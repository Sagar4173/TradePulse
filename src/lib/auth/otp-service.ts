import { AuthError } from "./errors";
import {
  AmbiguousPhoneMatchError,
  isNormalizedIndianPhone,
} from "./phone";
import type {
  AuthSession,
  AuthUser,
  OtpServiceDeps,
} from "./types";

export type RequestOtpResult = {
  challengeId: string;
  expiresAt: Date;
  resendAt: Date;
  devCode?: string;
};

export type VerifyOtpResult = {
  token: string;
  expiresAt: Date;
  sessionId: string;
  user: AuthUser;
};

function secondsUntil(target: Date, now: Date): number {
  return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 1_000));
}

/**
 * Creates a short-lived OTP challenge after enforcing per-phone and per-IP
 * request limits.
 *
 * Admission is split into two phases so rate-limited requests never pay the
 * scrypt cost:
 *   1. Inside the advisory-lock transaction, an admission reservation is
 *      created. It counts toward both windows immediately.
 *   2. After the lock is released, the code is generated and hashed, and the
 *      challenge is persisted against the live reservation. The provider call
 *      happens after that transaction commits.
 *
 * A crashed request leaves a PENDING reservation that expires to ABANDONED and
 * still counts for the rate window, so a crash cannot reset the limits.
 */
export async function requestOtp(
  deps: OtpServiceDeps,
  input: { phone: string; ipHash?: string | null },
): Promise<RequestOtpResult> {
  const { store, config, provider } = deps;

  if (!isNormalizedIndianPhone(input.phone)) {
    throw new AuthError("INVALID_PHONE", "A valid Indian mobile number is required.");
  }

  const requestIpHash = input.ipHash ?? null;
  const reservation = await store.withOtpAdmissionLock(
    { phone: input.phone, requestIpHash },
    async (lockedStore) => {
      const lockedNow = deps.now();
      await lockedStore.expireStaleOtpReservations(
        { phone: input.phone, requestIpHash },
        lockedNow,
      );
      const latestRequestAt =
        await lockedStore.latestActiveOtpRequestForPhone(
          input.phone,
          lockedNow,
        );

      if (latestRequestAt) {
        const resendAt = new Date(
          latestRequestAt.getTime() +
            config.otpResendCooldownSeconds * 1_000,
        );

        if (resendAt > lockedNow) {
          throw new AuthError(
            "RESEND_COOLDOWN",
            "Please wait before requesting another code.",
            { retryAfterSeconds: secondsUntil(resendAt, lockedNow) },
          );
        }
      }

      const windowStart = new Date(
        lockedNow.getTime() - config.otpRateWindowSeconds * 1_000,
      );
      const recentPhoneRequests = await lockedStore.countOtpRequestsSince(
        input.phone,
        windowStart,
      );

      if (recentPhoneRequests >= config.otpMaxRequestsPerWindow) {
        throw new AuthError(
          "RATE_LIMITED",
          "Too many verification requests. Please try again later.",
          { retryAfterSeconds: config.otpRateWindowSeconds },
        );
      }

      if (requestIpHash) {
        const recentIpRequests =
          await lockedStore.countOtpRequestsByIpSince(
            requestIpHash,
            windowStart,
          );

        if (recentIpRequests >= config.otpMaxRequestsPerIpWindow) {
          throw new AuthError(
            "RATE_LIMITED",
            "Too many verification requests. Please try again later.",
            { retryAfterSeconds: config.otpRateWindowSeconds },
          );
        }
      }

      return lockedStore.createOtpReservation({
        phone: input.phone,
        requestIpHash,
        createdAt: lockedNow,
        expiresAt: new Date(
          lockedNow.getTime() + config.otpReservationLeaseSeconds * 1_000,
        ),
      });
    },
  );

  const code = deps.generateCode();
  const codeHash = await deps.hashOtp(code);
  const completedAt = deps.now();
  const challenge = await store.completeOtpReservation({
    reservationId: reservation.id,
    phone: input.phone,
    codeHash,
    maxAttempts: config.otpMaxAttempts,
    expiresAt: new Date(
      completedAt.getTime() + config.otpTtlSeconds * 1_000,
    ),
    createdAt: completedAt,
    requestIpHash,
    completedAt,
  });

  if (!challenge) {
    // The admission lease elapsed or the reservation was already completed.
    // Fail closed; the request remains counted for the rate window.
    throw new AuthError(
      "OTP_REQUEST_FAILED",
      "Verification could not be completed. Please try again.",
    );
  }

  let devCode: string | undefined;

  try {
    await provider.send({ phone: input.phone, code });

    // The provider contract cannot return a code. Only the explicit local
    // development provider may reveal it, and only when the runtime config
    // permits development OTP. The server action applies a second gate.
    if (
      provider.kind === "development" &&
      config.devOtpEnabled &&
      !config.isProduction
    ) {
      devCode = code;
    }
  } catch {
    // Make the unsent challenge unusable without erasing rate-limit evidence.
    // The reservation remains counted per phone/IP, but it no longer holds the
    // resend cooldown because no code reached the user. Provider details are
    // never surfaced to the caller.
    try {
      await store.failOtpReservation(
        reservation.id,
        challenge.id,
        deps.now(),
      );
    } catch {
      // If failure bookkeeping also fails, the reservation remains counted and
      // the cooldown stays closed. Never surface database details.
    }

    throw new AuthError(
      "PROVIDER_UNAVAILABLE",
      "Verification is temporarily unavailable.",
    );
  }

  return {
    challengeId: challenge.id,
    expiresAt: challenge.expiresAt,
    resendAt: new Date(
      reservation.createdAt.getTime() +
        config.otpResendCooldownSeconds * 1_000,
    ),
    ...(devCode ? { devCode } : {}),
  };
}

/**
 * Verifies an OTP, consumes it exactly once, provisions a retailer account on
 * first successful verification, and issues a fresh database-backed session.
 */
export async function verifyOtp(
  deps: OtpServiceDeps,
  input: { challengeId: string; code: string; ipHash?: string | null },
): Promise<VerifyOtpResult> {
  const { store, config } = deps;
  const now = deps.now();
  const challenge = await store.findOtpChallengeById(input.challengeId);

  if (!challenge) {
    throw new AuthError("OTP_NOT_FOUND", "The verification code is not valid.");
  }

  if (challenge.consumedAt) {
    throw new AuthError(
      "OTP_ALREADY_USED",
      "This verification code has already been used.",
    );
  }

  if (challenge.expiresAt <= now) {
    throw new AuthError(
      "OTP_EXPIRED",
      "This verification code has expired.",
    );
  }

  if (challenge.attempts >= challenge.maxAttempts) {
    throw new AuthError(
      "OTP_LOCKED",
      "Too many incorrect attempts. Request a new code.",
    );
  }

  const attempts = await store.incrementOtpAttempts(challenge.id);

  if (attempts > challenge.maxAttempts) {
    throw new AuthError(
      "OTP_LOCKED",
      "Too many incorrect attempts. Request a new code.",
    );
  }

  if (!/^\d{6}$/.test(input.code)) {
    throw new AuthError("INVALID_OTP", "The verification code is not valid.", {
      attemptsRemaining: Math.max(0, challenge.maxAttempts - attempts),
    });
  }

  const isValid = await deps.verifyOtpHash(input.code, challenge.codeHash);

  if (!isValid) {
    throw new AuthError("INVALID_OTP", "The verification code is not valid.", {
      attemptsRemaining: Math.max(0, challenge.maxAttempts - attempts),
    });
  }

  const consumed = await store.consumeOtpChallenge(challenge.id, now);

  if (!consumed) {
    throw new AuthError(
      "OTP_ALREADY_USED",
      "This verification code has already been used.",
    );
  }

  let user: AuthUser;

  try {
    user = await store.ensureUserForVerifiedPhone(challenge.phone, now);
  } catch (error) {
    if (error instanceof AmbiguousPhoneMatchError) {
      // Never choose between duplicate accounts or create another one.
      throw new AuthError(
        "ACCOUNT_AMBIGUOUS",
        "Multiple accounts match this phone number. Contact an administrator.",
      );
    }

    throw error;
  }

  if (user.status !== "ACTIVE") {
    throw new AuthError(
      "ACCOUNT_DISABLED",
      "This account cannot sign in. Contact your administrator.",
    );
  }

  const token = deps.generateSessionToken();
  const tokenHash = deps.hashToken(token);
  const expiresAt = new Date(
    now.getTime() + config.sessionTtlSeconds * 1_000,
  );
  const session = await store.createSession({
    tokenHash,
    userId: user.id,
    expiresAt,
    createdAt: now,
    ipHash: input.ipHash ?? null,
  });

  await store.consumeOutstandingOtpChallenges(challenge.phone, now);
  await store.recordSuccessfulLogin(user.id, now);

  return {
    token,
    expiresAt,
    sessionId: session.id,
    user,
  };
}

export function toAuthSession(result: VerifyOtpResult): AuthSession {
  return {
    sessionId: result.sessionId,
    user: result.user,
    expiresAt: result.expiresAt,
  };
}

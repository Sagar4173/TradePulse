"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import type {
  RequestOtpState,
  VerifyOtpState,
} from "./action-types";
import { buildRequestOtpSentState } from "./action-state";
import { hashIdentifier } from "./crypto";
import { AuthError } from "./errors";
import { requestOtp, verifyOtp } from "./otp-service";
import { normalizeIndianPhone } from "./phone";
import { safeNextPath } from "./redirect";
import {
  clearSessionCookie,
  getSessionToken,
  setSessionCookie,
} from "./session";
import { revokeSessionToken } from "./session-service";
import {
  getAuthConfig,
  getOtpServiceDeps,
  getSessionServiceDeps,
} from "./runtime";

async function getRequestIpHash(): Promise<string | null> {
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const ip =
    forwardedFor?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip")?.trim();

  return ip ? hashIdentifier(`ip:${ip}`) : null;
}

function requestErrorMessage(error: unknown): string {
  if (!(error instanceof AuthError)) {
    return "We could not send a verification code right now. Please try again later.";
  }

  switch (error.code) {
    case "INVALID_PHONE":
      return "Enter a valid 10-digit Indian mobile number.";
    case "RESEND_COOLDOWN":
      return `Please wait ${error.retryAfterSeconds ?? 60} seconds before requesting another code.`;
    case "RATE_LIMITED":
      return "Too many verification requests. Please wait before trying again.";
    case "PROVIDER_UNAVAILABLE":
      return "Verification is temporarily unavailable. Please try again later.";
    default:
      return "We could not send a verification code right now. Please try again later.";
  }
}

function verifyErrorMessage(error: unknown): string {
  if (!(error instanceof AuthError)) {
    return "We could not verify that code right now. Please try again.";
  }

  switch (error.code) {
    case "OTP_EXPIRED":
      return "That code has expired. Request a new code.";
    case "OTP_LOCKED":
      return "Too many incorrect attempts. Request a new code.";
    case "OTP_ALREADY_USED":
      return "That code has already been used. Request a new code.";
    case "ACCOUNT_DISABLED":
    case "ACCOUNT_AMBIGUOUS":
      return "Unable to sign in. Contact your administrator if you need help.";
    case "INVALID_OTP":
      return error.attemptsRemaining === undefined
        ? "That code is not correct. Check it and try again."
        : `That code is not correct. ${error.attemptsRemaining} attempt${
            error.attemptsRemaining === 1 ? "" : "s"
          } remaining.`;
    default:
      return "That code is not valid. Request a new code.";
  }
}

export async function requestOtpAction(
  _previousState: RequestOtpState,
  formData: FormData,
): Promise<RequestOtpState> {
  const phone = normalizeIndianPhone(String(formData.get("phone") ?? ""));

  if (!phone) {
    return {
      status: "error",
      message: "Enter a valid 10-digit Indian mobile number.",
      challengeId: null,
      phone: null,
      devCode: null,
      resendAt: null,
      expiresAt: null,
    };
  }

  try {
    const result = await requestOtp(getOtpServiceDeps(), {
      phone,
      ipHash: await getRequestIpHash(),
    });

    return buildRequestOtpSentState({
      result,
      phone,
      config: getAuthConfig(),
    });
  } catch (error) {
    return {
      status: "error",
      message: requestErrorMessage(error),
      challengeId: null,
      phone,
      devCode: null,
      resendAt: null,
      expiresAt: null,
    };
  }
}

export async function verifyOtpAction(
  _previousState: VerifyOtpState,
  formData: FormData,
): Promise<VerifyOtpState> {
  const challengeId = String(formData.get("challengeId") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  const nextPath = safeNextPath(String(formData.get("next") ?? ""));

  if (!challengeId || !/^\d{6}$/.test(code)) {
    return {
      status: "error",
      message: "Enter the 6-digit verification code.",
      challengeId: challengeId || null,
    };
  }

  let result;

  try {
    result = await verifyOtp(getOtpServiceDeps(), {
      challengeId,
      code,
      ipHash: await getRequestIpHash(),
    });
  } catch (error) {
    return {
      status: "error",
      message: verifyErrorMessage(error),
      challengeId,
    };
  }

  // Session fixation protection: discard any pre-authentication session
  // before setting the freshly issued token.
  const previousToken = await getSessionToken();

  if (previousToken) {
    try {
      await revokeSessionToken(getSessionServiceDeps(), previousToken);
    } catch {
      // The new session is independent; a failed cleanup must not block login.
    }
  }

  await setSessionCookie(result.token, result.expiresAt);
  redirect(nextPath);
}

export async function logoutAction(): Promise<void> {
  const token = await getSessionToken();

  if (token) {
    try {
      await revokeSessionToken(getSessionServiceDeps(), token);
    } catch {
      // Clearing the browser cookie still ends the local session.
    }
  }

  await clearSessionCookie();
  redirect("/login");
}

import type { AuthConfig } from "./types";

type Environment = Record<string, string | undefined>;

function positiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, maximum);
}

const DEFAULT_OTP_TTL_SECONDS = 300;
const DEFAULT_OTP_MAX_ATTEMPTS = 5;
const DEFAULT_RESEND_COOLDOWN_SECONDS = 60;
const DEFAULT_RESERVATION_LEASE_SECONDS = 60;
const MIN_RESERVATION_LEASE_SECONDS = 10;
const DEFAULT_RATE_WINDOW_MINUTES = 15;
const DEFAULT_MAX_REQUESTS_PER_WINDOW = 5;
const DEFAULT_MAX_REQUESTS_PER_IP_WINDOW = 20;
const DEFAULT_SESSION_TTL_DAYS = 7;

/**
 * Authentication tuning is environment-driven, but every value has a bounded
 * production-safe default. Invalid values never disable rate limiting.
 */
export function loadAuthConfig(env: Environment = process.env): AuthConfig {
  // Vercel marks production deployments with VERCEL_ENV. Treat either signal as
  // production so a misconfigured NODE_ENV cannot enable development OTP.
  const isProduction =
    env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
  const rateWindowMinutes = positiveInteger(
    env.AUTH_OTP_RATE_WINDOW_MINUTES,
    DEFAULT_RATE_WINDOW_MINUTES,
    60,
  );

  return {
    otpLength: 6,
    otpTtlSeconds: positiveInteger(
      env.AUTH_OTP_TTL_SECONDS,
      DEFAULT_OTP_TTL_SECONDS,
      900,
    ),
    otpMaxAttempts: positiveInteger(
      env.AUTH_OTP_MAX_ATTEMPTS,
      DEFAULT_OTP_MAX_ATTEMPTS,
      10,
    ),
    otpResendCooldownSeconds: positiveInteger(
      env.AUTH_OTP_RESEND_COOLDOWN_SECONDS,
      DEFAULT_RESEND_COOLDOWN_SECONDS,
      600,
    ),
    otpReservationLeaseSeconds: Math.max(
      MIN_RESERVATION_LEASE_SECONDS,
      positiveInteger(
        env.AUTH_OTP_RESERVATION_LEASE_SECONDS,
        DEFAULT_RESERVATION_LEASE_SECONDS,
        300,
      ),
    ),
    otpRateWindowSeconds: rateWindowMinutes * 60,
    otpMaxRequestsPerWindow: positiveInteger(
      env.AUTH_OTP_MAX_REQUESTS_PER_WINDOW,
      DEFAULT_MAX_REQUESTS_PER_WINDOW,
      20,
    ),
    otpMaxRequestsPerIpWindow: positiveInteger(
      env.AUTH_OTP_MAX_REQUESTS_PER_IP_WINDOW,
      DEFAULT_MAX_REQUESTS_PER_IP_WINDOW,
      200,
    ),
    sessionTtlSeconds:
      positiveInteger(env.AUTH_SESSION_TTL_DAYS, DEFAULT_SESSION_TTL_DAYS, 30) *
      24 *
      60 *
      60,
    // A development OTP is never enabled in a production runtime, even if the
    // flag is accidentally set there.
    devOtpEnabled: !isProduction && env.AUTH_DEV_OTP_ENABLED === "true",
    isProduction,
  };
}

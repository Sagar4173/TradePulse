export type AuthErrorCode =
  | "INVALID_PHONE"
  | "RESEND_COOLDOWN"
  | "RATE_LIMITED"
  | "OTP_REQUEST_FAILED"
  | "PROVIDER_UNAVAILABLE"
  | "OTP_NOT_FOUND"
  | "OTP_EXPIRED"
  | "OTP_ALREADY_USED"
  | "OTP_LOCKED"
  | "INVALID_OTP"
  | "ACCOUNT_DISABLED"
  | "ACCOUNT_AMBIGUOUS";

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly retryAfterSeconds: number | undefined;
  readonly attemptsRemaining: number | undefined;

  constructor(
    code: AuthErrorCode,
    message: string,
    options?: { retryAfterSeconds?: number; attemptsRemaining?: number },
  ) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.retryAfterSeconds = options?.retryAfterSeconds;
    this.attemptsRemaining = options?.attemptsRemaining;
  }
}

/**
 * The admission keys stayed contended beyond the request's lock-wait budget.
 * This is an infrastructure-level condition, not a domain outcome; callers
 * must translate it into a controlled retry response instead of a server
 * error.
 */
export class OtpAdmissionBusyError extends Error {
  constructor() {
    super("OTP admission lock wait exceeded the configured budget.");
    this.name = "OtpAdmissionBusyError";
  }
}

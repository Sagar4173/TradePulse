export type SmsProviderErrorCategory =
  | "timeout"
  | "network"
  | "authentication"
  | "rejected"
  | "rate_limited"
  | "server"
  | "http";

/**
 * Normalized provider failure. Messages intentionally contain no request body,
 * response body, phone number, OTP, or credential. Callers map this to the
 * generic authentication error shown to the user.
 */
export class SmsProviderError extends Error {
  readonly category: SmsProviderErrorCategory;
  readonly status: number | undefined;

  constructor(
    category: SmsProviderErrorCategory,
    message: string,
    options?: { status?: number },
  ) {
    super(message);
    this.name = "SmsProviderError";
    this.category = category;
    this.status = options?.status;
  }
}

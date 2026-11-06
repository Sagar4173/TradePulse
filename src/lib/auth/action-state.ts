import type { RequestOtpState } from "./action-types";
import type { RequestOtpResult } from "./otp-service";
import type { AuthConfig } from "./types";

type DevelopmentCodePolicy = Pick<
  AuthConfig,
  "devOtpEnabled" | "isProduction"
>;

/**
 * Server-action boundary for a sent OTP. The OTP service already suppresses
 * development codes in production; this second gate ensures a code can never
 * be serialized into a production response even if a future provider or service
 * change accidentally supplies one.
 */
export function buildRequestOtpSentState(input: {
  result: RequestOtpResult;
  phone: string;
  config: DevelopmentCodePolicy;
}): RequestOtpState {
  const devCode =
    input.config.devOtpEnabled &&
    !input.config.isProduction &&
    input.result.devCode
      ? input.result.devCode
      : null;

  return {
    status: "sent",
    message: "Enter the 6-digit code sent to your phone.",
    challengeId: input.result.challengeId,
    phone: input.phone,
    devCode,
    resendAt: input.result.resendAt.getTime(),
    expiresAt: input.result.expiresAt.getTime(),
  };
}

import type { OtpProvider } from "../types";
import { SmsProviderError } from "./errors";
import { postSmsRequest } from "./http";
import { parseJsonObject } from "./json";
import type { Msg91Config, SmsProviderDeps } from "./types";

const MSG91_OTP_URL = "https://control.msg91.com/api/v5/otp";

/**
 * MSG91 SendOTP adapter. The OTP is generated and verified by TradePulse; MSG91
 * only delivers it. MSG91 still returns HTTP 200 for some application errors,
 * so the response body must explicitly report success.
 */
export function createMsg91Provider(
  config: Msg91Config,
  deps: SmsProviderDeps = {},
): OtpProvider {
  return {
    id: "sms:msg91",
    kind: "sms",
    async send({ phone, code, ttlSeconds }) {
      const response = await postSmsRequest(
        {
          url: MSG91_OTP_URL,
          headers: {
            "Content-Type": "application/json",
            authkey: config.authKey,
          },
          body: JSON.stringify({
            template_id: config.templateId,
            mobile: phone.replace(/^\+/, ""),
            otp: code,
            otp_expiry: Math.max(1, Math.ceil(ttlSeconds / 60)),
          }),
          timeoutMs: config.timeoutMs,
        },
        deps,
      );

      const body = parseJsonObject(response.body);

      if (!body || body.type !== "success") {
        throw new SmsProviderError(
          "rejected",
          "The SMS provider rejected the message request.",
          { status: response.status },
        );
      }
    },
  };
}

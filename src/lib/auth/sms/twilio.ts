import type { OtpProvider } from "../types";
import { SmsProviderError } from "./errors";
import { postSmsRequest } from "./http";
import { parseJsonObject } from "./json";
import { renderSmsMessage } from "./message";
import type { SmsProviderDeps, TwilioConfig } from "./types";

const TWILIO_API_BASE =
  "https://api.twilio.com/2010-04-01/Accounts";
const FAILED_MESSAGE_STATUSES = new Set(["failed", "undelivered", "canceled"]);

/**
 * Twilio Programmable Messaging adapter. It intentionally uses the Messages
 * resource rather than Twilio Verify so TradePulse keeps sole ownership of OTP
 * generation, hashing, expiry, attempt limits, and single-use consumption.
 */
export function createTwilioProvider(
  config: TwilioConfig,
  deps: SmsProviderDeps = {},
): OtpProvider {
  return {
    id: "sms:twilio",
    kind: "sms",
    async send({ phone, code, ttlSeconds }) {
      const form = new URLSearchParams();
      form.set("To", phone);
      form.set("Body", renderSmsMessage(config.messageTemplate, code, ttlSeconds));

      if (config.messagingServiceSid) {
        form.set("MessagingServiceSid", config.messagingServiceSid);
      } else if (config.fromNumber) {
        form.set("From", config.fromNumber);
      }

      const authorization = Buffer.from(
        `${config.accountSid}:${config.authToken}`,
      ).toString("base64");

      const response = await postSmsRequest(
        {
          url: `${TWILIO_API_BASE}/${encodeURIComponent(config.accountSid)}/Messages.json`,
          headers: {
            Authorization: `Basic ${authorization}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form.toString(),
          timeoutMs: config.timeoutMs,
        },
        deps,
      );

      const body = parseJsonObject(response.body);
      const sid = typeof body?.sid === "string" ? body.sid : "";
      const status = typeof body?.status === "string" ? body.status.toLowerCase() : "";

      if (!sid || FAILED_MESSAGE_STATUSES.has(status)) {
        throw new SmsProviderError(
          "rejected",
          "The SMS provider returned an unexpected response.",
          { status: response.status },
        );
      }
    },
  };
}

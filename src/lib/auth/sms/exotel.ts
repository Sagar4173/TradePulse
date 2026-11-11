import type { OtpProvider } from "../types";
import { SmsProviderError } from "./errors";
import { postSmsRequest } from "./http";
import { parseJsonObject } from "./json";
import { renderSmsMessage } from "./message";
import type { ExotelConfig, SmsProviderDeps } from "./types";

const FAILED_MESSAGE_STATUSES = new Set(["failed", "undelivered"]);

/**
 * Exotel SMS adapter for India DLT traffic. The approved DLT entity and
 * template identifiers are required; the rendered body must match the approved
 * template text exactly. A 2xx response means Exotel accepted the message, not
 * that the handset received it.
 */
export function createExotelProvider(
  config: ExotelConfig,
  deps: SmsProviderDeps = {},
): OtpProvider {
  return {
    id: "sms:exotel",
    kind: "sms",
    async send({ phone, code, ttlSeconds }) {
      const form = new URLSearchParams();
      form.set("From", config.senderId);
      form.set("To", phone);
      form.set("Body", renderSmsMessage(config.messageTemplate, code, ttlSeconds));
      form.set("DltEntityId", config.dltEntityId);
      form.set("DltTemplateId", config.dltTemplateId);
      form.set("SmsType", "transactional");
      form.set("Priority", "high");

      const authorization = Buffer.from(
        `${config.apiKey}:${config.apiToken}`,
      ).toString("base64");

      const response = await postSmsRequest(
        {
          url: `https://${config.subdomain}/v1/Accounts/${encodeURIComponent(
            config.accountSid,
          )}/Sms/send`,
          headers: {
            Authorization: `Basic ${authorization}`,
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form.toString(),
          timeoutMs: config.timeoutMs,
        },
        deps,
      );

      const body = parseJsonObject(response.body);
      const rawMessage = body?.SMSMessage;
      const message =
        rawMessage && typeof rawMessage === "object" && !Array.isArray(rawMessage)
          ? (rawMessage as Record<string, unknown>)
          : null;
      const sid = typeof message?.Sid === "string" ? message.Sid : "";
      const status =
        typeof message?.Status === "string" ? message.Status.toLowerCase() : "";

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

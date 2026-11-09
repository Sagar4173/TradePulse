import type { OtpProvider } from "../types";
import { createExotelProvider } from "./exotel";
import { createMsg91Provider } from "./msg91";
import { createTwilioProvider } from "./twilio";
import type { SmsConfig, SmsProviderDeps } from "./types";

export { loadSmsConfig } from "./config";
export type { SmsConfigResult } from "./config";
export { SmsProviderError } from "./errors";
export type { SmsProviderErrorCategory } from "./errors";
export type {
  ExotelConfig,
  Msg91Config,
  SmsConfig,
  SmsProviderDeps,
  SmsProviderName,
  TwilioConfig,
} from "./types";

function createAdapter(
  config: SmsConfig,
  deps: SmsProviderDeps,
): OtpProvider {
  switch (config.provider) {
    case "msg91":
      return createMsg91Provider(config, deps);
    case "twilio":
      return createTwilioProvider(config, deps);
    case "exotel":
      return createExotelProvider(config, deps);
  }
}

/**
 * Creates the configured delivery provider. Duplicate-send protection lives in
 * the OTP service's database admission lock and resend cooldown, which are
 * enforced across every server instance before a code is generated.
 */
export function createSmsProvider(
  config: SmsConfig,
  deps: SmsProviderDeps = {},
): OtpProvider {
  return createAdapter(config, deps);
}

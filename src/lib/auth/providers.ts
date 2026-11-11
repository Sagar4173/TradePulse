import { checkDevelopmentDatabaseTarget } from "../dev/dev-target";
import { createSmsProvider, loadSmsConfig } from "./sms";
import type { OtpProvider } from "./types";

type Environment = Record<string, string | undefined>;

export class OtpProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OtpProviderUnavailableError";
  }
}

const developmentProvider: OtpProvider = {
  id: "development",
  kind: "development",
  async send() {
    // The OTP service, not the provider, decides whether the generated code may
    // be returned to the local UI. Providers never return the code.
  },
};

const unavailableProvider: OtpProvider = {
  id: "unconfigured",
  kind: "sms",
  async send() {
    throw new OtpProviderUnavailableError(
      "OTP SMS provider is not configured.",
    );
  },
};

/**
 * Provider boundary for OTP delivery. Production always fails closed unless a
 * complete, supported SMS provider is configured; the development provider is
 * impossible in production even if AUTH_DEV_OTP_ENABLED is set by mistake.
 *
 * Outside production, the development provider requires both the explicit
 * development flag and a verifiable non-production database target. NODE_ENV
 * alone is not trusted: an allowlisted host plus an explicit fingerprint of the
 * actual connection target must match, so a copied production DATABASE_URL
 * cannot silently enable developer OTP codes. A verified development target
 * takes precedence over configured SMS so local work does not send real texts.
 * If the flag is set but the target is unverified, selection fails closed
 * instead of falling through to a real SMS provider.
 */
export function createOtpProvider(options: {
  env: Environment;
  isProduction: boolean;
}): OtpProvider {
  if (!options.isProduction && options.env.AUTH_DEV_OTP_ENABLED === "true") {
    // The operator asked for local development codes. If the target cannot be
    // verified as non-production, fail closed instead of silently sending real
    // SMS through a configured provider.
    return checkDevelopmentDatabaseTarget(options.env).ok
      ? developmentProvider
      : unavailableProvider;
  }

  const sms = loadSmsConfig(options.env);

  if (!sms.ok) {
    return unavailableProvider;
  }

  return createSmsProvider(sms.config);
}

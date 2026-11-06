import { checkDevelopmentDatabaseTarget } from "../dev/dev-target";
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
 * Provider boundary for future SMS integrations. No vendor API is invented
 * here. Production always fails closed until a real provider is implemented
 * and configured; the development provider is impossible in production even if
 * AUTH_DEV_OTP_ENABLED is set by mistake.
 *
 * Outside production, the development provider additionally requires a
 * verifiable non-production database target. NODE_ENV alone is not trusted:
 * an allowlisted host plus an explicit fingerprint of the actual connection
 * target must match, so a copied production DATABASE_URL cannot silently enable
 * developer OTP codes.
 */
export function createOtpProvider(options: {
  env: Environment;
  isProduction: boolean;
}): OtpProvider {
  if (options.isProduction || options.env.AUTH_DEV_OTP_ENABLED !== "true") {
    return unavailableProvider;
  }

  if (!checkDevelopmentDatabaseTarget(options.env).ok) {
    return unavailableProvider;
  }

  return developmentProvider;
}

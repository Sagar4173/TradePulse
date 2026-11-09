import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeDevelopmentTargetFingerprint } from "../../dev/dev-target";
import { createOtpProvider } from "../providers";

const DEV_HOST = "ep-dev-123.ap-southeast-1.aws.neon.tech";
const DEV_DATABASE = "tradepulse_dev";
const DEV_URL = `postgresql://dev_user:dev-password@${DEV_HOST}:5432/${DEV_DATABASE}?sslmode=require`;
const PRODUCTION_HOST = "ep-production-456.ap-southeast-1.aws.neon.tech";
const PRODUCTION_URL = `postgresql://owner:production-password@${PRODUCTION_HOST}:5432/neondb?sslmode=require`;

function fingerprint(host = DEV_HOST, database = DEV_DATABASE): string {
  return computeDevelopmentTargetFingerprint({
    host,
    port: 5432,
    database,
    schema: "public",
  });
}

function developmentEnvironment(
  overrides?: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    NODE_ENV: "development",
    AUTH_DEV_OTP_ENABLED: "true",
    DATABASE_URL: DEV_URL,
    DIRECT_URL: DEV_URL,
    TRADEPULSE_DEV_TARGET_HOSTS: DEV_HOST,
    TRADEPULSE_DEV_TARGET_FINGERPRINT: fingerprint(),
    ...overrides,
  };
}

function smsEnvironment(
  overrides?: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    AUTH_SMS_PROVIDER: "msg91",
    AUTH_SMS_MSG91_AUTH_KEY: "sms-auth-key-secret",
    AUTH_SMS_MSG91_TEMPLATE_ID: "sms-template-id",
    ...overrides,
  };
}

const SEND_INPUT = {
  phone: "+919876543210",
  code: "123456",
  ttlSeconds: 300,
};

describe("OTP provider selection", () => {
  it("selects the development provider for a verified non-production target", async () => {
    const provider = createOtpProvider({
      env: developmentEnvironment(),
      isProduction: false,
    });

    const result = await provider.send({
      ...SEND_INPUT,
    });

    assert.equal(result, undefined);
    assert.equal(provider.id, "development");
    assert.equal(provider.kind, "development");
  });

  it("fails closed when the development database target is not explicitly verified", async () => {
    for (const env of [
      developmentEnvironment({ TRADEPULSE_DEV_TARGET_FINGERPRINT: undefined }),
      developmentEnvironment({ TRADEPULSE_DEV_TARGET_HOSTS: undefined }),
      developmentEnvironment({ DATABASE_URL: undefined }),
      developmentEnvironment({ TRADEPULSE_PRODUCTION_TARGET_HOSTS: DEV_HOST }),
    ]) {
      const provider = createOtpProvider({ env, isProduction: false });

      await assert.rejects(
        provider.send(SEND_INPUT),
        /not configured/i,
      );
    }
  });

  it("fails closed when DIRECT_URL points at a production database", async () => {
    const provider = createOtpProvider({
      env: developmentEnvironment({ DIRECT_URL: PRODUCTION_URL }),
      isProduction: false,
    });

    await assert.rejects(
      provider.send(SEND_INPUT),
      /not configured/i,
    );
  });

  it("fails closed when DATABASE_URL points at a production database", async () => {
    const provider = createOtpProvider({
      env: developmentEnvironment({
        DATABASE_URL: PRODUCTION_URL,
        DIRECT_URL: DEV_URL,
        TRADEPULSE_DEV_TARGET_HOSTS: PRODUCTION_HOST,
        TRADEPULSE_DEV_TARGET_FINGERPRINT: fingerprint(
          PRODUCTION_HOST,
          "neondb",
        ),
      }),
      isProduction: false,
    });

    await assert.rejects(
      provider.send(SEND_INPUT),
      /not configured/i,
    );
  });

  it("fails closed in production even when the development flag is set", async () => {
    const provider = createOtpProvider({
      env: developmentEnvironment({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
      }),
      isProduction: true,
    });

    await assert.rejects(
      provider.send(SEND_INPUT),
      /not configured/i,
    );
  });

  it("fails closed outside production when development OTP is not enabled", async () => {
    const provider = createOtpProvider({
      env: developmentEnvironment({ AUTH_DEV_OTP_ENABLED: undefined }),
      isProduction: false,
    });

    await assert.rejects(
      provider.send(SEND_INPUT),
      /not configured/i,
    );
  });

  it("fails closed when the development flag is set but its target is unverified, even if SMS is configured", async () => {
    const provider = createOtpProvider({
      env: developmentEnvironment({
        ...smsEnvironment(),
        NODE_ENV: "development",
        VERCEL_ENV: undefined,
        TRADEPULSE_DEV_TARGET_FINGERPRINT: fingerprint("other-host"),
      }),
      isProduction: false,
    });

    assert.equal(provider.id, "unconfigured");
    await assert.rejects(provider.send(SEND_INPUT), /not configured/i);
  });

  it("selects a configured SMS provider in production", () => {
    const provider = createOtpProvider({
      env: smsEnvironment(),
      isProduction: true,
    });

    assert.equal(provider.id, "sms:msg91");
    assert.equal(provider.kind, "sms");
    assert.equal(provider.id.includes("sms-auth-key-secret"), false);
  });

  it("selects a configured SMS provider outside production when development OTP is off", () => {
    const provider = createOtpProvider({
      env: {
        ...smsEnvironment(),
        NODE_ENV: "development",
        VERCEL_ENV: undefined,
        AUTH_DEV_OTP_ENABLED: "false",
      },
      isProduction: false,
    });

    assert.equal(provider.id, "sms:msg91");
    assert.equal(provider.kind, "sms");
  });

  it("keeps the verified development provider ahead of a configured SMS provider", () => {
    const provider = createOtpProvider({
      env: developmentEnvironment({
        ...smsEnvironment(),
        NODE_ENV: "development",
        VERCEL_ENV: undefined,
      }),
      isProduction: false,
    });

    assert.equal(provider.id, "development");
    assert.equal(provider.kind, "development");
  });

  it("fails closed in production when the SMS provider is incomplete", async () => {
    const provider = createOtpProvider({
      env: smsEnvironment({ AUTH_SMS_MSG91_AUTH_KEY: undefined }),
      isProduction: true,
    });

    await assert.rejects(provider.send(SEND_INPUT), /not configured/i);
    assert.equal(provider.id, "unconfigured");
  });

  it("fails closed in production when the SMS provider is unknown", async () => {
    const provider = createOtpProvider({
      env: smsEnvironment({ AUTH_SMS_PROVIDER: "unknown-vendor" }),
      isProduction: true,
    });

    await assert.rejects(provider.send(SEND_INPUT), /not configured/i);
    assert.equal(provider.id, "unconfigured");
  });
});

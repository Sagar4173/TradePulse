import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_SMS_TIMEOUT_MS, loadSmsConfig } from "../config";
import type { ExotelConfig, Msg91Config, TwilioConfig } from "../types";

const MSG91_ENV = {
  AUTH_SMS_PROVIDER: "msg91",
  AUTH_SMS_MSG91_AUTH_KEY: "test-msg91-auth-key",
  AUTH_SMS_MSG91_TEMPLATE_ID: "test-msg91-template",
};

const TWILIO_ENV = {
  AUTH_SMS_PROVIDER: "twilio",
  AUTH_SMS_TWILIO_ACCOUNT_SID: "AC11111111111111111111111111111111",
  AUTH_SMS_TWILIO_AUTH_TOKEN: "test-twilio-auth-token",
  AUTH_SMS_TWILIO_FROM_NUMBER: "+919876543210",
};

const EXOTEL_ENV = {
  AUTH_SMS_PROVIDER: "exotel",
  AUTH_SMS_EXOTEL_ACCOUNT_SID: "test-exotel-account",
  AUTH_SMS_EXOTEL_API_KEY: "test-exotel-api-key",
  AUTH_SMS_EXOTEL_API_TOKEN: "test-exotel-api-token",
  AUTH_SMS_EXOTEL_SENDER_ID: "TRDPLS",
  AUTH_SMS_EXOTEL_DLT_ENTITY_ID: "test-dlt-entity",
  AUTH_SMS_EXOTEL_DLT_TEMPLATE_ID: "test-dlt-template",
};

function expectConfig<T>(env: Record<string, string | undefined>): T {
  const result = loadSmsConfig(env);

  if (!result.ok) {
    throw new Error(result.errors.join("; "));
  }

  return result.config as T;
}

function expectErrors(env: Record<string, string | undefined>): string[] {
  const result = loadSmsConfig(env);

  if (result.ok) {
    throw new Error("expected configuration to be rejected");
  }

  return result.errors;
}

describe("loadSmsConfig", () => {
  it("loads a complete MSG91 configuration with bounded defaults", () => {
    const config = expectConfig<Msg91Config>(MSG91_ENV);

    assert.equal(config.provider, "msg91");
    assert.equal(config.authKey, "test-msg91-auth-key");
    assert.equal(config.templateId, "test-msg91-template");
    assert.equal(config.timeoutMs, DEFAULT_SMS_TIMEOUT_MS);
  });

  it("ignores the body template for MSG91 because its dashboard template is used", () => {
    const config = expectConfig<Msg91Config>({
      ...MSG91_ENV,
      AUTH_SMS_MESSAGE_TEMPLATE: "This body has no code placeholder.",
    });

    assert.equal(config.provider, "msg91");
    assert.equal("messageTemplate" in config, false);
  });

  it("loads Twilio with a From number", () => {
    const config = expectConfig<TwilioConfig>(TWILIO_ENV);

    assert.equal(config.provider, "twilio");
    assert.equal(config.fromNumber, "+919876543210");
    assert.equal(config.messagingServiceSid, null);
  });

  it("loads Twilio with a Messaging Service SID", () => {
    const config = expectConfig<TwilioConfig>({
      ...TWILIO_ENV,
      AUTH_SMS_TWILIO_FROM_NUMBER: undefined,
      AUTH_SMS_TWILIO_MESSAGING_SERVICE_SID:
        "MG11111111111111111111111111111111",
    });

    assert.equal(config.fromNumber, null);
    assert.equal(
      config.messagingServiceSid,
      "MG11111111111111111111111111111111",
    );
  });

  it("rejects Twilio when both sender options are configured", () => {
    const errors = expectErrors({
      ...TWILIO_ENV,
      AUTH_SMS_TWILIO_MESSAGING_SERVICE_SID:
        "MG11111111111111111111111111111111",
    });

    assert.ok(
      errors.some((error) => error.includes("exactly one of")),
      errors.join("; "),
    );
  });

  it("rejects Twilio when no sender option is configured", () => {
    const errors = expectErrors({
      ...TWILIO_ENV,
      AUTH_SMS_TWILIO_FROM_NUMBER: undefined,
    });

    assert.ok(
      errors.some((error) => error.includes("AUTH_SMS_TWILIO_FROM_NUMBER")),
      errors.join("; "),
    );
  });

  it("loads a complete Exotel configuration with DLT identifiers", () => {
    const config = expectConfig<ExotelConfig>(EXOTEL_ENV);

    assert.equal(config.provider, "exotel");
    assert.equal(config.subdomain, "api.exotel.com");
    assert.equal(config.senderId, "TRDPLS");
    assert.equal(config.dltEntityId, "test-dlt-entity");
    assert.equal(config.dltTemplateId, "test-dlt-template");
  });

  it("accepts a provider name case-insensitively", () => {
    const config = expectConfig<Msg91Config>({
      ...MSG91_ENV,
      AUTH_SMS_PROVIDER: " MSG91 ",
    });

    assert.equal(config.provider, "msg91");
  });

  it("rejects a missing provider selection", () => {
    const errors = expectErrors({});

    assert.equal(errors.length, 1);
    assert.match(errors[0] ?? "", /AUTH_SMS_PROVIDER/);
  });

  it("rejects an unknown provider without echoing its value", () => {
    const errors = expectErrors({
      AUTH_SMS_PROVIDER: "unknown-provider-secret",
    });

    assert.ok(errors.some((error) => error.includes("AUTH_SMS_PROVIDER")));
    assert.equal(errors.join("; ").includes("unknown-provider-secret"), false);
    assert.ok(errors.join("; ").includes("msg91"));
  });

  it("reports missing credentials by environment variable name only", () => {
    const errors = expectErrors({
      AUTH_SMS_PROVIDER: "msg91",
      AUTH_SMS_MSG91_AUTH_KEY: "super-secret-auth-key",
    });

    const joined = errors.join("; ");
    assert.ok(joined.includes("AUTH_SMS_MSG91_TEMPLATE_ID"), joined);
    assert.equal(joined.includes("super-secret-auth-key"), false);
  });

  it("rejects an invalid timeout instead of silently accepting it", () => {
    const errors = expectErrors({
      ...MSG91_ENV,
      AUTH_SMS_TIMEOUT_MS: "not-a-number",
    });

    assert.ok(
      errors.some((error) => error.includes("AUTH_SMS_TIMEOUT_MS")),
      errors.join("; "),
    );
  });

  it("rejects a message template that cannot carry the code", () => {
    const errors = expectErrors({
      ...TWILIO_ENV,
      AUTH_SMS_MESSAGE_TEMPLATE: "Your TradePulse code is ready.",
    });

    assert.ok(
      errors.some((error) => error.includes("AUTH_SMS_MESSAGE_TEMPLATE")),
      errors.join("; "),
    );
  });

  it("rejects an Exotel subdomain outside the provider domain", () => {
    const errors = expectErrors({
      ...EXOTEL_ENV,
      AUTH_SMS_EXOTEL_SUBDOMAIN: "https://attacker.example",
    });

    assert.ok(
      errors.some((error) => error.includes("AUTH_SMS_EXOTEL_SUBDOMAIN")),
      errors.join("; "),
    );
  });
});

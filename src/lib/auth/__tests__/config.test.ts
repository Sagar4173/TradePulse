import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadAuthConfig } from "../config";

describe("loadAuthConfig", () => {
  it("uses secure production-safe defaults", () => {
    const config = loadAuthConfig({});

    assert.equal(config.otpLength, 6);
    assert.equal(config.otpTtlSeconds, 300);
    assert.equal(config.otpMaxAttempts, 5);
    assert.equal(config.otpResendCooldownSeconds, 60);
    assert.equal(config.otpReservationLeaseSeconds, 60);
    assert.equal(config.otpRateWindowSeconds, 900);
    assert.equal(config.otpMaxRequestsPerWindow, 5);
    assert.equal(config.otpMaxRequestsPerIpWindow, 20);
    assert.equal(config.sessionTtlSeconds, 7 * 24 * 60 * 60);
    assert.equal(config.devOtpEnabled, false);
    assert.equal(config.isProduction, false);
  });

  it("parses configured values", () => {
    const config = loadAuthConfig({
      NODE_ENV: "production",
      AUTH_OTP_TTL_SECONDS: "120",
      AUTH_OTP_MAX_ATTEMPTS: "3",
      AUTH_OTP_RESEND_COOLDOWN_SECONDS: "30",
      AUTH_OTP_RESERVATION_LEASE_SECONDS: "30",
      AUTH_OTP_RATE_WINDOW_MINUTES: "10",
      AUTH_OTP_MAX_REQUESTS_PER_WINDOW: "4",
      AUTH_OTP_MAX_REQUESTS_PER_IP_WINDOW: "12",
      AUTH_SESSION_TTL_DAYS: "2",
      AUTH_DEV_OTP_ENABLED: "true",
    });

    assert.equal(config.isProduction, true);
    assert.equal(config.otpTtlSeconds, 120);
    assert.equal(config.otpMaxAttempts, 3);
    assert.equal(config.otpResendCooldownSeconds, 30);
    assert.equal(config.otpReservationLeaseSeconds, 30);
    assert.equal(config.otpRateWindowSeconds, 600);
    assert.equal(config.otpMaxRequestsPerWindow, 4);
    assert.equal(config.otpMaxRequestsPerIpWindow, 12);
    assert.equal(config.sessionTtlSeconds, 2 * 24 * 60 * 60);
    assert.equal(config.devOtpEnabled, false);
  });

  it("treats Vercel production as production even if NODE_ENV is misconfigured", () => {
    const config = loadAuthConfig({
      NODE_ENV: "development",
      VERCEL_ENV: "production",
      AUTH_DEV_OTP_ENABLED: "true",
    });

    assert.equal(config.isProduction, true);
    assert.equal(config.devOtpEnabled, false);
  });

  it("ignores invalid and non-positive values", () => {
    const config = loadAuthConfig({
      AUTH_OTP_TTL_SECONDS: "-1",
      AUTH_OTP_MAX_ATTEMPTS: "not-a-number",
      AUTH_OTP_RESEND_COOLDOWN_SECONDS: "0",
      AUTH_OTP_RESERVATION_LEASE_SECONDS: "1",
      AUTH_OTP_MAX_REQUESTS_PER_WINDOW: "999",
      AUTH_SESSION_TTL_DAYS: "0",
    });

    assert.equal(config.otpTtlSeconds, 300);
    assert.equal(config.otpMaxAttempts, 5);
    assert.equal(config.otpResendCooldownSeconds, 60);
    assert.equal(config.otpReservationLeaseSeconds, 10);
    assert.equal(config.otpMaxRequestsPerWindow, 20);
    assert.equal(config.sessionTtlSeconds, 7 * 24 * 60 * 60);
  });
});

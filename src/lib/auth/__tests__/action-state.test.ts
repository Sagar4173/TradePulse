import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildRequestOtpSentState } from "../action-state";
import type { RequestOtpResult } from "../otp-service";

const START = new Date("2026-01-01T10:00:00.000Z");
const RESULT: RequestOtpResult = {
  challengeId: "challenge_1",
  expiresAt: new Date(START.getTime() + 300_000),
  resendAt: new Date(START.getTime() + 60_000),
  devCode: "123456",
};

describe("buildRequestOtpSentState", () => {
  it("includes the development code only when explicitly enabled outside production", () => {
    const state = buildRequestOtpSentState({
      result: RESULT,
      phone: "+919876543210",
      config: { devOtpEnabled: true, isProduction: false },
    });

    assert.equal(state.status, "sent");
    assert.equal(state.devCode, "123456");
  });

  it("omits the development code in production even if the result and flag contain one", () => {
    const state = buildRequestOtpSentState({
      result: RESULT,
      phone: "+919876543210",
      config: { devOtpEnabled: true, isProduction: true },
    });

    assert.equal(state.devCode, null);
    assert.equal(JSON.stringify(state).includes("123456"), false);
  });

  it("omits the development code when development OTP is disabled", () => {
    const state = buildRequestOtpSentState({
      result: RESULT,
      phone: "+919876543210",
      config: { devOtpEnabled: false, isProduction: false },
    });

    assert.equal(state.devCode, null);
    assert.equal(JSON.stringify(state).includes("123456"), false);
  });

  it("stays null when the OTP service did not provide a development code", () => {
    const state = buildRequestOtpSentState({
      result: { ...RESULT, devCode: undefined },
      phone: "+919876543210",
      config: { devOtpEnabled: true, isProduction: false },
    });

    assert.equal(state.devCode, null);
  });
});

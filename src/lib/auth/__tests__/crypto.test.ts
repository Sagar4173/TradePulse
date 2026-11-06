import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  generateOtpCode,
  hashOtpCode,
  hashSessionToken,
  verifyOtpCodeHash,
} from "../crypto";

describe("OTP cryptography", () => {
  it("generates exactly six digits", () => {
    for (let index = 0; index < 20; index += 1) {
      assert.match(generateOtpCode(), /^\d{6}$/);
    }
  });

  it("hashes OTPs with a random salt and verifies them", async () => {
    const first = await hashOtpCode("123456");
    const second = await hashOtpCode("123456");

    assert.notEqual(first, second);
    assert.equal(first.includes("123456"), false);
    assert.equal(await verifyOtpCodeHash("123456", first), true);
    assert.equal(await verifyOtpCodeHash("654321", first), false);
    assert.equal(await verifyOtpCodeHash("123456", "malformed"), false);
  });

  it("hashes session tokens deterministically without storing the token", () => {
    const token = "session-token-value";
    const hash = hashSessionToken(token);

    assert.equal(hash, hashSessionToken(token));
    assert.equal(hash.includes(token), false);
    assert.match(hash, /^[a-f0-9]{64}$/);
  });
});

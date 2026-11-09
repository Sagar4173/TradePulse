import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AuthError } from "../errors";
import { loadAuthConfig } from "../config";
import { hashSessionToken } from "../crypto";
import { requestOtp, verifyOtp } from "../otp-service";
import { AmbiguousPhoneMatchError } from "../phone";
import type { AuthConfig, OtpProvider, OtpServiceDeps } from "../types";
import { createMemoryAuthStore, type MemoryUserSeed } from "./memory-store";

const PHONE = "+919876543210";
const START = new Date("2026-01-01T10:00:00.000Z");

function setup(options?: {
  users?: MemoryUserSeed[];
  retailerPhones?: Record<string, { id: string; ownerName: string }>;
  linkRequests?: Array<{
    id?: string;
    userId: string;
    retailerId: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    createdAt?: Date;
  }>;
  config?: Partial<AuthConfig>;
  provider?: OtpProvider;
}) {
  const store = createMemoryAuthStore({
    users: options?.users,
    retailerPhones: options?.retailerPhones,
    linkRequests: options?.linkRequests,
  });
  const sent: Array<{ phone: string; code: string; ttlSeconds: number }> = [];
  const provider: OtpProvider =
    options?.provider ??
    {
      id: "test",
      kind: "development",
      async send(input) {
        sent.push(input);
      },
    };

  let now = START;
  let tokenSequence = 0;
  const config: AuthConfig = {
    ...loadAuthConfig({
      NODE_ENV: "test",
      AUTH_DEV_OTP_ENABLED: "true",
    }),
    ...options?.config,
  };
  const deps: OtpServiceDeps = {
    store,
    provider,
    config,
    now: () => now,
    generateCode: () => "123456",
    generateSessionToken: () => `raw-token-${++tokenSequence}`,
    hashOtp: async (code) => `otp-hash:${code}`,
    verifyOtpHash: async (code, hash) => hash === `otp-hash:${code}`,
    hashToken: hashSessionToken,
  };

  return {
    store,
    deps,
    sent,
    advance(seconds: number) {
      now = new Date(now.getTime() + seconds * 1_000);
    },
  };
}

async function expectAuthError(
  promise: Promise<unknown>,
  code: string,
): Promise<AuthError> {
  let caught: unknown;

  try {
    await promise;
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof AuthError, `expected AuthError ${code}`);
  assert.equal(caught.code, code);
  return caught;
}

describe("requestOtp", () => {
  it("creates a hashed challenge and sends the generated code", async () => {
    const { deps, store, sent } = setup();

    const result = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });

    assert.equal(result.challengeId, store.getChallenges()[0].id);
    assert.equal(result.devCode, "123456");
    assert.equal(result.expiresAt.getTime(), START.getTime() + 300_000);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], {
      phone: PHONE,
      code: "123456",
      ttlSeconds: 300,
    });
    assert.equal(store.getChallenges()[0].codeHash, "otp-hash:123456");
    assert.notEqual(store.getChallenges()[0].codeHash, "123456");
  });

  it("rejects an invalid phone before admission or delivery", async () => {
    const { deps, store, sent } = setup();

    await expectAuthError(
      requestOtp(deps, { phone: "+14155552671", ipHash: "ip-hash" }),
      "INVALID_PHONE",
    );

    assert.equal(store.getReservations().length, 0);
    assert.equal(store.getChallenges().length, 0);
    assert.equal(sent.length, 0);
  });

  it("passes the configured challenge TTL to the delivery provider", async () => {
    const { deps, sent } = setup({ config: { otpTtlSeconds: 120 } });

    await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });

    assert.equal(sent[0]?.ttlSeconds, 120);
  });

  it("records rate-limit admission before hashing the OTP", async () => {
    const { deps, store } = setup();
    const events: string[] = [];
    const originalHash = deps.hashOtp;
    const originalAdmission = store.withOtpAdmissionLock.bind(store);

    deps.hashOtp = async (code) => {
      events.push("hash");
      return originalHash(code);
    };
    deps.store = {
      ...store,
      async withOtpAdmissionLock(scope, operation) {
        events.push("admission-start");
        const result = await originalAdmission(scope, async (lockedStore) => {
          events.push("admission-locked");
          return operation(lockedStore);
        });
        events.push("admission-complete");
        return result;
      },
    };

    await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });

    assert.deepEqual(events, [
      "admission-start",
      "admission-locked",
      "admission-complete",
      "hash",
    ]);
  });

  it("does not hash OTPs for rate-limited requests", async () => {
    const { deps } = setup({
      config: {
        otpMaxRequestsPerWindow: 1,
        otpResendCooldownSeconds: 0,
      },
    });

    await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });

    let hashCalls = 0;
    deps.hashOtp = async (code) => {
      hashCalls += 1;
      return `otp-hash:${code}`;
    };

    await expectAuthError(
      requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" }),
      "RATE_LIMITED",
    );

    assert.equal(hashCalls, 0);
  });

  it("never returns a development code in a production config", async () => {
    const { deps, sent } = setup({
      config: { isProduction: true, devOtpEnabled: true },
    });

    const result = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });

    assert.equal(result.devCode, undefined);
    assert.equal(sent.length, 1);
  });

  it("never serializes a development code into a production response", async () => {
    const { deps } = setup({
      config: { isProduction: true, devOtpEnabled: true },
    });

    const result = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });

    assert.equal(JSON.stringify(result).includes("123456"), false);
  });

  it("never returns a development code when development OTP is disabled", async () => {
    const { deps } = setup({
      config: { isProduction: false, devOtpEnabled: false },
    });

    const result = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });

    assert.equal(result.devCode, undefined);
  });

  it("never returns a code from a non-development provider", async () => {
    const { deps } = setup({
      config: { isProduction: false, devOtpEnabled: true },
      provider: {
        id: "sms",
        kind: "sms",
        async send() {},
      },
    });

    const result = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });

    assert.equal(result.devCode, undefined);
  });

  it("rejects a resend inside the cooldown window", async () => {
    const { deps, store, advance } = setup();

    await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    advance(30);

    const error = await expectAuthError(
      requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" }),
      "RESEND_COOLDOWN",
    );

    assert.equal(error.retryAfterSeconds, 30);
    assert.equal(store.getChallenges().length, 1);
  });

  it("allows a resend after the cooldown", async () => {
    const { deps, store, advance } = setup();

    await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    advance(61);

    await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    assert.equal(store.getChallenges().length, 2);
  });

  it("allows a resend exactly at the cooldown boundary", async () => {
    const { deps, store, advance } = setup();

    await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    advance(60);

    await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    assert.equal(store.getChallenges().length, 2);
  });

  it("allows only one of many concurrent requests for the same phone", async () => {
    const { deps, store, sent } = setup();

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" }),
      ),
    );
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 7);

    for (const result of rejected) {
      assert.ok(result.status === "rejected");
      assert.ok(result.reason instanceof AuthError);
      assert.equal(result.reason.code, "RESEND_COOLDOWN");
    }

    assert.equal(store.getChallenges().length, 1);
    assert.equal(sent.length, 1);
  });

  it("enforces the per-IP limit atomically across different phones", async () => {
    const { deps, store } = setup({
      config: { otpMaxRequestsPerIpWindow: 2 },
    });
    const phones = Array.from(
      { length: 8 },
      (_, index) => `+9198765432${String(index).padStart(2, "0")}`,
    );

    const results = await Promise.allSettled(
      phones.map((phone) =>
        requestOtp(deps, { phone, ipHash: "shared-ip-hash" }),
      ),
    );
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    assert.equal(fulfilled.length, 2);
    assert.equal(rejected.length, 6);

    for (const result of rejected) {
      assert.ok(result.status === "rejected");
      assert.ok(result.reason instanceof AuthError);
      assert.equal(result.reason.code, "RATE_LIMITED");
    }

    assert.equal(store.getChallenges().length, 2);
  });

  it("fails closed without creating a challenge when the admission lock fails", async () => {
    const { deps, store, sent } = setup();
    const failingDeps: OtpServiceDeps = {
      ...deps,
      store: {
        ...store,
        async withOtpAdmissionLock() {
          throw new Error("limiter lock unavailable");
        },
      },
    };

    await assert.rejects(
      requestOtp(failingDeps, { phone: PHONE, ipHash: "ip-hash" }),
      /limiter lock unavailable/,
    );

    assert.equal(store.getChallenges().length, 0);
    assert.equal(sent.length, 0);
  });

  it("locks both the normalized phone and the hashed request IP", async () => {
    const { deps, store } = setup();
    const scopes: Array<{ phone: string; requestIpHash: string | null }> = [];
    const recordingDeps: OtpServiceDeps = {
      ...deps,
      store: {
        ...store,
        async withOtpAdmissionLock(scope, operation) {
          scopes.push(scope);
          return store.withOtpAdmissionLock(scope, operation);
        },
      },
    };

    await requestOtp(recordingDeps, { phone: PHONE, ipHash: "ip-hash" });

    assert.deepEqual(scopes, [{ phone: PHONE, requestIpHash: "ip-hash" }]);
  });

  it("rate limits requests within the configured window", async () => {
    const { deps, advance } = setup();

    for (let index = 0; index < 5; index += 1) {
      await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
      advance(61);
    }

    const error = await expectAuthError(
      requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" }),
      "RATE_LIMITED",
    );

    assert.equal(error.retryAfterSeconds, 900);
  });

  it("rate limits requests from one IP across different phones", async () => {
    const { deps } = setup({
      config: { otpMaxRequestsPerIpWindow: 2 },
    });

    await requestOtp(deps, { phone: "+919876543210", ipHash: "ip-hash" });
    await requestOtp(deps, { phone: "+919876543211", ipHash: "ip-hash" });

    await expectAuthError(
      requestOtp(deps, { phone: "+919876543212", ipHash: "ip-hash" }),
      "RATE_LIMITED",
    );
  });

  it("expires an abandoned reservation without resetting the rate-limit window", async () => {
    const { deps, store, advance } = setup({
      config: { otpMaxRequestsPerWindow: 2 },
    });
    const originalHash = deps.hashOtp;

    deps.hashOtp = async () => {
      throw new Error("hash failed after admission");
    };

    await assert.rejects(
      requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" }),
      /hash failed after admission/,
    );

    const [abandoned] = store.getReservations();
    assert.equal(abandoned.status, "PENDING");

    // The admission lease expires, but the abandoned row still counts toward
    // the 15-minute window. The next request is allowed because the cooldown
    // ignores abandoned leases.
    advance(61);
    deps.hashOtp = originalHash;
    await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });

    assert.equal(store.getReservations()[0].status, "ABANDONED");
    assert.equal(store.getReservations()[1].status, "CONSUMED");

    // One abandoned request plus one completed request reaches the configured
    // boundary, so a third request is rejected instead of gaining a free slot.
    advance(61);
    await expectAuthError(
      requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" }),
      "RATE_LIMITED",
    );
  });

  it("does not expire stale reservations outside the current phone/IP scope", async () => {
    const { deps, store } = setup();
    const otherPhone = "+919876543211";

    await store.createOtpReservation({
      phone: otherPhone,
      requestIpHash: "other-ip-hash",
      createdAt: new Date(START.getTime() - 120_000),
      expiresAt: new Date(START.getTime() - 60_000),
    });

    await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });

    const unrelated = store
      .getReservations()
      .find((reservation) => reservation.phone === otherPhone);

    assert.equal(unrelated?.status, "PENDING");
  });

  it("fails closed and consumes the challenge when the provider fails", async () => {
    const { deps, store } = setup({
      provider: {
        id: "broken",
        kind: "sms",
        async send() {
          throw new Error("provider unavailable");
        },
      },
    });

    await expectAuthError(
      requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" }),
      "PROVIDER_UNAVAILABLE",
    );

    const [challenge] = store.getChallenges();
    assert.ok(challenge, "the failed challenge remains for rate-limit evidence");
    assert.ok(challenge.consumedAt, "the unsent challenge is unusable");

    const [reservation] = store.getReservations();
    assert.equal(reservation.status, "FAILED");
  });

  it("still rate limits repeated provider failures", async () => {
    const { deps, store } = setup({
      config: { otpMaxRequestsPerWindow: 1 },
      provider: {
        id: "broken",
        kind: "sms",
        async send() {
          throw new Error("provider unavailable");
        },
      },
    });

    await expectAuthError(
      requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" }),
      "PROVIDER_UNAVAILABLE",
    );
    await expectAuthError(
      requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" }),
      "RATE_LIMITED",
    );

    assert.equal(store.getChallenges().length, 1);
  });
});

describe("verifyOtp", () => {
  it("verifies a valid code, consumes it, and creates a session", async () => {
    const { deps, store, advance } = setup();
    const request = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    advance(10);

    const result = await verifyOtp(deps, {
      challengeId: request.challengeId,
      code: "123456",
      ipHash: "ip-hash",
    });

    assert.equal(result.token, "raw-token-1");
    assert.equal(result.user.role, "RETAILER");
    assert.equal(result.user.status, "ACTIVE");
    assert.equal(store.getChallenges()[0].consumedAt?.getTime(), START.getTime() + 10_000);
    assert.equal(store.getSessions().length, 1);
    assert.equal(
      store.getSessions()[0].tokenHash,
      hashSessionToken("raw-token-1"),
    );
    assert.equal(store.getSessions()[0].tokenHash.includes("raw-token"), false);
  });

  it("matches an existing user whose stored phone uses a legacy format", async () => {
    const { deps, store, advance } = setup({
      users: [
        {
          id: "user_legacy",
          name: "Legacy Format",
          phone: "+91-98765-43210",
          role: "RETAILER",
        },
      ],
    });
    const request = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    advance(5);

    const result = await verifyOtp(deps, {
      challengeId: request.challengeId,
      code: "123456",
    });

    assert.equal(result.user.id, "user_legacy");
    assert.equal(store.getUsers().length, 1);
    assert.equal(store.getSessions().length, 1);
  });

  it("creates an unlinked retailer with a pending link request instead of auto-linking", async () => {
    const { deps, store, advance } = setup({
      retailerPhones: {
        [PHONE]: { id: "retailer_a", ownerName: "Demo Kirana" },
      },
    });
    const request = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    advance(5);

    const result = await verifyOtp(deps, {
      challengeId: request.challengeId,
      code: "123456",
    });

    assert.equal(result.user.role, "RETAILER");
    assert.equal(result.user.retailerId, null);
    assert.equal(result.user.name, "Retailer 3210");

    const linkRequests = store.getRetailerLinkRequests();
    assert.equal(linkRequests.length, 1);
    assert.equal(linkRequests[0].retailerId, "retailer_a");
    assert.equal(linkRequests[0].userId, result.user.id);
    assert.equal(linkRequests[0].status, "PENDING");
  });

  it("does not create a duplicate link request on a later sign-in", async () => {
    const { deps, store, advance } = setup({
      retailerPhones: {
        [PHONE]: { id: "retailer_a", ownerName: "Demo Kirana" },
      },
    });
    const first = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    advance(5);
    await verifyOtp(deps, { challengeId: first.challengeId, code: "123456" });
    advance(61);

    const second = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    advance(5);
    const result = await verifyOtp(deps, {
      challengeId: second.challengeId,
      code: "123456",
    });

    assert.equal(result.user.retailerId, null);
    assert.equal(store.getRetailerLinkRequests().length, 1);
  });

  it("creates a pending link request when an existing unlinked retailer verifies", async () => {
    const { deps, store, advance } = setup({
      users: [
        {
          id: "user_existing",
          name: "Existing Retailer",
          phone: PHONE,
          role: "RETAILER",
          retailerId: null,
        },
      ],
      retailerPhones: {
        [PHONE]: { id: "retailer_a", ownerName: "Demo Kirana" },
      },
    });
    const request = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    advance(5);

    const result = await verifyOtp(deps, {
      challengeId: request.challengeId,
      code: "123456",
    });

    assert.equal(result.user.id, "user_existing");
    assert.equal(result.user.retailerId, null);

    const linkRequests = store.getRetailerLinkRequests();
    assert.equal(linkRequests.length, 1);
    assert.equal(linkRequests[0].userId, "user_existing");
    assert.equal(linkRequests[0].retailerId, "retailer_a");
    assert.equal(linkRequests[0].status, "PENDING");
  });

  it("does not create a second pending request for an existing retailer user", async () => {
    const { deps, store, advance } = setup({
      users: [
        {
          id: "user_existing",
          name: "Existing Retailer",
          phone: PHONE,
          role: "RETAILER",
          retailerId: null,
        },
      ],
      retailerPhones: {
        [PHONE]: { id: "retailer_a", ownerName: "Demo Kirana" },
      },
      linkRequests: [
        {
          userId: "user_existing",
          retailerId: "retailer_a",
          status: "PENDING",
        },
      ],
    });
    const request = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    advance(5);

    await verifyOtp(deps, { challengeId: request.challengeId, code: "123456" });

    assert.equal(store.getRetailerLinkRequests().length, 1);
  });

  it("does not create a new request when another pending request exists", async () => {
    const { deps, store, advance } = setup({
      users: [
        {
          id: "user_existing",
          name: "Existing Retailer",
          phone: PHONE,
          role: "RETAILER",
          retailerId: null,
        },
      ],
      retailerPhones: {
        [PHONE]: { id: "retailer_a", ownerName: "Demo Kirana" },
      },
      linkRequests: [
        {
          userId: "user_existing",
          retailerId: "retailer_b",
          status: "PENDING",
        },
      ],
    });
    const request = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    advance(5);

    await verifyOtp(deps, { challengeId: request.challengeId, code: "123456" });

    const linkRequests = store.getRetailerLinkRequests();
    assert.equal(linkRequests.length, 1);
    assert.equal(linkRequests[0].retailerId, "retailer_b");
  });

  it("creates a fresh pending request after an earlier request was rejected", async () => {
    const { deps, store, advance } = setup({
      users: [
        {
          id: "user_existing",
          name: "Existing Retailer",
          phone: PHONE,
          role: "RETAILER",
          retailerId: null,
        },
      ],
      retailerPhones: {
        [PHONE]: { id: "retailer_a", ownerName: "Demo Kirana" },
      },
      linkRequests: [
        {
          userId: "user_existing",
          retailerId: "retailer_a",
          status: "REJECTED",
          createdAt: new Date(START.getTime() - 60_000),
        },
      ],
    });
    const request = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    advance(5);

    await verifyOtp(deps, { challengeId: request.challengeId, code: "123456" });

    const linkRequests = store.getRetailerLinkRequests();
    assert.equal(linkRequests.length, 2);
    assert.equal(
      linkRequests.filter((linkRequest) => linkRequest.status === "PENDING")
        .length,
      1,
    );
  });

  it("does not create a link request for an already linked retailer user", async () => {
    const { deps, store, advance } = setup({
      users: [
        {
          id: "user_existing",
          name: "Existing Retailer",
          phone: PHONE,
          role: "RETAILER",
          retailerId: "retailer_a",
        },
      ],
      retailerPhones: {
        [PHONE]: { id: "retailer_a", ownerName: "Demo Kirana" },
      },
    });
    const request = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    advance(5);

    await verifyOtp(deps, { challengeId: request.challengeId, code: "123456" });

    assert.equal(store.getRetailerLinkRequests().length, 0);
  });

  it("does not create a link request for an existing non-retailer user", async () => {
    const { deps, store, advance } = setup({
      users: [
        {
          id: "user_existing",
          name: "Existing Salesman",
          phone: PHONE,
          role: "SALESMAN",
          retailerId: null,
        },
      ],
      retailerPhones: {
        [PHONE]: { id: "retailer_a", ownerName: "Demo Kirana" },
      },
    });
    const request = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    advance(5);

    await verifyOtp(deps, { challengeId: request.challengeId, code: "123456" });

    assert.equal(store.getRetailerLinkRequests().length, 0);
  });

  it("creates no link request when no retailer matches the verified phone", async () => {
    const { deps, store, advance } = setup();
    const request = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    advance(5);

    const result = await verifyOtp(deps, {
      challengeId: request.challengeId,
      code: "123456",
    });

    assert.equal(result.user.retailerId, null);
    assert.equal(store.getRetailerLinkRequests().length, 0);
  });

  it("leaves an unknown retailer unlinked instead of guessing", async () => {
    const { deps, advance } = setup();
    const request = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    advance(5);

    const result = await verifyOtp(deps, {
      challengeId: request.challengeId,
      code: "123456",
    });

    assert.equal(result.user.retailerId, null);
  });

  it("fails closed without creating an account when the phone is ambiguous", async () => {
    const { deps, store, advance } = setup();
    const ambiguousDeps: OtpServiceDeps = {
      ...deps,
      store: {
        ...deps.store,
        async ensureUserForVerifiedPhone() {
          throw new AmbiguousPhoneMatchError();
        },
      },
    };
    const request = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    advance(5);

    await expectAuthError(
      verifyOtp(ambiguousDeps, {
        challengeId: request.challengeId,
        code: "123456",
        ipHash: "ip-hash",
      }),
      "ACCOUNT_AMBIGUOUS",
    );

    assert.equal(store.getSessions().length, 0);
    assert.equal(store.getUsers().length, 0);
  });

  it("rejects an expired challenge", async () => {
    const { deps, advance } = setup();
    const request = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    advance(301);

    await expectAuthError(
      verifyOtp(deps, {
        challengeId: request.challengeId,
        code: "123456",
        ipHash: "ip-hash",
      }),
      "OTP_EXPIRED",
    );
  });

  it("prevents reuse after successful verification", async () => {
    const { deps, advance } = setup();
    const request = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    advance(5);

    await verifyOtp(deps, {
      challengeId: request.challengeId,
      code: "123456",
    });

    await expectAuthError(
      verifyOtp(deps, {
        challengeId: request.challengeId,
        code: "123456",
      }),
      "OTP_ALREADY_USED",
    );
  });

  it("issues exactly one session when the same code is verified concurrently", async () => {
    const { deps, store, advance } = setup();
    const request = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    advance(5);

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        verifyOtp(deps, {
          challengeId: request.challengeId,
          code: "123456",
          ipHash: "ip-hash",
        }),
      ),
    );

    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(store.getSessions().length, 1);

    for (const result of results) {
      if (result.status === "rejected") {
        assert.ok(result.reason instanceof AuthError);
        assert.equal(result.reason.code, "OTP_ALREADY_USED");
      }
    }
  });

  it("increments attempts and locks after the maximum", async () => {
    const { deps, store, advance } = setup();
    const request = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    advance(5);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expectAuthError(
        verifyOtp(deps, {
          challengeId: request.challengeId,
          code: "000000",
        }),
        "INVALID_OTP",
      );
      assert.equal(store.getChallenges()[0].attempts, attempt);
    }

    await expectAuthError(
      verifyOtp(deps, {
        challengeId: request.challengeId,
        code: "123456",
      }),
      "OTP_LOCKED",
    );
    assert.equal(store.getSessions().length, 0);
  });

  it("accepts the correct code on the final permitted attempt", async () => {
    const { deps, advance } = setup();
    const request = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    advance(5);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expectAuthError(
        verifyOtp(deps, {
          challengeId: request.challengeId,
          code: "000000",
        }),
        "INVALID_OTP",
      );
    }

    const result = await verifyOtp(deps, {
      challengeId: request.challengeId,
      code: "123456",
    });

    assert.equal(result.user.phone, PHONE);
  });

  it("does not create a session for a disabled account", async () => {
    const { deps, store, advance } = setup({
      users: [
        {
          id: "user_disabled",
          name: "Disabled User",
          phone: PHONE,
          role: "RETAILER",
          status: "DISABLED",
        },
      ],
    });
    const request = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    advance(5);

    await expectAuthError(
      verifyOtp(deps, {
        challengeId: request.challengeId,
        code: "123456",
      }),
      "ACCOUNT_DISABLED",
    );

    assert.equal(store.getSessions().length, 0);
    assert.ok(store.getChallenges()[0].consumedAt);
  });

  it("issues a fresh session token on every successful login", async () => {
    const { deps, store, advance } = setup();
    const first = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    advance(5);
    await verifyOtp(deps, { challengeId: first.challengeId, code: "123456" });
    advance(61);

    const second = await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });
    advance(5);
    const result = await verifyOtp(deps, {
      challengeId: second.challengeId,
      code: "123456",
    });

    assert.equal(result.token, "raw-token-2");
    assert.equal(store.getSessions().length, 2);
  });
});

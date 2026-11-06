import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadAuthConfig } from "../config";
import { buildSessionCookieOptions, SESSION_COOKIE_NAME } from "../cookies";
import { hashSessionToken } from "../crypto";
import { revokeSessionToken, validateSessionToken } from "../session-service";
import type { AuthStore } from "../types";
import { createMemoryAuthStore } from "./memory-store";

const START = new Date("2026-01-01T10:00:00.000Z");

function setup(disabled = false) {
  const store = createMemoryAuthStore({
    users: [
      {
        id: "user_a",
        name: "Test User",
        phone: "+919876543210",
        role: "RETAILER",
        status: disabled ? "DISABLED" : "ACTIVE",
      },
    ],
  });

  let now = START;
  const deps = {
    store,
    now: () => now,
    hashToken: hashSessionToken,
  };

  store.seedSession({
    id: "session_a",
    tokenHash: hashSessionToken("raw-token"),
    userId: "user_a",
    expiresAt: new Date(START.getTime() + 60 * 60 * 1_000),
    lastSeenAt: START,
    revokedAt: null,
    ipHash: null,
  });

  return {
    store,
    deps,
    advance(seconds: number) {
      now = new Date(START.getTime() + seconds * 1_000);
    },
  };
}

describe("validateSessionToken", () => {
  it("returns the user for a valid token and never compares raw tokens", async () => {
    const { deps } = setup();

    const session = await validateSessionToken(deps, "raw-token");

    assert.equal(session?.sessionId, "session_a");
    assert.equal(session?.user.id, "user_a");
    assert.equal(session?.user.role, "RETAILER");
  });

  it("rejects missing, expired, and revoked sessions", async () => {
    const missing = setup();
    assert.equal(await validateSessionToken(missing.deps, "unknown"), null);

    const expired = setup();
    expired.advance(60 * 60 + 1);
    assert.equal(await validateSessionToken(expired.deps, "raw-token"), null);

    const revoked = setup();
    revoked.store.getSessions()[0].revokedAt = START;
    assert.equal(await validateSessionToken(revoked.deps, "raw-token"), null);
  });

  it("rejects and revokes sessions for disabled users", async () => {
    const { deps, store } = setup(true);

    const session = await validateSessionToken(deps, "raw-token");

    assert.equal(session, null);
    assert.ok(store.getSessions()[0].revokedAt);
  });

  it("updates lastSeenAt only when the session is stale", async () => {
    const { deps, store, advance } = setup();
    advance(60);

    await validateSessionToken(deps, "raw-token");
    assert.equal(store.getSessions()[0].lastSeenAt.getTime(), START.getTime());

    advance(10 * 60);
    await validateSessionToken(deps, "raw-token");
    assert.equal(
      store.getSessions()[0].lastSeenAt.getTime(),
      START.getTime() + 10 * 60 * 1_000,
    );
  });
});

describe("logout", () => {
  it("revokes the session so the token cannot be reused", async () => {
    const { deps } = setup();

    await revokeSessionToken(deps, "raw-token");

    assert.equal(await validateSessionToken(deps, "raw-token"), null);
  });
});

describe("session cookie", () => {
  it("uses an HTTP-only, SameSite=Lax, site-wide cookie", () => {
    const config = loadAuthConfig({ NODE_ENV: "development" });
    const expiresAt = new Date(START.getTime() + 60_000);
    const options = buildSessionCookieOptions(config, expiresAt);

    assert.equal(SESSION_COOKIE_NAME, "tradepulse_session");
    assert.equal(options.httpOnly, true);
    assert.equal(options.sameSite, "lax");
    assert.equal(options.path, "/");
    assert.equal(options.secure, false);
    assert.equal(options.expires.getTime(), expiresAt.getTime());
  });

  it("sets Secure in production", () => {
    const config = loadAuthConfig({ NODE_ENV: "production" });
    const options = buildSessionCookieOptions(config, START);

    assert.equal(options.secure, true);
  });
});

// Keep the AuthStore type exercised by the memory store contract.
const _storeContract: AuthStore = createMemoryAuthStore();
void _storeContract;

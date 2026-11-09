import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { Client } from "pg";

import { getPrismaClient } from "../../src/lib/db";
import { loadAuthConfig } from "../../src/lib/auth/config";
import { AuthError } from "../../src/lib/auth/errors";
import { createPrismaAuthStore } from "../../src/lib/auth/store-prisma";
import { requestOtp, verifyOtp } from "../../src/lib/auth/otp-service";
import type {
  AuthConfig,
  AuthStore,
  OtpProvider,
  OtpServiceDeps,
} from "../../src/lib/auth/types";
import { applyMigrations } from "./helpers/migrations";
import { createTestDatabase, resetTestData } from "./helpers/test-database";

const PHONE = "+919876543210";

function createDeps(
  store: AuthStore,
  options?: {
    config?: Partial<AuthConfig>;
    provider?: OtpProvider;
  },
) {
  const config: AuthConfig = {
    ...loadAuthConfig({
      NODE_ENV: "test",
      AUTH_DEV_OTP_ENABLED: "false",
    }),
    otpMaxRequestsPerWindow: 20,
    otpMaxRequestsPerIpWindow: 200,
    ...options?.config,
  };
  let now = new Date("2026-01-01T10:00:00.000Z");

  const provider: OtpProvider = options?.provider ?? {
    id: "integration-test",
    kind: "development",
    async send() {
      // Delivery is not under test; persistence is.
    },
  };

  const deps: OtpServiceDeps = {
    store,
    provider,
    config,
    now: () => now,
    generateCode: () => "123456",
    generateSessionToken: () => "integration-session-token",
    hashOtp: async (code) => `otp-hash:${code}`,
    verifyOtpHash: async (code, hash) => hash === `otp-hash:${code}`,
    hashToken: (token) => `token-hash:${token}`,
  };

  return {
    deps,
    advance(seconds: number) {
      now = new Date(now.getTime() + seconds * 1_000);
    },
  };
}

function rejectionCode(result: PromiseSettledResult<unknown>): string | null {
  if (result.status !== "rejected") {
    return null;
  }

  return result.reason instanceof AuthError ? result.reason.code : "UNKNOWN";
}

describe("OTP admission against PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let prisma: ReturnType<typeof getPrismaClient>;

  before(async () => {
    database = await createTestDatabase();
    client = new Client({ connectionString: database.databaseUrl });
    await client.connect();
    await applyMigrations(client);

    process.env.DATABASE_URL = database.databaseUrl;
    delete process.env.DIRECT_URL;

    for (const name of [
      "PGHOST",
      "PGHOSTADDR",
      "PGPORT",
      "PGDATABASE",
      "PGOPTIONS",
      "PGSERVICE",
    ]) {
      delete process.env[name];
    }

    prisma = getPrismaClient();
  });

  beforeEach(async () => {
    await resetTestData(client);
  });

  after(async () => {
    await prisma.$disconnect();
    await client.end();
    await database.drop();
  });

  it("serializes concurrent admission for one phone and admits exactly one", async () => {
    const store = createPrismaAuthStore();
    const { deps } = createDeps(store, {
      config: {
        otpMaxRequestsPerWindow: 5,
        otpMaxRequestsPerIpWindow: 100,
      },
    });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) =>
        requestOtp(deps, { phone: PHONE, ipHash: `ip-${index}` }),
      ),
    );

    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );

    for (const result of results) {
      const code = rejectionCode(result);

      if (code !== null) {
        assert.equal(code, "RESEND_COOLDOWN");
      }
    }

    const reservations = await client.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM "OtpRequestReservation" WHERE phone = $1',
      [PHONE],
    );
    assert.equal(reservations.rows[0]?.count, 1);
  });

  it("enforces the per-IP limit atomically across different phones", async () => {
    const store = createPrismaAuthStore();
    const { deps } = createDeps(store, {
      config: {
        otpMaxRequestsPerWindow: 10,
        otpMaxRequestsPerIpWindow: 2,
      },
    });

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, index) =>
        requestOtp(deps, {
          phone: `+9198765432${String(10 + index).padStart(2, "0")}`,
          ipHash: "shared-ip-hash",
        }),
      ),
    );

    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      2,
    );

    const limited = results.filter(
      (result) => rejectionCode(result) === "RATE_LIMITED",
    );
    assert.equal(limited.length, 4);

    const reservations = await client.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM "OtpRequestReservation" WHERE "requestIpHash" = $1',
      ["shared-ip-hash"],
    );
    assert.equal(reservations.rows[0]?.count, 2);
  });

  it("allows only one concurrent completion of the same reservation", async () => {
    const store = createPrismaAuthStore();
    const completedAt = new Date("2026-01-01T10:01:00.000Z");
    const reservation = await store.createOtpReservation({
      phone: PHONE,
      requestIpHash: "ip-hash",
      createdAt: new Date("2026-01-01T10:00:00.000Z"),
      expiresAt: new Date("2026-01-01T10:02:00.000Z"),
    });

    const input = {
      reservationId: reservation.id,
      phone: PHONE,
      codeHash: "otp-hash:123456",
      maxAttempts: 5,
      expiresAt: new Date("2026-01-01T10:05:00.000Z"),
      createdAt: completedAt,
      requestIpHash: "ip-hash",
      completedAt,
    };

    const results = await Promise.all([
      store.completeOtpReservation(input),
      store.completeOtpReservation(input),
    ]);

    assert.equal(results.filter(Boolean).length, 1);

    const challenges = await client.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM "OtpChallenge" WHERE "reservationId" = $1',
      [reservation.id],
    );
    assert.equal(challenges.rows[0]?.count, 1);
  });

  it("issues exactly one session when the same OTP is verified concurrently", async () => {
    const store = createPrismaAuthStore();
    const { deps, advance } = createDeps(store);
    const request = await requestOtp(deps, {
      phone: PHONE,
      ipHash: "ip-hash",
    });
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

    for (const result of results) {
      if (result.status === "rejected") {
        assert.equal(rejectionCode(result), "OTP_ALREADY_USED");
      }
    }

    const sessions = await client.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM "Session"',
    );
    assert.equal(sessions.rows[0]?.count, 1);

    const challenges = await client.query<{ consumedAt: Date | null }>(
      'SELECT "consumedAt" FROM "OtpChallenge" WHERE id = $1',
      [request.challengeId],
    );
    assert.ok(challenges.rows[0]?.consumedAt);
  });

  it("rejects completion after the admission lease expires", async () => {
    const store = createPrismaAuthStore();
    const reservation = await store.createOtpReservation({
      phone: PHONE,
      requestIpHash: null,
      createdAt: new Date("2026-01-01T10:00:00.000Z"),
      expiresAt: new Date("2026-01-01T10:00:30.000Z"),
    });

    const challenge = await store.completeOtpReservation({
      reservationId: reservation.id,
      phone: PHONE,
      codeHash: "otp-hash:123456",
      maxAttempts: 5,
      expiresAt: new Date("2026-01-01T10:05:00.000Z"),
      createdAt: new Date("2026-01-01T10:01:00.000Z"),
      requestIpHash: null,
      completedAt: new Date("2026-01-01T10:01:00.000Z"),
    });

    assert.equal(challenge, null);

    const rows = await client.query<{ status: string }>(
      'SELECT status::text AS status FROM "OtpRequestReservation" WHERE id = $1',
      [reservation.id],
    );
    assert.equal(rows.rows[0]?.status, "PENDING");
  });

  it("scopes stale-reservation expiry to the current phone and IP keys", async () => {
    const store = createPrismaAuthStore();
    const { deps } = createDeps(store);
    const staleCreatedAt = new Date("2026-01-01T09:58:00.000Z");
    const staleExpiresAt = new Date("2026-01-01T09:59:00.000Z");

    const currentPhoneStale = await store.createOtpReservation({
      phone: PHONE,
      requestIpHash: "unrelated-ip",
      createdAt: staleCreatedAt,
      expiresAt: staleExpiresAt,
    });
    const sharedIpStale = await store.createOtpReservation({
      phone: "+919876543211",
      requestIpHash: "ip-hash",
      createdAt: staleCreatedAt,
      expiresAt: staleExpiresAt,
    });
    const unrelatedStale = await store.createOtpReservation({
      phone: "+919876543212",
      requestIpHash: "other-ip",
      createdAt: staleCreatedAt,
      expiresAt: staleExpiresAt,
    });

    await requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" });

    const rows = await client.query<{ id: string; status: string }>(
      'SELECT id, status::text AS status FROM "OtpRequestReservation" WHERE id = ANY($1::text[])',
      [[currentPhoneStale.id, sharedIpStale.id, unrelatedStale.id]],
    );
    const statusById = new Map(
      rows.rows.map((row) => [row.id, row.status] as const),
    );

    assert.equal(statusById.get(currentPhoneStale.id), "ABANDONED");
    assert.equal(statusById.get(sharedIpStale.id), "ABANDONED");
    assert.equal(statusById.get(unrelatedStale.id), "PENDING");
  });

  it("marks the challenge unusable and the reservation failed when delivery fails", async () => {
    const store = createPrismaAuthStore();
    const { deps } = createDeps(store, {
      provider: {
        id: "broken",
        kind: "sms",
        async send() {
          throw new Error("provider unavailable");
        },
      },
    });

    await assert.rejects(
      requestOtp(deps, { phone: PHONE, ipHash: "ip-hash" }),
      (error: unknown) =>
        error instanceof AuthError && error.code === "PROVIDER_UNAVAILABLE",
    );

    const reservations = await client.query<{
      status: string;
      completedAt: Date | null;
    }>(
      'SELECT status::text AS status, "completedAt" FROM "OtpRequestReservation" WHERE phone = $1',
      [PHONE],
    );
    assert.equal(reservations.rows[0]?.status, "FAILED");
    assert.ok(reservations.rows[0]?.completedAt);

    const challenges = await client.query<{ consumedAt: Date | null }>(
      'SELECT "consumedAt" FROM "OtpChallenge" WHERE phone = $1',
      [PHONE],
    );
    assert.equal(challenges.rows.length, 1);
    assert.ok(challenges.rows[0]?.consumedAt);
  });
});

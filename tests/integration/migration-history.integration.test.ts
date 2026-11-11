import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { Client } from "pg";

import { applyMigrations } from "./helpers/migrations";
import {
  closeTestDatabase,
  createTestDatabase,
} from "./helpers/test-database";

const MIGRATION_3 = "20261106120000_otp_reservations_retailer_link_reviews";
const MIGRATION_4 = "20261107120000_retailer_link_history_fks";

async function resetSchema(client: Client): Promise<void> {
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");
}

async function foreignKeyDeleteActions(
  client: Client,
): Promise<Map<string, string>> {
  const result = await client.query<{ conname: string; confdeltype: string }>(
    `SELECT conname, confdeltype
     FROM pg_constraint
     WHERE conrelid = '"RetailerLinkRequest"'::regclass
       AND contype = 'f'`,
  );

  return new Map(
    result.rows.map((row) => [row.conname, row.confdeltype] as const),
  );
}

async function seedPreMigrationFourData(client: Client): Promise<void> {
  await client.query(
    `INSERT INTO "User" ("id", "name", "phone", "phoneNormalized", "role", "status", "createdAt", "updatedAt")
     VALUES
       ('user_retailer', 'Retailer User', '+919800000002', '+919800000002', 'RETAILER', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ('admin_reviewer', 'Reviewer', '+919800000001', '+919800000001', 'ADMIN', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  );
  await client.query(
    `INSERT INTO "Retailer" ("id", "shopName", "ownerName", "phone", "creditLimit", "createdAt", "updatedAt")
     VALUES ('retailer_a', 'Shop A', 'Owner A', '+919800000003', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  );
  await client.query(
    `INSERT INTO "OtpRequestReservation" ("id", "phone", "status", "expiresAt", "createdAt")
     VALUES ('reservation_1', '+919800000002', 'PENDING', CURRENT_TIMESTAMP + INTERVAL '1 minute', CURRENT_TIMESTAMP)`,
  );
  await client.query(
    `INSERT INTO "OtpChallenge" ("id", "phone", "codeHash", "expiresAt", "createdAt", "reservationId")
     VALUES
       ('challenge_legacy', '+919800000002', 'hash', CURRENT_TIMESTAMP + INTERVAL '5 minutes', CURRENT_TIMESTAMP, NULL),
       ('challenge_linked', '+919800000002', 'hash', CURRENT_TIMESTAMP + INTERVAL '5 minutes', CURRENT_TIMESTAMP, 'reservation_1')`,
  );
  await client.query(
    `INSERT INTO "RetailerLinkRequest" ("id", "userId", "retailerId", "status", "createdAt")
     VALUES ('request_1', 'user_retailer', 'retailer_a', 'PENDING', CURRENT_TIMESTAMP)`,
  );
}

describe("retailer link-request migration history", () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;

  before(async () => {
    database = await createTestDatabase();
    client = new Client({ connectionString: database.databaseUrl });
    await client.connect();
  });

  beforeEach(async () => {
    await resetSchema(client);
  });

  after(async () => {
    await closeTestDatabase({ client, database });
  });

  it("preserves legacy rows and enforces history rules on upgrade", async () => {
    const applied = await applyMigrations(client, { through: MIGRATION_3 });
    assert.equal(applied.at(-1), MIGRATION_3);

    await seedPreMigrationFourData(client);

    const upgraded = await applyMigrations(client, {
      after: MIGRATION_3,
      through: MIGRATION_4,
    });
    assert.deepEqual(upgraded, [MIGRATION_4]);

    const challenges = await client.query<{
      id: string;
      reservationId: string | null;
    }>(
      'SELECT id, "reservationId" FROM "OtpChallenge" WHERE id IN ($1, $2) ORDER BY id',
      ["challenge_linked", "challenge_legacy"],
    );
    assert.deepEqual(
      challenges.rows.map((row) => [row.id, row.reservationId]),
      [
        ["challenge_legacy", null],
        ["challenge_linked", "reservation_1"],
      ],
    );

    const requests = await client.query<{ id: string; status: string }>(
      'SELECT id, status::text AS status FROM "RetailerLinkRequest"',
    );
    assert.deepEqual(requests.rows, [{ id: "request_1", status: "PENDING" }]);

    const deleteActions = await foreignKeyDeleteActions(client);
    assert.equal(deleteActions.get("RetailerLinkRequest_userId_fkey"), "r");
    assert.equal(
      deleteActions.get("RetailerLinkRequest_retailerId_fkey"),
      "r",
    );
    assert.equal(
      deleteActions.get("RetailerLinkRequest_reviewedById_fkey"),
      "r",
    );

    const indexes = await client.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE tablename = 'RetailerLinkRequest'`,
    );
    const indexNames = new Set(indexes.rows.map((row) => row.indexname));
    assert.equal(
      indexNames.has("RetailerLinkRequest_userId_retailerId_key"),
      false,
    );
    assert.equal(
      indexNames.has("RetailerLinkRequest_userId_retailerId_idx"),
      true,
    );
    assert.equal(
      indexNames.has("RetailerLinkRequest_userId_retailerId_pending_key"),
      true,
    );

    const pendingIndex = indexes.rows.find(
      (row) =>
        row.indexname === "RetailerLinkRequest_userId_retailerId_pending_key",
    );
    assert.match(pendingIndex?.indexdef ?? "", /UNIQUE INDEX/);
    assert.match(pendingIndex?.indexdef ?? "", /WHERE .*PENDING/);

    await assert.rejects(
      client.query(
        `INSERT INTO "RetailerLinkRequest" ("id", "userId", "retailerId", "status", "createdAt")
         VALUES ('request_duplicate', 'user_retailer', 'retailer_a', 'PENDING', CURRENT_TIMESTAMP)`,
      ),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505",
    );

    await assert.rejects(
      client.query('DELETE FROM "User" WHERE id = $1', ["user_retailer"]),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        // PostgreSQL raises restrict_violation (23001) for ON DELETE RESTRICT;
        // foreign_key_violation (23503) is used by NO ACTION.
        error.code === "23001",
    );
  });

  it("supports the documented rollback and re-apply recovery path", async () => {
    await applyMigrations(client);
    await seedPreMigrationFourData(client);

    const rollbackSql = `
      DROP INDEX "RetailerLinkRequest_userId_retailerId_pending_key";
      DROP INDEX "RetailerLinkRequest_userId_retailerId_idx";
      CREATE UNIQUE INDEX "RetailerLinkRequest_userId_retailerId_key"
        ON "RetailerLinkRequest"("userId", "retailerId");

      ALTER TABLE "RetailerLinkRequest"
        DROP CONSTRAINT "RetailerLinkRequest_userId_fkey";
      ALTER TABLE "RetailerLinkRequest"
        ADD CONSTRAINT "RetailerLinkRequest_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

      ALTER TABLE "RetailerLinkRequest"
        DROP CONSTRAINT "RetailerLinkRequest_retailerId_fkey";
      ALTER TABLE "RetailerLinkRequest"
        ADD CONSTRAINT "RetailerLinkRequest_retailerId_fkey"
        FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

      ALTER TABLE "RetailerLinkRequest"
        DROP CONSTRAINT "RetailerLinkRequest_reviewedById_fkey";
      ALTER TABLE "RetailerLinkRequest"
        ADD CONSTRAINT "RetailerLinkRequest_reviewedById_fkey"
        FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    `;

    await client.query("BEGIN");

    try {
      await client.query(rollbackSql);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    const rolledBackActions = await foreignKeyDeleteActions(client);
    assert.equal(rolledBackActions.get("RetailerLinkRequest_userId_fkey"), "c");
    assert.equal(
      rolledBackActions.get("RetailerLinkRequest_retailerId_fkey"),
      "c",
    );
    assert.equal(
      rolledBackActions.get("RetailerLinkRequest_reviewedById_fkey"),
      "n",
    );

    const reApplied = await applyMigrations(client, {
      after: MIGRATION_3,
      through: MIGRATION_4,
    });
    assert.deepEqual(reApplied, [MIGRATION_4]);

    const restoredActions = await foreignKeyDeleteActions(client);
    assert.equal(restoredActions.get("RetailerLinkRequest_userId_fkey"), "r");
    assert.equal(
      restoredActions.get("RetailerLinkRequest_retailerId_fkey"),
      "r",
    );
    assert.equal(
      restoredActions.get("RetailerLinkRequest_reviewedById_fkey"),
      "r",
    );

    const requests = await client.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM "RetailerLinkRequest"',
    );
    assert.equal(requests.rows[0]?.count, 1);
  });
});

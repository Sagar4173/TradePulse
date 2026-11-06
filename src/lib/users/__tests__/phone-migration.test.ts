import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const MIGRATION_PATH = new URL(
  "../../../../prisma/migrations/20261106090000_user_phone_normalized/migration.sql",
  import.meta.url,
);

async function readMigration(): Promise<string> {
  return readFile(MIGRATION_PATH, "utf8");
}

describe("normalized phone migration", () => {
  it("adds a nullable column and backfills before enforcing constraints", async () => {
    const sql = await readMigration();
    const addColumn = sql.indexOf('ADD COLUMN "phoneNormalized"');
    const backfill = sql.indexOf('UPDATE "User"');
    const notNull = sql.indexOf(
      'ALTER COLUMN "phoneNormalized" SET NOT NULL',
    );
    const uniqueIndex = sql.indexOf(
      'CREATE UNIQUE INDEX "User_phoneNormalized_key"',
    );

    assert.ok(addColumn >= 0, "the column is added");
    assert.ok(backfill > addColumn, "the backfill runs after the column exists");
    assert.ok(notNull > backfill, "NOT NULL is enforced after the backfill");
    assert.ok(
      uniqueIndex > backfill,
      "the unique index is created after the backfill",
    );
  });

  it("strips punctuation, country and trunk prefixes during the backfill", async () => {
    const sql = await readMigration();

    assert.match(sql, /regexp_replace\("phone", '\[\^0-9\]', '', 'g'\)/);
    assert.match(sql, /length\(digits\) = 12/);
    assert.match(sql, /digits LIKE '91%'/);
    assert.match(sql, /length\(digits\) = 11/);
    assert.match(sql, /digits LIKE '0%'/);
    assert.match(sql, /'\+91' \|\| digits/);
  });

  it("fails safely on invalid numbers instead of inventing values", async () => {
    const sql = await readMigration();
    const invalidCheck = sql.indexOf("invalid_count > 0");
    const notNull = sql.indexOf(
      'ALTER COLUMN "phoneNormalized" SET NOT NULL',
    );

    assert.match(sql, /RAISE EXCEPTION/);
    assert.match(sql, /invalid Indian mobile number/i);
    assert.ok(
      invalidCheck >= 0 && invalidCheck < notNull,
      "invalid rows abort before NOT NULL is enforced",
    );
  });

  it("fails safely on duplicate normalized numbers without merging users", async () => {
    const sql = await readMigration();
    const duplicateCheck = sql.indexOf("duplicate_count > 0");
    const uniqueIndex = sql.indexOf(
      'CREATE UNIQUE INDEX "User_phoneNormalized_key"',
    );

    assert.match(sql, /GROUP BY "phoneNormalized"/);
    assert.match(sql, /HAVING count\(\*\) > 1/);
    assert.match(sql, /duplicate normalized phone/i);
    assert.doesNotMatch(sql, /DELETE FROM "User"/i);
    assert.doesNotMatch(sql, /SET "phone"\s*=/i);
    assert.ok(
      duplicateCheck >= 0 && duplicateCheck < uniqueIndex,
      "duplicates abort before the unique index is created",
    );
  });

  it("enforces the canonical E.164 format and unique identity", async () => {
    const sql = await readMigration();

    assert.match(sql, /User_phoneNormalized_format/);
    assert.match(sql, /\[\+\]91\[6-9\]\[0-9\]\{9\}/);
    assert.match(
      sql,
      /CREATE UNIQUE INDEX "User_phoneNormalized_key" ON "User"\("phoneNormalized"\)/,
    );
  });

  it("masks full phone numbers in fail-closed error examples", async () => {
    const sql = await readMigration();

    assert.match(
      sql,
      /right\(regexp_replace\("phone", '\[\^0-9\]', '', 'g'\), 4\)/,
    );
    assert.match(
      sql,
      /format\('ending %s -> %s', right\("phoneNormalized", 4\), "ids"\)/,
    );
    assert.doesNotMatch(sql, /format\('%s \(%s\)', "id", "phone"\)/);
    assert.doesNotMatch(sql, /format\('%s -> %s', "phoneNormalized"/);
  });
});

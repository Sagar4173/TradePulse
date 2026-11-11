import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseDatabaseConnectionTarget } from "../connection-target";
import {
  checkTestDatabaseTarget,
  isGeneratedTestDatabaseName,
  TEST_DATABASE_EXPECTED_NEON_HOST_ENV,
  TEST_DATABASE_NAME,
  type TestDatabaseTargetCheck,
} from "../test-database-target";

const TEST_HOST = "ep-test-123.ap-southeast-1.aws.neon.tech";
const TEST_POOLED_HOST =
  "ep-test-123-pooler.ap-southeast-1.aws.neon.tech";
const PRODUCTION_HOST =
  "ep-production-456.ap-southeast-1.aws.neon.tech";

const TEST_URL =
  `postgresql://test_user:test-password@${TEST_HOST}:5432/${TEST_DATABASE_NAME}?sslmode=require`;
const TEST_POOLED_URL =
  `postgresql://test_user:test-password@${TEST_POOLED_HOST}:5432/${TEST_DATABASE_NAME}?sslmode=require`;
const PRODUCTION_URL =
  `postgresql://owner:production-password@${PRODUCTION_HOST}:5432/neondb?sslmode=require`;
const LOCAL_URL =
  "postgresql://local_user:local-password@127.0.0.1:5432/postgres?sslmode=disable";
const PRODUCTION_HOST_TEST_DATABASE_URL =
  `postgresql://test_user:test-password@${PRODUCTION_HOST}:5432/${TEST_DATABASE_NAME}?sslmode=require`;
const PRODUCTION_COMPARISON_WITHOUT_NEONDB_URL =
  `postgresql://owner:production-password@${PRODUCTION_HOST}:5432/tradepulse_other?sslmode=require`;

function targetFingerprint(url: string): string {
  const parsed = parseDatabaseConnectionTarget(url);

  if (!parsed.ok) {
    throw new Error("The test fixture URL is not valid.");
  }

  return parsed.target.fingerprint;
}

function check(
  overrides: Partial<Parameters<typeof checkTestDatabaseTarget>[0]> = {},
): TestDatabaseTargetCheck {
  return checkTestDatabaseTarget({
    adminUrl: TEST_URL,
    deniedHosts: [],
    environment: { NODE_ENV: "test" },
    expectedNeonHost: TEST_HOST,
    productionFingerprints: "",
    productionUrls: [PRODUCTION_URL],
    ...overrides,
  });
}

function expectSuccess(
  result: TestDatabaseTargetCheck,
): Extract<TestDatabaseTargetCheck, { ok: true }> {
  if (!result.ok) {
    assert.fail(result.reason);
  }

  return result;
}

function expectFailure(
  result: TestDatabaseTargetCheck,
  pattern?: RegExp,
): void {
  if (result.ok) {
    assert.fail("Expected the test database target to be rejected.");
  }

  if (pattern) {
    assert.match(result.reason, pattern);
  }
}

describe("integration-test database target guard", () => {
  it("accepts the explicitly allowlisted Neon test database", () => {
    const result = expectSuccess(check());

    assert.equal(result.neon, true);
    assert.equal(result.target.host, TEST_HOST);
    assert.equal(result.target.database, TEST_DATABASE_NAME);
    assert.equal(result.target.schema, "public");
    assert.equal(result.target.port, 5432);
  });

  it("accepts a disposable non-Neon local database", () => {
    const result = expectSuccess(
      check({
        adminUrl: LOCAL_URL,
        expectedNeonHost: undefined,
      }),
    );

    assert.equal(result.neon, false);
    assert.equal(result.target.database, "postgres");
  });

  it("does not require a production comparison for a local target", () => {
    const result = expectSuccess(
      check({
        adminUrl: LOCAL_URL,
        expectedNeonHost: undefined,
        productionFingerprints: "",
        productionUrls: [],
      }),
    );

    assert.equal(result.neon, false);
  });

  it("rejects the production database name on a local target", () => {
    expectFailure(
      check({
        adminUrl:
          "postgresql://local_user:local-password@127.0.0.1:5432/neondb?sslmode=disable",
        expectedNeonHost: undefined,
      }),
      /production database neondb/,
    );
  });

  it("rejects a local target that matches a configured production URL", () => {
    expectFailure(
      check({
        adminUrl: LOCAL_URL,
        expectedNeonHost: undefined,
        productionUrls: [LOCAL_URL],
      }),
      /matches a configured production database target/,
    );
  });

  it("accepts a local target when configured production URLs are unrelated", () => {
    const result = expectSuccess(
      check({
        adminUrl: LOCAL_URL,
        expectedNeonHost: undefined,
        productionUrls: [PRODUCTION_URL],
      }),
    );

    assert.equal(result.neon, false);
  });

  it("requires the explicit test administration URL", () => {
    expectFailure(
      check({ adminUrl: undefined }),
      /TRADEPULSE_TEST_DATABASE_ADMIN_URL/,
    );
  });

  it("rejects production, preview, and staging runtime signals", () => {
    for (const environment of [
      { NODE_ENV: "production" },
      { NODE_ENV: "staging" },
      { VERCEL_ENV: "production" },
      { VERCEL_ENV: "preview" },
    ]) {
      expectFailure(check({ environment }), /production runtime signal/);
    }
  });

  it("rejects PostgreSQL target override variables", () => {
    for (const name of [
      "PGHOST",
      "PGHOSTADDR",
      "PGPORT",
      "PGDATABASE",
      "PGOPTIONS",
      "PGSERVICE",
    ]) {
      expectFailure(
        check({ environment: { NODE_ENV: "test", [name]: "configured" } }),
        new RegExp(name),
      );
    }
  });

  it("requires the non-secret Neon endpoint allowlist", () => {
    expectFailure(
      check({ expectedNeonHost: undefined }),
      new RegExp(TEST_DATABASE_EXPECTED_NEON_HOST_ENV),
    );
  });

  it("rejects a Neon endpoint that does not match the allowlist", () => {
    expectFailure(
      check({ expectedNeonHost: PRODUCTION_HOST }),
      /does not match TRADEPULSE_TEST_DATABASE_EXPECTED_NEON_HOST/,
    );
  });

  it("rejects a pooled endpoint in the allowlist", () => {
    expectFailure(
      check({ expectedNeonHost: TEST_POOLED_HOST }),
      /direct endpoint/,
    );
  });

  it("rejects a pooled administration endpoint", () => {
    expectFailure(
      check({ adminUrl: TEST_POOLED_URL }),
      /direct Neon endpoint/,
    );
  });

  it("rejects the production database name", () => {
    expectFailure(
      check({
        adminUrl:
          `postgresql://test_user:test-password@${TEST_HOST}:5432/neondb?sslmode=require`,
      }),
      /production database neondb/,
    );
  });

  it("rejects any database other than tradepulse_test", () => {
    expectFailure(
      check({
        adminUrl:
          `postgresql://test_user:test-password@${TEST_HOST}:5432/tradepulse_test_other?sslmode=require`,
      }),
      /must point at the dedicated test database/,
    );
  });

  it("rejects an explicit schema override", () => {
    expectFailure(
      check({ adminUrl: `${TEST_URL}&schema=public` }),
      /default public schema/,
    );
  });

  it("rejects a non-standard port", () => {
    expectFailure(
      check({
        adminUrl:
          `postgresql://test_user:test-password@${TEST_HOST}:6543/${TEST_DATABASE_NAME}?sslmode=require`,
      }),
      /standard PostgreSQL port 5432/,
    );
  });

  it("rejects an administration target that matches production", () => {
    expectFailure(
      check({ productionUrls: [TEST_URL] }),
      /matches a configured production database target/,
    );
  });

  it("accepts tradepulse_test on the production endpoint as a documented shared-endpoint limitation", () => {
    const result = expectSuccess(
      check({
        adminUrl: PRODUCTION_HOST_TEST_DATABASE_URL,
        expectedNeonHost: PRODUCTION_HOST,
        productionUrls: [PRODUCTION_URL],
      }),
    );

    assert.equal(result.neon, true);
    assert.equal(result.target.database, TEST_DATABASE_NAME);
  });

  it("rejects the production endpoint when it is explicitly denied", () => {
    expectFailure(
      check({
        adminUrl: PRODUCTION_HOST_TEST_DATABASE_URL,
        deniedHosts: [PRODUCTION_HOST],
        expectedNeonHost: PRODUCTION_HOST,
        productionUrls: [PRODUCTION_URL],
      }),
      /explicitly marked as production/,
    );
  });

  it("requires a neondb production URL or explicit fingerprints for Neon", () => {
    expectFailure(
      check({
        productionFingerprints: "",
        productionUrls: [PRODUCTION_COMPARISON_WITHOUT_NEONDB_URL],
      }),
      /cannot compare/,
    );
  });

  it("does not count a local neondb URL as a production comparison", () => {
    expectFailure(
      check({
        productionFingerprints: "",
        productionUrls: [
          "postgresql://local_user:local-password@127.0.0.1:5432/neondb?sslmode=disable",
        ],
      }),
      /cannot compare/,
    );
  });

  it("accepts a local target when a production comparison URL is invalid", () => {
    const result = expectSuccess(
      check({
        adminUrl: LOCAL_URL,
        expectedNeonHost: undefined,
        productionUrls: ["not-a-postgresql-url"],
      }),
    );

    assert.equal(result.neon, false);
  });

  it("rejects a production fingerprint match", () => {
    expectFailure(
      check({
        productionFingerprints: targetFingerprint(TEST_URL),
        productionUrls: [],
      }),
      /matches a configured production database target/,
    );
  });

  it("fails closed when no production comparison is configured", () => {
    expectFailure(
      check({ productionFingerprints: "", productionUrls: [] }),
      /cannot compare/,
    );
  });

  it("fails closed when a production comparison URL is invalid", () => {
    expectFailure(
      check({ productionUrls: ["not-a-postgresql-url"] }),
      /production database URL/,
    );
  });

  it("fails closed when a production fingerprint is malformed", () => {
    expectFailure(
      check({ productionFingerprints: "not-a-fingerprint" }),
      /malformed fingerprint/,
    );
  });

  it("rejects a host explicitly marked as production", () => {
    expectFailure(
      check({ deniedHosts: [TEST_HOST] }),
      /explicitly marked as production/,
    );
  });

  it("rejects a Neon allowlist configured for a local target", () => {
    expectFailure(
      check({
        adminUrl: LOCAL_URL,
        expectedNeonHost: TEST_HOST,
      }),
      /not a Neon target/,
    );
  });

  it("rejects production-looking local database names", () => {
    expectFailure(
      check({
        adminUrl:
          "postgresql://local_user:local-password@127.0.0.1:5432/tradepulse_prod?sslmode=disable",
        expectedNeonHost: undefined,
      }),
      /production-looking/,
    );
  });

  it("does not expose credentials or connection strings in results", () => {
    const success = check();
    const failure = check({ expectedNeonHost: PRODUCTION_HOST });

    for (const result of [success, failure]) {
      const serialized = JSON.stringify(result);

      assert.equal(serialized.includes("test-password"), false);
      assert.equal(serialized.includes("production-password"), false);
      assert.equal(serialized.includes("postgresql://"), false);
    }
  });

  it("recognizes only generated temporary database names", () => {
    assert.equal(
      isGeneratedTestDatabaseName(
        "tradepulse_test_m1abc_0123456789abcdef",
      ),
      true,
    );
    assert.equal(isGeneratedTestDatabaseName(TEST_DATABASE_NAME), false);
    assert.equal(isGeneratedTestDatabaseName("tradepulse_test_"), false);
    assert.equal(
      isGeneratedTestDatabaseName(
        "tradepulse_test_m1abc_0123456789ABCDEF",
      ),
      false,
    );
    assert.equal(
      isGeneratedTestDatabaseName(
        "tradepulse_test_m1abc_0123456789abcdef_extra",
      ),
      false,
    );
    assert.equal(isGeneratedTestDatabaseName("neondb"), false);
    assert.equal(
      isGeneratedTestDatabaseName("tradepulse_test_m1abc_0123abcd"),
      false,
    );
    assert.equal(
      isGeneratedTestDatabaseName(
        `tradepulse_test_${"a".repeat(50)}_0123456789abcdef`,
      ),
      false,
    );
  });
});

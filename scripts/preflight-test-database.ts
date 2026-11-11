import { readFileSync } from "node:fs";

import { parse as parseDotenv } from "dotenv";
import { Client } from "pg";

import {
  normalizeDatabaseHost,
  parseDatabaseConnectionTarget,
  type DatabaseConnectionTarget,
} from "../src/lib/db/connection-target";
import {
  checkTestDatabaseTarget,
  isGeneratedTestDatabaseName,
  isNeonHost,
  isNeonPoolerHost,
  PRODUCTION_DATABASE_NAME,
  PRODUCTION_TARGET_FINGERPRINTS_ENV,
  TEST_DATABASE_ADMIN_URL_ENV,
  TEST_DATABASE_EXPECTED_NEON_HOST_ENV,
  TEST_DATABASE_NAME,
  TestDatabaseTargetError,
} from "../src/lib/db/test-database-target";
import {
  productionConnectionUrls,
  requireTestDatabaseAdminUrl,
} from "../tests/integration/helpers/test-database";

/**
 * Read-only preflight for the integration-test administration connection.
 *
 * The fail-closed guard in `src/lib/db/test-database-target.ts` remains the
 * single source of truth. This script only calls it with the same inputs as the
 * integration harness, reports non-secret target identity, and optionally opens
 * one read-only session to confirm the credentials resolve to `tradepulse_test`.
 *
 * It never creates a database, applies a migration, truncates data, drops a
 * database, or runs the integration suite. It never prints a connection string,
 * password, or query-parameter value.
 */

const ENV_FILE_FLAG = "--env-file";
const CONNECT_FLAG = "--connect";
const LIST_GENERATED_FLAG = "--list-generated";
const DEFAULT_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

let failed = false;

function report(ok: boolean, label: string, detail?: string): void {
  if (!ok) {
    failed = true;
  }

  const status = ok ? "OK  " : "FAIL";
  console.log(
    `  ${status} ${label}${detail ? ` (${detail})` : ""}`,
  );
}

function section(title: string): void {
  console.log("");
  console.log(title);
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown error";

  // Connection errors should not contain credentials, but redact any URL shape
  // defensively before printing a driver message.
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://[redacted]");
}

function loadOptionalEnvironmentFile(): void {
  const index = process.argv.indexOf(ENV_FILE_FLAG);

  if (index === -1) {
    return;
  }

  const file = process.argv[index + 1];

  if (!file) {
    throw new Error(`${ENV_FILE_FLAG} requires a file path`);
  }

  const values = parseDotenv(readFileSync(file, "utf8"));

  for (const [name, value] of Object.entries(values)) {
    if (process.env[name] === undefined) {
      process.env[name] = value;
    }
  }
}

function probeRejects(input: {
  adminUrl: string;
  deniedHosts?: readonly string[];
  expectedNeonHost?: string;
  productionFingerprints?: string;
  productionUrls?: readonly string[];
}): boolean {
  return !checkTestDatabaseTarget({
    adminUrl: input.adminUrl,
    deniedHosts: input.deniedHosts ?? [],
    environment: {},
    expectedNeonHost: input.expectedNeonHost,
    productionFingerprints: input.productionFingerprints ?? "",
    productionUrls: input.productionUrls ?? [],
  }).ok;
}

function syntheticUrl(target: DatabaseConnectionTarget): string {
  return (
    `postgresql://probe:probe@${target.host}:${target.port}/` +
    `${encodeURIComponent(target.database)}?sslmode=require`
  );
}

async function main(): Promise<void> {
  loadOptionalEnvironmentFile();

  console.log("TradePulse integration-test database preflight (read-only)");
  console.log(
    "No DDL, DML, migration, database creation, truncation, or drop is performed.",
  );

  let adminUrl: string;

  try {
    adminUrl = requireTestDatabaseAdminUrl();
  } catch (error) {
    if (error instanceof TestDatabaseTargetError) {
      console.error(`FAIL ${error.message}`);
      process.exitCode = 1;
      return;
    }

    throw error;
  }

  const parsed = parseDatabaseConnectionTarget(adminUrl);

  if (!parsed.ok) {
    console.error(
      `FAIL ${TEST_DATABASE_ADMIN_URL_ENV} is not usable: ${parsed.reason}`,
    );
    process.exitCode = 1;
    return;
  }

  const target = parsed.target;
  const rawHost = new URL(adminUrl).hostname;
  const expectedHost = normalizeDatabaseHost(
    process.env[TEST_DATABASE_EXPECTED_NEON_HOST_ENV] ?? "",
  );

  section("Target identity");
  report(
    target.database === TEST_DATABASE_NAME,
    `database is exactly ${TEST_DATABASE_NAME}`,
    target.database,
  );
  report(isNeonHost(target.host), "endpoint is a Neon host", target.host);
  report(
    !isNeonPoolerHost(rawHost),
    "endpoint is direct, not pooled",
    rawHost,
  );
  report(
    target.host === expectedHost,
    `host matches ${TEST_DATABASE_EXPECTED_NEON_HOST_ENV}`,
    target.host,
  );
  report(target.port === 5432, "port is 5432", String(target.port));
  report(
    !parsed.schemaExplicit && target.schema === "public",
    "schema is the default public schema",
    target.schema,
  );

  const productionUrls = productionConnectionUrls();
  const explicitFingerprints = (
    process.env[PRODUCTION_TARGET_FINGERPRINTS_ENV] ?? ""
  )
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => DEFAULT_FINGERPRINT_PATTERN.test(entry));

  const productionFingerprints = new Set<string>(explicitFingerprints);
  let productionTarget: DatabaseConnectionTarget | undefined;
  let invalidProductionUrls = 0;

  for (const url of productionUrls) {
    const production = parseDatabaseConnectionTarget(url);

    if (!production.ok) {
      invalidProductionUrls += 1;
      continue;
    }

    productionFingerprints.add(production.target.fingerprint);
    productionTarget ??= production.target;
  }

  section("Production protection");
  report(
    productionFingerprints.size > 0,
    "production target fingerprints are available for comparison",
    `${productionFingerprints.size} distinct`,
  );
  report(
    invalidProductionUrls === 0,
    "every configured production comparison URL is usable",
    `${productionUrls.length} configured`,
  );
  report(
    !productionFingerprints.has(target.fingerprint),
    "the test target does not match any production fingerprint",
  );

  section("Guard behavior on unsafe targets");
  report(
    probeRejects({
      adminUrl: syntheticUrl({
        ...target,
        database: PRODUCTION_DATABASE_NAME,
      }),
      expectedNeonHost: target.host,
    }),
    `${PRODUCTION_DATABASE_NAME} is rejected on the same endpoint`,
  );
  report(
    probeRejects({
      adminUrl: syntheticUrl(target),
      deniedHosts: [target.host],
      expectedNeonHost: target.host,
    }),
    "an explicitly denied production host is rejected",
  );

  if (productionTarget) {
    report(
      probeRejects({
        adminUrl: syntheticUrl(productionTarget),
        expectedNeonHost: isNeonHost(productionTarget.host)
          ? productionTarget.host
          : undefined,
        productionFingerprints: [...productionFingerprints].join(","),
      }),
      "the configured production target is rejected by the guard",
    );
  }

  if (process.argv.includes(CONNECT_FLAG)) {
    section("Live read-only identity check");

    const client = new Client({
      connectionString: adminUrl,
      connectionTimeoutMillis: 15_000,
      query_timeout: 15_000,
    });

    try {
      await client.connect();

      const result = await client.query<{
        database: string;
        role: string;
        schema: string;
      }>(
        "SELECT current_database() AS database, " +
          "current_user AS role, current_schema() AS schema",
      );
      const row = result.rows[0];

      report(
        row?.database === TEST_DATABASE_NAME,
        "server reports the expected database",
        row?.database,
      );
      report(
        row?.schema === "public",
        "session uses the public schema",
        row?.schema,
      );
      report(
        typeof row?.role === "string" && row.role.length > 0,
        "authenticated role",
        row?.role,
      );

      if (process.argv.includes(LIST_GENERATED_FLAG)) {
        const databases = await client.query<{ datname: string }>(
          "SELECT datname FROM pg_database ORDER BY datname",
        );
        const generated = databases.rows
          .map((database) => database.datname)
          .filter(isGeneratedTestDatabaseName);

        report(
          generated.length === 0,
          "no generated temporary test databases remain",
          generated.length === 0 ? "none" : generated.join(", "),
        );
      }
    } catch (error) {
      report(false, "read-only connection succeeded", safeMessage(error));
    } finally {
      try {
        await client.end();
      } catch {
        // The connection may already be closed after a failure.
      }
    }
  } else {
    section("Live read-only identity check");
    console.log(
      `  SKIP pass ${CONNECT_FLAG} to confirm credentials and the live database identity`,
    );

    if (process.argv.includes(LIST_GENERATED_FLAG)) {
      console.log(
        `  SKIP pass ${CONNECT_FLAG} to list generated temporary databases`,
      );
    }
  }

  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`FAIL ${safeMessage(error)}`);
  process.exitCode = 1;
});

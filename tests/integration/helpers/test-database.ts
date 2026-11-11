import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { parse as parseDotenv } from "dotenv";
import { Client } from "pg";

import { parseDatabaseConnectionTarget } from "../../../src/lib/db/connection-target";
import {
  checkTestDatabaseTarget,
  GENERATED_TEST_DATABASE_PREFIX,
  isGeneratedTestDatabaseName,
  PRODUCTION_TARGET_FINGERPRINTS_ENV,
  PRODUCTION_TARGET_HOSTS_ENV,
  TEST_DATABASE_ADMIN_URL_ENV,
  TEST_DATABASE_EXPECTED_NEON_HOST_ENV,
  TestDatabaseTargetError,
} from "../../../src/lib/db/test-database-target";

export {
  TEST_DATABASE_ADMIN_URL_ENV,
  TEST_DATABASE_EXPECTED_NEON_HOST_ENV,
};

const PRODUCTION_DATABASE_ENV_NAMES = [
  "DATABASE_URL",
  "DIRECT_URL",
] as const;

export type TestDatabase = {
  databaseName: string;
  databaseUrl: string;
  drop(): Promise<void>;
};

export type TestDatabaseClientFactory = (connectionString: string) => Client;

export type TestDatabaseDependencies = {
  createClient?: TestDatabaseClientFactory;
};

function createPostgresClient(connectionString: string): Client {
  return new Client({ connectionString });
}

/**
 * Reads production URLs from `.env` without applying them to `process.env`.
 * The test process must never inherit the application's production target.
 */
function dotEnvProductionUrls(): string[] {
  try {
    const contents = readFileSync(
      path.resolve(process.cwd(), ".env"),
      "utf8",
    );
    const parsed = parseDotenv(contents);

    return [parsed.DATABASE_URL, parsed.DIRECT_URL].filter(
      (value): value is string => Boolean(value?.trim()),
    );
  } catch {
    return [];
  }
}

export function productionConnectionUrls(): string[] {
  const urls = [
    ...PRODUCTION_DATABASE_ENV_NAMES.map((name) => process.env[name]),
    ...dotEnvProductionUrls(),
  ];

  return [
    ...new Set(
      urls
        .map((url) => url?.trim())
        .filter((url): url is string => Boolean(url)),
    ),
  ];
}

/**
 * Reads the explicit test-only admin URL. It never falls back to DATABASE_URL or
 * DIRECT_URL, so a shell that is configured for development or production
 * cannot silently create and drop a database there.
 *
 * A Neon target is accepted only when the database is exactly
 * `tradepulse_test`, the direct endpoint matches the explicit non-secret
 * allowlist, and the target does not match a configured production URL.
 */
export function requireTestDatabaseAdminUrl(): string {
  const adminUrl = process.env[TEST_DATABASE_ADMIN_URL_ENV]?.trim();
  const result = checkTestDatabaseTarget({
    adminUrl,
    deniedHosts: (process.env[PRODUCTION_TARGET_HOSTS_ENV] ?? "").split(","),
    environment: process.env,
    expectedNeonHost: process.env[TEST_DATABASE_EXPECTED_NEON_HOST_ENV],
    productionFingerprints:
      process.env[PRODUCTION_TARGET_FINGERPRINTS_ENV],
    productionUrls: productionConnectionUrls(),
  });

  if (!result.ok) {
    throw new TestDatabaseTargetError(result.reason);
  }

  if (!adminUrl) {
    throw new TestDatabaseTargetError(
      `${TEST_DATABASE_ADMIN_URL_ENV} is required`,
    );
  }

  return adminUrl;
}

function generateDatabaseName(): string {
  const name = `${GENERATED_TEST_DATABASE_PREFIX}${Date.now().toString(36)}_${randomBytes(8).toString("hex")}`;

  if (!isGeneratedTestDatabaseName(name)) {
    throw new Error("Generated test database name is not a safe identifier.");
  }

  return name;
}

function quoteIdentifier(identifier: string): string {
  // Prisma model names are PascalCase, so table identifiers need mixed case.
  // Generated database names are validated separately and stay lowercase.
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(identifier)) {
    throw new Error("Refusing to quote an unsafe database identifier.");
  }

  return `"${identifier}"`;
}

function buildDatabaseUrl(adminUrl: string, databaseName: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  // The generated database uses the default schema. A schema override on the
  // admin URL must not silently apply to the test database.
  url.searchParams.delete("schema");
  return url.toString();
}

async function databaseOwner(
  client: Client,
  databaseName: string,
): Promise<{ currentRole: string; owner: string } | null> {
  const result = await client.query<{
    current_role_name: string;
    owner: string;
  }>(
    `SELECT pg_get_userbyid(datdba) AS owner,
            current_user AS current_role_name
     FROM pg_database
     WHERE datname = $1`,
    [databaseName],
  );

  if (result.rowCount !== 1) {
    return null;
  }

  return {
    currentRole: result.rows[0].current_role_name,
    owner: result.rows[0].owner,
  };
}

export type TestDatabaseCleanupDependencies = {
  /** Reuse the already-validated administration URL when available. */
  adminUrl?: string;
  createClient?: TestDatabaseClientFactory;
  /** Runs immediately after the DROP succeeds, before the client is closed. */
  onDropped?: () => void;
};

/**
 * Drops one generated temporary database after re-validating every safety
 * condition. Used by `TestDatabase.drop()` and by the explicit cleanup CLI for
 * databases leaked by an interrupted test process.
 *
 * Returns false when the database no longer exists. Throws without dropping
 * when the name is not generated, the administration connection resolves
 * elsewhere, or the connected role does not own the database.
 */
export async function dropGeneratedTestDatabase(
  databaseName: string,
  dependencies: TestDatabaseCleanupDependencies = {},
): Promise<boolean> {
  if (!isGeneratedTestDatabaseName(databaseName)) {
    throw new Error(
      "Refusing to drop a database that does not match the generated test-database convention.",
    );
  }

  const adminUrl = dependencies.adminUrl ?? requireTestDatabaseAdminUrl();
  const adminTarget = parseDatabaseConnectionTarget(adminUrl);

  if (!adminTarget.ok) {
    throw new TestDatabaseTargetError(
      `${TEST_DATABASE_ADMIN_URL_ENV} is not a usable PostgreSQL URL: ${adminTarget.reason}`,
    );
  }

  const createClient = dependencies.createClient ?? createPostgresClient;
  const cleanup = createClient(adminUrl);
  let cleanupConnected = false;

  try {
    await cleanup.connect();
    cleanupConnected = true;

    const currentDatabase = await cleanup.query<{
      database_name: string;
    }>("SELECT current_database() AS database_name");

    if (
      currentDatabase.rows[0]?.database_name !== adminTarget.target.database
    ) {
      throw new Error(
        "Refusing to drop a test database: the administration connection did not resolve to the configured database.",
      );
    }

    const ownership = await databaseOwner(cleanup, databaseName);

    if (!ownership) {
      return false;
    }

    if (ownership.owner !== ownership.currentRole) {
      throw new Error(
        "Refusing to drop a test database owned by a different role.",
      );
    }

    // Only this generated database is terminated and dropped. The admin
    // database and every other database on the server are untouched.
    await cleanup.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    );
    await cleanup.query(
      `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`,
    );
    dependencies.onDropped?.();
    return true;
  } finally {
    if (cleanupConnected) {
      await cleanup.end();
    }
  }
}

/**
 * Creates a uniquely named database on the explicitly configured test server.
 * Callers apply the migration chain themselves so migration-history tests can
 * stop at an intermediate revision.
 */
export async function createTestDatabase(
  dependencies: TestDatabaseDependencies = {},
): Promise<TestDatabase> {
  const adminUrl = requireTestDatabaseAdminUrl();
  const adminTarget = parseDatabaseConnectionTarget(adminUrl);

  if (!adminTarget.ok) {
    throw new TestDatabaseTargetError(
      `${TEST_DATABASE_ADMIN_URL_ENV} is not a usable PostgreSQL URL: ${adminTarget.reason}`,
    );
  }

  const createClient = dependencies.createClient ?? createPostgresClient;
  const databaseName = generateDatabaseName();
  const admin = createClient(adminUrl);
  let connected = false;
  let created = false;
  let failed = false;
  let failure: unknown;

  try {
    await admin.connect();
    connected = true;

    const currentDatabase = await admin.query<{
      database_name: string;
    }>("SELECT current_database() AS database_name");

    if (
      currentDatabase.rows[0]?.database_name !==
      adminTarget.target.database
    ) {
      throw new Error(
        "Refusing to create a test database: the administration connection did not resolve to the configured database.",
      );
    }

    await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    created = true;
  } catch (error) {
    failed = true;
    failure = error;
    attachDatabaseName(error, databaseName);
    throw error;
  } finally {
    if (connected) {
      try {
        await admin.end();
      } catch (endError) {
        if (failed) {
          attachCleanupFailure(failure, endError);
        } else if (!created) {
          throw endError;
        }

        // If the database exists and the operation succeeded, the handle is
        // returned so the caller can still drop it.
      }
    }
  }

  return {
    databaseName,
    databaseUrl: buildDatabaseUrl(adminUrl, databaseName),
    async drop() {
      if (!created) {
        return;
      }

      await dropGeneratedTestDatabase(databaseName, {
        adminUrl,
        createClient,
        onDropped: () => {
          created = false;
        },
      });
      created = false;
    },
  };
}

/**
 * Closes the Prisma client, the raw PostgreSQL client, and the temporary
 * database in that order. Every step is attempted even when an earlier step
 * fails, and every failure is preserved.
 *
 * The generated-name and ownership checks inside `database.drop()` remain the
 * only path to `DROP DATABASE`.
 */
export async function closeTestDatabase(input: {
  client?: Pick<Client, "end">;
  database?: Pick<TestDatabase, "drop">;
  disconnect?: () => Promise<void>;
}): Promise<void> {
  const errors: unknown[] = [];

  if (input.disconnect) {
    try {
      await input.disconnect();
    } catch (error) {
      errors.push(error);
    }
  }

  if (input.client) {
    try {
      await input.client.end();
    } catch (error) {
      errors.push(error);
    }
  }

  if (input.database) {
    try {
      await input.database.drop();
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length === 0) {
    return;
  }

  if (errors.length === 1) {
    throw errors[0];
  }

  throw new AggregateError(
    errors,
    "Failed to close the integration-test database cleanly.",
  );
}

function attachDatabaseName(error: unknown, databaseName: string): void {
  if (!(error instanceof Error)) {
    return;
  }

  // The generated name is not a secret and helps manual cleanup if CREATE
  // succeeded on the server but the client saw a failure.
  try {
    Object.defineProperty(error, "testDatabaseName", {
      configurable: true,
      enumerable: false,
      value: databaseName,
      writable: false,
    });
  } catch {
    // Preserve the original failure even if the detail cannot be attached.
  }
}

function attachCleanupFailure(error: unknown, cleanupError: unknown): void {
  if (!(error instanceof Error) || !(cleanupError instanceof Error)) {
    return;
  }

  // Keep the original test failure as the thrown error and expose the cleanup
  // failure alongside it instead of masking the test failure.
  try {
    Object.defineProperty(error, "cleanupError", {
      configurable: true,
      enumerable: false,
      value: cleanupError,
      writable: false,
    });
  } catch {
    // A non-extensible error still takes precedence over the cleanup failure.
  }
}

export async function withTestDatabase<T>(
  operation: (database: TestDatabase) => Promise<T>,
  dependencies: TestDatabaseDependencies = {},
): Promise<T> {
  const database = await createTestDatabase(dependencies);
  let operationSucceeded = false;

  try {
    const result = await operation(database);
    operationSucceeded = true;
    return result;
  } catch (error) {
    try {
      await database.drop();
    } catch (cleanupError) {
      attachCleanupFailure(error, cleanupError);
    }

    throw error;
  } finally {
    if (operationSucceeded) {
      await database.drop();
    }
  }
}

const APPLICATION_TABLES = [
  "AuditEvent",
  "RetailerLinkRequest",
  "Session",
  "OtpChallenge",
  "OtpRequestReservation",
  "SalesmanRetailerAssignment",
  "OrderItem",
  "Order",
  "Scheme",
  "Inventory",
  "ProductAlias",
  "RetailerProductPrice",
  "Product",
  "Retailer",
  "User",
] as const;

/** Clears all application rows between integration tests. */
export async function resetTestData(client: Client): Promise<void> {
  const tables = APPLICATION_TABLES.map(quoteIdentifier).join(", ");
  await client.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

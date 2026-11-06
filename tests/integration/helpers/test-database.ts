import { randomBytes } from "node:crypto";

import { Client } from "pg";

import {
  isProductionLikeIdentifier,
  normalizeDatabaseHost,
  parseDatabaseConnectionTarget,
} from "../../../src/lib/db/connection-target";

export const TEST_DATABASE_ADMIN_URL_ENV =
  "TRADEPULSE_TEST_DATABASE_ADMIN_URL";

const GENERATED_DATABASE_PREFIX = "tradepulse_test_";
const PRODUCTION_ENV_NAMES = [
  "NODE_ENV",
  "VERCEL_ENV",
] as const;

export type TestDatabase = {
  databaseName: string;
  databaseUrl: string;
  drop(): Promise<void>;
};

function productionEnvironmentError(): string | null {
  for (const name of PRODUCTION_ENV_NAMES) {
    if (process.env[name]?.trim().toLowerCase() === "production") {
      return `Refusing to create a test database while ${name}=production.`;
    }
  }

  return null;
}

/**
 * Reads the explicit test-only admin URL. It never falls back to DATABASE_URL or
 * DIRECT_URL, so a shell that is configured for development or production
 * cannot silently create and drop a database there.
 */
export function requireTestDatabaseAdminUrl(): string {
  const productionError = productionEnvironmentError();

  if (productionError) {
    throw new Error(productionError);
  }

  const raw = process.env[TEST_DATABASE_ADMIN_URL_ENV]?.trim();

  if (!raw) {
    throw new Error(
      `${TEST_DATABASE_ADMIN_URL_ENV} is required for PostgreSQL integration tests. ` +
        "Set it to a disposable, non-production PostgreSQL role with CREATEDB permission. " +
        "The harness never falls back to DATABASE_URL or DIRECT_URL.",
    );
  }

  const parsed = parseDatabaseConnectionTarget(raw);

  if (!parsed.ok) {
    throw new Error(
      `${TEST_DATABASE_ADMIN_URL_ENV} is not a usable PostgreSQL URL: ${parsed.reason}.`,
    );
  }

  const target = parsed.target;

  if (target.host === "neon.tech" || target.host.endsWith(".neon.tech")) {
    throw new Error(
      `${TEST_DATABASE_ADMIN_URL_ENV} points at Neon. Integration tests create and drop databases and must use a disposable local or isolated test server, never Neon or production.`,
    );
  }

  if (
    isProductionLikeIdentifier(target.database) ||
    isProductionLikeIdentifier(target.schema)
  ) {
    throw new Error(
      `${TEST_DATABASE_ADMIN_URL_ENV} points at a production-looking database or schema.`,
    );
  }

  const deniedHosts = (process.env.TRADEPULSE_PRODUCTION_TARGET_HOSTS ?? "")
    .split(",")
    .map((host) => normalizeDatabaseHost(host))
    .filter(Boolean);

  if (deniedHosts.includes(target.host)) {
    throw new Error(
      `${TEST_DATABASE_ADMIN_URL_ENV} points at a host explicitly marked as production.`,
    );
  }

  return raw;
}

function generateDatabaseName(): string {
  const name = `${GENERATED_DATABASE_PREFIX}${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;

  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error("Generated test database name is not a safe identifier.");
  }

  return name;
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(identifier)) {
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

/**
 * Creates a uniquely named database on the explicitly configured test server.
 * Callers apply the migration chain themselves so migration-history tests can
 * stop at an intermediate revision.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = requireTestDatabaseAdminUrl();
  const databaseName = generateDatabaseName();
  const admin = new Client({ connectionString: adminUrl });
  let created = false;

  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    created = true;
  } finally {
    await admin.end();
  }

  return {
    databaseName,
    databaseUrl: buildDatabaseUrl(adminUrl, databaseName),
    async drop() {
      if (!created || !databaseName.startsWith(GENERATED_DATABASE_PREFIX)) {
        return;
      }

      created = false;
      const cleanup = new Client({ connectionString: adminUrl });

      try {
        await cleanup.connect();
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
      } finally {
        await cleanup.end();
      }
    },
  };
}

export async function withTestDatabase<T>(
  operation: (database: TestDatabase) => Promise<T>,
): Promise<T> {
  const database = await createTestDatabase();

  try {
    return await operation(database);
  } finally {
    await database.drop();
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

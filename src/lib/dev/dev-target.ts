import {
  computeDatabaseTargetFingerprint,
  DEFAULT_POSTGRES_PORT,
  DEFAULT_POSTGRES_SCHEMA,
  isProductionLikeIdentifier,
  normalizeDatabaseHost,
  parseDatabaseConnectionTarget,
  TARGET_OVERRIDE_ENVIRONMENT_VARIABLES,
  type DatabaseConnectionTarget,
} from "../db/connection-target";

type Environment = Record<string, string | undefined>;

export const DEV_TARGET_FINGERPRINT_ENV = "TRADEPULSE_DEV_TARGET_FINGERPRINT";
export const DEV_TARGET_HOSTS_ENV = "TRADEPULSE_DEV_TARGET_HOSTS";
export const PRODUCTION_TARGET_HOSTS_ENV =
  "TRADEPULSE_PRODUCTION_TARGET_HOSTS";

const SYSTEM_SCHEMAS = new Set([
  "information_schema",
  "pg_catalog",
  "pg_toast",
]);

export type DevelopmentDatabaseTarget = DatabaseConnectionTarget;

export type DevelopmentDatabaseTargetCheck =
  | { ok: true; target: DevelopmentDatabaseTarget }
  | { ok: false; reason: string };

export class DevelopmentTargetError extends Error {
  constructor(reason: string) {
    super(
      `Refusing to use this database as a development target: ${reason}. ` +
        "Configure an explicit development branch hostname and fingerprint as documented in README.md.",
    );
    this.name = "DevelopmentTargetError";
  }
}

export { normalizeDatabaseHost };

export function computeDevelopmentTargetFingerprint(input: {
  host: string;
  port?: number;
  database: string;
  schema?: string;
}): string {
  return computeDatabaseTargetFingerprint({
    host: input.host,
    port: input.port ?? DEFAULT_POSTGRES_PORT,
    database: input.database,
    schema: input.schema ?? DEFAULT_POSTGRES_SCHEMA,
  });
}

/**
 * Extracts only the non-secret parts of a PostgreSQL connection string. The
 * credentials, query parameter values, and raw URL are deliberately never
 * returned.
 */
export function describeDatabaseTarget(
  connectionString: string | undefined,
): DevelopmentDatabaseTarget | null {
  const parsed = parseDatabaseConnectionTarget(connectionString);
  return parsed.ok ? parsed.target : null;
}

function parseHostList(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((entry) => normalizeDatabaseHost(entry))
        .filter(Boolean),
    ),
  ];
}

function hasProductionSignal(env: Environment): boolean {
  const nodeEnv = env.NODE_ENV?.trim().toLowerCase();
  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase();

  return (
    nodeEnv === "production" ||
    nodeEnv === "staging" ||
    vercelEnv === "production" ||
    vercelEnv === "preview" ||
    vercelEnv === "staging"
  );
}

function sameDatabaseTarget(
  left: DatabaseConnectionTarget,
  right: DatabaseConnectionTarget,
): boolean {
  return (
    left.host === right.host &&
    left.port === right.port &&
    left.database === right.database &&
    left.schema === right.schema
  );
}

/**
 * Fail-closed check for development-only writes and development OTP.
 *
 * `DATABASE_URL` is the runtime target used by `getPrismaClient()`. When
 * `DIRECT_URL` is configured, it must resolve to the same host, port, database,
 * and schema; neither variable silently wins. An allowlisted host alone is not
 * enough because the fingerprint is derived from the effective driver target,
 * including query-parameter overrides, the port, and the schema.
 */
export function checkDevelopmentDatabaseTarget(
  env: Environment,
): DevelopmentDatabaseTargetCheck {
  if (hasProductionSignal(env)) {
    return {
      ok: false,
      reason: "a production runtime signal is present",
    };
  }

  for (const name of TARGET_OVERRIDE_ENVIRONMENT_VARIABLES) {
    if (env[name]?.trim()) {
      return {
        ok: false,
        reason: `${name} is set and its effective target cannot be safely verified`,
      };
    }
  }

  const runtime = parseDatabaseConnectionTarget(env.DATABASE_URL);

  if (!runtime.ok) {
    return {
      ok: false,
      reason: `DATABASE_URL ${runtime.reason}`,
    };
  }

  const directUrl = env.DIRECT_URL?.trim();

  if (directUrl) {
    const direct = parseDatabaseConnectionTarget(directUrl);

    if (!direct.ok) {
      return {
        ok: false,
        reason: "DIRECT_URL is not a valid PostgreSQL connection URL",
      };
    }

    if (!sameDatabaseTarget(runtime.target, direct.target)) {
      return {
        ok: false,
        reason:
          "DIRECT_URL does not match DATABASE_URL on the effective target",
      };
    }
  }

  if (isProductionLikeIdentifier(runtime.target.database)) {
    return {
      ok: false,
      reason: "the effective database name is marked as production",
    };
  }

  if (
    isProductionLikeIdentifier(runtime.target.schema) ||
    SYSTEM_SCHEMAS.has(runtime.target.schema) ||
    runtime.target.schema.startsWith("pg_")
  ) {
    return {
      ok: false,
      reason: "the effective schema is marked as production or system-managed",
    };
  }

  const expectedFingerprint = env[DEV_TARGET_FINGERPRINT_ENV]
    ?.trim()
    .toLowerCase();

  if (
    !expectedFingerprint ||
    !/^[a-f0-9]{64}$/.test(expectedFingerprint)
  ) {
    return {
      ok: false,
      reason: `${DEV_TARGET_FINGERPRINT_ENV} is missing or malformed`,
    };
  }

  const productionHosts = parseHostList(env[PRODUCTION_TARGET_HOSTS_ENV]);

  if (productionHosts.includes(runtime.target.host)) {
    return {
      ok: false,
      reason: "the database host is explicitly marked as production",
    };
  }

  const allowedHosts = parseHostList(env[DEV_TARGET_HOSTS_ENV]);

  if (allowedHosts.length === 0) {
    return {
      ok: false,
      reason: `${DEV_TARGET_HOSTS_ENV} is missing`,
    };
  }

  if (!allowedHosts.includes(runtime.target.host)) {
    return {
      ok: false,
      reason: "the database host is not in the development allowlist",
    };
  }

  if (expectedFingerprint !== runtime.target.fingerprint) {
    return {
      ok: false,
      reason: "the configured fingerprint does not match the database target",
    };
  }

  return { ok: true, target: runtime.target };
}

export function requireDevelopmentDatabaseTarget(
  env: Environment,
): DevelopmentDatabaseTarget {
  const result = checkDevelopmentDatabaseTarget(env);

  if (!result.ok) {
    throw new DevelopmentTargetError(result.reason);
  }

  return result.target;
}

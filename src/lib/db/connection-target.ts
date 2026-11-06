import { createHash } from "node:crypto";

import { parse } from "pg-connection-string";

export const DEFAULT_POSTGRES_PORT = 5432;
export const DEFAULT_POSTGRES_SCHEMA = "public";

/**
 * The pg driver reads these variables when the corresponding value is absent
 * from the connection string. An omitted port, for example, falls back to
 * PGPORT before the driver default, and PGOPTIONS can alter search_path.
 */
export const TARGET_OVERRIDE_ENVIRONMENT_VARIABLES = [
  "PGHOST",
  "PGHOSTADDR",
  "PGPORT",
  "PGDATABASE",
  "PGOPTIONS",
  "PGSERVICE",
] as const;

export type DatabaseConnectionTarget = {
  host: string;
  port: number;
  database: string;
  schema: string;
  fingerprint: string;
};

export type DatabaseConnectionTargetResult =
  | { ok: true; target: DatabaseConnectionTarget; schemaExplicit: boolean }
  | { ok: false; reason: string };

/**
 * Neon exposes the same branch through `-pooler` and direct hostnames. Only
 * Neon hostnames may be normalized: stripping `-pooler` from an unrelated host
 * would let two different endpoints share a fingerprint.
 */
export function normalizeDatabaseHost(hostname: string): string {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");

  if (!host.endsWith(".neon.tech")) {
    return host;
  }

  const labels = host.split(".");
  const first = labels[0];

  if (!first?.endsWith("-pooler") || first.length === "-pooler".length) {
    return host;
  }

  labels[0] = first.slice(0, -"-pooler".length);
  return labels.join(".");
}

export function computeDatabaseTargetFingerprint(input: {
  host: string;
  port: number;
  database: string;
  schema: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        normalizeDatabaseHost(input.host),
        input.port,
        input.database,
        input.schema,
      ]),
      "utf8",
    )
    .digest("hex");
}

export function isProductionLikeIdentifier(value: string): boolean {
  return /(^|[._-])(prod|production)([._-]|$)/i.test(value);
}

const ALLOWED_QUERY_PARAMETERS = new Set([
  "application_name",
  "channel_binding",
  "connect_timeout",
  "schema",
  "sslmode",
  "sslnegotiation",
  "uselibpqcompat",
]);

const SAFE_SCHEMA = /^[a-z_][a-z0-9_]*$/;

function invalid(reason: string): DatabaseConnectionTargetResult {
  return { ok: false, reason };
}

function validateQueryParameters(url: URL): DatabaseConnectionTargetResult | null {
  const seen = new Set<string>();

  for (const [key, value] of url.searchParams) {
    if (seen.has(key)) {
      return invalid("the connection URL contains duplicate parameters");
    }

    seen.add(key);

    if (!ALLOWED_QUERY_PARAMETERS.has(key)) {
      return invalid(
        `the connection URL contains an unsupported parameter "${key}"`,
      );
    }

    if (key === "sslmode" && ![
      "disable",
      "prefer",
      "require",
      "verify-ca",
      "verify-full",
      "no-verify",
    ].includes(value)) {
      return invalid("the connection URL has an invalid sslmode value");
    }

    if (key === "channel_binding" && ![
      "disable",
      "prefer",
      "require",
    ].includes(value)) {
      return invalid("the connection URL has an invalid channel_binding value");
    }

    if (key === "sslnegotiation" && !["postgres", "direct"].includes(value)) {
      return invalid("the connection URL has an invalid sslnegotiation value");
    }

    if (key === "uselibpqcompat" && !["true", "false"].includes(value)) {
      return invalid("the connection URL has an invalid uselibpqcompat value");
    }

    if (key === "connect_timeout" && !/^\d+$/.test(value)) {
      return invalid("the connection URL has an invalid connect_timeout value");
    }
  }

  return null;
}

/**
 * Parses a PostgreSQL connection string with the same parser used by `pg`.
 *
 * The effective host, port, database, and schema are what matter. Query
 * parameters accepted by `pg-connection-string` such as `host` and `port`
 * override the URL authority, so this parser rejects every target-affecting
 * parameter instead of validating only the visible URL authority.
 */
export function parseDatabaseConnectionTarget(
  connectionString: string | undefined,
): DatabaseConnectionTargetResult {
  const trimmed = connectionString?.trim();

  if (!trimmed) {
    return invalid("the database URL is missing");
  }

  if (trimmed.startsWith("/")) {
    return invalid("Unix-domain socket connection strings are not supported");
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    // Never include the raw URL in an error: it can contain credentials.
    return invalid("the database URL is not valid");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return invalid("the database URL must use the postgres or postgresql protocol");
  }

  if (url.hash) {
    return invalid("the database URL must not contain a fragment");
  }

  if (!url.hostname) {
    return invalid("the database URL must include a host");
  }

  const queryError = validateQueryParameters(url);

  if (queryError) {
    return queryError;
  }

  const schemaParam = url.searchParams.get("schema");
  const schemaExplicit = schemaParam !== null;
  const schema = schemaParam?.trim() || DEFAULT_POSTGRES_SCHEMA;

  if (!SAFE_SCHEMA.test(schema)) {
    return invalid("the effective schema is not a safe PostgreSQL identifier");
  }

  let parsed: ReturnType<typeof parse>;

  try {
    parsed = parse(trimmed);
  } catch {
    // pg-connection-string redacts the input, but use a fixed message anyway.
    return invalid("the database URL could not be parsed by the PostgreSQL driver");
  }

  const host = typeof parsed.host === "string" ? parsed.host.trim() : "";

  if (
    !host ||
    host.startsWith("/") ||
    host.includes("/") ||
    host.includes("\\") ||
    host.includes("\0")
  ) {
    return invalid("the database URL does not resolve to a valid host");
  }

  const normalizedHost = normalizeDatabaseHost(host);

  if (!normalizedHost) {
    return invalid("the database URL does not resolve to a valid host");
  }

  const rawPort = parsed.port;
  const port =
    rawPort === undefined || rawPort === null || rawPort === ""
      ? DEFAULT_POSTGRES_PORT
      : Number(rawPort);

  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    return invalid("the database URL does not resolve to a valid port");
  }

  const database =
    typeof parsed.database === "string" ? parsed.database.trim() : "";

  if (
    !database ||
    database.includes("/") ||
    database.includes("\\") ||
    database.includes("\0")
  ) {
    return invalid("the database URL does not resolve to exactly one database");
  }

  return {
    ok: true,
    schemaExplicit,
    target: {
      host: normalizedHost,
      port,
      database,
      schema,
      fingerprint: computeDatabaseTargetFingerprint({
        host: normalizedHost,
        port,
        database,
        schema,
      }),
    },
  };
}

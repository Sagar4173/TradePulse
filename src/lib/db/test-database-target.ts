import {
  isProductionLikeIdentifier,
  normalizeDatabaseHost,
  parseDatabaseConnectionTarget,
  TARGET_OVERRIDE_ENVIRONMENT_VARIABLES,
  type DatabaseConnectionTarget,
} from "./connection-target";

export const TEST_DATABASE_ADMIN_URL_ENV =
  "TRADEPULSE_TEST_DATABASE_ADMIN_URL";
export const TEST_DATABASE_EXPECTED_NEON_HOST_ENV =
  "TRADEPULSE_TEST_DATABASE_EXPECTED_NEON_HOST";
export const PRODUCTION_TARGET_FINGERPRINTS_ENV =
  "TRADEPULSE_PRODUCTION_TARGET_FINGERPRINTS";
export const PRODUCTION_TARGET_HOSTS_ENV =
  "TRADEPULSE_PRODUCTION_TARGET_HOSTS";

export const TEST_DATABASE_NAME = "tradepulse_test";
export const PRODUCTION_DATABASE_NAME = "neondb";
export const GENERATED_TEST_DATABASE_PREFIX = "tradepulse_test_";

const PRODUCTION_ENV_NAMES = [
  "NODE_ENV",
  "VERCEL_ENV",
] as const;
const PRODUCTION_ENV_VALUES = new Set([
  "production",
  "preview",
  "staging",
]);
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const GENERATED_NAME_PATTERN =
  /^tradepulse_test_[a-z0-9]+_[a-f0-9]{16}$/;

type Environment = Record<string, string | undefined>;

export type TestDatabaseTargetCheck =
  | {
      ok: true;
      neon: boolean;
      target: DatabaseConnectionTarget;
    }
  | {
      ok: false;
      reason: string;
    };

export class TestDatabaseTargetError extends Error {
  constructor(reason: string) {
    super(
      `Refusing to use this database for integration tests: ${reason}. ` +
        "Configure an explicitly isolated test database as documented in README.md.",
    );
    this.name = "TestDatabaseTargetError";
  }
}

function hasProductionSignal(environment: Environment): boolean {
  for (const name of PRODUCTION_ENV_NAMES) {
    const value = environment[name]?.trim().toLowerCase();

    if (value && PRODUCTION_ENV_VALUES.has(value)) {
      return true;
    }
  }

  return false;
}

export function isNeonHost(host: string): boolean {
  return host === "neon.tech" || host.endsWith(".neon.tech");
}

export function isNeonPoolerHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/\.$/, "");
  const firstLabel = normalized.split(".")[0] ?? "";

  return (
    firstLabel.length > "-pooler".length &&
    firstLabel.endsWith("-pooler")
  );
}

function parseFingerprintList(
  value: string | undefined,
): { ok: true; fingerprints: string[] } | { ok: false; reason: string } {
  const entries = (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  for (const entry of entries) {
    if (!FINGERPRINT_PATTERN.test(entry)) {
      return {
        ok: false,
        reason: `${PRODUCTION_TARGET_FINGERPRINTS_ENV} contains a malformed fingerprint`,
      };
    }
  }

  return { ok: true, fingerprints: [...new Set(entries)] };
}

type ProductionComparison = {
  fingerprints: string[];
  includesProductionDatabase: boolean;
  invalidUrls: number;
};

function productionComparisonFromUrls(
  urls: readonly string[],
): ProductionComparison {
  const fingerprints = new Set<string>();
  let includesProductionDatabase = false;
  let invalidUrls = 0;

  for (const url of urls) {
    if (!url.trim()) {
      continue;
    }

    const parsed = parseDatabaseConnectionTarget(url);

    if (!parsed.ok) {
      invalidUrls += 1;
      continue;
    }

    fingerprints.add(parsed.target.fingerprint);

    if (
      parsed.target.database === PRODUCTION_DATABASE_NAME &&
      isNeonHost(parsed.target.host)
    ) {
      includesProductionDatabase = true;
    }
  }

  return {
    fingerprints: [...fingerprints],
    includesProductionDatabase,
    invalidUrls,
  };
}

/**
 * Fail-closed guard for the integration-test administration connection.
 *
 * Local disposable PostgreSQL keeps the original behavior: any non-production
 * database on the configured host is allowed, provided it does not use the
 * production database name and does not match a configured production target.
 *
 * A Neon target is allowed only when all of the following are explicitly
 * configured:
 *
 * - the database name is exactly `tradepulse_test`;
 * - the direct endpoint host matches the non-secret allowlist;
 * - the URL does not use Neon's `-pooler` endpoint;
 * - the target does not match a configured production target;
 * - a production comparison is available from a `neondb` URL or explicit
 *   non-secret fingerprints.
 *
 * The allowlist intentionally permits `tradepulse_test` on the same Neon
 * endpoint as production, because the test database lives in the existing
 * project. The `neondb` comparison only proves that a Neon production database
 * URL is configured; it does not prove the test endpoint is isolated. Set
 * `TRADEPULSE_PRODUCTION_TARGET_HOSTS` to reject that endpoint when a separate
 * Neon project or branch is required.
 *
 * The guard never includes a connection string or password in its result.
 */
export function checkTestDatabaseTarget(input: {
  adminUrl: string | undefined;
  expectedNeonHost?: string;
  productionUrls?: readonly string[];
  productionFingerprints?: string;
  deniedHosts?: readonly string[];
  environment?: Environment;
}): TestDatabaseTargetCheck {
  const environment = input.environment ?? process.env;

  if (hasProductionSignal(environment)) {
    return {
      ok: false,
      reason: "a production runtime signal is present",
    };
  }

  for (const name of TARGET_OVERRIDE_ENVIRONMENT_VARIABLES) {
    if (environment[name]?.trim()) {
      return {
        ok: false,
        reason: `${name} is set and its effective target cannot be safely verified`,
      };
    }
  }

  const adminUrl = input.adminUrl?.trim();

  if (!adminUrl) {
    return {
      ok: false,
      reason: `${TEST_DATABASE_ADMIN_URL_ENV} is required`,
    };
  }

  const parsed = parseDatabaseConnectionTarget(adminUrl);

  if (!parsed.ok) {
    return {
      ok: false,
      reason: `${TEST_DATABASE_ADMIN_URL_ENV} is not a usable PostgreSQL URL: ${parsed.reason}`,
    };
  }

  const target = parsed.target;
  const deniedHosts = new Set(
    (input.deniedHosts ?? [])
      .map((host) => normalizeDatabaseHost(host))
      .filter(Boolean),
  );

  if (deniedHosts.has(target.host)) {
    return {
      ok: false,
      reason: `${TEST_DATABASE_ADMIN_URL_ENV} points at a host explicitly marked as production`,
    };
  }

  // `neondb` is the production database name for this project. Reject it for
  // every target, including local servers, before any other comparison.
  if (target.database === PRODUCTION_DATABASE_NAME) {
    return {
      ok: false,
      reason: `${TEST_DATABASE_ADMIN_URL_ENV} points at the production database ${PRODUCTION_DATABASE_NAME}`,
    };
  }

  const configuredFingerprints = parseFingerprintList(
    input.productionFingerprints,
  );

  if (!configuredFingerprints.ok) {
    return configuredFingerprints;
  }

  const productionComparison = productionComparisonFromUrls(
    input.productionUrls ?? [],
  );
  const neon = isNeonHost(target.host);

  if (productionComparison.invalidUrls > 0 && neon) {
    return {
      ok: false,
      reason:
        "a configured production database URL is not a usable PostgreSQL URL",
    };
  }

  const productionFingerprints = new Set([
    ...configuredFingerprints.fingerprints,
    ...productionComparison.fingerprints,
  ]);

  if (productionFingerprints.has(target.fingerprint)) {
    return {
      ok: false,
      reason: `${TEST_DATABASE_ADMIN_URL_ENV} matches a configured production database target`,
    };
  }

  if (!neon) {
    if (input.expectedNeonHost?.trim()) {
      return {
        ok: false,
        reason: `${TEST_DATABASE_EXPECTED_NEON_HOST_ENV} is configured but the administration URL is not a Neon target`,
      };
    }

    if (
      isProductionLikeIdentifier(target.database) ||
      isProductionLikeIdentifier(target.schema)
    ) {
      return {
        ok: false,
        reason: `${TEST_DATABASE_ADMIN_URL_ENV} points at a production-looking database or schema`,
      };
    }

    return { ok: true, neon: false, target };
  }

  if (target.database !== TEST_DATABASE_NAME) {
    return {
      ok: false,
      reason: `${TEST_DATABASE_ADMIN_URL_ENV} must point at the dedicated test database ${TEST_DATABASE_NAME}`,
    };
  }

  if (parsed.schemaExplicit || target.schema !== "public") {
    return {
      ok: false,
      reason: `${TEST_DATABASE_ADMIN_URL_ENV} must use the default public schema without a schema override`,
    };
  }

  if (target.port !== 5432) {
    return {
      ok: false,
      reason: `${TEST_DATABASE_ADMIN_URL_ENV} must use the standard PostgreSQL port 5432`,
    };
  }

  const expectedHostValue = input.expectedNeonHost?.trim();

  if (!expectedHostValue) {
    return {
      ok: false,
      reason: `${TEST_DATABASE_EXPECTED_NEON_HOST_ENV} is required for Neon targets`,
    };
  }

  const expectedHost = normalizeDatabaseHost(expectedHostValue);

  if (!expectedHost || !isNeonHost(expectedHost)) {
    return {
      ok: false,
      reason: `${TEST_DATABASE_EXPECTED_NEON_HOST_ENV} must be a Neon hostname`,
    };
  }

  if (isNeonPoolerHost(expectedHostValue)) {
    return {
      ok: false,
      reason: `${TEST_DATABASE_EXPECTED_NEON_HOST_ENV} must identify the direct endpoint, not the pooled endpoint`,
    };
  }

  if (target.host !== expectedHost) {
    return {
      ok: false,
      reason: `${TEST_DATABASE_ADMIN_URL_ENV} does not match ${TEST_DATABASE_EXPECTED_NEON_HOST_ENV}`,
    };
  }

  let rawHost: string;

  try {
    rawHost = new URL(adminUrl).hostname;
  } catch {
    return {
      ok: false,
      reason: `${TEST_DATABASE_ADMIN_URL_ENV} is not a valid URL`,
    };
  }

  if (isNeonPoolerHost(rawHost)) {
    return {
      ok: false,
      reason: `${TEST_DATABASE_ADMIN_URL_ENV} must use the direct Neon endpoint, not the pooled endpoint`,
    };
  }

  if (
    configuredFingerprints.fingerprints.length === 0 &&
    !productionComparison.includesProductionDatabase
  ) {
    return {
      ok: false,
      reason:
        `cannot compare ${TEST_DATABASE_ADMIN_URL_ENV} with production: ` +
        `configure DATABASE_URL and DIRECT_URL for a ${PRODUCTION_DATABASE_NAME} target, ` +
        `or ${PRODUCTION_TARGET_FINGERPRINTS_ENV}`,
    };
  }

  return { ok: true, neon: true, target };
}

export function isGeneratedTestDatabaseName(name: string): boolean {
  return (
    name !== TEST_DATABASE_NAME &&
    name.length <= 63 &&
    GENERATED_NAME_PATTERN.test(name)
  );
}

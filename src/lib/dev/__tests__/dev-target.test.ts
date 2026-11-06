import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkDevelopmentDatabaseTarget,
  computeDevelopmentTargetFingerprint,
  describeDatabaseTarget,
  DevelopmentTargetError,
  requireDevelopmentDatabaseTarget,
} from "../dev-target";

const DEV_HOST = "ep-dev-123.ap-southeast-1.aws.neon.tech";
const DEV_POOLED_HOST = "ep-dev-123-pooler.ap-southeast-1.aws.neon.tech";
const DEV_DATABASE = "tradepulse_dev";
const DEV_SCHEMA = "public";
const DEV_PORT = 5432;
const DEV_URL = `postgresql://dev_user:dev-password@${DEV_HOST}:${DEV_PORT}/${DEV_DATABASE}?sslmode=require`;
const DEV_DIRECT_URL = DEV_URL;
const DEV_POOLED_URL = `postgresql://dev_user:dev-password@${DEV_POOLED_HOST}:${DEV_PORT}/${DEV_DATABASE}?sslmode=require`;
const PRODUCTION_HOST = "ep-production-456.ap-southeast-1.aws.neon.tech";
const PRODUCTION_URL = `postgresql://owner:production-password@${PRODUCTION_HOST}:5432/neondb?sslmode=require`;

function fingerprint(overrides?: {
  host?: string;
  port?: number;
  database?: string;
  schema?: string;
}): string {
  return computeDevelopmentTargetFingerprint({
    host: overrides?.host ?? DEV_HOST,
    port: overrides?.port ?? DEV_PORT,
    database: overrides?.database ?? DEV_DATABASE,
    schema: overrides?.schema ?? DEV_SCHEMA,
  });
}

const DEV_FINGERPRINT = fingerprint();

function environment(
  overrides?: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    NODE_ENV: "development",
    DATABASE_URL: DEV_URL,
    DIRECT_URL: DEV_DIRECT_URL,
    TRADEPULSE_DEV_TARGET_HOSTS: DEV_HOST,
    TRADEPULSE_DEV_TARGET_FINGERPRINT: DEV_FINGERPRINT,
    ...overrides,
  };
}

describe("development database target guard", () => {
  it("accepts matching runtime and direct development targets", () => {
    const result = checkDevelopmentDatabaseTarget(environment());

    assert.equal(result.ok, true);

    if (result.ok) {
      assert.equal(result.target.host, DEV_HOST);
      assert.equal(result.target.port, DEV_PORT);
      assert.equal(result.target.database, DEV_DATABASE);
      assert.equal(result.target.schema, DEV_SCHEMA);
      assert.equal(result.target.fingerprint, DEV_FINGERPRINT);
    }

    assert.equal(JSON.stringify(result).includes("dev-password"), false);
    assert.equal(JSON.stringify(result).includes("postgresql://"), false);
  });

  it("accepts a runtime target when DIRECT_URL is not configured", () => {
    const result = checkDevelopmentDatabaseTarget(
      environment({ DIRECT_URL: undefined }),
    );

    assert.equal(result.ok, true);
  });

  it("validates DATABASE_URL, not DIRECT_URL, as the runtime target", () => {
    const result = checkDevelopmentDatabaseTarget(
      environment({
        DATABASE_URL: PRODUCTION_URL,
        DIRECT_URL: DEV_DIRECT_URL,
        TRADEPULSE_DEV_TARGET_HOSTS: PRODUCTION_HOST,
        TRADEPULSE_DEV_TARGET_FINGERPRINT: fingerprint({
          host: PRODUCTION_HOST,
          database: "neondb",
        }),
      }),
    );

    assert.equal(result.ok, false);
  });

  it("fails closed when DIRECT_URL points at a different target", () => {
    const result = checkDevelopmentDatabaseTarget(
      environment({ DIRECT_URL: PRODUCTION_URL }),
    );

    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes("production-password"), false);
  });

  it("fails closed when DIRECT_URL is malformed", () => {
    for (const directUrl of ["not a url", "https://example.test/db"]) {
      const result = checkDevelopmentDatabaseTarget(
        environment({ DIRECT_URL: directUrl }),
      );

      assert.equal(result.ok, false);
    }
  });

  it("rejects a query-parameter host override even when the URL authority is development", () => {
    const result = checkDevelopmentDatabaseTarget(
      environment({
        DATABASE_URL: `${DEV_URL}&host=${PRODUCTION_HOST}`,
      }),
    );

    assert.equal(result.ok, false);
  });

  it("rejects a query-parameter port override", () => {
    const result = checkDevelopmentDatabaseTarget(
      environment({
        DATABASE_URL: `${DEV_URL}&port=6543`,
      }),
    );

    assert.equal(result.ok, false);
  });

  it("accepts an explicitly configured non-default port", () => {
    const port = 6543;
    const url = `postgresql://dev_user:dev-password@${DEV_HOST}:${port}/${DEV_DATABASE}?sslmode=require`;
    const result = checkDevelopmentDatabaseTarget(
      environment({
        DATABASE_URL: url,
        DIRECT_URL: url,
        TRADEPULSE_DEV_TARGET_FINGERPRINT: fingerprint({ port }),
      }),
    );

    assert.equal(result.ok, true);

    if (result.ok) {
      assert.equal(result.target.port, port);
    }
  });

  it("rejects a production-like schema even when its fingerprint is configured", () => {
    const result = checkDevelopmentDatabaseTarget(
      environment({
        DATABASE_URL: `${DEV_URL}&schema=production`,
        DIRECT_URL: `${DEV_URL}&schema=production`,
        TRADEPULSE_DEV_TARGET_FINGERPRINT: fingerprint({
          schema: "production",
        }),
      }),
    );

    assert.equal(result.ok, false);
  });

  it("includes a safe non-default schema in the fingerprint", () => {
    const schema = "dev_app";
    const url = `${DEV_URL}&schema=${schema}`;
    const result = checkDevelopmentDatabaseTarget(
      environment({
        DATABASE_URL: url,
        DIRECT_URL: url,
        TRADEPULSE_DEV_TARGET_FINGERPRINT: fingerprint({ schema }),
      }),
    );

    assert.equal(result.ok, true);

    if (result.ok) {
      assert.equal(result.target.schema, schema);
    }

    assert.notEqual(fingerprint({ schema }), DEV_FINGERPRINT);
  });

  it("rejects a schema that differs between DATABASE_URL and DIRECT_URL", () => {
    const result = checkDevelopmentDatabaseTarget(
      environment({
        DATABASE_URL: `${DEV_URL}&schema=dev_app`,
        DIRECT_URL: `${DEV_URL}&schema=dev_other`,
        TRADEPULSE_DEV_TARGET_FINGERPRINT: fingerprint({
          schema: "dev_app",
        }),
      }),
    );

    assert.equal(result.ok, false);
  });

  it("fails closed when PGOPTIONS is present", () => {
    const result = checkDevelopmentDatabaseTarget(
      environment({ PGOPTIONS: "-c search_path=production" }),
    );

    assert.equal(result.ok, false);
  });

  it("fails closed when PGSERVICE is present", () => {
    const result = checkDevelopmentDatabaseTarget(
      environment({ PGSERVICE: "production" }),
    );

    assert.equal(result.ok, false);
  });

  it("rejects URL options and service parameters", () => {
    for (const suffix of [
      "&options=-c%20search_path%3Dproduction",
      "&service=production",
      "&sslcert=client.crt",
    ]) {
      const result = checkDevelopmentDatabaseTarget(
        environment({ DATABASE_URL: `${DEV_URL}${suffix}` }),
      );

      assert.equal(result.ok, false);
    }
  });

  it("rejects duplicate query parameters instead of guessing precedence", () => {
    const result = checkDevelopmentDatabaseTarget(
      environment({
        DATABASE_URL: `${DEV_URL}&schema=public&schema=production`,
      }),
    );

    assert.equal(result.ok, false);
  });

  it("rejects missing, malformed, and non-PostgreSQL URLs without echoing secrets", () => {
    for (const url of [
      undefined,
      "",
      "not a url",
      "https://example.test/database",
      "postgresql://user:password@host-without-database",
      "postgresql:///database-without-host",
      "postgresql://user:password@host/database/extra",
      "postgresql://user:password@host/database#fragment",
      "/var/run/postgresql database",
    ]) {
      const result = checkDevelopmentDatabaseTarget(
        environment({ DATABASE_URL: url, DIRECT_URL: undefined }),
      );

      assert.equal(result.ok, false);
      assert.equal(JSON.stringify(result).includes("password"), false);
    }
  });

  it("fails closed on production runtime signals", () => {
    for (const signal of [
      { NODE_ENV: "production" },
      { NODE_ENV: "staging" },
      { VERCEL_ENV: "production" },
      { VERCEL_ENV: "preview" },
    ]) {
      const result = checkDevelopmentDatabaseTarget(
        environment({ ...signal }),
      );

      assert.equal(result.ok, false);
    }
  });

  it("fails closed when the explicit fingerprint is missing or malformed", () => {
    for (const configuredFingerprint of [
      undefined,
      "",
      "not-a-fingerprint",
      "0".repeat(63),
    ]) {
      const result = checkDevelopmentDatabaseTarget(
        environment({
          TRADEPULSE_DEV_TARGET_FINGERPRINT: configuredFingerprint,
        }),
      );

      assert.equal(result.ok, false);
    }
  });

  it("fails closed when the fingerprint does not match the effective target", () => {
    const result = checkDevelopmentDatabaseTarget(
      environment({
        TRADEPULSE_DEV_TARGET_FINGERPRINT: fingerprint({
          host: PRODUCTION_HOST,
          database: "neondb",
        }),
      }),
    );

    assert.equal(result.ok, false);
  });

  it("fails closed when the host allowlist is missing or does not match", () => {
    for (const hosts of [undefined, "", PRODUCTION_HOST]) {
      const result = checkDevelopmentDatabaseTarget(
        environment({ TRADEPULSE_DEV_TARGET_HOSTS: hosts }),
      );

      assert.equal(result.ok, false);
    }
  });

  it("fails closed for an explicitly production-denylisted host even if allowlisted", () => {
    const result = checkDevelopmentDatabaseTarget(
      environment({
        TRADEPULSE_PRODUCTION_TARGET_HOSTS: DEV_HOST,
      }),
    );

    assert.equal(result.ok, false);
  });

  it("treats Neon pooled and direct hostnames as the same logical target", () => {
    const result = checkDevelopmentDatabaseTarget(
      environment({
        DATABASE_URL: DEV_POOLED_URL,
        DIRECT_URL: DEV_DIRECT_URL,
      }),
    );

    assert.equal(result.ok, true);

    assert.equal(
      computeDevelopmentTargetFingerprint({
        host: DEV_POOLED_HOST,
        port: DEV_PORT,
        database: DEV_DATABASE,
        schema: DEV_SCHEMA,
      }),
      DEV_FINGERPRINT,
    );
  });

  it("does not normalize -pooler on unrelated hostnames", () => {
    assert.notEqual(
      computeDevelopmentTargetFingerprint({
        host: "db-pooler.example.com",
        port: DEV_PORT,
        database: DEV_DATABASE,
        schema: DEV_SCHEMA,
      }),
      computeDevelopmentTargetFingerprint({
        host: "db.example.com",
        port: DEV_PORT,
        database: DEV_DATABASE,
        schema: DEV_SCHEMA,
      }),
    );
  });

  it("describes only non-secret target fields", () => {
    const target = describeDatabaseTarget(DEV_URL);

    assert.ok(target);
    assert.equal(target.host, DEV_HOST);
    assert.equal(target.port, DEV_PORT);
    assert.equal(target.database, DEV_DATABASE);
    assert.equal(target.schema, DEV_SCHEMA);
    assert.equal(JSON.stringify(target).includes("dev-password"), false);

    for (const invalid of [
      undefined,
      "",
      "not a url",
      "https://example.test/database",
      "postgresql://user:password@host-without-database",
    ]) {
      assert.equal(describeDatabaseTarget(invalid), null);
    }
  });

  it("throws a safe error from the required-target helper", () => {
    assert.throws(
      () =>
        requireDevelopmentDatabaseTarget(
          environment({
            DATABASE_URL: PRODUCTION_URL,
            DIRECT_URL: undefined,
            TRADEPULSE_DEV_TARGET_HOSTS: PRODUCTION_HOST,
            TRADEPULSE_DEV_TARGET_FINGERPRINT: fingerprint({
              host: PRODUCTION_HOST,
              database: "neondb",
            }),
            TRADEPULSE_PRODUCTION_TARGET_HOSTS: PRODUCTION_HOST,
          }),
        ),
      (error: unknown) =>
        error instanceof DevelopmentTargetError &&
        !error.message.includes("production-password"),
    );
  });
});

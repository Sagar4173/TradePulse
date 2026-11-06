import "dotenv/config";

import {
  checkDevelopmentDatabaseTarget,
  describeDatabaseTarget,
  DEV_TARGET_FINGERPRINT_ENV,
  DEV_TARGET_HOSTS_ENV,
} from "../src/lib/dev/dev-target";

/**
 * Prints only the non-secret identity of the configured database target.
 *
 * DATABASE_URL is the runtime target. When DIRECT_URL is present it must match
 * the same effective host, port, database, and schema. Credentials, query
 * parameter values, and the raw connection strings are never printed.
 */

const runtimeTarget = describeDatabaseTarget(process.env.DATABASE_URL);

if (!runtimeTarget) {
  console.error(
    "DATABASE_URL is missing or is not a valid PostgreSQL URL. DIRECT_URL is not a runtime fallback.",
  );
  process.exit(1);
}

console.log("Runtime DATABASE_URL target:");
console.log(`Host: ${runtimeTarget.host}`);
console.log(`Port: ${runtimeTarget.port}`);
console.log(`Database: ${runtimeTarget.database}`);
console.log(`Schema: ${runtimeTarget.schema}`);
console.log(`${DEV_TARGET_HOSTS_ENV}=${runtimeTarget.host}`);
console.log(`${DEV_TARGET_FINGERPRINT_ENV}=${runtimeTarget.fingerprint}`);

const directTarget = describeDatabaseTarget(process.env.DIRECT_URL);

if (process.env.DIRECT_URL?.trim() && !directTarget) {
  console.log("");
  console.log("DIRECT_URL is set but is not a valid PostgreSQL URL.");
} else if (directTarget) {
  console.log("");
  console.log("DIRECT_URL target:");
  console.log(`Host: ${directTarget.host}`);
  console.log(`Port: ${directTarget.port}`);
  console.log(`Database: ${directTarget.database}`);
  console.log(`Schema: ${directTarget.schema}`);
}

const check = checkDevelopmentDatabaseTarget(process.env);

if (!check.ok) {
  console.log("");
  console.log(`This target is not currently accepted as a dev target: ${check.reason}.`);
  console.log(
    "Set the values above in .env, unset production runtime signals and target-override PG* variables, and re-run the check.",
  );
}

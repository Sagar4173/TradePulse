import { readFileSync } from "node:fs";

import { parse as parseDotenv } from "dotenv";

import {
  isGeneratedTestDatabaseName,
  TEST_DATABASE_NAME,
} from "../src/lib/db/test-database-target";
import {
  dropGeneratedTestDatabase,
  requireTestDatabaseAdminUrl,
} from "../tests/integration/helpers/test-database";

/**
 * Explicit cleanup for temporary databases leaked by an interrupted test
 * process. Every name must match the generated `tradepulse_test_*` convention,
 * and every drop re-validates the administration target, the live connection
 * identity, and database ownership through the integration harness.
 *
 * This command never drops `tradepulse_test`, `neondb`, or an arbitrary name.
 */

const ENV_FILE_FLAG = "--env-file";
const CONFIRM_FLAG = "--yes";

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

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown error";

  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://[redacted]");
}

function usage(): never {
  console.error(
    `Usage: npm run db:cleanup-test -- [${ENV_FILE_FLAG} <path>] ` +
      `${CONFIRM_FLAG} <generated-database-name>...`,
  );
  process.exit(1);
}

async function main(): Promise<void> {
  loadOptionalEnvironmentFile();

  const argumentsList = process.argv.slice(2);
  const names: string[] = [];
  let confirmed = false;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];

    if (argument === ENV_FILE_FLAG) {
      index += 1;
      continue;
    }

    if (argument === CONFIRM_FLAG) {
      confirmed = true;
      continue;
    }

    if (argument.startsWith("--")) {
      usage();
    }

    names.push(argument);
  }

  if (names.length === 0) {
    usage();
  }

  const uniqueNames = [...new Set(names)];
  let invalid = false;

  for (const name of uniqueNames) {
    if (!isGeneratedTestDatabaseName(name)) {
      console.error(
        `FAIL ${name} does not match the generated test-database convention.`,
      );
      invalid = true;
    }
  }

  if (invalid) {
    process.exitCode = 1;
    return;
  }

  const adminUrl = requireTestDatabaseAdminUrl();

  console.log(
    `Target: ${TEST_DATABASE_NAME} (validated by the integration-test guard)`,
  );

  if (!confirmed) {
    console.log("Dry run. The following generated test databases would be dropped:");
    for (const name of uniqueNames) {
      console.log(`  ${name}`);
    }
    console.log(`Re-run with ${CONFIRM_FLAG} to drop them.`);
    return;
  }

  let failures = 0;

  for (const name of uniqueNames) {
    try {
      const dropped = await dropGeneratedTestDatabase(name, { adminUrl });
      console.log(`${dropped ? "DROPPED" : "ABSENT "} ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL    ${name}: ${safeMessage(error)}`);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`FAIL ${safeMessage(error)}`);
  process.exitCode = 1;
});

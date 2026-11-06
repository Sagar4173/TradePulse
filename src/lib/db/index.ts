import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import {
  parseDatabaseConnectionTarget,
  TARGET_OVERRIDE_ENVIRONMENT_VARIABLES,
} from "@/lib/db/connection-target";

const globalForPrisma = globalThis as typeof globalThis & {
  tradepulsePrisma?: PrismaClient;
};

type DatabaseConfig = {
  connectionString: string;
  schema?: string;
};

function getDatabaseConfig(): DatabaseConfig {
  const connectionString = process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not configured. Copy .env.example to .env and set a PostgreSQL connection string.",
    );
  }

  for (const name of TARGET_OVERRIDE_ENVIRONMENT_VARIABLES) {
    if (process.env[name]?.trim()) {
      throw new Error(
        `${name} is set. Configure the complete database target in DATABASE_URL and remove target-override environment variables.`,
      );
    }
  }

  const parsed = parseDatabaseConnectionTarget(connectionString);

  if (!parsed.ok) {
    // Do not surface the raw URL: a malformed DSN can contain credentials.
    throw new Error(`DATABASE_URL is not valid: ${parsed.reason}.`);
  }

  return {
    connectionString,
    schema: parsed.schemaExplicit ? parsed.target.schema : undefined,
  };
}

/**
 * Creates the Prisma client lazily so route/module imports do not connect during
 * the production build. The global cache prevents connection leaks during
 * Next.js development hot reloads.
 */
export function getPrismaClient(): PrismaClient {
  if (!globalForPrisma.tradepulsePrisma) {
    const { connectionString, schema } = getDatabaseConfig();
    const adapter = new PrismaPg(
      {
        connectionString,
        connectionTimeoutMillis: 5_000,
        statement_timeout: 5_000,
        query_timeout: 5_000,
        max: 10,
      },
      schema ? { schema } : undefined,
    );

    globalForPrisma.tradepulsePrisma = new PrismaClient({ adapter });
  }

  return globalForPrisma.tradepulsePrisma;
}

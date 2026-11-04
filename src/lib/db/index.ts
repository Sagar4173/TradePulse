import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

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

  let databaseUrl: URL;

  try {
    databaseUrl = new URL(connectionString);
  } catch {
    // Do not surface the raw URL: a malformed DSN can contain credentials.
    throw new Error("DATABASE_URL is not a valid PostgreSQL connection URL.");
  }

  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol.");
  }

  return {
    connectionString,
    schema: databaseUrl.searchParams.get("schema")?.trim() || undefined,
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

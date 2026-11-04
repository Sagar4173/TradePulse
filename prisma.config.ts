import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Prisma CLI operations (migrate, studio, introspection) must use the
    // direct, non-pooled Neon endpoint. Runtime queries use the pooled
    // DATABASE_URL through the pg driver adapter.
    url: env("DIRECT_URL"),
    // Optional: only needed by `prisma migrate dev` for drift detection.
    // Point this at a separate Neon branch/database, never at a pooler.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});

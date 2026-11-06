import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { Client } from "pg";

export type MigrationFile = {
  name: string;
  sqlPath: string;
};

const MIGRATIONS_DIR = path.resolve(process.cwd(), "prisma", "migrations");

export async function listMigrations(): Promise<MigrationFile[]> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const migrations: MigrationFile[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const sqlPath = path.join(MIGRATIONS_DIR, entry.name, "migration.sql");
    migrations.push({ name: entry.name, sqlPath });
  }

  migrations.sort((left, right) => left.name.localeCompare(right.name));
  return migrations;
}

export async function latestMigrationName(): Promise<string> {
  const migrations = await listMigrations();
  const latest = migrations.at(-1);

  if (!latest) {
    throw new Error("No Prisma migrations were found.");
  }

  return latest.name;
}

/**
 * Applies migration SQL in directory order. Each migration runs in its own
 * transaction, matching the all-or-nothing behavior a failed PostgreSQL
 * migration should have. Optional `after`/`through` limits let migration-history
 * tests stop at, or resume from, an intermediate revision.
 */
export async function applyMigrations(
  client: Client,
  options?: { after?: string; through?: string },
): Promise<string[]> {
  const migrations = await listMigrations();
  const applied: string[] = [];
  let started = options?.after === undefined;

  if (options?.after && !migrations.some((migration) => migration.name === options.after)) {
    throw new Error(
      `Migration ${options.after} was not found in prisma/migrations.`,
    );
  }

  for (const migration of migrations) {
    if (!started) {
      if (migration.name === options?.after) {
        started = true;
      }
      continue;
    }

    const sql = await readFile(migration.sqlPath, "utf8");

    await client.query("BEGIN");

    try {
      await client.query(sql);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    applied.push(migration.name);

    if (migration.name === options?.through) {
      return applied;
    }
  }

  if (options?.through && applied.at(-1) !== options.through) {
    throw new Error(
      `Migration ${options.through} was not found in prisma/migrations.`,
    );
  }

  return applied;
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import type { Client } from "pg";

import { TEST_DATABASE_NAME } from "../../../src/lib/db/test-database-target";
import {
  closeTestDatabase,
  createTestDatabase,
  dropGeneratedTestDatabase,
  resetTestData,
  withTestDatabase,
  type TestDatabase,
  type TestDatabaseClientFactory,
} from "./test-database";

const LOCAL_ADMIN_URL =
  "postgresql://local_user:local-password@127.0.0.1:5432/postgres?sslmode=disable";
const GENERATED_DATABASE_NAME =
  "tradepulse_test_testrun_0123456789abcdef";

const ENVIRONMENT_VARIABLES = [
  "DATABASE_URL",
  "DIRECT_URL",
  "NODE_ENV",
  "VERCEL_ENV",
  "TRADEPULSE_TEST_DATABASE_ADMIN_URL",
  "TRADEPULSE_TEST_DATABASE_EXPECTED_NEON_HOST",
  "TRADEPULSE_PRODUCTION_TARGET_FINGERPRINTS",
  "TRADEPULSE_PRODUCTION_TARGET_HOSTS",
  "PGHOST",
  "PGHOSTADDR",
  "PGPORT",
  "PGDATABASE",
  "PGOPTIONS",
  "PGSERVICE",
] as const;

const ORIGINAL_ENVIRONMENT: Record<string, string | undefined> = {};
const MUTABLE_ENVIRONMENT = process.env as Record<
  string,
  string | undefined
>;

before(() => {
  for (const name of ENVIRONMENT_VARIABLES) {
    ORIGINAL_ENVIRONMENT[name] = MUTABLE_ENVIRONMENT[name];
    delete MUTABLE_ENVIRONMENT[name];
  }

  MUTABLE_ENVIRONMENT.NODE_ENV = "test";
  MUTABLE_ENVIRONMENT.TRADEPULSE_TEST_DATABASE_ADMIN_URL = LOCAL_ADMIN_URL;
});

after(() => {
  for (const name of ENVIRONMENT_VARIABLES) {
    const value = ORIGINAL_ENVIRONMENT[name];

    if (value === undefined) {
      delete MUTABLE_ENVIRONMENT[name];
    } else {
      MUTABLE_ENVIRONMENT[name] = value;
    }
  }
});

type QueryResult = {
  rowCount: number;
  rows: Record<string, unknown>[];
};

type FakeBehavior = {
  endError?: Error;
  query: (sql: string, params?: readonly unknown[]) => Promise<QueryResult>;
};

class FakeClient {
  readonly calls: { sql: string; params?: readonly unknown[] }[] = [];
  connectCalls = 0;
  endCalls = 0;

  constructor(private readonly behavior: FakeBehavior) {}

  async connect(): Promise<void> {
    this.connectCalls += 1;
  }

  async query(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult> {
    this.calls.push({ sql, params });
    return this.behavior.query(sql, params);
  }

  async end(): Promise<void> {
    this.endCalls += 1;

    if (this.behavior.endError) {
      throw this.behavior.endError;
    }
  }

  asClient(): Client {
    return this as unknown as Client;
  }
}

function rows(values: Record<string, unknown>[]): QueryResult {
  return { rowCount: values.length, rows: values };
}

function empty(): QueryResult {
  return { rowCount: 0, rows: [] };
}

function adminBehavior(overrides: Partial<FakeBehavior> = {}): FakeBehavior {
  return {
    query: async (sql) => {
      if (sql.includes("current_database()")) {
        return rows([{ database_name: "postgres" }]);
      }

      return empty();
    },
    ...overrides,
  };
}

function cleanupBehavior(
  options: {
    currentRole?: string;
    dropError?: Error;
    endError?: Error;
    owner?: string;
  } = {},
): FakeBehavior {
  return {
    endError: options.endError,
    query: async (sql) => {
      if (sql.includes("current_database()")) {
        return rows([{ database_name: "postgres" }]);
      }

      if (sql.includes("FROM pg_database")) {
        return rows([
          {
            current_role_name: options.currentRole ?? "local_user",
            owner: options.owner ?? "local_user",
          },
        ]);
      }

      if (sql.startsWith("DROP DATABASE") && options.dropError) {
        throw options.dropError;
      }

      return empty();
    },
  };
}

function clientFactory(clients: FakeClient[]): TestDatabaseClientFactory {
  let index = 0;

  return () => {
    const client = clients[index];
    index += 1;

    if (!client) {
      throw new Error("Unexpected extra database client.");
    }

    return client.asClient();
  };
}

const APPLICATION_TABLES = [
  "AuditEvent",
  "RetailerLinkRequest",
  "Session",
  "OtpChallenge",
  "OtpRequestReservation",
  "SalesmanRetailerAssignment",
  "OrderItem",
  "Order",
  "Scheme",
  "Inventory",
  "ProductAlias",
  "RetailerProductPrice",
  "Product",
  "Retailer",
  "User",
] as const;

function schemaModelNames(): string[] {
  const schema = readFileSync(
    path.resolve(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  );

  assert.equal(
    schema.includes("@@map"),
    false,
    "This test assumes Prisma model names are the physical table names.",
  );

  return [
    ...schema.matchAll(/^model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/gm),
  ].map((match) => match[1]);
}

describe("integration-test database harness", () => {
  it("creates and drops only a generated test database", async () => {
    const admin = new FakeClient(adminBehavior());
    const cleanup = new FakeClient(cleanupBehavior());
    const database = await createTestDatabase({
      createClient: clientFactory([admin, cleanup]),
    });

    assert.match(
      database.databaseName,
      /^tradepulse_test_[a-z0-9]+_[a-f0-9]{16}$/,
    );
    assert.equal(
      new URL(database.databaseUrl).pathname,
      `/${database.databaseName}`,
    );

    await database.drop();

    const sql = [...admin.calls, ...cleanup.calls]
      .map((call) => call.sql)
      .join("\n");

    assert.match(sql, /CREATE DATABASE "tradepulse_test_/);
    assert.match(sql, /DROP DATABASE IF EXISTS "tradepulse_test_/);
    assert.equal(
      sql.includes(`DROP DATABASE IF EXISTS "${TEST_DATABASE_NAME}"`),
      false,
    );
    assert.equal(sql.includes('"neondb"'), false);
  });

  it("refuses to clean up a database name that is not generated", async () => {
    let clients = 0;

    await assert.rejects(
      dropGeneratedTestDatabase(TEST_DATABASE_NAME, {
        adminUrl: LOCAL_ADMIN_URL,
        createClient: () => {
          clients += 1;
          return new FakeClient(cleanupBehavior()).asClient();
        },
      }),
      /generated test-database convention/,
    );

    assert.equal(clients, 0);
  });

  it("reports an absent generated database without attempting a drop", async () => {
    const cleanup = new FakeClient({
      query: async (sql) => {
        if (sql.includes("current_database()")) {
          return rows([{ database_name: "postgres" }]);
        }

        return empty();
      },
    });

    const dropped = await dropGeneratedTestDatabase(GENERATED_DATABASE_NAME, {
      adminUrl: LOCAL_ADMIN_URL,
      createClient: () => cleanup.asClient(),
    });

    assert.equal(dropped, false);
    assert.equal(
      cleanup.calls.some((call) => call.sql.startsWith("DROP DATABASE")),
      false,
    );
  });

  it("refuses to clean up a database owned by a different role", async () => {
    const cleanup = new FakeClient(cleanupBehavior({ owner: "different_role" }));

    await assert.rejects(
      dropGeneratedTestDatabase(GENERATED_DATABASE_NAME, {
        adminUrl: LOCAL_ADMIN_URL,
        createClient: () => cleanup.asClient(),
      }),
      /different role/,
    );

    assert.equal(
      cleanup.calls.some((call) => call.sql.startsWith("DROP DATABASE")),
      false,
    );
  });

  it("refuses to clean up when the admin connection resolves elsewhere", async () => {
    const cleanup = new FakeClient({
      query: async (sql) => {
        if (sql.includes("current_database()")) {
          return rows([{ database_name: "unexpected_database" }]);
        }

        return empty();
      },
    });

    await assert.rejects(
      dropGeneratedTestDatabase(GENERATED_DATABASE_NAME, {
        adminUrl: LOCAL_ADMIN_URL,
        createClient: () => cleanup.asClient(),
      }),
      /did not resolve to the configured database/,
    );

    assert.equal(
      cleanup.calls.some((call) => call.sql.startsWith("DROP DATABASE")),
      false,
    );
  });

  it("does not attempt a drop when CREATE DATABASE fails", async () => {
    const admin = new FakeClient(
      adminBehavior({
        query: async (sql) => {
          if (sql.startsWith("CREATE DATABASE")) {
            throw new Error("create failed");
          }

          if (sql.includes("current_database()")) {
            return rows([{ database_name: "postgres" }]);
          }

          return empty();
        },
      }),
    );

    await assert.rejects(
      createTestDatabase({ createClient: clientFactory([admin]) }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /create failed/);
        assert.match(
          (error as Error & { testDatabaseName?: string }).testDatabaseName ??
            "",
          /^tradepulse_test_/,
        );
        return true;
      },
    );

    assert.equal(
      admin.calls.some((call) => call.sql.startsWith("DROP DATABASE")),
      false,
    );
  });

  it("refuses to create a database when the admin connection resolves elsewhere", async () => {
    const admin = new FakeClient(
      adminBehavior({
        query: async (sql) => {
          if (sql.includes("current_database()")) {
            return rows([{ database_name: "other_database" }]);
          }

          return empty();
        },
      }),
    );

    await assert.rejects(
      createTestDatabase({ createClient: clientFactory([admin]) }),
      /did not resolve to the configured database/,
    );

    assert.equal(
      admin.calls.some((call) => call.sql.startsWith("CREATE DATABASE")),
      false,
    );
  });

  it("refuses to drop a database owned by a different role", async () => {
    const admin = new FakeClient(adminBehavior());
    const cleanup = new FakeClient(
      cleanupBehavior({ currentRole: "local_user", owner: "other_owner" }),
    );
    const database = await createTestDatabase({
      createClient: clientFactory([admin, cleanup]),
    });

    await assert.rejects(database.drop(), /owned by a different role/);

    assert.equal(
      cleanup.calls.some((call) => call.sql.startsWith("DROP DATABASE")),
      false,
    );
  });

  it("can retry a drop after a transient failure", async () => {
    const admin = new FakeClient(adminBehavior());
    const failedCleanup = new FakeClient(
      cleanupBehavior({ dropError: new Error("transient drop failure") }),
    );
    const successfulCleanup = new FakeClient(cleanupBehavior());
    const database = await createTestDatabase({
      createClient: clientFactory([admin, failedCleanup, successfulCleanup]),
    });

    await assert.rejects(database.drop(), /transient drop failure/);
    await database.drop();

    assert.equal(
      failedCleanup.calls.some((call) =>
        call.sql.startsWith("DROP DATABASE"),
      ),
      true,
    );
    assert.equal(
      successfulCleanup.calls.some((call) =>
        call.sql.startsWith("DROP DATABASE"),
      ),
      true,
    );

    await database.drop();
    assert.equal(successfulCleanup.endCalls, 1);
  });

  it("returns a cleanup handle when the administration connection end fails", async () => {
    const admin = new FakeClient(
      adminBehavior({ endError: new Error("end failed") }),
    );
    const cleanup = new FakeClient(cleanupBehavior());
    const database = await createTestDatabase({
      createClient: clientFactory([admin, cleanup]),
    });

    await database.drop();

    assert.equal(
      cleanup.calls.some((call) => call.sql.startsWith("DROP DATABASE")),
      true,
    );
  });

  it("drops the test database after a successful operation", async () => {
    const admin = new FakeClient(adminBehavior());
    const cleanup = new FakeClient(cleanupBehavior());

    const result = await withTestDatabase(
      async (database) => database.databaseName,
      { createClient: clientFactory([admin, cleanup]) },
    );

    assert.match(result, /^tradepulse_test_/);
    assert.equal(
      cleanup.calls.some((call) => call.sql.startsWith("DROP DATABASE")),
      true,
    );
  });

  it("keeps the database dropped when closing the cleanup connection fails", async () => {
    const admin = new FakeClient(adminBehavior());
    const cleanup = new FakeClient(
      cleanupBehavior({ endError: new Error("cleanup end failed") }),
    );
    const database = await createTestDatabase({
      createClient: clientFactory([admin, cleanup]),
    });

    await assert.rejects(database.drop(), /cleanup end failed/);

    assert.equal(
      cleanup.calls.some((call) => call.sql.startsWith("DROP DATABASE")),
      true,
    );

    // DROP already succeeded, so a second call is a no-op.
    await database.drop();
    assert.equal(cleanup.endCalls, 1);
  });

  it("preserves the original operation error when cleanup fails", async () => {
    const admin = new FakeClient(adminBehavior());
    const cleanup = new FakeClient(
      cleanupBehavior({ dropError: new Error("cleanup failed") }),
    );

    await assert.rejects(
      withTestDatabase(
        async () => {
          throw new Error("operation failed");
        },
        { createClient: clientFactory([admin, cleanup]) },
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "operation failed");

        const cleanupError = (
          error as Error & { cleanupError?: unknown }
        ).cleanupError;

        assert.ok(cleanupError instanceof Error);
        assert.equal(cleanupError.message, "cleanup failed");
        return true;
      },
    );
  });
});

describe("integration-test database disposal", () => {
  function fakeClient(end: () => Promise<void>): Client {
    return { end } as unknown as Client;
  }

  function fakeDatabase(drop: () => Promise<void>): TestDatabase {
    return {
      databaseName: "tradepulse_test_unit_0123456789abcdef",
      databaseUrl:
        "postgresql://probe:probe@127.0.0.1:5432/tradepulse_test_unit_0123456789abcdef?sslmode=disable",
      drop,
    };
  }

  it("drops the database even when the client close fails", async () => {
    let dropped = false;
    const endError = new Error("end failed");

    await assert.rejects(
      closeTestDatabase({
        client: fakeClient(async () => {
          throw endError;
        }),
        database: fakeDatabase(async () => {
          dropped = true;
        }),
      }),
      (error: unknown) => error === endError,
    );

    assert.equal(dropped, true);
  });

  it("drops the database even when the optional disconnect fails", async () => {
    let dropped = false;
    const disconnectError = new Error("disconnect failed");

    await assert.rejects(
      closeTestDatabase({
        disconnect: async () => {
          throw disconnectError;
        },
        client: fakeClient(async () => {}),
        database: fakeDatabase(async () => {
          dropped = true;
        }),
      }),
      (error: unknown) => error === disconnectError,
    );

    assert.equal(dropped, true);
  });

  it("preserves both errors when closing and dropping fail", async () => {
    const endError = new Error("end failed");
    const dropError = new Error("drop failed");

    await assert.rejects(
      closeTestDatabase({
        client: fakeClient(async () => {
          throw endError;
        }),
        database: fakeDatabase(async () => {
          throw dropError;
        }),
      }),
      (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors.length, 2);
        assert.equal(error.errors[0], endError);
        assert.equal(error.errors[1], dropError);
        return true;
      },
    );
  });

  it("runs disconnect, client close, and drop in order", async () => {
    const order: string[] = [];

    await closeTestDatabase({
      disconnect: async () => {
        order.push("disconnect");
      },
      client: fakeClient(async () => {
        order.push("end");
      }),
      database: fakeDatabase(async () => {
        order.push("drop");
      }),
    });

    assert.deepEqual(order, ["disconnect", "end", "drop"]);
  });
});

describe("integration-test data reset", () => {
  it("quotes every Prisma table name, including PascalCase and ProductAlias", async () => {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => {
        statements.push(sql);
        return { rowCount: 0, rows: [] };
      },
    } as unknown as Client;

    await resetTestData(client);

    assert.equal(statements.length, 1);

    const statement = statements[0];

    assert.match(statement, /^TRUNCATE TABLE /);
    assert.match(statement, /RESTART IDENTITY CASCADE$/);
    assert.equal(
      statement.match(/"[A-Za-z]+"/g)?.length,
      APPLICATION_TABLES.length,
    );

    for (const table of APPLICATION_TABLES) {
      assert.match(statement, new RegExp(`"${table}"`));
    }

    assert.deepEqual(
      [...APPLICATION_TABLES].sort(),
      schemaModelNames().sort(),
    );
  });
});

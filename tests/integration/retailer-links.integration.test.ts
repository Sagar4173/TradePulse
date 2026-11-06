import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { Client } from "pg";

import { getPrismaClient } from "../../src/lib/db";
import {
  RetailerLinkRequestStatus,
  UserRole,
} from "../../src/generated/prisma/client";
import {
  reviewRetailerLink,
  updateUserAccess,
} from "../../src/lib/users/repository";
import { applyMigrations } from "./helpers/migrations";
import {
  seedLinkRequest,
  seedRetailer,
  seedUser,
} from "./helpers/seed";
import { createTestDatabase, resetTestData } from "./helpers/test-database";

describe("retailer link review against PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let prisma: ReturnType<typeof getPrismaClient>;

  before(async () => {
    database = await createTestDatabase();
    client = new Client({ connectionString: database.databaseUrl });
    await client.connect();
    await applyMigrations(client);

    process.env.DATABASE_URL = database.databaseUrl;
    delete process.env.DIRECT_URL;

    for (const name of [
      "PGHOST",
      "PGHOSTADDR",
      "PGPORT",
      "PGDATABASE",
      "PGOPTIONS",
      "PGSERVICE",
    ]) {
      delete process.env[name];
    }

    prisma = getPrismaClient();
  });

  beforeEach(async () => {
    await resetTestData(client);
  });

  after(async () => {
    await prisma.$disconnect();
    await client.end();
    await database.drop();
  });

  it("allows only one concurrent approval and records one audit event", async () => {
    const admin = await seedUser(prisma, {
      id: "admin_1",
      name: "Admin",
      phone: "+919800000001",
      role: UserRole.ADMIN,
    });
    const user = await seedUser(prisma, {
      id: "user_1",
      name: "Retailer User",
      phone: "+919800000002",
    });
    const retailer = await seedRetailer(prisma, {
      id: "retailer_a",
      phone: "+919800000003",
    });
    const request = await seedLinkRequest(prisma, {
      id: "request_1",
      userId: user.id,
      retailerId: retailer.id,
    });

    const results = await Promise.allSettled([
      reviewRetailerLink({
        actorId: admin.id,
        requestId: request.id,
        decision: "APPROVE",
      }),
      reviewRetailerLink({
        actorId: admin.id,
        requestId: request.id,
        decision: "APPROVE",
      }),
    ]);

    const successes = results.filter(
      (result) => result.status === "fulfilled" && result.value.ok,
    );
    assert.equal(successes.length, 1);

    const linkedUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { retailerId: true },
    });
    assert.equal(linkedUser.retailerId, retailer.id);

    const storedRequest = await prisma.retailerLinkRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    assert.equal(storedRequest.status, RetailerLinkRequestStatus.APPROVED);

    const audits = await prisma.auditEvent.count({
      where: { eventType: "RETAILER_LINK_APPROVED", entityId: request.id },
    });
    assert.equal(audits, 1);
  });

  it("rolls the link back when the audit insert fails", async () => {
    const admin = await seedUser(prisma, {
      id: "admin_1",
      name: "Admin",
      phone: "+919800000001",
      role: UserRole.ADMIN,
    });
    const user = await seedUser(prisma, {
      id: "user_1",
      name: "Retailer User",
      phone: "+919800000002",
    });
    const retailer = await seedRetailer(prisma, {
      id: "retailer_a",
      phone: "+919800000003",
    });
    const request = await seedLinkRequest(prisma, {
      id: "request_1",
      userId: user.id,
      retailerId: retailer.id,
    });

    await client.query(`
      CREATE OR REPLACE FUNCTION tradepulse_fail_audit()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'forced audit failure';
      END;
      $$;
    `);
    await client.query(`
      CREATE TRIGGER tradepulse_fail_audit_trigger
      BEFORE INSERT ON "AuditEvent"
      FOR EACH ROW
      WHEN (NEW."eventType" = 'RETAILER_LINK_APPROVED')
      EXECUTE FUNCTION tradepulse_fail_audit();
    `);

    try {
      await assert.rejects(
        reviewRetailerLink({
          actorId: admin.id,
          requestId: request.id,
          decision: "APPROVE",
        }),
      );
    } finally {
      await client.query(
        'DROP TRIGGER IF EXISTS tradepulse_fail_audit_trigger ON "AuditEvent"',
      );
      await client.query("DROP FUNCTION IF EXISTS tradepulse_fail_audit()");
    }

    const userAfter = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { retailerId: true },
    });
    assert.equal(userAfter.retailerId, null);

    const requestAfter = await prisma.retailerLinkRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    assert.equal(requestAfter.status, RetailerLinkRequestStatus.PENDING);
    assert.equal(requestAfter.reviewedById, null);

    const auditCount = await prisma.auditEvent.count({
      where: { entityId: request.id },
    });
    assert.equal(auditCount, 0);
  });

  it("resolves pending requests when an administrator links a retailer directly", async () => {
    const admin = await seedUser(prisma, {
      id: "admin_1",
      name: "Admin",
      phone: "+919800000001",
      role: UserRole.ADMIN,
    });
    const user = await seedUser(prisma, {
      id: "user_1",
      name: "Retailer User",
      phone: "+919800000002",
    });
    const retailerA = await seedRetailer(prisma, {
      id: "retailer_a",
      phone: "+919800000003",
    });
    const retailerB = await seedRetailer(prisma, {
      id: "retailer_b",
      phone: "+919800000004",
    });

    await seedLinkRequest(prisma, {
      id: "request_a",
      userId: user.id,
      retailerId: retailerA.id,
    });
    await seedLinkRequest(prisma, {
      id: "request_b",
      userId: user.id,
      retailerId: retailerB.id,
    });

    const result = await updateUserAccess({
      actorId: admin.id,
      targetUserId: user.id,
      assignment: {
        role: "RETAILER",
        status: "ACTIVE",
        retailerId: retailerB.id,
        assignedRetailerIds: [],
      },
    });

    assert.deepEqual(result, { ok: true });

    const linkedUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { retailerId: true },
    });
    assert.equal(linkedUser.retailerId, retailerB.id);

    const requests = await prisma.retailerLinkRequest.findMany({
      where: { userId: user.id },
      orderBy: { id: "asc" },
    });
    const byId = new Map(requests.map((request) => [request.id, request] as const));

    assert.equal(
      byId.get("request_a")?.status,
      RetailerLinkRequestStatus.REJECTED,
    );
    assert.equal(
      byId.get("request_b")?.status,
      RetailerLinkRequestStatus.APPROVED,
    );
    assert.equal(byId.get("request_b")?.reviewedById, admin.id);
    assert.ok(byId.get("request_b")?.reviewedAt);

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { eventType: "USER_ACCESS_UPDATED", entityId: user.id },
    });
    const metadata = audit.metadata as Record<string, unknown>;
    assert.equal(metadata.previousRetailerId, null);
    assert.equal(metadata.retailerId, retailerB.id);
  });

  it("preserves history with restrictive foreign keys and one pending pair", async () => {
    const reviewer = await seedUser(prisma, {
      id: "admin_1",
      name: "Reviewer",
      phone: "+919800000001",
      role: UserRole.ADMIN,
    });
    const user = await seedUser(prisma, {
      id: "user_1",
      name: "Retailer User",
      phone: "+919800000002",
    });
    const approvedUser = await seedUser(prisma, {
      id: "user_2",
      name: "Approved User",
      phone: "+919800000005",
    });
    const retailer = await seedRetailer(prisma, {
      id: "retailer_a",
      phone: "+919800000003",
    });

    await seedLinkRequest(prisma, {
      id: "request_rejected",
      userId: user.id,
      retailerId: retailer.id,
      status: RetailerLinkRequestStatus.REJECTED,
      reviewedById: reviewer.id,
      reviewedAt: new Date("2026-01-03T00:00:00.000Z"),
    });

    // The partial unique index only protects PENDING rows, so a new request
    // after a rejection is allowed.
    await seedLinkRequest(prisma, {
      id: "request_pending",
      userId: user.id,
      retailerId: retailer.id,
    });

    await seedLinkRequest(prisma, {
      id: "request_approved",
      userId: approvedUser.id,
      retailerId: retailer.id,
      status: RetailerLinkRequestStatus.APPROVED,
      reviewedById: reviewer.id,
      reviewedAt: new Date("2026-01-04T00:00:00.000Z"),
    });

    await assert.rejects(
      client.query(
        `INSERT INTO "RetailerLinkRequest" ("id", "userId", "retailerId", "status", "createdAt")
         VALUES ($1, $2, $3, 'PENDING', CURRENT_TIMESTAMP)`,
        ["request_duplicate_pending", user.id, retailer.id],
      ),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505",
    );

    await assert.rejects(
      prisma.user.delete({ where: { id: user.id } }),
      /foreign key/i,
    );
    await assert.rejects(
      prisma.retailer.delete({ where: { id: retailer.id } }),
      /foreign key/i,
    );
    await assert.rejects(
      prisma.user.delete({ where: { id: reviewer.id } }),
      /foreign key/i,
    );

    const history = await prisma.retailerLinkRequest.findMany({
      where: { userId: user.id },
      orderBy: { id: "asc" },
    });
    assert.deepEqual(
      history.map((request) => request.status),
      [
        RetailerLinkRequestStatus.PENDING,
        RetailerLinkRequestStatus.REJECTED,
      ],
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  reviewRetailerLinkRequest,
  type RetailerLinkReviewStore,
} from "../retailer-linking";

const NOW = new Date("2026-11-06T10:00:00.000Z");

type TestUser = {
  id: string;
  role: string;
  status: string;
  retailerId: string | null;
};

type TestRequest = {
  id: string;
  userId: string;
  retailerId: string;
  status: string;
  reviewedAt: Date | null;
  reviewedById: string | null;
};

type TestAudit = {
  eventType: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

function createStore(seed?: {
  actors?: TestUser[];
  users?: TestUser[];
  requests?: TestRequest[];
  retailers?: string[];
}) {
  const actors = new Map(
    (seed?.actors ?? []).map((actor) => [actor.id, { ...actor }]),
  );
  const users = new Map(
    (seed?.users ?? []).map((user) => [user.id, { ...user }]),
  );
  const requests = new Map(
    (seed?.requests ?? []).map((request) => [request.id, { ...request }]),
  );
  const retailers = new Set(seed?.retailers ?? []);
  const audits: TestAudit[] = [];

  const store: RetailerLinkReviewStore = {
    async findActor(actorId) {
      return actors.get(actorId) ?? null;
    },

    async findRequest(requestId) {
      const request = requests.get(requestId);

      if (!request) {
        return null;
      }

      const user = users.get(request.userId);

      if (!user) {
        return null;
      }

      return {
        id: request.id,
        status: request.status,
        userId: request.userId,
        retailerId: request.retailerId,
        user,
        retailer: retailers.has(request.retailerId)
          ? { id: request.retailerId }
          : null,
      };
    },

    async approve(input) {
      const request = requests.get(input.requestId);
      const user = users.get(input.userId);

      if (
        !request ||
        request.status !== "PENDING" ||
        !user ||
        user.role !== "RETAILER" ||
        user.retailerId !== null
      ) {
        return false;
      }

      request.status = "APPROVED";
      request.reviewedAt = input.reviewedAt;
      request.reviewedById = input.reviewedById;
      user.retailerId = input.retailerId;
      return true;
    },

    async reject(input) {
      const request = requests.get(input.requestId);

      if (!request || request.status !== "PENDING") {
        return false;
      }

      request.status = "REJECTED";
      request.reviewedAt = input.reviewedAt;
      request.reviewedById = input.reviewedById;
      return true;
    },

    async recordAuditEvent(input) {
      audits.push(input);
    },
  };

  return { store, users, requests, audits };
}

function pendingRequest(overrides?: Partial<TestRequest>): TestRequest {
  return {
    id: "link_request_1",
    userId: "user_1",
    retailerId: "retailer_a",
    status: "PENDING",
    reviewedAt: null,
    reviewedById: null,
    ...overrides,
  };
}

describe("reviewRetailerLinkRequest", () => {
  it("approves a validated pending request and records the approval", async () => {
    const { store, users, requests, audits } = createStore({
      actors: [
        {
          id: "admin_1",
          role: "ADMIN",
          status: "ACTIVE",
          retailerId: null,
        },
      ],
      users: [
        {
          id: "user_1",
          role: "RETAILER",
          status: "ACTIVE",
          retailerId: null,
        },
      ],
      requests: [pendingRequest()],
      retailers: ["retailer_a"],
    });

    const result = await reviewRetailerLinkRequest(store, {
      actorId: "admin_1",
      requestId: "link_request_1",
      decision: "APPROVE",
      now: NOW,
    });

    assert.deepEqual(result, { ok: true, decision: "APPROVE" });
    assert.equal(users.get("user_1")?.retailerId, "retailer_a");
    assert.equal(requests.get("link_request_1")?.status, "APPROVED");
    assert.equal(requests.get("link_request_1")?.reviewedById, "admin_1");
    assert.equal(requests.get("link_request_1")?.reviewedAt, NOW);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].eventType, "RETAILER_LINK_APPROVED");
    assert.equal(audits[0].actorId, "admin_1");
    assert.deepEqual(audits[0].metadata, {
      userId: "user_1",
      retailerId: "retailer_a",
    });
  });

  it("rejects a pending request without linking the user", async () => {
    const { store, users, requests, audits } = createStore({
      actors: [
        {
          id: "admin_1",
          role: "ADMIN",
          status: "ACTIVE",
          retailerId: null,
        },
      ],
      users: [
        {
          id: "user_1",
          role: "RETAILER",
          status: "ACTIVE",
          retailerId: null,
        },
      ],
      requests: [pendingRequest()],
      retailers: ["retailer_a"],
    });

    const result = await reviewRetailerLinkRequest(store, {
      actorId: "admin_1",
      requestId: "link_request_1",
      decision: "REJECT",
      now: NOW,
    });

    assert.deepEqual(result, { ok: true, decision: "REJECT" });
    assert.equal(users.get("user_1")?.retailerId, null);
    assert.equal(requests.get("link_request_1")?.status, "REJECTED");
    assert.equal(audits.length, 1);
    assert.equal(audits[0].eventType, "RETAILER_LINK_REJECTED");
  });

  it("refuses an actor without administrator permission", async () => {
    const { store, users, requests, audits } = createStore({
      actors: [
        {
          id: "retailer_1",
          role: "RETAILER",
          status: "ACTIVE",
          retailerId: "retailer_a",
        },
      ],
      users: [
        {
          id: "user_1",
          role: "RETAILER",
          status: "ACTIVE",
          retailerId: null,
        },
      ],
      requests: [pendingRequest()],
      retailers: ["retailer_a"],
    });

    const result = await reviewRetailerLinkRequest(store, {
      actorId: "retailer_1",
      requestId: "link_request_1",
      decision: "APPROVE",
      now: NOW,
    });

    assert.equal(result.ok, false);
    assert.equal(users.get("user_1")?.retailerId, null);
    assert.equal(requests.get("link_request_1")?.status, "PENDING");
    assert.equal(audits.length, 0);
  });

  it("refuses a disabled administrator", async () => {
    const { store, users, audits } = createStore({
      actors: [
        {
          id: "admin_1",
          role: "ADMIN",
          status: "DISABLED",
          retailerId: null,
        },
      ],
      users: [
        {
          id: "user_1",
          role: "RETAILER",
          status: "ACTIVE",
          retailerId: null,
        },
      ],
      requests: [pendingRequest()],
      retailers: ["retailer_a"],
    });

    const result = await reviewRetailerLinkRequest(store, {
      actorId: "admin_1",
      requestId: "link_request_1",
      decision: "APPROVE",
      now: NOW,
    });

    assert.equal(result.ok, false);
    assert.equal(users.get("user_1")?.retailerId, null);
    assert.equal(audits.length, 0);
  });

  it("does not review an already-decided request twice", async () => {
    const { store, users, requests, audits } = createStore({
      actors: [
        {
          id: "admin_1",
          role: "ADMIN",
          status: "ACTIVE",
          retailerId: null,
        },
      ],
      users: [
        {
          id: "user_1",
          role: "RETAILER",
          status: "ACTIVE",
          retailerId: null,
        },
      ],
      requests: [pendingRequest({ status: "APPROVED" })],
      retailers: ["retailer_a"],
    });

    const result = await reviewRetailerLinkRequest(store, {
      actorId: "admin_1",
      requestId: "link_request_1",
      decision: "APPROVE",
      now: NOW,
    });

    assert.equal(result.ok, false);
    assert.equal(users.get("user_1")?.retailerId, null);
    assert.equal(requests.get("link_request_1")?.status, "APPROVED");
    assert.equal(audits.length, 0);
  });

  it("refuses to approve a request whose retailer no longer exists", async () => {
    const { store, users, requests, audits } = createStore({
      actors: [
        {
          id: "admin_1",
          role: "ADMIN",
          status: "ACTIVE",
          retailerId: null,
        },
      ],
      users: [
        {
          id: "user_1",
          role: "RETAILER",
          status: "ACTIVE",
          retailerId: null,
        },
      ],
      requests: [pendingRequest()],
    });

    const result = await reviewRetailerLinkRequest(store, {
      actorId: "admin_1",
      requestId: "link_request_1",
      decision: "APPROVE",
      now: NOW,
    });

    assert.equal(result.ok, false);
    assert.equal(users.get("user_1")?.retailerId, null);
    assert.equal(requests.get("link_request_1")?.status, "PENDING");
    assert.equal(audits.length, 0);
  });

  it("refuses to link a non-retailer account", async () => {
    const { store, users, audits } = createStore({
      actors: [
        {
          id: "admin_1",
          role: "ADMIN",
          status: "ACTIVE",
          retailerId: null,
        },
      ],
      users: [
        {
          id: "user_1",
          role: "ORDER_DESK",
          status: "ACTIVE",
          retailerId: null,
        },
      ],
      requests: [pendingRequest()],
      retailers: ["retailer_a"],
    });

    const result = await reviewRetailerLinkRequest(store, {
      actorId: "admin_1",
      requestId: "link_request_1",
      decision: "APPROVE",
      now: NOW,
    });

    assert.equal(result.ok, false);
    assert.equal(users.get("user_1")?.retailerId, null);
    assert.equal(audits.length, 0);
  });

  it("refuses to overwrite an existing retailer link", async () => {
    const { store, users, audits } = createStore({
      actors: [
        {
          id: "admin_1",
          role: "ADMIN",
          status: "ACTIVE",
          retailerId: null,
        },
      ],
      users: [
        {
          id: "user_1",
          role: "RETAILER",
          status: "ACTIVE",
          retailerId: "retailer_b",
        },
      ],
      requests: [pendingRequest()],
      retailers: ["retailer_a", "retailer_b"],
    });

    const result = await reviewRetailerLinkRequest(store, {
      actorId: "admin_1",
      requestId: "link_request_1",
      decision: "APPROVE",
      now: NOW,
    });

    assert.equal(result.ok, false);
    assert.equal(users.get("user_1")?.retailerId, "retailer_b");
    assert.equal(audits.length, 0);
  });
});

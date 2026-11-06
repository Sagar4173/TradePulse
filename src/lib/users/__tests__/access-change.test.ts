import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildUserAccessAuditMetadata,
  resolvePendingRetailerLinkRequests,
} from "../access-change";

describe("buildUserAccessAuditMetadata", () => {
  it("records the previous and new retailer IDs", () => {
    const metadata = buildUserAccessAuditMetadata({
      previousRetailerId: "retailer_old",
      assignment: {
        role: "RETAILER",
        status: "ACTIVE",
        retailerId: "retailer_new",
        assignedRetailerIds: [],
      },
      revokedSessions: 2,
    });

    assert.deepEqual(metadata, {
      role: "RETAILER",
      status: "ACTIVE",
      previousRetailerId: "retailer_old",
      retailerId: "retailer_new",
      assignedRetailerCount: 0,
      revokedSessions: 2,
    });
  });

  it("preserves an unlinked previous retailer and records the assignment", () => {
    const metadata = buildUserAccessAuditMetadata({
      previousRetailerId: null,
      assignment: {
        role: "SALESMAN",
        status: "ACTIVE",
        retailerId: null,
        assignedRetailerIds: ["retailer_a", "retailer_b"],
      },
      revokedSessions: 0,
    });

    assert.equal(metadata.previousRetailerId, null);
    assert.equal(metadata.retailerId, null);
    assert.equal(metadata.assignedRetailerCount, 2);
  });
});

describe("resolvePendingRetailerLinkRequests", () => {
  it("leaves pending requests untouched when no retailer is linked", () => {
    const resolutions = resolvePendingRetailerLinkRequests({
      pendingRequests: [{ id: "request_1", retailerId: "retailer_a" }],
      linkedRetailerId: null,
    });

    assert.deepEqual(resolutions, []);
  });

  it("returns no decisions when the user has no pending requests", () => {
    const resolutions = resolvePendingRetailerLinkRequests({
      pendingRequests: [],
      linkedRetailerId: "retailer_a",
    });

    assert.deepEqual(resolutions, []);
  });

  it("approves the matching request and rejects every other request", () => {
    const resolutions = resolvePendingRetailerLinkRequests({
      pendingRequests: [
        { id: "request_1", retailerId: "retailer_a" },
        { id: "request_2", retailerId: "retailer_b" },
        { id: "request_3", retailerId: "retailer_c" },
      ],
      linkedRetailerId: "retailer_b",
    });

    assert.deepEqual(resolutions, [
      { requestId: "request_1", status: "REJECTED" },
      { requestId: "request_2", status: "APPROVED" },
      { requestId: "request_3", status: "REJECTED" },
    ]);
  });

  it("rejects all pending requests when the linked retailer has no request", () => {
    const resolutions = resolvePendingRetailerLinkRequests({
      pendingRequests: [{ id: "request_1", retailerId: "retailer_a" }],
      linkedRetailerId: "retailer_direct",
    });

    assert.deepEqual(resolutions, [
      { requestId: "request_1", status: "REJECTED" },
    ]);
  });
});

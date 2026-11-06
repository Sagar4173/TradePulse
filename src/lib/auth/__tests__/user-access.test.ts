import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PUBLIC_REGISTRATION_ROLE,
  isLastActiveAdminChange,
  isSelfAccessChange,
  shouldRevokeSessionsOnAccessChange,
  validateAccessAssignment,
} from "../user-access";

describe("public registration", () => {
  it("can only ever produce retailer accounts", () => {
    assert.equal(PUBLIC_REGISTRATION_ROLE, "RETAILER");
  });
});

describe("validateAccessAssignment", () => {
  it("requires a retailer link for retailer users", () => {
    const result = validateAccessAssignment({
      role: "RETAILER",
      status: "ACTIVE",
      retailerId: null,
      assignedRetailerIds: [],
    });

    assert.equal(result.ok, false);
  });

  it("accepts a retailer linked to a retailer record", () => {
    const result = validateAccessAssignment({
      role: "RETAILER",
      status: "ACTIVE",
      retailerId: "retailer_a",
      assignedRetailerIds: [],
    });

    assert.deepEqual(result, {
      ok: true,
      value: {
        role: "RETAILER",
        status: "ACTIVE",
        retailerId: "retailer_a",
        assignedRetailerIds: [],
      },
    });
  });

  it("rejects unknown roles and statuses", () => {
    assert.equal(
      validateAccessAssignment({
        role: "SUPER_ADMIN",
        status: "ACTIVE",
        retailerId: null,
        assignedRetailerIds: [],
      }).ok,
      false,
    );

    assert.equal(
      validateAccessAssignment({
        role: "ADMIN",
        status: "PENDING",
        retailerId: null,
        assignedRetailerIds: [],
      }).ok,
      false,
    );
  });

  it("normalizes non-retailer links and only keeps salesman assignments", () => {
    const admin = validateAccessAssignment({
      role: "ADMIN",
      status: "ACTIVE",
      retailerId: "retailer_a",
      assignedRetailerIds: ["retailer_a"],
    });
    assert.deepEqual(admin, {
      ok: true,
      value: {
        role: "ADMIN",
        status: "ACTIVE",
        retailerId: null,
        assignedRetailerIds: [],
      },
    });

    const salesman = validateAccessAssignment({
      role: "SALESMAN",
      status: "ACTIVE",
      retailerId: null,
      assignedRetailerIds: ["retailer_b", "retailer_a", "retailer_a"],
    });
    assert.deepEqual(salesman, {
      ok: true,
      value: {
        role: "SALESMAN",
        status: "ACTIVE",
        retailerId: null,
        assignedRetailerIds: ["retailer_a", "retailer_b"],
      },
    });
  });
});

describe("access-change guards", () => {
  it("detects self changes", () => {
    assert.equal(isSelfAccessChange("user_a", "user_a"), true);
    assert.equal(isSelfAccessChange("user_a", "user_b"), false);
  });

  it("revokes sessions when a role or status change could alter access", () => {
    assert.equal(
      shouldRevokeSessionsOnAccessChange({
        currentRole: "RETAILER",
        currentStatus: "ACTIVE",
        nextRole: "ADMIN",
        nextStatus: "ACTIVE",
      }),
      true,
    );
    assert.equal(
      shouldRevokeSessionsOnAccessChange({
        currentRole: "ADMIN",
        currentStatus: "ACTIVE",
        nextRole: "RETAILER",
        nextStatus: "ACTIVE",
      }),
      true,
    );
    assert.equal(
      shouldRevokeSessionsOnAccessChange({
        currentRole: "SALESMAN",
        currentStatus: "ACTIVE",
        nextRole: "SALESMAN",
        nextStatus: "DISABLED",
      }),
      true,
    );
    assert.equal(
      shouldRevokeSessionsOnAccessChange({
        currentRole: "RETAILER",
        currentStatus: "ACTIVE",
        nextRole: "RETAILER",
        nextStatus: "ACTIVE",
      }),
      false,
    );
  });

  it("prevents removing the final active administrator", () => {
    assert.equal(
      isLastActiveAdminChange({
        currentRole: "ADMIN",
        currentStatus: "ACTIVE",
        nextRole: "ORDER_DESK",
        nextStatus: "ACTIVE",
        otherActiveAdminCount: 0,
      }),
      true,
    );
    assert.equal(
      isLastActiveAdminChange({
        currentRole: "ADMIN",
        currentStatus: "ACTIVE",
        nextRole: "ADMIN",
        nextStatus: "DISABLED",
        otherActiveAdminCount: 0,
      }),
      true,
    );
    assert.equal(
      isLastActiveAdminChange({
        currentRole: "ADMIN",
        currentStatus: "ACTIVE",
        nextRole: "ORDER_DESK",
        nextStatus: "ACTIVE",
        otherActiveAdminCount: 1,
      }),
      false,
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PERMISSIONS,
  canAccessOrder,
  canAccessRetailer,
  hasAnyPermission,
  hasPermission,
} from "../permissions";
import { getNavigationForRole } from "../navigation";
import type { Role } from "../types";

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

describe("role permissions", () => {
  it("gives retailers only self-scoped operational access", () => {
    const role: Role = "RETAILER";

    assert.equal(hasPermission(role, PERMISSIONS.DASHBOARD_VIEW), true);
    assert.equal(hasPermission(role, PERMISSIONS.CATALOGUE_VIEW), true);
    assert.equal(hasPermission(role, PERMISSIONS.ORDERS_VIEW_OWN), true);
    assert.equal(hasPermission(role, PERMISSIONS.ORDERS_SUBMIT_OWN), true);
    assert.equal(hasPermission(role, PERMISSIONS.ORDERS_CANCEL_OWN), true);
    assert.equal(hasPermission(role, PERMISSIONS.CREDIT_VIEW_OWN), true);
    assert.equal(hasPermission(role, PERMISSIONS.ORDERS_MANAGE), false);
    assert.equal(hasPermission(role, PERMISSIONS.ORDERS_VIEW_ALL), false);
    assert.equal(hasPermission(role, PERMISSIONS.RETAILERS_VIEW_ALL), false);
    assert.equal(hasPermission(role, PERMISSIONS.USERS_VIEW), false);
  });

  it("limits salesmen to assigned retailer scope", () => {
    assert.equal(hasPermission("SALESMAN", PERMISSIONS.ORDERS_VIEW_ASSIGNED), true);
    assert.equal(hasPermission("SALESMAN", PERMISSIONS.RETAILERS_VIEW_ASSIGNED), true);
    assert.equal(hasPermission("SALESMAN", PERMISSIONS.ORDERS_MANAGE), false);
    assert.equal(hasPermission("SALESMAN", PERMISSIONS.ORDERS_SUBMIT_OWN), false);
    assert.equal(hasPermission("SALESMAN", PERMISSIONS.ORDERS_VIEW_ALL), false);
    assert.equal(hasPermission("SALESMAN", PERMISSIONS.USERS_VIEW), false);
  });

  it("gives order desk explicit all-order and retailer visibility but no user management", () => {
    assert.equal(hasPermission("ORDER_DESK", PERMISSIONS.ORDERS_VIEW_ALL), true);
    assert.equal(hasPermission("ORDER_DESK", PERMISSIONS.ORDERS_MANAGE), true);
    assert.equal(hasPermission("ORDER_DESK", PERMISSIONS.ORDERS_SUBMIT_OWN), false);
    assert.equal(hasPermission("ORDER_DESK", PERMISSIONS.RETAILERS_VIEW_ALL), true);
    assert.equal(hasPermission("ORDER_DESK", PERMISSIONS.CREDIT_VIEW_ALL), true);
    assert.equal(hasPermission("ORDER_DESK", PERMISSIONS.USERS_VIEW), false);
    assert.equal(hasPermission("ORDER_DESK", PERMISSIONS.USERS_MANAGE), false);
  });

  it("gives administrators every permission", () => {
    for (const permission of ALL_PERMISSIONS) {
      assert.equal(hasPermission("ADMIN", permission), true, permission);
    }
  });

  it("checks any-of permission lists", () => {
    assert.equal(
      hasAnyPermission("SALESMAN", [
        PERMISSIONS.ORDERS_VIEW_OWN,
        PERMISSIONS.ORDERS_VIEW_ASSIGNED,
      ]),
      true,
    );
    assert.equal(
      hasAnyPermission("RETAILER", [
        PERMISSIONS.USERS_VIEW,
        PERMISSIONS.AUDIT_VIEW,
      ]),
      false,
    );
  });
});

describe("retailer and order scoping", () => {
  it("allows retailers to access only their own retailer", () => {
    assert.equal(canAccessRetailer("RETAILER", "retailer_a", [], "retailer_a"), true);
    assert.equal(canAccessRetailer("RETAILER", "retailer_a", [], "retailer_b"), false);
    assert.equal(canAccessRetailer("RETAILER", null, [], "retailer_a"), false);
  });

  it("allows salesmen to access only assigned retailers", () => {
    assert.equal(
      canAccessRetailer("SALESMAN", null, ["retailer_a"], "retailer_a"),
      true,
    );
    assert.equal(
      canAccessRetailer("SALESMAN", null, ["retailer_a"], "retailer_b"),
      false,
    );
    assert.equal(canAccessRetailer("SALESMAN", null, [], "retailer_a"), false);
  });

  it("allows order desk and administrators to access any retailer", () => {
    assert.equal(canAccessRetailer("ORDER_DESK", null, [], "retailer_a"), true);
    assert.equal(canAccessRetailer("ADMIN", null, [], "retailer_a"), true);
  });

  it("applies the same scope to orders", () => {
    assert.equal(canAccessOrder("RETAILER", "retailer_a", [], "retailer_a"), true);
    assert.equal(canAccessOrder("RETAILER", "retailer_a", [], "retailer_b"), false);
    assert.equal(canAccessOrder("SALESMAN", null, ["retailer_b"], "retailer_b"), true);
    assert.equal(canAccessOrder("SALESMAN", null, ["retailer_b"], "retailer_a"), false);
    assert.equal(canAccessOrder("ORDER_DESK", null, [], "retailer_a"), true);
  });
});

describe("role navigation", () => {
  it("matches the milestone navigation for each role", () => {
    assert.deepEqual(
      getNavigationForRole("RETAILER").map((item) => item.href),
      ["/dashboard", "/catalogue", "/cart", "/orders", "/account"],
    );
    assert.deepEqual(
      getNavigationForRole("SALESMAN").map((item) => item.href),
      ["/dashboard", "/retailers", "/orders", "/account"],
    );
    assert.deepEqual(
      getNavigationForRole("ORDER_DESK").map((item) => item.href),
      ["/dashboard", "/orders", "/retailers", "/account"],
    );
    assert.deepEqual(
      getNavigationForRole("ADMIN").map((item) => item.href),
      [
        "/dashboard",
        "/users",
        "/retailers",
        "/orders",
        "/products",
        "/inventory",
        "/schemes",
        "/audit-logs",
      ],
    );
  });
});

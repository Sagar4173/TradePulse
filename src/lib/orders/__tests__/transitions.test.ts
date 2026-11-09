import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ACTION_TARGET_STATUS,
  actionRequiresReason,
  canPerformAction,
  getAvailableOrderActions,
  isTerminalStatus,
  isTransitionAllowed,
} from "../transitions";

describe("order transition matrix", () => {
  it("maps every action to its target status", () => {
    assert.deepEqual(ACTION_TARGET_STATUS, {
      APPROVE: "APPROVED",
      REJECT: "REJECTED",
      CANCEL: "CANCELLED",
      START_PROCESSING: "PROCESSING",
      MARK_READY: "READY_FOR_DISPATCH",
      DISPATCH: "DISPATCHED",
      DELIVER: "DELIVERED",
    });
  });

  it("allows only the documented forward transitions", () => {
    const allowed = [
      ["PENDING_REVIEW", "APPROVED"],
      ["PENDING_REVIEW", "ON_CREDIT_HOLD"],
      ["PENDING_REVIEW", "REJECTED"],
      ["PENDING_REVIEW", "CANCELLED"],
      ["ON_CREDIT_HOLD", "APPROVED"],
      ["ON_CREDIT_HOLD", "REJECTED"],
      ["ON_CREDIT_HOLD", "CANCELLED"],
      ["APPROVED", "PROCESSING"],
      ["APPROVED", "CANCELLED"],
      ["PROCESSING", "READY_FOR_DISPATCH"],
      ["PROCESSING", "CANCELLED"],
      ["READY_FOR_DISPATCH", "DISPATCHED"],
      ["READY_FOR_DISPATCH", "CANCELLED"],
      ["DISPATCHED", "DELIVERED"],
    ] as const;

    for (const [from, to] of allowed) {
      assert.equal(isTransitionAllowed(from, to), true, `${from} -> ${to}`);
    }

    const denied = [
      ["REJECTED", "APPROVED"],
      ["CANCELLED", "PENDING_REVIEW"],
      ["DELIVERED", "DISPATCHED"],
      ["DISPATCHED", "CANCELLED"],
      ["APPROVED", "PENDING_REVIEW"],
      ["DRAFT", "APPROVED"],
    ] as const;

    for (const [from, to] of denied) {
      assert.equal(isTransitionAllowed(from, to), false, `${from} -> ${to}`);
    }
  });

  it("identifies terminal statuses", () => {
    assert.equal(isTerminalStatus("REJECTED"), true);
    assert.equal(isTerminalStatus("CANCELLED"), true);
    assert.equal(isTerminalStatus("DELIVERED"), true);
    assert.equal(isTerminalStatus("FULFILLED"), true);
    assert.equal(isTerminalStatus("PENDING_REVIEW"), false);
    assert.equal(isTerminalStatus("DISPATCHED"), false);
  });

  it("requires a reason for rejection and cancellation", () => {
    assert.equal(actionRequiresReason("REJECT"), true);
    assert.equal(actionRequiresReason("CANCEL"), true);
    assert.equal(actionRequiresReason("APPROVE"), false);
    assert.equal(actionRequiresReason("DISPATCH"), false);
  });
});

describe("role-restricted order actions", () => {
  it("lets retailers cancel only their own pending or held orders", () => {
    assert.deepEqual(getAvailableOrderActions("RETAILER", "PENDING_REVIEW"), [
      "CANCEL",
    ]);
    assert.deepEqual(getAvailableOrderActions("RETAILER", "ON_CREDIT_HOLD"), [
      "CANCEL",
    ]);
    assert.deepEqual(getAvailableOrderActions("RETAILER", "APPROVED"), []);
    assert.equal(
      canPerformAction("RETAILER", "PENDING_REVIEW", "CANCEL"),
      true,
    );
    assert.equal(canPerformAction("RETAILER", "PENDING_REVIEW", "APPROVE"), false);
    assert.equal(canPerformAction("RETAILER", "PENDING_REVIEW", "REJECT"), false);
    assert.equal(canPerformAction("RETAILER", "DISPATCHED", "DELIVER"), false);
  });

  it("gives Order Desk and Admin the documented processing actions", () => {
    assert.deepEqual(
      getAvailableOrderActions("ORDER_DESK", "PENDING_REVIEW"),
      ["APPROVE", "REJECT", "CANCEL"],
    );
    assert.deepEqual(
      getAvailableOrderActions("ORDER_DESK", "ON_CREDIT_HOLD"),
      ["APPROVE", "REJECT", "CANCEL"],
    );
    assert.deepEqual(getAvailableOrderActions("ORDER_DESK", "APPROVED"), [
      "START_PROCESSING",
      "CANCEL",
    ]);
    assert.deepEqual(getAvailableOrderActions("ORDER_DESK", "PROCESSING"), [
      "MARK_READY",
      "CANCEL",
    ]);
    assert.deepEqual(
      getAvailableOrderActions("ORDER_DESK", "READY_FOR_DISPATCH"),
      ["DISPATCH", "CANCEL"],
    );
    assert.deepEqual(getAvailableOrderActions("ORDER_DESK", "DISPATCHED"), [
      "DELIVER",
    ]);
    assert.deepEqual(getAvailableOrderActions("ORDER_DESK", "DELIVERED"), []);
    assert.deepEqual(
      getAvailableOrderActions("ADMIN", "PENDING_REVIEW"),
      ["APPROVE", "REJECT", "CANCEL"],
    );
  });

  it("keeps salesmen read-only", () => {
    for (const status of [
      "PENDING_REVIEW",
      "ON_CREDIT_HOLD",
      "APPROVED",
      "PROCESSING",
      "READY_FOR_DISPATCH",
      "DISPATCHED",
    ] as const) {
      assert.deepEqual(getAvailableOrderActions("SALESMAN", status), [], status);
    }
  });

  it("rejects actions that are not valid from the current status", () => {
    assert.equal(canPerformAction("ORDER_DESK", "DELIVERED", "CANCEL"), false);
    assert.equal(canPerformAction("ORDER_DESK", "PENDING_REVIEW", "DISPATCH"), false);
    assert.equal(canPerformAction("ORDER_DESK", "DRAFT", "APPROVE"), false);
  });
});

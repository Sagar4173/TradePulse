/**
 * Explicit order state machine.
 *
 * A transition is allowed only when both the source status and the actor role
 * permit it. Retailers may cancel only their own orders before approval;
 * salesman accounts are read-only; Order Desk and Admin share the operational
 * lifecycle. The server action layer still verifies retailer ownership.
 */

import type { Role } from "@/lib/auth/types";

import type { OrderStatusValue } from "./status";

export const ORDER_ACTIONS = [
  "APPROVE",
  "REJECT",
  "START_PROCESSING",
  "MARK_READY",
  "DISPATCH",
  "DELIVER",
  "CANCEL",
] as const;

export type OrderAction = (typeof ORDER_ACTIONS)[number];

export function isOrderAction(value: unknown): value is OrderAction {
  return (
    typeof value === "string" &&
    (ORDER_ACTIONS as readonly string[]).includes(value)
  );
}

export const ACTION_TARGET_STATUS: Record<OrderAction, OrderStatusValue> = {
  APPROVE: "APPROVED",
  REJECT: "REJECTED",
  CANCEL: "CANCELLED",
  START_PROCESSING: "PROCESSING",
  MARK_READY: "READY_FOR_DISPATCH",
  DISPATCH: "DISPATCHED",
  DELIVER: "DELIVERED",
};

const ACTION_SOURCE_STATUSES: Record<
  OrderAction,
  readonly OrderStatusValue[]
> = {
  APPROVE: ["PENDING_REVIEW", "ON_CREDIT_HOLD"],
  REJECT: ["PENDING_REVIEW", "ON_CREDIT_HOLD"],
  CANCEL: [
    "PENDING_REVIEW",
    "ON_CREDIT_HOLD",
    "APPROVED",
    "PROCESSING",
    "READY_FOR_DISPATCH",
  ],
  START_PROCESSING: ["APPROVED"],
  MARK_READY: ["PROCESSING"],
  DISPATCH: ["READY_FOR_DISPATCH"],
  DELIVER: ["DISPATCHED"],
};

const TRANSITIONS: Record<OrderStatusValue, readonly OrderStatusValue[]> = {
  DRAFT: [],
  PENDING_REVIEW: [
    "APPROVED",
    "ON_CREDIT_HOLD",
    "REJECTED",
    "CANCELLED",
  ],
  ON_CREDIT_HOLD: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["READY_FOR_DISPATCH", "CANCELLED"],
  READY_FOR_DISPATCH: ["DISPATCHED", "CANCELLED"],
  DISPATCHED: ["DELIVERED"],
  DELIVERED: [],
  REJECTED: [],
  FULFILLED: [],
  CANCELLED: [],
};

const TERMINAL_STATUSES: readonly OrderStatusValue[] = [
  "REJECTED",
  "CANCELLED",
  "DELIVERED",
  "FULFILLED",
];

const RETAILER_CANCELLABLE: readonly OrderStatusValue[] = [
  "PENDING_REVIEW",
  "ON_CREDIT_HOLD",
];

export function isTransitionAllowed(
  from: OrderStatusValue,
  to: OrderStatusValue,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminalStatus(status: OrderStatusValue): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function actionRequiresReason(action: OrderAction): boolean {
  return action === "REJECT" || action === "CANCEL";
}

export function canPerformAction(
  role: Role,
  from: OrderStatusValue,
  action: OrderAction,
): boolean {
  if (!ACTION_SOURCE_STATUSES[action].includes(from)) {
    return false;
  }

  switch (role) {
    case "RETAILER":
      return action === "CANCEL" && RETAILER_CANCELLABLE.includes(from);
    case "SALESMAN":
      return false;
    case "ORDER_DESK":
    case "ADMIN":
      return true;
  }
}

export function getAvailableOrderActions(
  role: Role,
  from: OrderStatusValue,
): OrderAction[] {
  return ORDER_ACTIONS.filter((action) => canPerformAction(role, from, action));
}

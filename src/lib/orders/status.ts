/**
 * Shared order lifecycle vocabulary.
 *
 * These string values mirror the PostgreSQL enums exactly. They are declared
 * locally so the pure lifecycle rules can be tested without a database or a
 * generated Prisma client.
 */

export const ORDER_STATUSES = [
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "PROCESSING",
  "READY_FOR_DISPATCH",
  "DISPATCHED",
  "DELIVERED",
  "ON_CREDIT_HOLD",
  "REJECTED",
  "FULFILLED",
  "CANCELLED",
] as const;

export type OrderStatusValue = (typeof ORDER_STATUSES)[number];

export const STOCK_STATES = [
  "NONE",
  "RESERVED",
  "RELEASED",
  "DEDUCTED",
] as const;

export type StockStateValue = (typeof STOCK_STATES)[number];

export const CREDIT_CHECK_STATUSES = [
  "NOT_CHECKED",
  "PASSED",
  "FAILED",
] as const;

export type CreditCheckStatusValue = (typeof CREDIT_CHECK_STATUSES)[number];

export function isOrderStatus(value: unknown): value is OrderStatusValue {
  return (
    typeof value === "string" &&
    (ORDER_STATUSES as readonly string[]).includes(value)
  );
}

export function isStockState(value: unknown): value is StockStateValue {
  return (
    typeof value === "string" &&
    (STOCK_STATES as readonly string[]).includes(value)
  );
}

export function orderStatusLabel(status: string): string {
  switch (status) {
    case "DRAFT":
      return "Draft";
    case "PENDING_REVIEW":
      return "Pending review";
    case "APPROVED":
      return "Approved";
    case "PROCESSING":
      return "Processing";
    case "READY_FOR_DISPATCH":
      return "Ready for dispatch";
    case "DISPATCHED":
      return "Dispatched";
    case "DELIVERED":
      return "Delivered";
    case "ON_CREDIT_HOLD":
      return "On credit hold";
    case "REJECTED":
      return "Rejected";
    case "FULFILLED":
      return "Fulfilled";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}

export function stockStateLabel(state: string): string {
  switch (state) {
    case "NONE":
      return "No reservation";
    case "RESERVED":
      return "Stock reserved";
    case "RELEASED":
      return "Reservation released";
    case "DEDUCTED":
      return "Stock deducted";
    default:
      return state;
  }
}

export function creditCheckLabel(status: string): string {
  switch (status) {
    case "NOT_CHECKED":
      return "Not checked";
    case "PASSED":
      return "Passed";
    case "FAILED":
      return "Failed";
    default:
      return status;
  }
}

export const ORDER_EVENT_LABELS: Record<string, string> = {
  ORDER_SUBMITTED: "Order submitted",
  ORDER_CREDIT_HELD: "Placed on credit hold",
  ORDER_CREDIT_HOLD_RELEASED: "Credit hold released",
  ORDER_CREDIT_RECHECK_FAILED: "Credit recheck failed",
  ORDER_APPROVED: "Order approved",
  ORDER_REJECTED: "Order rejected",
  ORDER_CANCELLED: "Order cancelled",
  ORDER_PROCESSING_STARTED: "Processing started",
  ORDER_READY_FOR_DISPATCH: "Marked ready for dispatch",
  ORDER_DISPATCHED: "Order dispatched",
  ORDER_DELIVERED: "Order delivered",
  ORDER_STOCK_RESERVED: "Stock reserved",
  ORDER_STOCK_RELEASED: "Stock reservation released",
  ORDER_STOCK_DEDUCTED: "Stock deducted",
  ORDER_STOCK_UNAVAILABLE: "Stock unavailable",
};

export function orderEventLabel(eventType: string): string {
  return ORDER_EVENT_LABELS[eventType] ?? orderStatusLabel(eventType);
}

/**
 * Display-only formatting for order screens. These helpers never participate in
 * authorization or money calculations; all values shown here were calculated by
 * the server-side order services.
 */

import type { Prisma } from "@/generated/prisma/client";
import { formatInr } from "@/lib/format";

import type { CheckoutLineChangeReason } from "./checkout";
import type { OrderAction } from "./transitions";

export const ORDER_ACTION_LABELS: Record<OrderAction, string> = {
  APPROVE: "Approve order",
  REJECT: "Reject order",
  CANCEL: "Cancel order",
  START_PROCESSING: "Start processing",
  MARK_READY: "Mark ready for dispatch",
  DISPATCH: "Dispatch order",
  DELIVER: "Mark delivered",
};

export const ORDER_ACTION_HELP: Record<OrderAction, string> = {
  APPROVE: "Approve this order and continue fulfilment.",
  REJECT: "Reject this order. A reason is required.",
  CANCEL: "Cancel this order and release any stock reservation. A reason is required.",
  START_PROCESSING: "Move the approved order into processing.",
  MARK_READY: "Mark the processed order as ready for dispatch.",
  DISPATCH: "Deduct the reserved stock and record dispatch.",
  DELIVER: "Record that the retailer received this order.",
};

export const CHECKOUT_CHANGE_LABELS: Record<
  CheckoutLineChangeReason,
  string
> = {
  PRICE_CHANGED: "Price changed",
  STOCK_CHANGED: "Stock changed",
  SCHEME_CHANGED: "Scheme eligibility changed",
  QUANTITY_CHANGED: "Quantity or free units changed",
  PRODUCT_UNAVAILABLE: "Product is no longer available",
  PRODUCT_ADDED: "Product was added to the cart",
};

function isRecord(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(
  metadata: Prisma.JsonObject,
  key: string,
): string | null {
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

function reservationSummary(metadata: Prisma.JsonObject): string | null {
  const reservations = metadata.reservations;

  if (!Array.isArray(reservations) || reservations.length === 0) {
    return null;
  }

  const parts: string[] = [];

  for (const reservation of reservations.slice(0, 4)) {
    if (!isRecord(reservation)) {
      continue;
    }

    const sku = stringValue(reservation, "sku");
    const cases =
      typeof reservation.cases === "number" ? reservation.cases : null;

    if (sku && cases !== null) {
      parts.push(`${sku} × ${cases}`);
    }
  }

  if (parts.length === 0) {
    return null;
  }

  const remaining = reservations.length - parts.length;
  return `${parts.join(", ")}${remaining > 0 ? ` (+${remaining} more)` : ""}`;
}

/**
 * Builds a short, safe description from the JSON metadata stored with an order
 * audit event. Unknown fields are ignored rather than rendered.
 */
export function describeOrderAuditEvent(
  eventType: string,
  metadata: Prisma.JsonValue,
): string | null {
  if (!isRecord(metadata)) {
    return null;
  }

  const reason = stringValue(metadata, "reason");

  if (reason) {
    return reason;
  }

  if (eventType === "ORDER_CREDIT_RECHECK_FAILED") {
    const creditLimit = stringValue(metadata, "creditLimit");
    const projected = stringValue(metadata, "projectedExposure");
    const shortfall = stringValue(metadata, "shortfall");

    if (creditLimit && projected && shortfall) {
      return `Limit ${formatInr(creditLimit)} · projected ${formatInr(
        projected,
      )} · short by ${formatInr(shortfall)}`;
    }
  }

  if (eventType === "ORDER_CREDIT_HELD") {
    const creditLimit = stringValue(metadata, "creditLimit");
    const projected = stringValue(metadata, "projectedExposure");

    if (creditLimit && projected) {
      return `Limit ${formatInr(creditLimit)} · projected ${formatInr(
        projected,
      )}`;
    }
  }

  if (eventType === "ORDER_STOCK_UNAVAILABLE") {
    return "Stock is no longer available for one or more lines; the order was not advanced.";
  }

  if (
    eventType === "ORDER_STOCK_RESERVED" ||
    eventType === "ORDER_STOCK_RELEASED" ||
    eventType === "ORDER_STOCK_DEDUCTED"
  ) {
    const summary = reservationSummary(metadata);

    if (summary) {
      return summary;
    }
  }

  if (eventType === "ORDER_CREDIT_HOLD_RELEASED") {
    const projected = stringValue(metadata, "projectedExposure");

    if (projected) {
      return `Projected exposure ${formatInr(projected)} is within the credit limit.`;
    }
  }

  const previousStatus = stringValue(metadata, "previousStatus");
  const status = stringValue(metadata, "status");

  if (previousStatus && status) {
    return `${previousStatus.replaceAll("_", " ")} → ${status.replaceAll(
      "_",
      " ",
    )}`;
  }

  return null;
}

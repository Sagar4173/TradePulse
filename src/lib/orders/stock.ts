/**
 * Pure stock lifecycle planning.
 *
 * Physical stock (`stockCases`) and existing reservations (`reservedCases`) are
 * separate. Available cases are `stockCases - reservedCases`. Reserving adds to
 * `reservedCases`; releasing subtracts from it; dispatch subtracts the same
 * quantity from both columns so the available balance is unchanged by the
 * deduction itself.
 */

import type { OrderStatusValue, StockStateValue } from "./status";

export type ReservationLine = {
  sku: string;
  cases: number;
};

export type InventoryPosition = {
  stockCases: number;
  reservedCases: number;
};

export type StockShortage = {
  sku: string;
  requestedCases: number;
  availableCases: number;
};

export type StockReservationPlan =
  | { ok: true; reservations: ReservationLine[] }
  | { ok: false; shortages: StockShortage[] };

export type StockOperation = "NONE" | "RESERVE" | "RELEASE" | "DEDUCT";

export type StockEffect =
  | {
      ok: true;
      operation: StockOperation;
      nextState: StockStateValue;
    }
  | { ok: false; code: "INVALID_STOCK_STATE" };

function validateLine(line: ReservationLine): void {
  if (typeof line.sku !== "string" || line.sku.trim() === "") {
    throw new Error("Reservation line SKU is required.");
  }

  if (!Number.isSafeInteger(line.cases) || line.cases < 1) {
    throw new Error("Reservation line cases must be a positive integer.");
  }
}

export function planStockReservation(
  lines: readonly ReservationLine[],
  inventory: ReadonlyMap<string, InventoryPosition>,
): StockReservationPlan {
  const requested = new Map<string, number>();

  for (const line of lines) {
    validateLine(line);
    requested.set(line.sku, (requested.get(line.sku) ?? 0) + line.cases);
  }

  const shortages: StockShortage[] = [];
  const reservations: ReservationLine[] = [];

  for (const sku of [...requested.keys()].sort()) {
    const cases = requested.get(sku) ?? 0;
    const position = inventory.get(sku);
    const availableCases = position
      ? Math.max(0, position.stockCases - position.reservedCases)
      : 0;

    if (cases > availableCases) {
      shortages.push({
        sku,
        requestedCases: cases,
        availableCases,
      });
      continue;
    }

    reservations.push({ sku, cases });
  }

  if (shortages.length > 0) {
    return { ok: false, shortages };
  }

  return { ok: true, reservations };
}

export function stockEffectForTransition(
  from: OrderStatusValue,
  to: OrderStatusValue,
  current: StockStateValue,
): StockEffect {
  void from;

  switch (to) {
    case "APPROVED":
      if (current === "DEDUCTED") {
        return { ok: false, code: "INVALID_STOCK_STATE" };
      }

      if (current === "RESERVED") {
        return { ok: true, operation: "NONE", nextState: "RESERVED" };
      }

      return { ok: true, operation: "RESERVE", nextState: "RESERVED" };

    case "REJECTED":
    case "CANCELLED":
      if (current === "DEDUCTED") {
        return { ok: false, code: "INVALID_STOCK_STATE" };
      }

      if (current === "RESERVED") {
        return { ok: true, operation: "RELEASE", nextState: "RELEASED" };
      }

      return { ok: true, operation: "NONE", nextState: current };

    case "DISPATCHED":
      if (current === "RESERVED") {
        return { ok: true, operation: "DEDUCT", nextState: "DEDUCTED" };
      }

      if (current === "DEDUCTED") {
        return { ok: true, operation: "NONE", nextState: "DEDUCTED" };
      }

      return { ok: false, code: "INVALID_STOCK_STATE" };

    case "DELIVERED":
      if (current !== "DEDUCTED") {
        return { ok: false, code: "INVALID_STOCK_STATE" };
      }

      return { ok: true, operation: "NONE", nextState: "DEDUCTED" };

    default:
      return { ok: true, operation: "NONE", nextState: current };
  }
}

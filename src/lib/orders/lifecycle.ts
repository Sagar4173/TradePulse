import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/lib/auth/types";
import { getPrismaClient } from "@/lib/db";
import { paiseToDecimalString, parseMoneyToPaise } from "@/lib/money";

import type { OrderActionCode, CheckoutShortage } from "./action-types";
import { assessCredit, CREDIT_EXPOSURE_STATUSES } from "./credit";
import { planStockReservation, stockEffectForTransition } from "./stock";
import type { OrderAction } from "./transitions";
import {
  ACTION_TARGET_STATUS,
  actionRequiresReason,
  canPerformAction,
  isTransitionAllowed,
} from "./transitions";
import {
  isOrderStatus,
  isStockState,
  type OrderStatusValue,
  type StockStateValue,
} from "./status";
import type { ReservationLine, StockOperation } from "./stock";
import { withSerializableRetry } from "./transaction";

export type OrderTransitionActor = {
  userId: string;
  role: Role;
  retailerId: string | null;
};

export type OrderTransitionResult =
  | {
      ok: true;
      code: "UPDATED" | "ALREADY_APPLIED";
      orderId: string;
      orderNumber: string;
      previousStatus: string;
      status: string;
      stockState: string;
    }
  | {
      ok: false;
      code: OrderActionCode;
      message: string;
      shortages?: CheckoutShortage[];
    };

type LockedOrder = {
  id: string;
  orderNumber: string;
  status: string;
  stockState: string;
  retailerId: string;
  total: string;
};

type LockedInventory = {
  productSku: string;
  stockCases: number;
  reservedCases: number;
};

const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_REASON_LENGTH = 500;

class StockConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockConflictError";
  }
}

function failure(
  code: OrderActionCode,
  message: string,
  shortages?: CheckoutShortage[],
): OrderTransitionResult {
  return { ok: false, code, message, ...(shortages ? { shortages } : {}) };
}

function messageFor(code: OrderActionCode): string {
  switch (code) {
    case "INVALID_TRANSITION":
      return "That action is not allowed from the order's current status.";
    case "REASON_REQUIRED":
      return "A reason is required for this action.";
    case "CREDIT_LIMIT_EXCEEDED":
      return "The retailer's open-order exposure would exceed the credit limit.";
    case "INSUFFICIENT_STOCK":
      return "Stock is no longer available to reserve this order.";
    case "INVALID_STOCK_STATE":
      return "The order's stock reservation is not in a state that allows this action.";
    case "NOT_FOUND":
      return "This order does not exist in your authorized scope.";
    case "UNAUTHORIZED":
      return "Sign in again to manage this order.";
    case "FORBIDDEN":
      return "Your role cannot perform this action.";
    case "UNKNOWN":
      return "The order could not be updated. Please try again.";
    default:
      return "The order could not be updated.";
  }
}

const ACTION_EVENT_TYPES: Record<OrderAction, string> = {
  APPROVE: "ORDER_APPROVED",
  REJECT: "ORDER_REJECTED",
  CANCEL: "ORDER_CANCELLED",
  START_PROCESSING: "ORDER_PROCESSING_STARTED",
  MARK_READY: "ORDER_READY_FOR_DISPATCH",
  DISPATCH: "ORDER_DISPATCHED",
  DELIVER: "ORDER_DELIVERED",
};

const STOCK_EVENT_TYPES: Record<
  Exclude<StockOperation, "NONE">,
  string
> = {
  RESERVE: "ORDER_STOCK_RESERVED",
  RELEASE: "ORDER_STOCK_RELEASED",
  DEDUCT: "ORDER_STOCK_DEDUCTED",
};

function normalizeReason(reason: string | null | undefined): string {
  return typeof reason === "string"
    ? reason.trim().slice(0, MAX_REASON_LENGTH)
    : "";
}

function reservationLines(
  items: ReadonlyArray<{
    productSku: string;
    quantity: number;
    freeQuantity: number;
  }>,
): ReservationLine[] {
  const merged = new Map<string, number>();

  for (const item of items) {
    const cases = item.quantity + item.freeQuantity;

    if (cases <= 0) {
      continue;
    }

    merged.set(item.productSku, (merged.get(item.productSku) ?? 0) + cases);
  }

  return [...merged.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([sku, cases]) => ({ sku, cases }));
}

async function lockOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<LockedOrder | null> {
  const rows = await tx.$queryRaw<LockedOrder[]>`
    SELECT
      "id",
      "orderNumber",
      "status"::text AS "status",
      "stockState"::text AS "stockState",
      "retailerId",
      "total"::text AS "total"
    FROM "Order"
    WHERE "id" = ${orderId}
    FOR UPDATE
  `;

  return rows[0] ?? null;
}

async function lockInventory(
  tx: Prisma.TransactionClient,
  lines: readonly ReservationLine[],
): Promise<Map<string, LockedInventory>> {
  const skus = lines.map((line) => line.sku);

  if (skus.length === 0) {
    return new Map();
  }

  const rows = await tx.$queryRaw<LockedInventory[]>`
    SELECT "productSku", "stockCases", "reservedCases"
    FROM "Inventory"
    WHERE "productSku" IN (${Prisma.join(skus)})
    ORDER BY "productSku"
    FOR UPDATE
  `;

  return new Map(rows.map((row) => [row.productSku, row]));
}

function valuesClause(lines: readonly ReservationLine[]): Prisma.Sql {
  return Prisma.join(
    lines.map(
      (line) => Prisma.sql`(${line.sku}::text, ${line.cases}::integer)`,
    ),
  );
}

/**
 * Reserves paid and free cases together. The inventory rows are locked in SKU
 * order, planned with the pure stock rule, and then updated by one conditional
 * statement. Any row-count mismatch rolls the whole transaction back, so a
 * partial reservation can never commit.
 */
async function reserveStock(
  tx: Prisma.TransactionClient,
  lines: readonly ReservationLine[],
): Promise<
  { ok: true; reservations: ReservationLine[] } | { ok: false; shortages: CheckoutShortage[] }
> {
  if (lines.length === 0) {
    return { ok: false, shortages: [] };
  }

  const inventory = await lockInventory(tx, lines);
  const plan = planStockReservation(lines, inventory);

  if (!plan.ok) {
    return plan;
  }

  const updated = await tx.$executeRaw(
    Prisma.sql`
      UPDATE "Inventory" AS inventory
      SET
        "reservedCases" = inventory."reservedCases" + value.cases,
        "updatedAt" = CURRENT_TIMESTAMP
      FROM (VALUES ${valuesClause(plan.reservations)}) AS value(sku, cases)
      WHERE
        inventory."productSku" = value.sku
        AND inventory."stockCases" - inventory."reservedCases" >= value.cases
    `,
  );

  if (updated !== plan.reservations.length) {
    throw new StockConflictError(
      "The stock reservation could not be applied to every line.",
    );
  }

  return { ok: true, reservations: plan.reservations };
}

async function releaseStock(
  tx: Prisma.TransactionClient,
  lines: readonly ReservationLine[],
): Promise<void> {
  if (lines.length === 0) {
    throw new StockConflictError("A reserved order must have at least one line.");
  }

  const inventory = await lockInventory(tx, lines);

  for (const line of lines) {
    const position = inventory.get(line.sku);

    if (!position || position.reservedCases < line.cases) {
      throw new StockConflictError(
        `The reservation for ${line.sku} cannot be released exactly once.`,
      );
    }
  }

  const updated = await tx.$executeRaw(
    Prisma.sql`
      UPDATE "Inventory" AS inventory
      SET
        "reservedCases" = inventory."reservedCases" - value.cases,
        "updatedAt" = CURRENT_TIMESTAMP
      FROM (VALUES ${valuesClause(lines)}) AS value(sku, cases)
      WHERE
        inventory."productSku" = value.sku
        AND inventory."reservedCases" >= value.cases
    `,
  );

  if (updated !== lines.length) {
    throw new StockConflictError(
      "The stock reservation could not be released for every line.",
    );
  }
}

async function deductStock(
  tx: Prisma.TransactionClient,
  lines: readonly ReservationLine[],
): Promise<void> {
  if (lines.length === 0) {
    throw new StockConflictError("A dispatched order must have at least one line.");
  }

  const inventory = await lockInventory(tx, lines);

  for (const line of lines) {
    const position = inventory.get(line.sku);

    if (
      !position ||
      position.reservedCases < line.cases ||
      position.stockCases < line.cases
    ) {
      throw new StockConflictError(
        `The reservation for ${line.sku} cannot be deducted exactly once.`,
      );
    }
  }

  const updated = await tx.$executeRaw(
    Prisma.sql`
      UPDATE "Inventory" AS inventory
      SET
        "stockCases" = inventory."stockCases" - value.cases,
        "reservedCases" = inventory."reservedCases" - value.cases,
        "updatedAt" = CURRENT_TIMESTAMP
      FROM (VALUES ${valuesClause(lines)}) AS value(sku, cases)
      WHERE
        inventory."productSku" = value.sku
        AND inventory."stockCases" >= value.cases
        AND inventory."reservedCases" >= value.cases
    `,
  );

  if (updated !== lines.length) {
    throw new StockConflictError(
      "The stock deduction could not be applied to every line.",
    );
  }
}

async function loadReservationLines(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<ReservationLine[]> {
  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: {
      productSku: true,
      quantity: true,
      freeQuantity: true,
    },
  });

  return reservationLines(items);
}

/**
 * Rechecks both credit and stock before a credit-held order is approved. The
 * retailer row is locked so concurrent submissions and hold releases serialize
 * their exposure calculation. The current order is excluded from existing
 * exposure because its total is added explicitly by `assessCredit`.
 */
async function releaseCreditHold(
  tx: Prisma.TransactionClient,
  order: LockedOrder,
  actorId: string,
  now: Date,
): Promise<
  | {
      ok: true;
      creditLimitPaise: bigint;
      projectedExposurePaise: bigint;
      reservations: ReservationLine[];
    }
  | {
      ok: false;
      code: "CREDIT_LIMIT_EXCEEDED" | "INSUFFICIENT_STOCK";
      shortages?: CheckoutShortage[];
    }
> {
  const retailerRows = await tx.$queryRaw<Array<{ creditLimit: string }>>`
    SELECT "creditLimit"::text AS "creditLimit"
    FROM "Retailer"
    WHERE "id" = ${order.retailerId}
    FOR UPDATE
  `;

  if (retailerRows.length === 0) {
    return { ok: false, code: "CREDIT_LIMIT_EXCEEDED" };
  }

  const creditLimitPaise = parseMoneyToPaise(retailerRows[0]!.creditLimit);
  const exposureRows = await tx.order.aggregate({
    where: {
      retailerId: order.retailerId,
      status: { in: [...CREDIT_EXPOSURE_STATUSES] },
      id: { not: order.id },
    },
    _sum: { total: true },
  });
  const assessment = assessCredit({
    creditLimitPaise,
    openExposurePaise: parseMoneyToPaise(exposureRows._sum.total ?? "0"),
    orderTotalPaise: parseMoneyToPaise(order.total),
  });

  if (!assessment.passed) {
    const shortfall =
      assessment.projectedExposurePaise - creditLimitPaise;

    await tx.order.update({
      where: { id: order.id },
      data: {
        creditCheckStatus: "FAILED",
        creditLimitSnapshot: paiseToDecimalString(creditLimitPaise),
        creditOutstandingSnapshot: paiseToDecimalString(
          assessment.projectedExposurePaise,
        ),
        creditHoldReason: `Projected open-order exposure ${paiseToDecimalString(
          assessment.projectedExposurePaise,
        )} exceeds the credit limit ${paiseToDecimalString(creditLimitPaise)}.`,
        creditCheckedAt: now,
      },
    });

    await tx.auditEvent.create({
      data: {
        eventType: "ORDER_CREDIT_RECHECK_FAILED",
        entityType: "Order",
        entityId: order.id,
        actorId,
        metadata: {
          orderNumber: order.orderNumber,
          previousStatus: order.status,
          creditLimit: paiseToDecimalString(creditLimitPaise),
          projectedExposure: paiseToDecimalString(
            assessment.projectedExposurePaise,
          ),
          shortfall: paiseToDecimalString(shortfall),
        },
      },
    });

    return { ok: false, code: "CREDIT_LIMIT_EXCEEDED" };
  }

  const lines = await loadReservationLines(tx, order.id);
  const reservation = await reserveStock(tx, lines);

  if (!reservation.ok) {
    // Credit now passes, but the order still cannot be approved because stock
    // is unavailable. Keep the order on hold and store the current credit
    // snapshot so the screen does not show a stale credit failure.
    await tx.order.update({
      where: { id: order.id },
      data: {
        creditCheckStatus: "PASSED",
        creditLimitSnapshot: paiseToDecimalString(creditLimitPaise),
        creditOutstandingSnapshot: paiseToDecimalString(
          assessment.projectedExposurePaise,
        ),
        creditHoldReason:
          "Credit is within the limit, but stock is no longer available for one or more lines.",
        creditCheckedAt: now,
      },
    });

    await tx.auditEvent.create({
      data: {
        eventType: "ORDER_STOCK_UNAVAILABLE",
        entityType: "Order",
        entityId: order.id,
        actorId,
        metadata: {
          orderNumber: order.orderNumber,
          previousStatus: order.status,
          shortages: reservation.shortages,
        },
      },
    });

    return {
      ok: false,
      code: "INSUFFICIENT_STOCK",
      shortages: reservation.shortages,
    };
  }

  return {
    ok: true,
    creditLimitPaise,
    projectedExposurePaise: assessment.projectedExposurePaise,
    reservations: reservation.reservations,
  };
}

async function performTransition(
  tx: Prisma.TransactionClient,
  input: {
    actor: OrderTransitionActor;
    orderId: string;
    action: OrderAction;
    reason: string;
    now: Date;
  },
): Promise<OrderTransitionResult> {
  const order = await lockOrder(tx, input.orderId);

  if (!order) {
    return failure("NOT_FOUND", messageFor("NOT_FOUND"));
  }

  if (
    input.actor.role === "RETAILER" &&
    order.retailerId !== input.actor.retailerId
  ) {
    return failure("NOT_FOUND", messageFor("NOT_FOUND"));
  }

  if (!isOrderStatus(order.status) || !isStockState(order.stockState)) {
    return failure("INVALID_STOCK_STATE", messageFor("INVALID_STOCK_STATE"));
  }

  const from: OrderStatusValue = order.status;
  const currentStock = order.stockState as StockStateValue;
  const target = ACTION_TARGET_STATUS[input.action];

  // Role authorization is checked before the idempotent "already applied"
  // branch, so a retailer can never receive a success response for an approval
  // action even when the order happens to be approved already.
  if (input.actor.role === "SALESMAN") {
    return failure("FORBIDDEN", messageFor("FORBIDDEN"));
  }

  if (input.actor.role === "RETAILER" && input.action !== "CANCEL") {
    return failure("FORBIDDEN", messageFor("FORBIDDEN"));
  }

  if (from === target) {
    return {
      ok: true,
      code: "ALREADY_APPLIED",
      orderId: order.id,
      orderNumber: order.orderNumber,
      previousStatus: from,
      status: from,
      stockState: currentStock,
    };
  }

  if (!isTransitionAllowed(from, target)) {
    return failure("INVALID_TRANSITION", messageFor("INVALID_TRANSITION"));
  }

  if (!canPerformAction(input.actor.role, from, input.action)) {
    return failure("FORBIDDEN", messageFor("FORBIDDEN"));
  }

  const auditEvents: Prisma.AuditEventCreateManyInput[] = [];
  const isCreditHoldRelease =
    input.action === "APPROVE" && from === "ON_CREDIT_HOLD";
  let creditSnapshot:
    | { creditLimitPaise: bigint; projectedExposurePaise: bigint }
    | null = null;
  let nextStock: StockStateValue = currentStock;

  if (isCreditHoldRelease) {
    // A held order should have no reservation. Refusing a reserved or deducted
    // state protects against double reservation if data was altered outside
    // the lifecycle service.
    if (currentStock === "RESERVED" || currentStock === "DEDUCTED") {
      return failure("INVALID_STOCK_STATE", messageFor("INVALID_STOCK_STATE"));
    }

    const released = await releaseCreditHold(
      tx,
      order,
      input.actor.userId,
      input.now,
    );

    if (!released.ok) {
      return failure(
        released.code,
        messageFor(released.code),
        released.shortages,
      );
    }

    creditSnapshot = {
      creditLimitPaise: released.creditLimitPaise,
      projectedExposurePaise: released.projectedExposurePaise,
    };
    nextStock = "RESERVED";

    auditEvents.push({
      eventType: STOCK_EVENT_TYPES.RESERVE,
      entityType: "Order",
      entityId: order.id,
      actorId: input.actor.userId,
      metadata: {
        orderNumber: order.orderNumber,
        previousStatus: from,
        status: target,
        reservations: released.reservations,
      },
    });
  } else {
    const effect = stockEffectForTransition(from, target, currentStock);

    if (!effect.ok) {
      return failure("INVALID_STOCK_STATE", messageFor("INVALID_STOCK_STATE"));
    }

    nextStock = effect.nextState;

    if (effect.operation !== "NONE") {
      const lines = await loadReservationLines(tx, order.id);

      if (effect.operation === "RESERVE") {
        const reservation = await reserveStock(tx, lines);

        if (!reservation.ok) {
          await tx.auditEvent.create({
            data: {
              eventType: "ORDER_STOCK_UNAVAILABLE",
              entityType: "Order",
              entityId: order.id,
              actorId: input.actor.userId,
              metadata: {
                orderNumber: order.orderNumber,
                previousStatus: from,
                status: target,
                shortages: reservation.shortages,
              },
            },
          });

          return failure(
            "INSUFFICIENT_STOCK",
            messageFor("INSUFFICIENT_STOCK"),
            reservation.shortages,
          );
        }

        auditEvents.push({
          eventType: STOCK_EVENT_TYPES.RESERVE,
          entityType: "Order",
          entityId: order.id,
          actorId: input.actor.userId,
          metadata: {
            orderNumber: order.orderNumber,
            previousStatus: from,
            status: target,
            reservations: reservation.reservations,
          },
        });
      } else if (effect.operation === "RELEASE") {
        await releaseStock(tx, lines);
        auditEvents.push({
          eventType: STOCK_EVENT_TYPES.RELEASE,
          entityType: "Order",
          entityId: order.id,
          actorId: input.actor.userId,
          metadata: {
            orderNumber: order.orderNumber,
            previousStatus: from,
            status: target,
            reservations: lines,
          },
        });
      } else if (effect.operation === "DEDUCT") {
        await deductStock(tx, lines);
        auditEvents.push({
          eventType: STOCK_EVENT_TYPES.DEDUCT,
          entityType: "Order",
          entityId: order.id,
          actorId: input.actor.userId,
          metadata: {
            orderNumber: order.orderNumber,
            previousStatus: from,
            status: target,
            reservations: lines,
          },
        });
      }
    }
  }

  await tx.order.update({
    where: { id: order.id },
    data: {
      status: target,
      stockState: nextStock,
      ...(input.action === "REJECT" || input.action === "CANCEL"
        ? { statusReason: input.reason }
        : {}),
      ...(isCreditHoldRelease && creditSnapshot
        ? {
            creditCheckStatus: "PASSED",
            creditLimitSnapshot: paiseToDecimalString(
              creditSnapshot.creditLimitPaise,
            ),
            creditOutstandingSnapshot: paiseToDecimalString(
              creditSnapshot.projectedExposurePaise,
            ),
            creditHoldReason: null,
            creditCheckedAt: input.now,
            statusReason: null,
          }
        : {}),
    },
  });

  if (isCreditHoldRelease && creditSnapshot) {
    auditEvents.unshift({
      eventType: "ORDER_CREDIT_HOLD_RELEASED",
      entityType: "Order",
      entityId: order.id,
      actorId: input.actor.userId,
      metadata: {
        orderNumber: order.orderNumber,
        previousStatus: from,
        status: target,
        creditLimit: paiseToDecimalString(creditSnapshot.creditLimitPaise),
        projectedExposure: paiseToDecimalString(
          creditSnapshot.projectedExposurePaise,
        ),
      },
    });
  }

  auditEvents.push({
    eventType: ACTION_EVENT_TYPES[input.action],
    entityType: "Order",
    entityId: order.id,
    actorId: input.actor.userId,
    metadata: {
      orderNumber: order.orderNumber,
      previousStatus: from,
      status: target,
      stockState: nextStock,
      ...(input.reason ? { reason: input.reason } : {}),
    },
  });

  await tx.auditEvent.createMany({ data: auditEvents });

  return {
    ok: true,
    code: "UPDATED",
    orderId: order.id,
    orderNumber: order.orderNumber,
    previousStatus: from,
    status: target,
    stockState: nextStock,
  };
}

/**
 * Applies one order lifecycle action.
 *
 * The order row is locked `FOR UPDATE`, so two operators cannot apply
 * conflicting transitions at the same time. Repeating the action that already
 * produced the current status returns `ALREADY_APPLIED` without touching stock
 * or writing another audit event. Stock effects are conditional single
 * statements and any mismatch rolls the transaction back.
 */
export async function transitionOrder(input: {
  actor: OrderTransitionActor;
  orderId: string;
  action: OrderAction;
  reason?: string | null;
  now?: Date;
}): Promise<OrderTransitionResult> {
  const reason = normalizeReason(input.reason);

  if (!ORDER_ID_PATTERN.test(input.orderId)) {
    return failure("NOT_FOUND", messageFor("NOT_FOUND"));
  }

  if (actionRequiresReason(input.action) && reason.length < 3) {
    return failure("REASON_REQUIRED", messageFor("REASON_REQUIRED"));
  }

  const now = input.now ?? new Date();

  try {
    return await withSerializableRetry(() =>
      getPrismaClient().$transaction(
        (tx) =>
          performTransition(tx, {
            actor: input.actor,
            orderId: input.orderId,
            action: input.action,
            reason,
            now,
          }),
        { isolationLevel: "Serializable" },
      ),
    );
  } catch (error) {
    if (error instanceof StockConflictError) {
      return failure("INVALID_STOCK_STATE", messageFor("INVALID_STOCK_STATE"));
    }

    return failure("UNKNOWN", messageFor("UNKNOWN"));
  }
}

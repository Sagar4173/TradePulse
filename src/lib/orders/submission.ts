import "server-only";

import type { Role } from "@/lib/auth/types";
import { fetchCartProducts } from "@/lib/cart/repository";
import { calculateCart } from "@/lib/cart/calc";
import type { CartLineInput } from "@/lib/cart/cookie";
import type { CheckoutLineChange, CheckoutReview } from "@/lib/orders/checkout";
import {
  buildCheckoutFingerprint,
  compareCheckoutReview,
} from "@/lib/orders/checkout";
import {
  assessCredit,
  CREDIT_EXPOSURE_STATUSES,
} from "@/lib/orders/credit";
import { formatOrderNumber } from "@/lib/orders/order-number";
import { planStockReservation } from "@/lib/orders/stock";
import { withSerializableRetry } from "@/lib/orders/transaction";
import type { CheckoutActionCode, CheckoutShortage } from "./action-types";
import { getPrismaClient } from "@/lib/db";
import {
  paiseToDecimalString,
  parseMoneyToPaise,
} from "@/lib/money";
import { isPrismaErrorCode } from "@/lib/orders/transaction";

export type SubmitOrderActor = {
  userId: string;
  role: Role;
  retailerId: string | null;
};

export type SubmitOrderResult =
  | {
      ok: true;
      orderId: string;
      orderNumber: string;
      status: string;
      duplicate: boolean;
    }
  | {
      ok: false;
      code: CheckoutActionCode;
      message?: string;
      changes?: CheckoutLineChange[];
      shortages?: CheckoutShortage[];
    };

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

class StockReservationError extends Error {
  constructor(
    readonly sku: string,
    readonly cases: number,
  ) {
    super(`Stock reservation failed for ${sku}.`);
    this.name = "StockReservationError";
  }
}

function holdReason(projectedPaise: bigint, limitPaise: bigint): string {
  return `Projected open-order exposure ${paiseToDecimalString(
    projectedPaise,
  )} exceeds the credit limit ${paiseToDecimalString(limitPaise)}.`;
}

function messageFor(code: CheckoutActionCode): string | undefined {
  switch (code) {
    case "CART_EMPTY":
      return "Your cart is empty.";
    case "CART_CHANGED":
      return "Prices, schemes, or stock changed since you reviewed the cart. Review the updated cart before placing the order.";
    case "CART_HAS_ISSUES":
      return "One or more cart lines need attention before this order can be placed.";
    case "INVALID_REVIEW":
      return "The cart review has expired. Reload the cart and try again.";
    case "INVALID_REQUEST":
      return "The checkout request is not valid. Reload the cart and try again.";
    case "INSUFFICIENT_STOCK":
      return "Stock is no longer available for one or more lines. Review the updated cart.";
    case "UNAUTHORIZED":
      return "Sign in again to place this order.";
    case "FORBIDDEN":
      return "This account cannot place orders for the selected retailer.";
    case "UNKNOWN":
      return "The order could not be placed. No order was created; please try again.";
    default:
      return undefined;
  }
}

function checkoutLines(summaryLines: ReturnType<typeof calculateCart>["lines"]) {
  return summaryLines.filter(
    (line) => line.unitPricePaise !== null && line.gstRateBasisPoints !== null,
  );
}

async function currentShortages(
  retailerId: string,
  lines: readonly CartLineInput[],
  now: Date,
): Promise<CheckoutShortage[]> {
  try {
    const products = await fetchCartProducts(
      retailerId,
      lines.map((line) => line.sku),
    );
    const summary = calculateCart(
      lines,
      new Map(products.map((product) => [product.sku, product])),
      now,
    );
    const positions = new Map(
      summary.lines.map((line) => [
        line.sku,
        {
          stockCases: line.availableCases ?? 0,
          reservedCases: 0,
        },
      ]),
    );
    const plan = planStockReservation(
      summary.lines.map((line) => ({
        sku: line.sku,
        cases: line.paidQuantity + line.freeQuantity,
      })),
      positions,
    );

    return plan.ok ? [] : plan.shortages;
  } catch {
    return [];
  }
}

export async function submitOrder(input: {
  actor: SubmitOrderActor;
  lines: readonly CartLineInput[];
  idempotencyKey: string;
  review: CheckoutReview | null;
  now?: Date;
}): Promise<SubmitOrderResult> {
  const { actor, lines, idempotencyKey, review } = input;
  const now = input.now ?? new Date();
  const retailerId = actor.retailerId;

  if (
    actor.role !== "RETAILER" ||
    !retailerId
  ) {
    return { ok: false, code: "FORBIDDEN", message: messageFor("FORBIDDEN") };
  }

  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return {
      ok: false,
      code: "INVALID_REQUEST",
      message: messageFor("INVALID_REQUEST"),
    };
  }

  // The duplicate lookup must happen before the empty-cart check. A successful
  // submission clears the cart cookie, so replaying the same reviewed form
  // afterwards must still return the order that was already created.
  const existing = await getPrismaClient().order.findUnique({
    where: { retailerId_idempotencyKey: { retailerId, idempotencyKey } },
    select: { id: true, orderNumber: true, status: true },
  });

  if (existing) {
    return {
      ok: true,
      orderId: existing.id,
      orderNumber: existing.orderNumber,
      status: existing.status,
      duplicate: true,
    };
  }

  if (lines.length === 0) {
    return { ok: false, code: "CART_EMPTY", message: messageFor("CART_EMPTY") };
  }

  try {
    return await withSerializableRetry(() =>
      getPrismaClient().$transaction(
        async (tx) => {
          const duplicate = await tx.order.findUnique({
            where: {
              retailerId_idempotencyKey: { retailerId, idempotencyKey },
            },
            select: { id: true, orderNumber: true, status: true },
          });

          if (duplicate) {
            return {
              ok: true as const,
              orderId: duplicate.id,
              orderNumber: duplicate.orderNumber,
              status: duplicate.status,
              duplicate: true,
            };
          }

          const products = await fetchCartProducts(
            retailerId,
            lines.map((line) => line.sku),
            tx,
          );
          const summary = calculateCart(
            lines,
            new Map(products.map((product) => [product.sku, product])),
            now,
          );

          if (summary.unavailableSkus.length > 0) {
            return {
              ok: false as const,
              code: "CART_CHANGED" as const,
              message: messageFor("CART_CHANGED"),
              changes: review
                ? compareCheckoutReview(review, summary.lines)
                : undefined,
            };
          }

          if (!review) {
            return {
              ok: false as const,
              code: "INVALID_REVIEW" as const,
              message: messageFor("INVALID_REVIEW"),
            };
          }

          const currentFingerprint = buildCheckoutFingerprint(summary.lines);

          if (currentFingerprint !== review.fingerprint) {
            const changes = compareCheckoutReview(review, summary.lines);
            return {
              ok: false as const,
              code: "CART_CHANGED" as const,
              message: messageFor("CART_CHANGED"),
              changes,
            };
          }

          if (summary.hasIssues) {
            return {
              ok: false as const,
              code: "CART_HAS_ISSUES" as const,
              message: messageFor("CART_HAS_ISSUES"),
            };
          }

          const orderableLines = checkoutLines(summary.lines);

          if (orderableLines.length !== summary.lines.length) {
            return {
              ok: false as const,
              code: "CART_HAS_ISSUES" as const,
              message: messageFor("CART_HAS_ISSUES"),
            };
          }

          const retailerRows = await tx.$queryRaw<
            Array<{ creditLimit: string }>
          >`
            SELECT "creditLimit"::text AS "creditLimit"
            FROM "Retailer"
            WHERE "id" = ${retailerId}
            FOR UPDATE
          `;

          if (retailerRows.length === 0) {
            return {
              ok: false as const,
              code: "FORBIDDEN" as const,
              message: messageFor("FORBIDDEN"),
            };
          }

          const creditLimitPaise = parseMoneyToPaise(
            retailerRows[0]!.creditLimit,
          );
          const exposureRows = await tx.order.aggregate({
            where: {
              retailerId,
              status: { in: [...CREDIT_EXPOSURE_STATUSES] },
            },
            _sum: { total: true },
          });
          const openExposurePaise = parseMoneyToPaise(
            exposureRows._sum.total ?? "0",
          );
          const assessment = assessCredit({
            creditLimitPaise,
            openExposurePaise,
            orderTotalPaise: summary.totalPaise,
          });

          const positions = new Map(
            products.map((product) => [
              product.sku,
              {
                stockCases: product.stock.availableCases ?? 0,
                reservedCases: 0,
              },
            ]),
          );
          const reservationPlan = assessment.passed
            ? planStockReservation(
                orderableLines.map((line) => ({
                  sku: line.sku,
                  cases: line.paidQuantity + line.freeQuantity,
                })),
                positions,
              )
            : null;

          if (reservationPlan && !reservationPlan.ok) {
            return {
              ok: false as const,
              code: "INSUFFICIENT_STOCK" as const,
              message: messageFor("INSUFFICIENT_STOCK"),
              shortages: reservationPlan.shortages,
            };
          }

          const sequenceRows = await tx.$queryRaw<Array<{ value: bigint }>>`
            SELECT nextval('order_number_seq')::bigint AS value
          `;
          const sequenceValue = sequenceRows[0]?.value;

          if (sequenceValue === undefined) {
            throw new Error("Order number sequence did not return a value.");
          }

          const orderNumber = formatOrderNumber(now, Number(sequenceValue));
          const total = paiseToDecimalString(summary.totalPaise);
          const hold = assessment.passed
            ? null
            : holdReason(
                assessment.projectedExposurePaise,
                creditLimitPaise,
              );

          const order = await tx.order.create({
            data: {
              orderNumber,
              retailerId,
              createdById: actor.userId,
              idempotencyKey,
              status: assessment.passed
                ? "PENDING_REVIEW"
                : "ON_CREDIT_HOLD",
              creditCheckStatus: assessment.passed ? "PASSED" : "FAILED",
              creditLimitSnapshot: paiseToDecimalString(creditLimitPaise),
              creditOutstandingSnapshot: paiseToDecimalString(
                assessment.projectedExposurePaise,
              ),
              creditHoldReason: hold,
              creditCheckedAt: now,
              stockState: "NONE",
              subtotal: paiseToDecimalString(summary.subtotalPaise),
              discount: paiseToDecimalString(summary.discountPaise),
              gstAmount: paiseToDecimalString(summary.gstPaise),
              total,
              source: "MANUAL",
              items: {
                create: orderableLines.map((line) => ({
                  productSku: line.sku,
                  productName: line.name,
                  unitLabel: line.unitLabel,
                  quantity: line.paidQuantity,
                  freeQuantity: line.freeQuantity,
                  schemeId: line.scheme?.schemeId ?? null,
                  schemeName: line.schemeName,
                  schemeType: line.scheme?.type ?? null,
                  schemeDiscountPercent:
                    line.schemeDiscountPercentBasisPoints === null
                      ? null
                      : paiseToDecimalString(
                          line.schemeDiscountPercentBasisPoints,
                        ),
                  unitPrice: paiseToDecimalString(
                    line.unitPricePaise as bigint,
                  ),
                  discount: paiseToDecimalString(line.discountPaise),
                  gstRate: paiseToDecimalString(
                    line.gstRateBasisPoints as bigint,
                  ),
                  gstAmount: paiseToDecimalString(line.gstPaise),
                  lineTotal: paiseToDecimalString(line.totalPaise),
                })),
              },
            },
            select: { id: true, orderNumber: true, status: true },
          });

          if (assessment.passed) {
            for (const reservation of reservationPlan!.ok
              ? reservationPlan!.reservations
              : []) {
              const updated = await tx.$executeRaw`
                UPDATE "Inventory"
                SET
                  "reservedCases" = "reservedCases" + ${reservation.cases},
                  "updatedAt" = CURRENT_TIMESTAMP
                WHERE
                  "productSku" = ${reservation.sku}
                  AND "stockCases" - "reservedCases" >= ${reservation.cases}
              `;

              if (updated !== 1) {
                throw new StockReservationError(
                  reservation.sku,
                  reservation.cases,
                );
              }
            }

            await tx.order.update({
              where: { id: order.id },
              data: { stockState: "RESERVED" },
            });
          }

          const freeCases = orderableLines.reduce(
            (totalFree, line) => totalFree + line.freeQuantity,
            0,
          );
          const itemCount = orderableLines.reduce(
            (count, line) => count + line.paidQuantity,
            0,
          );

          await tx.auditEvent.createMany({
            data: [
              {
                eventType: "ORDER_SUBMITTED",
                entityType: "Order",
                entityId: order.id,
                actorId: actor.userId,
                metadata: {
                  orderNumber,
                  status: assessment.passed
                    ? "PENDING_REVIEW"
                    : "ON_CREDIT_HOLD",
                  stockState: assessment.passed ? "RESERVED" : "NONE",
                  creditCheckStatus: assessment.passed
                    ? "PASSED"
                    : "FAILED",
                  itemCount,
                  freeCases,
                  total: paiseToDecimalString(summary.totalPaise),
                  projectedExposure: paiseToDecimalString(
                    assessment.projectedExposurePaise,
                  ),
                  creditLimit: paiseToDecimalString(creditLimitPaise),
                },
              },
              ...(assessment.passed
                ? [
                    {
                      eventType: "ORDER_STOCK_RESERVED",
                      entityType: "Order",
                      entityId: order.id,
                      actorId: actor.userId,
                      metadata: {
                        orderNumber,
                        reservations: reservationPlan!.ok
                          ? reservationPlan!.reservations
                          : [],
                      },
                    },
                  ]
                : [
                    {
                      eventType: "ORDER_CREDIT_HELD",
                      entityType: "Order",
                      entityId: order.id,
                      actorId: actor.userId,
                      metadata: {
                        orderNumber,
                        creditLimit: paiseToDecimalString(creditLimitPaise),
                        projectedExposure: paiseToDecimalString(
                          assessment.projectedExposurePaise,
                        ),
                        shortfall: paiseToDecimalString(
                          assessment.projectedExposurePaise - creditLimitPaise,
                        ),
                      },
                    },
                  ]),
            ],
          });

          return {
            ok: true as const,
            orderId: order.id,
            orderNumber: order.orderNumber,
            status: assessment.passed ? "PENDING_REVIEW" : "ON_CREDIT_HOLD",
            duplicate: false,
          };
        },
        { isolationLevel: "Serializable" },
      ),
    );
  } catch (error) {
    if (error instanceof StockReservationError) {
      return {
        ok: false,
        code: "INSUFFICIENT_STOCK",
        message: messageFor("INSUFFICIENT_STOCK"),
        shortages: await currentShortages(retailerId, lines, now),
      };
    }

    if (isPrismaErrorCode(error, "P2002")) {
      const duplicate = await getPrismaClient().order.findUnique({
        where: {
          retailerId_idempotencyKey: { retailerId, idempotencyKey },
        },
        select: { id: true, orderNumber: true, status: true },
      });

      if (duplicate) {
        return {
          ok: true,
          orderId: duplicate.id,
          orderNumber: duplicate.orderNumber,
          status: duplicate.status,
          duplicate: true,
        };
      }
    }

    return { ok: false, code: "UNKNOWN", message: messageFor("UNKNOWN") };
  }
}

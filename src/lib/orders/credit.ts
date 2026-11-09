/**
 * Open-order credit exposure for TradePulse.
 *
 * Exact calculation
 * -----------------
 * Exposure is the sum of the `total` value of every order whose status is one
 * of `CREDIT_EXPOSURE_STATUSES`. `DRAFT` orders have not been submitted,
 * `REJECTED` orders never consumed credit, and `CANCELLED` orders have released
 * it, so those three are excluded.
 *
 * `ON_CREDIT_HOLD` is deliberately included. A credit-held order still
 * represents requested commercial exposure; excluding it would let a retailer
 * accumulate unlimited held orders and repeatedly pass the check.
 *
 * A new order's projected exposure is:
 *
 *   existing exposure (excluding the order being checked)
 *   + the new order's server-calculated total
 *
 * The order passes when projected exposure is less than or equal to the
 * retailer's credit limit. All arithmetic is integer paise; floating point is
 * never used.
 *
 * `DELIVERED` and the legacy `FULFILLED` status remain in exposure because
 * Milestone 4 has no payment or invoice ledger. Removing delivered value
 * without a recorded payment would silently free credit that is still owed.
 */

export const CREDIT_EXPOSURE_STATUSES = [
  "PENDING_REVIEW",
  "ON_CREDIT_HOLD",
  "APPROVED",
  "PROCESSING",
  "READY_FOR_DISPATCH",
  "DISPATCHED",
  "DELIVERED",
  "FULFILLED",
] as const;

export type CreditExposureStatus = (typeof CREDIT_EXPOSURE_STATUSES)[number];

export type CreditExposureOrder = {
  status: string;
  totalPaise: bigint;
};

export type CreditAssessment = {
  passed: boolean;
  projectedExposurePaise: bigint;
  availableCreditPaise: bigint;
};

export function isCreditExposureStatus(
  status: string,
): status is CreditExposureStatus {
  return (CREDIT_EXPOSURE_STATUSES as readonly string[]).includes(status);
}

function requireNonNegative(value: bigint, label: string): void {
  if (value < 0n) {
    throw new Error(`${label} cannot be negative.`);
  }
}

export function sumOpenOrderExposure(
  orders: Iterable<CreditExposureOrder>,
): bigint {
  let exposure = 0n;

  for (const order of orders) {
    requireNonNegative(order.totalPaise, "Order total");

    if (isCreditExposureStatus(order.status)) {
      exposure += order.totalPaise;
    }
  }

  return exposure;
}

export function assessCredit(input: {
  creditLimitPaise: bigint;
  openExposurePaise: bigint;
  orderTotalPaise: bigint;
}): CreditAssessment {
  requireNonNegative(input.creditLimitPaise, "Credit limit");
  requireNonNegative(input.openExposurePaise, "Open exposure");
  requireNonNegative(input.orderTotalPaise, "Order total");

  const projectedExposurePaise =
    input.openExposurePaise + input.orderTotalPaise;
  const availableCreditPaise =
    input.creditLimitPaise > input.openExposurePaise
      ? input.creditLimitPaise - input.openExposurePaise
      : 0n;

  return {
    passed: projectedExposurePaise <= input.creditLimitPaise,
    projectedExposurePaise,
    availableCreditPaise,
  };
}

/**
 * Pure scheme evaluation for the retailer catalogue and cart.
 *
 * Rules enforced here:
 * - only active schemes inside their validity window;
 * - the configured minimum quantity must be met;
 * - at most one scheme per cart line — never stacked;
 * - `BUY_X_GET_Y` grants a free block for each completed multiple of the
 *   minimum quantity;
 * - `PERCENTAGE_DISCOUNT` discounts the line subtotal;
 * - malformed configuration is ignored rather than guessed.
 *
 * Stock limits are not known to this module. The cart service caps free units
 * against availability and explains any shortfall.
 */

import {
  MoneyValueError,
  multiplyByQuantity,
  parsePercentToBasisPoints,
  percentageOf,
} from "../money";

export type SchemeType = "BUY_X_GET_Y" | "PERCENTAGE_DISCOUNT";

type DecimalLike = { toString(): string } | string;

export type SchemeCandidate = {
  id: string;
  name?: string;
  type: SchemeType | string;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  minimumQuantity: number | null;
  freeQuantity: number | null;
  discountPercent: DecimalLike | null;
};

export type SchemeContext = {
  paidQuantity: number;
  unitPricePaise: bigint;
  now?: Date;
};

export type AppliedScheme = {
  schemeId: string;
  type: SchemeType;
  paidQuantity: number;
  freeQuantity: number;
  fulfilledQuantity: number;
  discountPaise: bigint;
};

export function isSchemeEligible(
  scheme: Pick<SchemeCandidate, "isActive" | "startsAt" | "endsAt">,
  now: Date,
): boolean {
  if (!scheme.isActive) {
    return false;
  }

  if (scheme.startsAt && scheme.startsAt.getTime() > now.getTime()) {
    return false;
  }

  if (scheme.endsAt && scheme.endsAt.getTime() < now.getTime()) {
    return false;
  }

  return true;
}

function positiveIntegerOrNull(value: number | null): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0
    ? (value as number)
    : null;
}

function evaluateBuyXGetY(
  scheme: SchemeCandidate,
  context: Required<SchemeContext>,
): AppliedScheme | null {
  const minimum = positiveIntegerOrNull(scheme.minimumQuantity);
  const freePerBlock = positiveIntegerOrNull(scheme.freeQuantity);

  if (minimum === null || freePerBlock === null) {
    return null;
  }

  if (context.paidQuantity < minimum) {
    return null;
  }

  const blocks = Math.floor(context.paidQuantity / minimum);
  const freeQuantity = blocks * freePerBlock;
  const discountPaise = multiplyByQuantity(
    context.unitPricePaise,
    freeQuantity,
  );

  if (freeQuantity === 0 || discountPaise === 0n) {
    return null;
  }

  return {
    schemeId: scheme.id,
    type: "BUY_X_GET_Y",
    paidQuantity: context.paidQuantity,
    freeQuantity,
    fulfilledQuantity: context.paidQuantity + freeQuantity,
    discountPaise,
  };
}

function evaluatePercentageDiscount(
  scheme: SchemeCandidate,
  context: Required<SchemeContext>,
): AppliedScheme | null {
  if (scheme.discountPercent === null) {
    return null;
  }

  const minimum = scheme.minimumQuantity ?? 1;

  if (!Number.isSafeInteger(minimum) || minimum < 1) {
    return null;
  }

  if (context.paidQuantity < minimum) {
    return null;
  }

  let basisPoints: bigint;

  try {
    basisPoints = parsePercentToBasisPoints(scheme.discountPercent);
  } catch (error) {
    if (error instanceof MoneyValueError) {
      return null;
    }

    throw error;
  }

  if (basisPoints === 0n) {
    return null;
  }

  const lineSubtotal = multiplyByQuantity(
    context.unitPricePaise,
    context.paidQuantity,
  );
  const discountPaise = percentageOf(lineSubtotal, basisPoints);

  if (discountPaise === 0n) {
    return null;
  }

  return {
    schemeId: scheme.id,
    type: "PERCENTAGE_DISCOUNT",
    paidQuantity: context.paidQuantity,
    freeQuantity: 0,
    fulfilledQuantity: context.paidQuantity,
    discountPaise,
  };
}

/**
 * Evaluates one scheme for one cart line. Returns null when the scheme is not
 * active, outside its window, below its minimum, malformed, or produces no
 * customer benefit.
 */
export function evaluateScheme(
  scheme: SchemeCandidate,
  context: SchemeContext,
): AppliedScheme | null {
  if (
    !Number.isSafeInteger(context.paidQuantity) ||
    context.paidQuantity < 1
  ) {
    return null;
  }

  const now = context.now ?? new Date();

  if (!isSchemeEligible(scheme, now)) {
    return null;
  }

  const resolved = { ...context, now };

  if (scheme.type === "BUY_X_GET_Y") {
    return evaluateBuyXGetY(scheme, resolved);
  }

  if (scheme.type === "PERCENTAGE_DISCOUNT") {
    return evaluatePercentageDiscount(scheme, resolved);
  }

  return null;
}

/**
 * Chooses the single most valuable eligible scheme. Ties are broken by scheme
 * id so the same cart always produces the same result.
 */
export function selectBestScheme(
  schemes: readonly SchemeCandidate[],
  context: SchemeContext,
): AppliedScheme | null {
  let best: AppliedScheme | null = null;
  const now = context.now ?? new Date();

  for (const scheme of schemes) {
    const applied = evaluateScheme(scheme, { ...context, now });

    if (!applied) {
      continue;
    }

    if (
      !best ||
      applied.discountPaise > best.discountPaise ||
      (applied.discountPaise === best.discountPaise &&
        applied.schemeId < best.schemeId)
    ) {
      best = applied;
    }
  }

  return best;
}

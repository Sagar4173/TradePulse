/**
 * Server-side cart calculation.
 *
 * This function never trusts a browser price, discount or total. It receives
 * only SKU and paid quantity, plus commercial data reloaded from the database
 * for the authenticated retailer, and recomputes every value with exact paise
 * arithmetic.
 */

import {
  MoneyValueError,
  multiplyByQuantity,
  parsePercentToBasisPoints,
  percentageOf,
} from "../money";
import { selectBestScheme, type AppliedScheme } from "../schemes/engine";
import {
  MAX_LINE_QUANTITY,
  type CartLineInput,
} from "./cookie";
import type {
  CartGstBreakdown,
  CartLineNotice,
  CartLineResult,
  CartPriceInput,
  CartSummary,
} from "./types";

function parseGstRate(value: { toString(): string } | string): bigint | null {
  try {
    return parsePercentToBasisPoints(value);
  } catch (error) {
    if (error instanceof MoneyValueError) {
      return null;
    }

    throw error;
  }
}

function addNotice(notices: CartLineNotice[], notice: CartLineNotice): void {
  if (!notices.includes(notice)) {
    notices.push(notice);
  }
}

function calculateLine(
  input: CartLineInput,
  product: CartPriceInput,
  now: Date,
): CartLineResult | null {
  if (
    !Number.isSafeInteger(input.quantity) ||
    input.quantity < 1 ||
    input.quantity > MAX_LINE_QUANTITY
  ) {
    return null;
  }

  const notices: CartLineNotice[] = [];
  const gstRateBasisPoints = parseGstRate(product.gstRate);
  const unitPricePaise = product.unitPricePaise;
  const availableCases = product.stock.availableCases;
  const requestedQuantity = input.quantity;
  let paidQuantity = requestedQuantity;

  if (unitPricePaise === null) {
    addNotice(notices, "PRICE_UNAVAILABLE");
  }

  if (gstRateBasisPoints === null) {
    addNotice(notices, "TAX_UNAVAILABLE");
  }

  if (availableCases === null) {
    addNotice(notices, "STOCK_UNAVAILABLE");
    paidQuantity = 0;
  } else if (availableCases === 0) {
    addNotice(notices, "OUT_OF_STOCK");
    paidQuantity = 0;
  } else if (paidQuantity > availableCases) {
    addNotice(notices, "STOCK_REDUCED");
    paidQuantity = availableCases;
  }

  let scheme: AppliedScheme | null = null;
  let freeQuantity = 0;

  if (unitPricePaise !== null && paidQuantity > 0) {
    scheme = selectBestScheme(product.schemes, {
      paidQuantity,
      unitPricePaise,
      now,
    });

    if (scheme && scheme.freeQuantity > 0) {
      freeQuantity = scheme.freeQuantity;

      if (
        availableCases !== null &&
        paidQuantity + freeQuantity > availableCases
      ) {
        const allowedFree = Math.max(0, availableCases - paidQuantity);
        addNotice(notices, "FREE_UNITS_REDUCED");

        if (allowedFree === 0) {
          scheme = null;
          freeQuantity = 0;
        } else {
          scheme = {
            ...scheme,
            freeQuantity: allowedFree,
            fulfilledQuantity: paidQuantity + allowedFree,
            discountPaise: multiplyByQuantity(
              unitPricePaise,
              allowedFree,
            ),
          };
          freeQuantity = allowedFree;
        }
      }
    }
  }

  const fulfilledQuantity = paidQuantity + freeQuantity;
  const priceAndTaxAvailable =
    unitPricePaise !== null && gstRateBasisPoints !== null;
  const appliedSchemeCandidate = scheme
    ? product.schemes.find(
        (candidate) => candidate.id === scheme.schemeId,
      ) ?? null
    : null;
  let schemeDiscountPercentBasisPoints: bigint | null = null;

  if (
    appliedSchemeCandidate?.type === "PERCENTAGE_DISCOUNT" &&
    appliedSchemeCandidate.discountPercent !== null
  ) {
    try {
      schemeDiscountPercentBasisPoints = parsePercentToBasisPoints(
        appliedSchemeCandidate.discountPercent,
      );
    } catch (error) {
      if (!(error instanceof MoneyValueError)) {
        throw error;
      }
    }
  }

  let subtotalPaise = 0n;
  let discountPaise = 0n;
  let taxablePaise = 0n;
  let gstPaise = 0n;
  let totalPaise = 0n;

  if (priceAndTaxAvailable) {
    subtotalPaise = multiplyByQuantity(unitPricePaise, fulfilledQuantity);

    if (scheme?.type === "PERCENTAGE_DISCOUNT") {
      discountPaise = scheme.discountPaise;
    } else if (freeQuantity > 0) {
      discountPaise = multiplyByQuantity(unitPricePaise, freeQuantity);
    }

    taxablePaise = subtotalPaise - discountPaise;
    gstPaise = percentageOf(taxablePaise, gstRateBasisPoints);
    totalPaise = taxablePaise + gstPaise;
  }

  const isOrderable =
    priceAndTaxAvailable &&
    paidQuantity > 0 &&
    availableCases !== null &&
    paidQuantity <= availableCases;

  return {
    sku: product.sku,
    name: product.name,
    brand: product.brand,
    imageUrl: product.imageUrl,
    unitLabel: product.unitLabel,
    unitPricePaise,
    gstRateBasisPoints,
    requestedQuantity,
    paidQuantity,
    freeQuantity,
    fulfilledQuantity,
    stockStatus: product.stock.status,
    availableCases,
    scheme,
    schemeName: appliedSchemeCandidate?.name ?? null,
    schemeDiscountPercentBasisPoints,
    subtotalPaise,
    discountPaise,
    taxablePaise,
    gstPaise,
    totalPaise,
    notices,
    isOrderable,
  };
}

export function calculateCart(
  lines: readonly CartLineInput[],
  products: ReadonlyMap<string, CartPriceInput>,
  now: Date = new Date(),
): CartSummary {
  const calculated: CartLineResult[] = [];
  const unavailableSkus: string[] = [];

  for (const input of lines) {
    const product = products.get(input.sku);

    if (!product) {
      unavailableSkus.push(input.sku);
      continue;
    }

    const line = calculateLine(input, product, now);

    if (!line) {
      unavailableSkus.push(input.sku);
      continue;
    }

    calculated.push(line);
  }

  let subtotalPaise = 0n;
  let discountPaise = 0n;
  let taxablePaise = 0n;
  let gstPaise = 0n;
  let totalPaise = 0n;
  let itemCount = 0;
  const breakdown = new Map<string, CartGstBreakdown>();

  for (const line of calculated) {
    itemCount += line.paidQuantity;
    subtotalPaise += line.subtotalPaise;
    discountPaise += line.discountPaise;
    taxablePaise += line.taxablePaise;
    gstPaise += line.gstPaise;
    totalPaise += line.totalPaise;

    if (
      line.gstRateBasisPoints !== null &&
      line.taxablePaise > 0n
    ) {
      const key = line.gstRateBasisPoints.toString();
      const existing = breakdown.get(key);

      if (existing) {
        existing.taxablePaise += line.taxablePaise;
        existing.gstPaise += line.gstPaise;
      } else {
        breakdown.set(key, {
          rateBasisPoints: line.gstRateBasisPoints,
          taxablePaise: line.taxablePaise,
          gstPaise: line.gstPaise,
        });
      }
    }
  }

  const gstBreakdown = [...breakdown.values()].sort((a, b) =>
    a.rateBasisPoints > b.rateBasisPoints ? -1 : 1,
  );

  const hasIssues =
    unavailableSkus.length > 0 ||
    calculated.some(
      (line) =>
        !line.isOrderable ||
        line.notices.includes("STOCK_REDUCED") ||
        line.notices.includes("FREE_UNITS_REDUCED"),
    );

  return {
    lines: calculated,
    unavailableSkus,
    itemCount,
    lineCount: calculated.length,
    subtotalPaise,
    discountPaise,
    taxablePaise,
    gstPaise,
    totalPaise,
    gstBreakdown,
    hasIssues,
  };
}

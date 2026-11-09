/**
 * Checkout review tokens.
 *
 * The cart page asks the server to fingerprint the authoritative cart it just
 * rendered. The fingerprint and a display-only line snapshot travel back with
 * the submission. On submit the server reloads every price, scheme, and stock
 * value and compares the fresh fingerprint before creating an order.
 *
 * Nothing in this token is trusted for money. It can only cause the server to
 * ask the retailer to review the cart again; totals are always recalculated
 * from the database.
 */

import { createHash } from "node:crypto";

export type CheckoutLineLike = {
  sku: string;
  paidQuantity: number;
  freeQuantity: number;
  unitPricePaise: bigint | null;
  discountPaise: bigint;
  gstPaise: bigint;
  totalPaise: bigint;
  availableCases: number | null;
  scheme: { schemeId: string; type: string } | null;
};

export type CheckoutReviewLine = {
  sku: string;
  paidQuantity: number;
  freeQuantity: number;
  unitPricePaise: string | null;
  discountPaise: string;
  gstPaise: string;
  totalPaise: string;
  availableCases: number | null;
  schemeId: string | null;
  schemeType: string | null;
};

export type CheckoutLineChangeReason =
  | "PRICE_CHANGED"
  | "STOCK_CHANGED"
  | "SCHEME_CHANGED"
  | "QUANTITY_CHANGED"
  | "PRODUCT_UNAVAILABLE"
  | "PRODUCT_ADDED";

export type CheckoutLineChange = {
  sku: string;
  reasons: CheckoutLineChangeReason[];
};

export type CheckoutReview = {
  version: 1;
  fingerprint: string;
  lines: CheckoutReviewLine[];
};

const MAX_TOKEN_LENGTH = 16_384;
const MAX_REVIEW_LINES = 100;
const FINGERPRINT_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MONEY_PATTERN = /^(?:0|[1-9]\d*)$/;

function toReviewLine(line: CheckoutLineLike): CheckoutReviewLine {
  return {
    sku: line.sku,
    paidQuantity: line.paidQuantity,
    freeQuantity: line.freeQuantity,
    unitPricePaise: line.unitPricePaise?.toString() ?? null,
    discountPaise: line.discountPaise.toString(),
    gstPaise: line.gstPaise.toString(),
    totalPaise: line.totalPaise.toString(),
    availableCases: line.availableCases,
    schemeId: line.scheme?.schemeId ?? null,
    schemeType: line.scheme?.type ?? null,
  };
}

function canonicalSerializedLine(line: CheckoutReviewLine): string {
  return [
    line.sku,
    line.paidQuantity,
    line.freeQuantity,
    line.unitPricePaise ?? "",
    line.discountPaise,
    line.gstPaise,
    line.totalPaise,
    line.availableCases ?? "",
    line.schemeId ?? "",
    line.schemeType ?? "",
  ].join("\u001f");
}

function hashCanonicalLines(lines: readonly CheckoutReviewLine[]): string {
  const canonical = [...lines]
    .sort((left, right) => (left.sku < right.sku ? -1 : left.sku > right.sku ? 1 : 0))
    .map(canonicalSerializedLine)
    .join("\u001e");

  return createHash("sha256").update(canonical, "utf8").digest("base64url");
}

export function buildCheckoutFingerprint(
  lines: readonly CheckoutLineLike[],
): string {
  return hashCanonicalLines(lines.map(toReviewLine));
}

export function buildCheckoutReview(
  lines: readonly CheckoutLineLike[],
): CheckoutReview {
  const reviewLines = lines
    .map(toReviewLine)
    .sort((left, right) =>
      left.sku < right.sku ? -1 : left.sku > right.sku ? 1 : 0,
    );

  return {
    version: 1,
    fingerprint: hashCanonicalLines(reviewLines),
    lines: reviewLines,
  };
}

export function encodeCheckoutReview(review: CheckoutReview): string {
  return Buffer.from(JSON.stringify(review), "utf8").toString("base64url");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseReviewLine(value: unknown): CheckoutReviewLine | null {
  if (!isRecord(value)) {
    return null;
  }

  const {
    sku,
    paidQuantity,
    freeQuantity,
    unitPricePaise,
    discountPaise,
    gstPaise,
    totalPaise,
    availableCases,
    schemeId,
    schemeType,
  } = value;

  if (
    typeof sku !== "string" ||
    sku.trim() === "" ||
    sku.length > 100 ||
    !Number.isSafeInteger(paidQuantity) ||
    (paidQuantity as number) < 1 ||
    (paidQuantity as number) > 99_999 ||
    !Number.isSafeInteger(freeQuantity) ||
    (freeQuantity as number) < 0 ||
    (freeQuantity as number) > 99_999 ||
    typeof discountPaise !== "string" ||
    !MONEY_PATTERN.test(discountPaise) ||
    typeof gstPaise !== "string" ||
    !MONEY_PATTERN.test(gstPaise) ||
    typeof totalPaise !== "string" ||
    !MONEY_PATTERN.test(totalPaise) ||
    !(
      availableCases === null ||
      (Number.isSafeInteger(availableCases) && (availableCases as number) >= 0)
    ) ||
    !(schemeId === null || (typeof schemeId === "string" && schemeId.length <= 100)) ||
    !(schemeType === null || (typeof schemeType === "string" && schemeType.length <= 50))
  ) {
    return null;
  }

  if (
    !(
      unitPricePaise === null ||
      (typeof unitPricePaise === "string" && MONEY_PATTERN.test(unitPricePaise))
    )
  ) {
    return null;
  }

  return {
    sku,
    paidQuantity: paidQuantity as number,
    freeQuantity: freeQuantity as number,
    unitPricePaise,
    discountPaise,
    gstPaise,
    totalPaise,
    availableCases: availableCases as number | null,
    schemeId,
    schemeType,
  };
}

export function parseCheckoutReview(token: string): CheckoutReview | null {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    typeof parsed.fingerprint !== "string" ||
    !FINGERPRINT_PATTERN.test(parsed.fingerprint) ||
    !Array.isArray(parsed.lines) ||
    parsed.lines.length > MAX_REVIEW_LINES
  ) {
    return null;
  }

  const lines: CheckoutReviewLine[] = [];
  const seen = new Set<string>();

  for (const candidate of parsed.lines) {
    const line = parseReviewLine(candidate);

    if (!line || seen.has(line.sku)) {
      return null;
    }

    seen.add(line.sku);
    lines.push(line);
  }

  if (hashCanonicalLines(lines) !== parsed.fingerprint) {
    return null;
  }

  return {
    version: 1,
    fingerprint: parsed.fingerprint,
    lines,
  };
}

export function compareCheckoutReview(
  review: CheckoutReview,
  currentLines: readonly CheckoutLineLike[],
): CheckoutLineChange[] {
  const previous = new Map(review.lines.map((line) => [line.sku, line]));
  const current = new Map(
    currentLines.map((line) => [line.sku, toReviewLine(line)]),
  );
  const skus = [...new Set([...previous.keys(), ...current.keys()])].sort();
  const changes: CheckoutLineChange[] = [];

  for (const sku of skus) {
    const before = previous.get(sku);
    const after = current.get(sku);

    if (!after) {
      changes.push({ sku, reasons: ["PRODUCT_UNAVAILABLE"] });
      continue;
    }

    if (!before) {
      changes.push({ sku, reasons: ["PRODUCT_ADDED"] });
      continue;
    }

    const reasons: CheckoutLineChangeReason[] = [];

    if (before.unitPricePaise !== after.unitPricePaise) {
      reasons.push("PRICE_CHANGED");
    }

    if (before.availableCases !== after.availableCases) {
      reasons.push("STOCK_CHANGED");
    }

    if (
      before.schemeId !== after.schemeId ||
      before.schemeType !== after.schemeType
    ) {
      reasons.push("SCHEME_CHANGED");
    }

    if (
      before.paidQuantity !== after.paidQuantity ||
      before.freeQuantity !== after.freeQuantity
    ) {
      reasons.push("QUANTITY_CHANGED");
    }

    if (after.unitPricePaise === null) {
      reasons.push("PRODUCT_UNAVAILABLE");
    }

    if (reasons.length > 0) {
      changes.push({ sku, reasons });
    }
  }

  return changes;
}

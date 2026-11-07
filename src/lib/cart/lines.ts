/**
 * Pure cart line editing and quantity validation. Server actions call these
 * before writing the owner-bound cookie; the calculation layer independently
 * revalidates stock and prices on every read.
 */

import {
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  isValidLineQuantity,
  isValidSku,
  type CartLineInput,
} from "./cookie";

export type AddCartLineFailure =
  | "INVALID_SKU"
  | "INVALID_QUANTITY"
  | "QUANTITY_LIMIT"
  | "CART_FULL";

export type AddCartLineResult =
  | { ok: true; lines: CartLineInput[] }
  | { ok: false; code: AddCartLineFailure };

export type UpdateCartLineFailure = "LINE_NOT_FOUND" | "INVALID_QUANTITY";

export type UpdateCartLineResult =
  | { ok: true; lines: CartLineInput[] }
  | { ok: false; code: UpdateCartLineFailure };

export type QuantityValidation =
  | { ok: true }
  | {
      ok: false;
      code:
        | "INVALID_QUANTITY"
        | "STOCK_UNAVAILABLE"
        | "OUT_OF_STOCK"
        | "INSUFFICIENT_STOCK";
      availableCases?: number;
    };

export function addCartLine(
  lines: readonly CartLineInput[],
  input: CartLineInput,
): AddCartLineResult {
  if (!isValidSku(input.sku)) {
    return { ok: false, code: "INVALID_SKU" };
  }

  if (!isValidLineQuantity(input.quantity)) {
    return { ok: false, code: "INVALID_QUANTITY" };
  }

  const index = lines.findIndex((line) => line.sku === input.sku);

  if (index === -1) {
    if (lines.length >= MAX_CART_LINES) {
      return { ok: false, code: "CART_FULL" };
    }

    return {
      ok: true,
      lines: [...lines, { sku: input.sku, quantity: input.quantity }],
    };
  }

  const nextQuantity = lines[index].quantity + input.quantity;

  if (nextQuantity > MAX_LINE_QUANTITY) {
    return { ok: false, code: "QUANTITY_LIMIT" };
  }

  const next = [...lines];
  next[index] = { sku: input.sku, quantity: nextQuantity };

  return { ok: true, lines: next };
}

export function updateCartLine(
  lines: readonly CartLineInput[],
  sku: string,
  quantity: number,
): UpdateCartLineResult {
  const index = lines.findIndex((line) => line.sku === sku);

  if (index === -1) {
    return { ok: false, code: "LINE_NOT_FOUND" };
  }

  if (!isValidLineQuantity(quantity)) {
    return { ok: false, code: "INVALID_QUANTITY" };
  }

  const next = [...lines];
  next[index] = { sku, quantity };

  return { ok: true, lines: next };
}

export function removeCartLine(
  lines: readonly CartLineInput[],
  sku: string,
): CartLineInput[] {
  return lines.filter((line) => line.sku !== sku);
}

export function clearCartLines(): CartLineInput[] {
  return [];
}

export function validateRequestedQuantity(
  quantity: number,
  availableCases: number | null,
): QuantityValidation {
  if (!isValidLineQuantity(quantity)) {
    return { ok: false, code: "INVALID_QUANTITY" };
  }

  if (availableCases === null) {
    return { ok: false, code: "STOCK_UNAVAILABLE" };
  }

  if (availableCases === 0) {
    return { ok: false, code: "OUT_OF_STOCK" };
  }

  if (quantity > availableCases) {
    return {
      ok: false,
      code: "INSUFFICIENT_STOCK",
      availableCases,
    };
  }

  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";

import {
  CartCookieError,
  MAX_LINE_QUANTITY,
  countCartUnits,
  isValidLineQuantity,
  isValidSku,
} from "./cookie";
import type { CartActionCode, CartActionState } from "./action-types";
import { authorizeRetailerCart } from "./authorization";
import {
  addCartLine,
  removeCartLine,
  updateCartLine,
  validateRequestedQuantity,
} from "./lines";
import { fetchCartProducts } from "./repository";
import {
  clearCartCookie,
  readCartCookieLines,
  readCartCookieOrigin,
  writeCartCookieLines,
} from "./store";

function failure(
  code: CartActionCode,
  extra: Partial<CartActionState> = {},
): CartActionState {
  return { status: "error", code, ...extra };
}

function success(
  code: CartActionCode,
  extra: Partial<CartActionState> = {},
): CartActionState {
  return { status: "success", code, ...extra };
}

function parseQuantity(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    return null;
  }

  const quantity = Number(value.trim());

  return isValidLineQuantity(quantity) ? quantity : null;
}

async function authorizeOrFail(): Promise<
  | { ok: true; owner: { userId: string; retailerId: string } }
  | { ok: false; state: CartActionState }
> {
  const authorization = await authorizeRetailerCart();

  if (!authorization.ok) {
    return { ok: false, state: failure(authorization.reason) };
  }

  return { ok: true, owner: authorization.owner };
}

function persistFailure(error: unknown): CartActionState {
  if (error instanceof CartCookieError) {
    return failure("COOKIE_TOO_LARGE");
  }

  return failure("UNKNOWN");
}

export async function addToCartAction(
  _previousState: CartActionState,
  formData: FormData,
): Promise<CartActionState> {
  const authorization = await authorizeOrFail();

  if (!authorization.ok) {
    return authorization.state;
  }

  const sku = String(formData.get("sku") ?? "").trim();
  const quantity = parseQuantity(formData.get("quantity"));

  if (!isValidSku(sku)) {
    return failure("INVALID_SKU");
  }

  if (quantity === null) {
    return failure("INVALID_QUANTITY");
  }

  try {
    const lines = await readCartCookieLines(authorization.owner);
    const origin = await readCartCookieOrigin(authorization.owner);
    const existing = lines.find((line) => line.sku === sku)?.quantity ?? 0;
    const desiredQuantity = existing + quantity;

    if (desiredQuantity > MAX_LINE_QUANTITY) {
      return failure("QUANTITY_LIMIT");
    }

    const product = (
      await fetchCartProducts(authorization.owner.retailerId, [sku])
    )[0];

    if (!product) {
      return failure("PRODUCT_UNAVAILABLE");
    }

    if (product.unitPricePaise === null) {
      return failure("PRICE_UNAVAILABLE");
    }

    const stockCheck = validateRequestedQuantity(
      desiredQuantity,
      product.stock.availableCases,
    );

    if (!stockCheck.ok) {
      return failure(stockCheck.code, {
        availableCases: stockCheck.availableCases,
      });
    }

    const result = addCartLine(lines, { sku, quantity });

    if (!result.ok) {
      return failure(result.code);
    }

    await writeCartCookieLines(authorization.owner, result.lines, origin);
    revalidatePath("/", "layout");

    return success("ADDED", {
      sku,
      quantity,
      itemCount: countCartUnits(result.lines),
    });
  } catch (error) {
    return persistFailure(error);
  }
}

export async function updateCartLineAction(
  _previousState: CartActionState,
  formData: FormData,
): Promise<CartActionState> {
  const authorization = await authorizeOrFail();

  if (!authorization.ok) {
    return authorization.state;
  }

  const sku = String(formData.get("sku") ?? "").trim();
  const quantity = parseQuantity(formData.get("quantity"));

  if (!isValidSku(sku)) {
    return failure("INVALID_SKU");
  }

  if (quantity === null) {
    return failure("INVALID_QUANTITY");
  }

  try {
    const lines = await readCartCookieLines(authorization.owner);
    const origin = await readCartCookieOrigin(authorization.owner);

    if (!lines.some((line) => line.sku === sku)) {
      return failure("LINE_NOT_FOUND");
    }

    const product = (
      await fetchCartProducts(authorization.owner.retailerId, [sku])
    )[0];

    if (!product) {
      return failure("PRODUCT_UNAVAILABLE");
    }

    if (product.unitPricePaise === null) {
      return failure("PRICE_UNAVAILABLE");
    }

    const stockCheck = validateRequestedQuantity(
      quantity,
      product.stock.availableCases,
    );

    if (!stockCheck.ok) {
      return failure(stockCheck.code, {
        availableCases: stockCheck.availableCases,
      });
    }

    const result = updateCartLine(lines, sku, quantity);

    if (!result.ok) {
      return failure(result.code);
    }

    await writeCartCookieLines(authorization.owner, result.lines, origin);
    revalidatePath("/", "layout");

    return success("UPDATED", {
      sku,
      quantity,
      itemCount: countCartUnits(result.lines),
    });
  } catch (error) {
    return persistFailure(error);
  }
}

export async function removeCartLineAction(
  _previousState: CartActionState,
  formData: FormData,
): Promise<CartActionState> {
  const authorization = await authorizeOrFail();

  if (!authorization.ok) {
    return authorization.state;
  }

  const sku = String(formData.get("sku") ?? "").trim();

  if (!isValidSku(sku)) {
    return failure("INVALID_SKU");
  }

  try {
    const lines = await readCartCookieLines(authorization.owner);
    const origin = await readCartCookieOrigin(authorization.owner);

    if (!lines.some((line) => line.sku === sku)) {
      return failure("LINE_NOT_FOUND");
    }

    const result = removeCartLine(lines, sku);
    await writeCartCookieLines(authorization.owner, result, origin);
    revalidatePath("/", "layout");

    return success("REMOVED", {
      sku,
      itemCount: countCartUnits(result),
    });
  } catch (error) {
    return persistFailure(error);
  }
}

export async function clearCartAction(): Promise<CartActionState> {
  const authorization = await authorizeOrFail();

  if (!authorization.ok) {
    return authorization.state;
  }

  try {
    await clearCartCookie();
    revalidatePath("/", "layout");
    return success("CLEARED", { itemCount: 0 });
  } catch (error) {
    return persistFailure(error);
  }
}

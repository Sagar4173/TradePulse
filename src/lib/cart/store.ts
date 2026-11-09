import "server-only";

import { cookies } from "next/headers";

import { getAuthConfig } from "@/lib/auth/runtime";
import {
  CART_COOKIE_NAME,
  buildCartCookieOptions,
  countCartUnits,
  encodeCartCookie,
  readCartLines,
  readCartOrigin,
  type CartLineInput,
  type CartOrigin,
  type CartOwner,
} from "./cookie";

export async function readCartCookieLines(
  owner: CartOwner,
): Promise<CartLineInput[]> {
  const cookieStore = await cookies();
  return readCartLines(cookieStore.get(CART_COOKIE_NAME)?.value, owner);
}

export async function readCartCookieOrigin(
  owner: CartOwner,
): Promise<CartOrigin> {
  const cookieStore = await cookies();
  return readCartOrigin(cookieStore.get(CART_COOKIE_NAME)?.value, owner);
}

export async function writeCartCookieLines(
  owner: CartOwner,
  lines: readonly CartLineInput[],
  origin: CartOrigin = "MANUAL",
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(
    CART_COOKIE_NAME,
    encodeCartCookie(owner, lines, origin),
    buildCartCookieOptions(getAuthConfig().isProduction),
  );
}

export async function clearCartCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(CART_COOKIE_NAME);
}

/**
 * Lightweight badge count for the application shell. It reads only the
 * owner-bound cookie; the cart page recalculates authoritative quantities and
 * stock. A stale count can never affect pricing or ordering.
 */
export async function getCartItemCount(owner: CartOwner): Promise<number> {
  return countCartUnits(await readCartCookieLines(owner));
}

import "server-only";

import { calculateCart } from "./calc";
import type { CartOwner } from "./cookie";
import { fetchCartProducts } from "./repository";
import { readCartCookieLines } from "./store";
import type { CartSummary } from "./types";

/**
 * Rebuilds the cart from the owner-bound cookie and fresh database data. No
 * price, discount, tax, or stock value comes from the browser.
 */
export async function loadCart(
  owner: CartOwner,
  now: Date = new Date(),
): Promise<CartSummary> {
  const lines = await readCartCookieLines(owner);

  if (lines.length === 0) {
    return calculateCart([], new Map(), now);
  }

  const products = await fetchCartProducts(
    owner.retailerId,
    lines.map((line) => line.sku),
  );
  const productsBySku = new Map(products.map((item) => [item.sku, item]));

  return calculateCart(lines, productsBySku, now);
}

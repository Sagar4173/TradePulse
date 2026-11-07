import "server-only";

import { getPrismaClient } from "@/lib/db";
import { calculateStock } from "@/lib/inventory/stock";
import { parseMoneyToPaise } from "@/lib/money";
import { toSchemeCandidate } from "@/lib/schemes/row";
import type { CartPriceInput } from "./types";

const schemeSelect = {
  id: true,
  type: true,
  isActive: true,
  startsAt: true,
  endsAt: true,
  minimumQuantity: true,
  freeQuantity: true,
  discountPercent: true,
} as const;

/**
 * Loads the authenticated retailer's commercial data for the requested SKUs.
 * `dealerPrice` is never selected, and the price relation is scoped to the
 * retailer so another retailer's price can never enter a cart calculation.
 */
export async function fetchCartProducts(
  retailerId: string,
  skus: readonly string[],
): Promise<CartPriceInput[]> {
  if (skus.length === 0) {
    return [];
  }

  const rows = await getPrismaClient().product.findMany({
    where: { sku: { in: [...skus] }, isActive: true },
    select: {
      sku: true,
      name: true,
      brand: true,
      imageUrl: true,
      unitLabel: true,
      gstRate: true,
      inventory: {
        select: { stockCases: true, reservedCases: true },
      },
      prices: {
        where: { retailerId },
        select: { sellingPrice: true },
        take: 1,
      },
      schemes: {
        where: { isActive: true },
        orderBy: { id: "asc" },
        select: schemeSelect,
      },
    },
  });

  return rows.map((row) => ({
    sku: row.sku,
    name: row.name,
    brand: row.brand,
    imageUrl: row.imageUrl,
    unitLabel: row.unitLabel,
    gstRate: row.gstRate,
    unitPricePaise: row.prices[0]
      ? parseMoneyToPaise(row.prices[0].sellingPrice)
      : null,
    stock: calculateStock(row.inventory),
    schemes: row.schemes.map(toSchemeCandidate),
  }));
}

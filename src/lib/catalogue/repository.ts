import "server-only";

import { getPrismaClient } from "@/lib/db";
import { calculateStock } from "@/lib/inventory/stock";
import { MoneyValueError, parseMoneyToPaise, parsePercentToBasisPoints } from "@/lib/money";
import { toSchemeCandidate } from "@/lib/schemes/row";
import type { CatalogueCandidate, CatalogueDetails } from "./types";

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

function parseGstRate(value: { toString(): string }): bigint | null {
  try {
    return parsePercentToBasisPoints(value);
  } catch (error) {
    if (error instanceof MoneyValueError) {
      return null;
    }

    throw error;
  }
}

/**
 * Lightweight candidate query for search, filtering, sorting and pagination.
 * The retailer price relation is scoped to the authenticated retailer;
 * `dealerPrice` is never selected.
 */
export async function fetchCatalogueCandidates(
  retailerId: string,
): Promise<CatalogueCandidate[]> {
  const rows = await getPrismaClient().product.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      sku: true,
      name: true,
      brand: true,
      category: true,
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
    category: row.category,
    pricePaise: row.prices[0]
      ? parseMoneyToPaise(row.prices[0].sellingPrice)
      : null,
    stock: calculateStock(row.inventory),
    schemes: row.schemes.map(toSchemeCandidate),
  }));
}

/**
 * Hydrates only the current page, avoiding an N+1 query per product card.
 */
export async function fetchCatalogueDetails(
  skus: readonly string[],
): Promise<Map<string, CatalogueDetails>> {
  if (skus.length === 0) {
    return new Map();
  }

  const rows = await getPrismaClient().product.findMany({
    where: { sku: { in: [...skus] }, isActive: true },
    select: {
      sku: true,
      description: true,
      imageUrl: true,
      unitLabel: true,
      gstRate: true,
    },
  });

  return new Map(
    rows.map((row) => [
      row.sku,
      {
        sku: row.sku,
        description: row.description,
        imageUrl: row.imageUrl,
        unitLabel: row.unitLabel,
        gstRateBasisPoints: parseGstRate(row.gstRate),
      },
    ]),
  );
}

import "server-only";

import { getPrismaClient } from "@/lib/db";
import { calculateStock } from "@/lib/inventory/stock";
import { isPrismaErrorCode } from "@/lib/orders/transaction";
import { planAliasWrite } from "./alias";
import { normalizeAliasPhrase } from "./normalize";
import type {
  MatchAlias,
  MatchHistoryEntry,
  MatchProduct,
} from "./types";

export type CaptureContext = {
  products: MatchProduct[];
  aliases: MatchAlias[];
  history: MatchHistoryEntry[];
};

export type AliasCorrection = {
  phrase: string;
  parsedSku: string | null;
  selectedSku: string;
};

export type CaptureSearchProduct = {
  sku: string;
  name: string;
  brand: string | null;
  unitLabel: string;
  availableCases: number | null;
  hasRetailerPrice: boolean;
};

/**
 * Loads only the server-side data needed by deterministic capture. The
 * retailer price relation is scoped to the authenticated retailer and no
 * dealer price is selected. The full catalogue never reaches the browser;
 * only the parsed line candidates and their alternatives are returned.
 */
export async function loadCaptureContext(
  retailerId: string,
): Promise<CaptureContext> {
  const prisma = getPrismaClient();

  const [products, aliases, history] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        sku: true,
        name: true,
        description: true,
        brand: true,
        category: true,
        unitLabel: true,
        inventory: {
          select: { stockCases: true, reservedCases: true },
        },
        prices: {
          where: { retailerId },
          select: { id: true },
          take: 1,
        },
      },
    }),
    prisma.productAlias.findMany({
      where: { retailerId, isActive: true },
      orderBy: { normalizedPhrase: "asc" },
      select: {
        normalizedPhrase: true,
        productSku: true,
        confirmationCount: true,
      },
    }),
    prisma.orderItem.groupBy({
      by: ["productSku"],
      where: { order: { retailerId } },
      _count: { _all: true },
      _sum: { quantity: true },
    }),
  ]);

  return {
    products: products.map((product) => ({
      sku: product.sku,
      name: product.name,
      description: product.description,
      brand: product.brand,
      category: product.category,
      unitLabel: product.unitLabel,
      availableCases: calculateStock(product.inventory).availableCases,
      hasRetailerPrice: product.prices.length > 0,
    })),
    aliases,
    history: history.map((entry) => ({
      productSku: entry.productSku,
      orderCount: entry._count._all,
      totalQuantity: entry._sum.quantity ?? 0,
    })),
  };
}

/**
 * Bounded correction search. Only the authenticated retailer's price
 * availability is exposed, never a price or dealer value. The result cap keeps
 * the catalogue from being dumped into the browser.
 */
export async function searchCaptureProducts(
  retailerId: string,
  query: string,
): Promise<CaptureSearchProduct[]> {
  const term = query.trim();

  if (term.length < 2) {
    return [];
  }

  const rows = await getPrismaClient().product.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { brand: { contains: term, mode: "insensitive" } },
        { category: { contains: term, mode: "insensitive" } },
        { sku: { contains: term, mode: "insensitive" } },
      ],
    },
    orderBy: { name: "asc" },
    take: 8,
    select: {
      sku: true,
      name: true,
      brand: true,
      unitLabel: true,
      inventory: {
        select: { stockCases: true, reservedCases: true },
      },
      prices: {
        where: { retailerId },
        select: { sellingPrice: true },
        take: 1,
      },
    },
  });

  return rows.map((row) => ({
    sku: row.sku,
    name: row.name,
    brand: row.brand,
    unitLabel: row.unitLabel,
    availableCases: calculateStock(row.inventory).availableCases,
    hasRetailerPrice: row.prices.length > 0,
  }));
}

/**
 * Persists retailer corrections and their audit events in one serializable
 * transaction.
 *
 * The same normalised phrase is allowed to map to only one SKU per retailer.
 * The existing alias row is re-read inside the transaction so the audit event
 * type and `previousSku` describe the row that was actually written. A
 * concurrent confirmation can make the first attempt conflict; the bounded
 * retry then re-reads and recomputes the plan.
 *
 * Conflicting selections in a single confirmation are skipped rather than
 * allowing one browser request to choose the winner nondeterministically.
 * Cart-cookie persistence is intentionally outside this transaction; the
 * caller adds lines only after this database work succeeds.
 */
export async function applyAliasCorrections(input: {
  actorId: string;
  retailerId: string;
  corrections: readonly AliasCorrection[];
}): Promise<number> {
  if (input.corrections.length === 0) {
    return 0;
  }

  const byPhrase = new Map<
    string,
    { phrase: string; parsedSku: string | null; selectedSkus: Set<string> }
  >();

  for (const correction of input.corrections) {
    const normalizedPhrase = normalizeAliasPhrase(correction.phrase);

    if (!normalizedPhrase) {
      continue;
    }

    const existing = byPhrase.get(normalizedPhrase);

    if (existing) {
      existing.selectedSkus.add(correction.selectedSku);
      continue;
    }

    byPhrase.set(normalizedPhrase, {
      phrase: correction.phrase.trim().replace(/\s+/g, " "),
      parsedSku: correction.parsedSku,
      selectedSkus: new Set([correction.selectedSku]),
    });
  }

  if (byPhrase.size === 0) {
    return 0;
  }

  const prisma = getPrismaClient();

  return withAliasTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const aliasRows = await tx.productAlias.findMany({
          where: {
            retailerId: input.retailerId,
            normalizedPhrase: { in: [...byPhrase.keys()] },
          },
          select: {
            normalizedPhrase: true,
            productSku: true,
            isActive: true,
          },
        });

        const existingByPhrase = new Map(
          aliasRows.map((row) => [row.normalizedPhrase, row]),
        );

        const plans = [...byPhrase.entries()].flatMap(
          ([normalizedPhrase, correction]) => {
            if (correction.selectedSkus.size !== 1) {
              return [];
            }

            const selectedSku = [...correction.selectedSkus][0];
            const existing = existingByPhrase.get(normalizedPhrase) ?? null;
            const plan = planAliasWrite({
              phrase: correction.phrase,
              parsedSku: correction.parsedSku,
              selectedSku,
              existing: existing
                ? {
                    productSku: existing.productSku,
                    isActive: existing.isActive,
                  }
                : null,
            });

            return plan.action === "SKIP"
              ? []
              : [{ normalizedPhrase, plan }];
          },
        );

        let written = 0;

        for (const { normalizedPhrase, plan } of plans) {
          const alias = await tx.productAlias.upsert({
            where: {
              retailerId_normalizedPhrase: {
                retailerId: input.retailerId,
                normalizedPhrase,
              },
            },
            create: {
              retailerId: input.retailerId,
              productSku: plan.productSku,
              phrase: plan.phrase,
              normalizedPhrase,
              confirmationCount: 1,
              isActive: true,
            },
            update: {
              productSku: plan.productSku,
              phrase: plan.phrase,
              confirmationCount: { increment: 1 },
              isActive: true,
            },
            select: { id: true },
          });

          await tx.auditEvent.create({
            data: {
              eventType:
                plan.action === "CREATE"
                  ? "PRODUCT_ALIAS_CREATED"
                  : plan.action === "UPDATE"
                    ? "PRODUCT_ALIAS_UPDATED"
                    : "PRODUCT_ALIAS_REACTIVATED",
              entityType: "ProductAlias",
              entityId: alias.id,
              actorId: input.actorId,
              metadata: {
                retailerId: input.retailerId,
                phrase: plan.phrase,
                normalizedPhrase,
                productSku: plan.productSku,
                previousSku: plan.action === "UPDATE" ? plan.previousSku : null,
                source: "AI_TEXT_CONFIRMATION",
              },
            },
          });

          written += 1;
        }

        return written;
      },
      { isolationLevel: "Serializable" },
    ),
  );
}

const ALIAS_TRANSACTION_ATTEMPTS = 3;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * Retries the bounded serializable transaction when PostgreSQL reports a
 * serialization conflict or the unique alias key was inserted concurrently.
 * Both cases are safe to replay because the alias row is re-read on each try.
 */
async function withAliasTransactionRetry<T>(
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= ALIAS_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const retryable =
        isPrismaErrorCode(error, "P2034") ||
        isPrismaErrorCode(error, "P2002");

      if (!retryable || attempt === ALIAS_TRANSACTION_ATTEMPTS) {
        throw error;
      }

      await wait(attempt * 15);
    }
  }

  throw new Error("Unreachable alias transaction retry state.");
}

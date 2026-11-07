/**
 * Shared stock visibility rules for the retailer catalogue and cart.
 *
 * Availability is derived from the physical stock register minus reservations.
 * Retailers can never write these values; the server recomputes them on every
 * read so a stale browser cannot present or order unavailable stock.
 */

export const LOW_STOCK_THRESHOLD = 10;

export type StockStatus =
  | "IN_STOCK"
  | "LOW_STOCK"
  | "OUT_OF_STOCK"
  | "UNAVAILABLE";

export type StockSnapshot = {
  status: StockStatus;
  /** Null only when no inventory record exists for the product. */
  availableCases: number | null;
};

export type InventorySnapshot = {
  stockCases: number;
  reservedCases: number;
};

export function calculateStock(
  inventory: InventorySnapshot | null | undefined,
): StockSnapshot {
  if (!inventory) {
    return { status: "UNAVAILABLE", availableCases: null };
  }

  const availableCases = Math.max(
    0,
    inventory.stockCases - inventory.reservedCases,
  );

  if (availableCases === 0) {
    return { status: "OUT_OF_STOCK", availableCases: 0 };
  }

  return {
    status:
      availableCases <= LOW_STOCK_THRESHOLD ? "LOW_STOCK" : "IN_STOCK",
    availableCases,
  };
}

import type { StockSnapshot } from "../inventory/stock";
import type { SchemeCandidate } from "../schemes/engine";

export const CATALOGUE_SORTS = [
  "name-asc",
  "name-desc",
  "price-asc",
  "price-desc",
] as const;

export type CatalogueSort = (typeof CATALOGUE_SORTS)[number];

export const AVAILABILITY_FILTERS = [
  "all",
  "in-stock",
  "low-stock",
  "out-of-stock",
] as const;

export type AvailabilityFilter = (typeof AVAILABILITY_FILTERS)[number];

export type CatalogueFilters = {
  query: string;
  category: string | null;
  availability: AvailabilityFilter;
  sort: CatalogueSort;
  page: number;
};

/** Lightweight row used for searching, filtering and sorting. */
export type CatalogueCandidate = {
  sku: string;
  name: string;
  brand: string | null;
  category: string | null;
  /** The authenticated retailer's price only. Null means no price is set. */
  pricePaise: bigint | null;
  stock: StockSnapshot;
  schemes: readonly SchemeCandidate[];
};

/** Detail row hydrated only for the current page. */
export type CatalogueDetails = {
  sku: string;
  description: string | null;
  imageUrl: string | null;
  unitLabel: string;
  gstRateBasisPoints: bigint | null;
};

export type CatalogueItem = CatalogueCandidate &
  CatalogueDetails & {
    schemeLabels: string[];
  };

export type CataloguePageResult = {
  items: CatalogueCandidate[];
  total: number;
  page: number;
  pageCount: number;
};

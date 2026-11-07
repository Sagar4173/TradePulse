import "server-only";

import { describeEligibleSchemes } from "./scheme-labels";
import { fetchCatalogueCandidates, fetchCatalogueDetails } from "./repository";
import {
  collectCategories,
  filterAndPaginateCatalogue,
} from "./filters";
import type {
  CatalogueFilters,
  CatalogueItem,
} from "./types";

export type CataloguePageData = {
  items: CatalogueItem[];
  total: number;
  page: number;
  pageCount: number;
  categories: string[];
  filters: CatalogueFilters;
};

/**
 * Builds one catalogue page: lightweight candidate query, server-side
 * filtering/sorting/pagination, then one detail query for the visible SKUs.
 */
export async function loadCataloguePage(
  retailerId: string,
  filters: CatalogueFilters,
  now: Date = new Date(),
): Promise<CataloguePageData> {
  const candidates = await fetchCatalogueCandidates(retailerId);
  const result = filterAndPaginateCatalogue(candidates, filters);
  const details = await fetchCatalogueDetails(
    result.items.map((candidate) => candidate.sku),
  );

  const items = result.items.flatMap((candidate): CatalogueItem[] => {
    const detail = details.get(candidate.sku);

    if (!detail) {
      return [];
    }

    return [
      {
        ...candidate,
        ...detail,
        schemeLabels: describeEligibleSchemes(candidate.schemes, now),
      },
    ];
  });

  return {
    items,
    total: result.total,
    page: result.page,
    pageCount: result.pageCount,
    categories: collectCategories(candidates),
    filters: { ...filters, page: result.page },
  };
}

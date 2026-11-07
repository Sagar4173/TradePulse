/**
 * URL-facing catalogue filters. Browser input is untrusted: every value is
 * normalized to a known, bounded shape rather than rejected with an error, so a
 * malformed link still renders a usable catalogue.
 */

import type {
  AvailabilityFilter,
  CatalogueCandidate,
  CatalogueFilters,
  CataloguePageResult,
  CatalogueSort,
} from "./types";
import { AVAILABILITY_FILTERS, CATALOGUE_SORTS } from "./types";

export const CATALOGUE_PAGE_SIZE = 12;
export const MAX_QUERY_LENGTH = 80;
const MAX_PAGE = 100_000;

type SearchParamValue = string | string[] | undefined;
type SearchParams = Record<string, SearchParamValue>;

function firstValue(value: SearchParamValue): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function parsePage(value: SearchParamValue): number {
  const text = firstValue(value).trim();

  if (!/^\d+$/.test(text)) {
    return 1;
  }

  const page = Number(text);

  return Number.isSafeInteger(page) && page >= 1
    ? Math.min(page, MAX_PAGE)
    : 1;
}

export function parseCatalogueFilters(searchParams: SearchParams): CatalogueFilters {
  const query = firstValue(searchParams.q).trim().slice(0, MAX_QUERY_LENGTH);
  const rawCategory = firstValue(searchParams.category).trim();
  const rawAvailability = firstValue(searchParams.availability).trim();
  const rawSort = firstValue(searchParams.sort).trim();

  const availability = (
    AVAILABILITY_FILTERS as readonly string[]
  ).includes(rawAvailability)
    ? (rawAvailability as AvailabilityFilter)
    : "all";

  const sort = (CATALOGUE_SORTS as readonly string[]).includes(rawSort)
    ? (rawSort as CatalogueSort)
    : "name-asc";

  return {
    query,
    category:
      rawCategory === "" || rawCategory.toLowerCase() === "all"
        ? null
        : rawCategory.slice(0, MAX_QUERY_LENGTH),
    availability,
    sort,
    page: parsePage(searchParams.page),
  };
}

function compareText(left: string, right: string): number {
  const a = left.toLowerCase();
  const b = right.toLowerCase();

  if (a < b) {
    return -1;
  }

  if (a > b) {
    return 1;
  }

  return 0;
}

function compareName(a: CatalogueCandidate, b: CatalogueCandidate): number {
  return compareText(a.name, b.name) || compareText(a.sku, b.sku);
}

function matchesAvailability(
  candidate: CatalogueCandidate,
  availability: AvailabilityFilter,
): boolean {
  switch (availability) {
    case "in-stock":
      return (
        candidate.stock.availableCases !== null &&
        candidate.stock.availableCases > 0
      );
    case "low-stock":
      return candidate.stock.status === "LOW_STOCK";
    case "out-of-stock":
      return (
        candidate.stock.availableCases === null ||
        candidate.stock.availableCases === 0
      );
    default:
      return true;
  }
}

function matchesSearch(candidate: CatalogueCandidate, query: string): boolean {
  if (!query) {
    return true;
  }

  const needle = query.toLowerCase();
  const haystack = [candidate.name, candidate.sku, candidate.brand]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  return haystack.includes(needle);
}

function matchesCategory(
  candidate: CatalogueCandidate,
  category: string | null,
): boolean {
  if (!category) {
    return true;
  }

  return (candidate.category ?? "").toLowerCase() === category.toLowerCase();
}

function compareCandidates(
  a: CatalogueCandidate,
  b: CatalogueCandidate,
  sort: CatalogueSort,
): number {
  if (sort === "name-desc") {
    return compareName(b, a);
  }

  if (sort === "name-asc") {
    return compareName(a, b);
  }

  const aMissing = a.pricePaise === null;
  const bMissing = b.pricePaise === null;

  if (aMissing !== bMissing) {
    return aMissing ? 1 : -1;
  }

  if (!aMissing && a.pricePaise !== b.pricePaise) {
    const ascending = a.pricePaise! < b.pricePaise! ? -1 : 1;
    return sort === "price-asc" ? ascending : -ascending;
  }

  return compareName(a, b);
}

export function filterAndPaginateCatalogue(
  candidates: readonly CatalogueCandidate[],
  filters: CatalogueFilters,
): CataloguePageResult {
  const filtered = candidates.filter(
    (candidate) =>
      matchesSearch(candidate, filters.query) &&
      matchesCategory(candidate, filters.category) &&
      matchesAvailability(candidate, filters.availability),
  );

  const sorted = [...filtered].sort((a, b) =>
    compareCandidates(a, b, filters.sort),
  );

  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / CATALOGUE_PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  const start = (page - 1) * CATALOGUE_PAGE_SIZE;

  return {
    items: sorted.slice(start, start + CATALOGUE_PAGE_SIZE),
    total,
    page,
    pageCount,
  };
}

export function collectCategories(
  candidates: readonly CatalogueCandidate[],
): string[] {
  const seen = new Map<string, string>();

  for (const candidate of candidates) {
    const category = candidate.category?.trim();

    if (!category) {
      continue;
    }

    const key = category.toLowerCase();

    if (!seen.has(key)) {
      seen.set(key, category);
    }
  }

  return [...seen.values()].sort(compareText);
}

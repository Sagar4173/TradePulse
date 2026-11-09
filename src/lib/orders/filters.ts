/**
 * URL-facing order filters for retailer history and the Order Desk dashboard.
 * Browser parameters are normalized to a bounded shape instead of rejected, so
 * malformed links still render a usable page.
 */

import { ORDER_STATUSES, type OrderStatusValue } from "./status";

export const ORDER_PAGE_SIZE = 20;
const MAX_PAGE = 100_000;
const MAX_QUERY_LENGTH = 80;
const KOLKATA_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export const ORDER_SORTS = [
  "newest",
  "oldest",
  "total-desc",
  "total-asc",
] as const;

export type OrderSort = (typeof ORDER_SORTS)[number];

export type OrderStatusFilter = OrderStatusValue | "all";

export type OrderFilters = {
  query: string;
  status: OrderStatusFilter;
  from: string | null;
  to: string | null;
  sort: OrderSort;
  page: number;
};

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

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseDate(value: SearchParamValue): string | null {
  const text = firstValue(value).trim();
  return isValidDate(text) ? text : null;
}

export function parseOrderFilters(searchParams: SearchParams): OrderFilters {
  const query = firstValue(searchParams.q).trim().slice(0, MAX_QUERY_LENGTH);
  const rawStatus = firstValue(searchParams.status).trim();
  const rawSort = firstValue(searchParams.sort).trim();
  const status = (ORDER_STATUSES as readonly string[]).includes(rawStatus)
    ? (rawStatus as OrderStatusValue)
    : "all";
  const sort = (ORDER_SORTS as readonly string[]).includes(rawSort)
    ? (rawSort as OrderSort)
    : "newest";
  let from = parseDate(searchParams.from);
  let to = parseDate(searchParams.to);

  if (from && to && from > to) {
    const swap = from;
    from = to;
    to = swap;
  }

  return {
    query,
    status,
    from,
    to,
    sort,
    page: parsePage(searchParams.page),
  };
}

function kolkataDateStartUtc(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) - KOLKATA_OFFSET_MS);
}

function nextDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));

  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function orderDateRange(filters: OrderFilters): {
  gte: Date | null;
  lt: Date | null;
} {
  return {
    gte: filters.from ? kolkataDateStartUtc(filters.from) : null,
    lt: filters.to ? kolkataDateStartUtc(nextDate(filters.to)) : null,
  };
}

export function buildOrdersHref(
  basePath: string,
  filters: OrderFilters,
  page: number = filters.page,
): string {
  const params = new URLSearchParams();

  if (filters.query) {
    params.set("q", filters.query);
  }

  if (filters.status !== "all") {
    params.set("status", filters.status);
  }

  if (filters.from) {
    params.set("from", filters.from);
  }

  if (filters.to) {
    params.set("to", filters.to);
  }

  if (filters.sort !== "newest") {
    params.set("sort", filters.sort);
  }

  if (page > 1) {
    params.set("page", String(page));
  }

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/**
 * Pure Tally-compatible CSV export logic for the Order Desk.
 *
 * The export is intentionally a flat, line-level CSV rather than native Tally
 * XML. Every value is copied from the immutable `Order` and `OrderItem`
 * snapshots created at submission time; catalogue prices and schemes are never
 * re-read. Money columns inherit the product's existing GST-exclusive pricing
 * model: `lineTotal` and `orderTotal` include GST.
 */

import type { Prisma } from "@/generated/prisma/client";
import {
  formatBasisPointsPercent,
  paiseToDecimalString,
  parseMoneyToPaise,
  parsePercentToBasisPoints,
} from "@/lib/money";

import { orderDateRange, parseOrderFilters } from "./filters";
import { formatKolkataIsoDate } from "./order-number";
import { ORDER_STATUSES, type OrderStatusValue } from "./status";

type DecimalLike = { toString(): string } | string;
type SearchParamValue = string | string[] | undefined;

/**
 * Approved and post-approval statuses only. A credit-held order has never been
 * approved, and rejected/cancelled orders must never reach Tally.
 */
export const TALLY_EXPORT_STATUSES = [
  "APPROVED",
  "PROCESSING",
  "READY_FOR_DISPATCH",
  "DISPATCHED",
  "DELIVERED",
  "FULFILLED",
] as const satisfies readonly OrderStatusValue[];

export type TallyExportStatus = (typeof TALLY_EXPORT_STATUSES)[number];

const eligibleStatusSet: readonly string[] = TALLY_EXPORT_STATUSES;

export function isTallyExportStatus(
  value: string,
): value is TallyExportStatus {
  return eligibleStatusSet.includes(value);
}

/**
 * Derived from the shared status vocabulary so a future status is excluded by
 * default until someone deliberately decides it is exportable.
 */
export const TALLY_EXPORT_EXCLUDED_STATUSES: readonly OrderStatusValue[] =
  ORDER_STATUSES.filter((status) => !eligibleStatusSet.includes(status));

export const TALLY_EXPORT_MAX_ORDERS = 500;
export const TALLY_EXPORT_MAX_LINES = 5_000;

export const TALLY_EXPORT_AUDIT_EVENT = "ORDER_TALLY_EXPORTED";
export const TALLY_EXPORT_AUDIT_ENTITY = "OrderExport";

export type TallyExportFilters = {
  from: string | null;
  to: string | null;
};

export type TallyExportItem = {
  productSku: string;
  productName: string;
  unitLabel: string;
  quantity: number;
  freeQuantity: number;
  schemeName: string | null;
  schemeType: string | null;
  schemeDiscountPercent: DecimalLike | null;
  unitPrice: DecimalLike;
  discount: DecimalLike;
  gstRate: DecimalLike;
  gstAmount: DecimalLike;
  lineTotal: DecimalLike;
};

export type TallyExportOrder = {
  orderNumber: string;
  /**
   * Re-asserted by the pure builder as defense in depth; the database query
   * also filters on the eligible status set.
   */
  status: OrderStatusValue;
  createdAt: Date;
  retailerName: string;
  total: DecimalLike;
  items: readonly TallyExportItem[];
};

export type TallyExportRow = {
  orderNumber: string;
  orderDate: string;
  retailerName: string;
  sku: string;
  productName: string;
  unitLabel: string;
  paidQuantity: string;
  freeQuantity: string;
  unitPrice: string;
  discount: string;
  schemeName: string;
  schemeType: string;
  schemeDiscountPercent: string;
  gstRate: string;
  gstAmount: string;
  lineTotal: string;
  orderTotal: string;
};

const TALLY_EXPORT_COLUMNS = [
  ["orderNumber", "Order Number"],
  ["orderDate", "Order Date"],
  ["retailerName", "Customer Name"],
  ["sku", "SKU"],
  ["productName", "Product Name"],
  ["unitLabel", "Unit"],
  ["paidQuantity", "Paid Quantity"],
  ["freeQuantity", "Free Quantity"],
  ["unitPrice", "Unit Price (INR, GST excl.)"],
  ["discount", "Discount (INR)"],
  ["schemeName", "Scheme Name"],
  ["schemeType", "Scheme Type"],
  ["schemeDiscountPercent", "Scheme Discount (%)"],
  ["gstRate", "GST Rate (%)"],
  ["gstAmount", "GST Amount (INR)"],
  ["lineTotal", "Line Total (INR, GST incl.)"],
  ["orderTotal", "Order Total (INR, GST incl.)"],
] as const satisfies readonly (readonly [keyof TallyExportRow, string])[];

export const TALLY_EXPORT_HEADERS: readonly string[] =
  TALLY_EXPORT_COLUMNS.map(([, header]) => header);

export function parseTallyExportFilters(
  searchParams: Record<string, SearchParamValue>,
): TallyExportFilters {
  const parsed = parseOrderFilters(searchParams);

  return { from: parsed.from, to: parsed.to };
}

/**
 * The status list lives inside the database query so credit-held, rejected, and
 * cancelled orders are never loaded, even before the row builder runs.
 */
export function buildTallyExportWhere(
  filters: TallyExportFilters,
): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {
    status: { in: [...TALLY_EXPORT_STATUSES] },
    // An order without lines cannot produce a meaningful CSV row.
    items: { some: {} },
  };
  const range = orderDateRange(filters);

  if (range.gte || range.lt) {
    where.createdAt = {
      ...(range.gte ? { gte: range.gte } : {}),
      ...(range.lt ? { lt: range.lt } : {}),
    };
  }

  return where;
}

export function normalizeTallyMoney(value: DecimalLike): string {
  return paiseToDecimalString(parseMoneyToPaise(value));
}

function normalizeTallyPercent(value: DecimalLike): string {
  return formatBasisPointsPercent(parsePercentToBasisPoints(value));
}

export function buildTallyExportRows(
  orders: readonly TallyExportOrder[],
): TallyExportRow[] {
  const rows: TallyExportRow[] = [];

  for (const order of orders) {
    if (!isTallyExportStatus(order.status)) {
      throw new Error(
        `Cannot export order ${order.orderNumber}: status ${order.status} is not eligible.`,
      );
    }

    const orderDate = formatKolkataIsoDate(order.createdAt);
    const orderTotal = normalizeTallyMoney(order.total);

    for (const item of order.items) {
      rows.push({
        orderNumber: order.orderNumber,
        orderDate,
        retailerName: order.retailerName,
        sku: item.productSku,
        productName: item.productName,
        unitLabel: item.unitLabel,
        paidQuantity: String(item.quantity),
        freeQuantity: String(item.freeQuantity),
        unitPrice: normalizeTallyMoney(item.unitPrice),
        discount: normalizeTallyMoney(item.discount),
        schemeName: item.schemeName ?? "",
        schemeType: item.schemeType ?? "",
        schemeDiscountPercent:
          item.schemeDiscountPercent === null
            ? ""
            : normalizeTallyPercent(item.schemeDiscountPercent),
        gstRate: normalizeTallyPercent(item.gstRate),
        gstAmount: normalizeTallyMoney(item.gstAmount),
        lineTotal: normalizeTallyMoney(item.lineTotal),
        orderTotal,
      });
    }
  }

  return rows;
}

const FORMULA_INJECTION_PREFIX = /^\s*[=+\-@]/;

/**
 * Every cell is quoted, embedded quotes are doubled, and spreadsheet formula
 * prefixes are neutralized with a leading apostrophe. The guard looks at the
 * first non-whitespace character so leading spaces, tabs, CR/LF, and Unicode
 * whitespace cannot smuggle a formula past it. This keeps product and customer
 * names safe when the CSV is opened in Excel or imported into Tally.
 */
export function escapeCsvCell(value: string): string {
  const guarded = FORMULA_INJECTION_PREFIX.test(value) ? `'${value}` : value;

  return `"${guarded.replaceAll('"', '""')}"`;
}

export function buildTallyExportCsv(rows: readonly TallyExportRow[]): string {
  const lines = [
    TALLY_EXPORT_COLUMNS.map(([, header]) => escapeCsvCell(header)).join(","),
  ];

  for (const row of rows) {
    lines.push(
      TALLY_EXPORT_COLUMNS.map(([key]) => escapeCsvCell(row[key])).join(","),
    );
  }

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export type TallyExportSummary = {
  orderCount: number;
  lineCount: number;
  total: string;
};

export type TallyExportSummaryRow = {
  total: DecimalLike;
  itemCount: number;
};

/**
 * Bounded summary builder. The repository supplies at most one order beyond
 * the cap, so counting never scans the full order history. Itemless orders are
 * ignored because they cannot produce a CSV line.
 */
export function summarizeTallyExportCounts(
  rows: readonly TallyExportSummaryRow[],
): TallyExportSummary {
  let orderCount = 0;
  let lineCount = 0;
  let totalPaise = 0n;

  for (const row of rows) {
    if (row.itemCount === 0) {
      continue;
    }

    orderCount += 1;
    lineCount += row.itemCount;
    totalPaise += parseMoneyToPaise(row.total);
  }

  return {
    orderCount,
    lineCount,
    total: paiseToDecimalString(totalPaise),
  };
}

export function summarizeTallyExportOrders(
  orders: readonly TallyExportOrder[],
): TallyExportSummary {
  return summarizeTallyExportCounts(
    orders.map((order) => ({
      total: order.total,
      itemCount: order.items.length,
    })),
  );
}

export type TallyExportLimitProblem = "ORDER_LIMIT" | "LINE_LIMIT";

export function tallyExportLimitProblem(
  summary: TallyExportSummary,
): TallyExportLimitProblem | null {
  if (summary.orderCount > TALLY_EXPORT_MAX_ORDERS) {
    return "ORDER_LIMIT";
  }

  if (summary.lineCount > TALLY_EXPORT_MAX_LINES) {
    return "LINE_LIMIT";
  }

  return null;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function tallyExportFilename(filters: TallyExportFilters): string {
  const from =
    filters.from && ISO_DATE_PATTERN.test(filters.from) ? filters.from : null;
  const to = filters.to && ISO_DATE_PATTERN.test(filters.to) ? filters.to : null;

  if (from && to) {
    return `tradepulse-tally-orders-${from}-to-${to}.csv`;
  }

  if (from) {
    return `tradepulse-tally-orders-from-${from}.csv`;
  }

  if (to) {
    return `tradepulse-tally-orders-to-${to}.csv`;
  }

  return "tradepulse-tally-orders-all.csv";
}

export type TallyExportAuditMetadata = {
  format: "CSV";
  unitPriceBasis: "GST_EXCLUSIVE";
  lineTotalBasis: "GST_INCLUSIVE";
  orderTotalBasis: "GST_INCLUSIVE";
  from: string | null;
  to: string | null;
  orderCount: number;
  lineCount: number;
  total: string;
  eligibleStatuses: TallyExportStatus[];
};

export type TallyExportAudit = {
  eventType: string;
  entityType: string;
  metadata: TallyExportAuditMetadata;
};

export function tallyExportAuditMetadata(
  summary: TallyExportSummary,
  filters: TallyExportFilters,
): TallyExportAudit {
  return {
    eventType: TALLY_EXPORT_AUDIT_EVENT,
    entityType: TALLY_EXPORT_AUDIT_ENTITY,
    metadata: {
      format: "CSV",
      unitPriceBasis: "GST_EXCLUSIVE",
      lineTotalBasis: "GST_INCLUSIVE",
      orderTotalBasis: "GST_INCLUSIVE",
      from: filters.from,
      to: filters.to,
      orderCount: summary.orderCount,
      lineCount: summary.lineCount,
      total: summary.total,
      eligibleStatuses: [...TALLY_EXPORT_STATUSES],
    },
  };
}

export type TallyExportResult =
  | {
      ok: true;
      csv: string;
      filename: string;
      summary: TallyExportSummary;
    }
  | {
      ok: false;
      reason: "EMPTY" | "INELIGIBLE_ORDER" | TallyExportLimitProblem;
      summary: TallyExportSummary;
    };

export function createTallyExport(
  orders: readonly TallyExportOrder[],
  filters: TallyExportFilters,
): TallyExportResult {
  const summary = summarizeTallyExportOrders(orders);
  const hasIneligibleOrder = orders.some(
    (order) => !isTallyExportStatus(order.status),
  );

  if (hasIneligibleOrder) {
    return { ok: false, reason: "INELIGIBLE_ORDER", summary };
  }

  if (summary.orderCount === 0 || summary.lineCount === 0) {
    return { ok: false, reason: "EMPTY", summary };
  }

  const limitProblem = tallyExportLimitProblem(summary);

  if (limitProblem) {
    return { ok: false, reason: limitProblem, summary };
  }

  return {
    ok: true,
    csv: buildTallyExportCsv(buildTallyExportRows(orders)),
    filename: tallyExportFilename(filters),
    summary,
  };
}

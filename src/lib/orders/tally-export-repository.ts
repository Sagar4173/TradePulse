import "server-only";

import { getPrismaClient } from "@/lib/db";

import {
  TALLY_EXPORT_MAX_ORDERS,
  buildTallyExportWhere,
  summarizeTallyExportCounts,
  type TallyExportAudit,
  type TallyExportFilters,
  type TallyExportOrder,
  type TallyExportSummary,
} from "./tally-export";

/**
 * Read-only bounded summary used by the export preview and as the first bound
 * check on download. It reads at most one order beyond the cap, so a preview
 * never scans the full eligible order history. When the cap is exceeded the
 * preview shows "500+" and the download is refused.
 */
export async function summarizeTallyExport(
  filters: TallyExportFilters,
): Promise<TallyExportSummary> {
  const rows = await getPrismaClient().order.findMany({
    where: buildTallyExportWhere(filters),
    orderBy: [{ createdAt: "asc" }, { orderNumber: "asc" }],
    take: TALLY_EXPORT_MAX_ORDERS + 1,
    select: {
      total: true,
      _count: { select: { items: true } },
    },
  });

  return summarizeTallyExportCounts(
    rows.map((row) => ({
      total: row.total.toString(),
      itemCount: row._count.items,
    })),
  );
}

/**
 * Loads at most one order beyond the limit so the pure builder can detect a
 * concurrent approval instead of silently truncating the file. No catalogue
 * tables are joined: every exported value is an order snapshot.
 */
export async function loadTallyExportOrders(
  filters: TallyExportFilters,
): Promise<TallyExportOrder[]> {
  const orders = await getPrismaClient().order.findMany({
    where: buildTallyExportWhere(filters),
    orderBy: [{ createdAt: "asc" }, { orderNumber: "asc" }],
    take: TALLY_EXPORT_MAX_ORDERS + 1,
    select: {
      orderNumber: true,
      status: true,
      createdAt: true,
      total: true,
      retailer: { select: { shopName: true } },
      items: {
        orderBy: [{ productName: "asc" }, { productSku: "asc" }],
        select: {
          productSku: true,
          productName: true,
          unitLabel: true,
          quantity: true,
          freeQuantity: true,
          schemeName: true,
          schemeType: true,
          schemeDiscountPercent: true,
          unitPrice: true,
          discount: true,
          gstRate: true,
          gstAmount: true,
          lineTotal: true,
        },
      },
    },
  });

  return orders.map((order) => ({
    orderNumber: order.orderNumber,
    status: order.status,
    createdAt: order.createdAt,
    retailerName: order.retailer.shopName,
    total: order.total.toString(),
    items: order.items.map((item) => ({
      productSku: item.productSku,
      productName: item.productName,
      unitLabel: item.unitLabel,
      quantity: item.quantity,
      freeQuantity: item.freeQuantity,
      schemeName: item.schemeName,
      schemeType: item.schemeType,
      schemeDiscountPercent: item.schemeDiscountPercent?.toString() ?? null,
      unitPrice: item.unitPrice.toString(),
      discount: item.discount.toString(),
      gstRate: item.gstRate.toString(),
      gstAmount: item.gstAmount.toString(),
      lineTotal: item.lineTotal.toString(),
    })),
  }));
}

/**
 * Appends an export audit event. The payload is aggregate-only: no customer,
 * product, or order-level data is written to the audit trail.
 */
export async function recordTallyExportAudit(input: {
  actorId: string;
  exportId: string;
  audit: TallyExportAudit;
}): Promise<void> {
  await getPrismaClient().auditEvent.create({
    data: {
      eventType: input.audit.eventType,
      entityType: input.audit.entityType,
      entityId: input.exportId,
      actorId: input.actorId,
      metadata: input.audit.metadata,
    },
  });
}

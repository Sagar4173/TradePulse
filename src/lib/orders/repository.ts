import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthSession } from "@/lib/auth/types";
import { getPrismaClient } from "@/lib/db";

import {
  ORDER_PAGE_SIZE,
  orderDateRange,
  type OrderFilters,
  type OrderSort,
} from "./filters";

export type OrderScopeResult =
  | { ok: true; where: Prisma.OrderWhereInput }
  | { ok: false; reason: "NO_RETAILER" | "NO_ASSIGNMENTS" };

/**
 * The session is the only source of order scope. A retailer sees its own
 * retailerId; a salesman sees only assigned retailers; Order Desk and Admin
 * have network scope. Retailer ownership is checked again inside transitions.
 */
export async function resolveOrderScope(
  session: AuthSession,
  client: PrismaClient | Prisma.TransactionClient = getPrismaClient(),
): Promise<OrderScopeResult> {
  switch (session.user.role) {
    case "RETAILER":
      return session.user.retailerId
        ? { ok: true, where: { retailerId: session.user.retailerId } }
        : { ok: false, reason: "NO_RETAILER" };

    case "SALESMAN": {
      const assignments = await client.salesmanRetailerAssignment.findMany({
        where: { salesmanId: session.user.id },
        select: { retailerId: true },
      });

      if (assignments.length === 0) {
        return { ok: false, reason: "NO_ASSIGNMENTS" };
      }

      return {
        ok: true,
        where: {
          retailerId: { in: assignments.map((item) => item.retailerId) },
        },
      };
    }

    case "ORDER_DESK":
    case "ADMIN":
      return { ok: true, where: {} };
  }
}

export function buildOrderWhere(
  scopeWhere: Prisma.OrderWhereInput,
  filters: OrderFilters,
): Prisma.OrderWhereInput {
  const conditions: Prisma.OrderWhereInput[] = [scopeWhere];
  const range = orderDateRange(filters);

  if (filters.status !== "all") {
    conditions.push({ status: filters.status });
  }

  if (range.gte || range.lt) {
    conditions.push({
      createdAt: {
        ...(range.gte ? { gte: range.gte } : {}),
        ...(range.lt ? { lt: range.lt } : {}),
      },
    });
  }

  if (filters.query) {
    const query = filters.query;
    conditions.push({
      OR: [
        { orderNumber: { contains: query, mode: "insensitive" } },
        {
          retailer: {
            shopName: { contains: query, mode: "insensitive" },
          },
        },
        {
          retailer: {
            ownerName: { contains: query, mode: "insensitive" },
          },
        },
      ],
    });
  }

  return conditions.length === 1 ? conditions[0]! : { AND: conditions };
}

function orderByFor(
  sort: OrderSort,
): Prisma.OrderOrderByWithRelationInput[] {
  switch (sort) {
    case "oldest":
      return [{ createdAt: "asc" }, { id: "asc" }];
    case "total-desc":
      return [{ total: "desc" }, { createdAt: "desc" }];
    case "total-asc":
      return [{ total: "asc" }, { createdAt: "desc" }];
    case "newest":
    default:
      return [{ createdAt: "desc" }, { id: "desc" }];
  }
}

export type OrderListRow = {
  id: string;
  orderNumber: string;
  status: string;
  stockState: string;
  creditCheckStatus: string;
  total: { toString(): string } | string;
  createdAt: Date;
  retailer: { shopName: string };
  createdBy: { name: string };
  _count: { items: number };
};

export type OrderListResult = {
  items: OrderListRow[];
  total: number;
  page: number;
  pageCount: number;
  filteredValue: { toString(): string } | string | number;
  statusCounts: Record<string, number>;
};

export async function listOrders(
  scopeWhere: Prisma.OrderWhereInput,
  filters: OrderFilters,
): Promise<OrderListResult> {
  const prisma = getPrismaClient();
  const where = buildOrderWhere(scopeWhere, filters);
  const total = await prisma.order.count({ where });

  if (total === 0) {
    return {
      items: [],
      total: 0,
      page: 1,
      pageCount: 1,
      filteredValue: 0,
      statusCounts: {},
    };
  }

  const pageCount = Math.max(1, Math.ceil(total / ORDER_PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);

  const [items, aggregate, statusGroups] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: orderByFor(filters.sort),
      skip: (page - 1) * ORDER_PAGE_SIZE,
      take: ORDER_PAGE_SIZE,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        stockState: true,
        creditCheckStatus: true,
        total: true,
        createdAt: true,
        retailer: { select: { shopName: true } },
        createdBy: { select: { name: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.order.aggregate({ where, _sum: { total: true } }),
    prisma.order.groupBy({
      by: ["status"],
      where: scopeWhere,
      _count: { _all: true },
    }),
  ]);

  return {
    items,
    total,
    page,
    pageCount,
    filteredValue: aggregate._sum.total ?? 0,
    statusCounts: Object.fromEntries(
      statusGroups.map((group) => [group.status, group._count._all]),
    ),
  };
}

const detailInclude = {
  items: { orderBy: { productName: "asc" } },
  retailer: {
    select: {
      id: true,
      shopName: true,
      ownerName: true,
      phone: true,
      creditLimit: true,
    },
  },
  createdBy: { select: { id: true, name: true, role: true } },
} as const satisfies Prisma.OrderInclude;

export type OrderDetail = Prisma.OrderGetPayload<{
  include: typeof detailInclude;
}>;

export type OrderAuditRow = {
  id: string;
  eventType: string;
  actorId: string | null;
  metadata: Prisma.JsonValue;
  createdAt: Date;
  actor: { name: string } | null;
};

/**
 * Loads one order only when it is inside the session's scope. Returning null
 * for both "missing" and "not yours" avoids leaking whether another retailer's
 * order exists.
 */
export async function findOrderForSession(
  orderId: string,
  session: AuthSession,
): Promise<{ order: OrderDetail; auditEvents: OrderAuditRow[] } | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(orderId)) {
    return null;
  }

  const scope = await resolveOrderScope(session);

  if (!scope.ok) {
    return null;
  }

  const prisma = getPrismaClient();
  const order = await prisma.order.findFirst({
    where: { AND: [{ id: orderId }, scope.where] },
    include: detailInclude,
  });

  if (!order) {
    return null;
  }

  const auditEvents = await prisma.auditEvent.findMany({
    where: {
      entityType: "Order",
      entityId: order.id,
      eventType: { startsWith: "ORDER_" },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      eventType: true,
      actorId: true,
      metadata: true,
      createdAt: true,
      actor: { select: { name: true } },
    },
  });

  return { order, auditEvents };
}

export async function findOrderByIdempotencyKey(
  retailerId: string,
  idempotencyKey: string,
): Promise<{ id: string; orderNumber: string; status: string } | null> {
  return getPrismaClient().order.findUnique({
    where: {
      retailerId_idempotencyKey: { retailerId, idempotencyKey },
    },
    select: { id: true, orderNumber: true, status: true },
  });
}

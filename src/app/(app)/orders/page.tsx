import { ClipboardList, Clock3, IndianRupee, Store } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/empty-state";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Prisma } from "@/generated/prisma/client";
import { OrderStatus } from "@/generated/prisma/enums";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requireAnyPermission } from "@/lib/auth/session";
import { getPrismaClient } from "@/lib/db";
import { formatDateTime, formatInr } from "@/lib/format";

export const metadata: Metadata = {
  title: "Orders — TradePulse",
  description: "Orders visible within your authorized retailer scope.",
};

type VisibleOrder = {
  id: string;
  status: string;
  total: { toString(): string } | string | number;
  createdAt: Date;
  retailer: { shopName: string };
  createdBy: { name: string };
  _count: { items: number };
};

function OrderMobileCard({ order }: { order: VisibleOrder }) {
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted-foreground">
            {order.id.slice(-8).toUpperCase()}
          </p>
          <p className="mt-1 truncate text-sm font-semibold">
            {order.retailer.shopName}
          </p>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Placed</dt>
          <dd className="mt-0.5">{formatDateTime(order.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Items</dt>
          <dd className="mt-0.5">{order._count.items}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Created by</dt>
          <dd className="mt-0.5 truncate">{order.createdBy.name}</dd>
        </div>
        <div className="text-right">
          <dt className="text-muted-foreground">Total</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">
            {formatInr(order.total)}
          </dd>
        </div>
      </dl>
    </li>
  );
}

export default async function OrdersPage() {
  const session = await requireAnyPermission([
    PERMISSIONS.ORDERS_VIEW_OWN,
    PERMISSIONS.ORDERS_VIEW_ASSIGNED,
    PERMISSIONS.ORDERS_VIEW_ALL,
  ]);

  const prisma = getPrismaClient();
  let scopeWhere: Prisma.OrderWhereInput | null = null;
  let scopeDescription =
    "All orders in the distributor network. This view is read-only in the current milestone.";

  if (session.user.role === "RETAILER") {
    if (!session.user.retailerId) {
      return (
        <div className="space-y-6">
          <PageHeader
            eyebrow="Retailer workspace"
            title="My Orders"
            description="Your account must be linked to a retailer record before orders can be shown."
          />
          <EmptyState
            icon={Store}
            title="Store link pending"
            description="Your phone number is verified, but your user account is not linked to a retailer yet. Ask a TradePulse administrator to complete the link."
          />
        </div>
      );
    }

    scopeWhere = { retailerId: session.user.retailerId };
    scopeDescription =
      "Orders placed by your store. Other retailers' orders and pricing are never included.";
  } else if (session.user.role === "SALESMAN") {
    const assignments = await prisma.salesmanRetailerAssignment.findMany({
      where: { salesmanId: session.user.id },
      select: { retailerId: true },
    });
    const retailerIds = assignments.map((assignment) => assignment.retailerId);

    if (retailerIds.length === 0) {
      return (
        <div className="space-y-6">
          <PageHeader
            eyebrow="Salesman workspace"
            title="Orders"
            description="Order access follows your assigned retailer scope."
          />
          <EmptyState
            icon={Store}
            title="No retailers assigned"
            description="An administrator must assign retailers to your account before you can view their orders."
          />
        </div>
      );
    }

    scopeWhere = { retailerId: { in: retailerIds } };
    scopeDescription =
      "Orders from your assigned retailers only. Access outside this field scope is denied on the server.";
  }

  const where = scopeWhere ?? {};
  const [orders, orderCount, pendingCount, totals] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        status: true,
        total: true,
        createdAt: true,
        retailer: { select: { shopName: true } },
        createdBy: { select: { name: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.order.count({ where }),
    prisma.order.count({
      where: { ...where, status: OrderStatus.PENDING_REVIEW },
    }),
    prisma.order.aggregate({ where, _sum: { total: true } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          session.user.role === "RETAILER"
            ? "Retailer workspace"
            : session.user.role === "SALESMAN"
              ? "Salesman workspace"
              : "Operations"
        }
        title={session.user.role === "RETAILER" ? "My Orders" : "Orders"}
        description={scopeDescription}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Visible orders"
          value={String(orderCount)}
          detail="Limited to your authorized scope"
          icon={ClipboardList}
        />
        <StatCard
          label="Pending review"
          value={String(pendingCount)}
          detail="Waiting for order-desk action"
          icon={Clock3}
        />
        <StatCard
          label="Visible value"
          value={formatInr(totals._sum.total ?? 0)}
          detail="Sum of orders visible to you"
          icon={IndianRupee}
        />
      </div>

      {orders.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No orders yet"
          description="Order creation is not part of this milestone. Once orders exist in your authorized scope, they will appear here."
        />
      ) : (
        <>
          <ul className="space-y-3 md:hidden">
            {orders.map((order) => (
              <OrderMobileCard key={order.id} order={order} />
            ))}
          </ul>

          <Card className="hidden md:flex">
            <CardHeader>
              <CardTitle>Order register</CardTitle>
              <CardDescription>
                Showing the latest {orders.length} of {orderCount} orders visible
                to your role.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                  <caption className="sr-only">
                    Orders visible to your role
                  </caption>
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted-foreground">
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Order
                      </th>
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Retailer
                      </th>
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Placed
                      </th>
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Created by
                      </th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">
                        Items
                      </th>
                      <th scope="col" className="py-2 text-right font-medium">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {orders.map((order) => (
                      <tr key={order.id}>
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-muted-foreground">
                              {order.id.slice(-8).toUpperCase()}
                            </span>
                            <OrderStatusBadge status={order.status} />
                          </div>
                        </td>
                        <td className="max-w-[14rem] truncate py-3 pr-4">
                          {order.retailer.shopName}
                        </td>
                        <td className="whitespace-nowrap py-3 pr-4 text-muted-foreground">
                          {formatDateTime(order.createdAt)}
                        </td>
                        <td className="max-w-[12rem] truncate py-3 pr-4 text-muted-foreground">
                          {order.createdBy.name}
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums">
                          {order._count.items}
                        </td>
                        <td className="py-3 text-right font-semibold tabular-nums">
                          {formatInr(order.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

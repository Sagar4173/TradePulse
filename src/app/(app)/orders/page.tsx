import {
  AlertTriangle,
  ClipboardList,
  Clock3,
  IndianRupee,
  Store,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  PERMISSIONS,
  hasPermission,
} from "@/lib/auth/permissions";
import { requireAnyPermission } from "@/lib/auth/session";
import { formatDateTime, formatInr } from "@/lib/format";
import {
  ORDER_SORTS,
  buildOrdersHref,
  parseOrderFilters,
  type OrderSort,
} from "@/lib/orders/filters";
import {
  ORDER_STATUSES,
  creditCheckLabel,
  orderStatusLabel,
  stockStateLabel,
} from "@/lib/orders/status";
import {
  listOrders,
  resolveOrderScope,
  type OrderListRow,
} from "@/lib/orders/repository";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Orders — TradePulse",
  description:
    "Retailer order history and the Order Desk lifecycle workspace.",
};

const SORT_LABELS: Record<OrderSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  "total-desc": "Highest value",
  "total-asc": "Lowest value",
};

function scopeEmptyState(reason: "NO_RETAILER" | "NO_ASSIGNMENTS") {
  if (reason === "NO_RETAILER") {
    return (
      <EmptyState
        icon={Store}
        title="Store link pending"
        description="Your phone number is verified, but your user account is not linked to a retailer yet. Ask a TradePulse administrator to complete the link."
      />
    );
  }

  return (
    <EmptyState
      icon={Store}
      title="No retailers assigned"
      description="An administrator must assign retailers to your account before you can view their orders."
    />
  );
}

function OrderMobileCard({
  order,
  showRetailer,
  showOperations,
}: {
  order: OrderListRow;
  showRetailer: boolean;
  showOperations: boolean;
}) {
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/orders/${order.id}`}
            className="font-mono text-xs font-medium text-primary hover:underline"
          >
            {order.orderNumber}
          </Link>
          {showRetailer ? (
            <p className="mt-1 truncate text-sm font-semibold">
              {order.retailer.shopName}
            </p>
          ) : null}
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
        {showOperations ? (
          <div>
            <dt className="text-muted-foreground">Credit / stock</dt>
            <dd className="mt-0.5">
              {creditCheckLabel(order.creditCheckStatus)} ·{" "}
              {stockStateLabel(order.stockState)}
            </dd>
          </div>
        ) : null}
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

function FilterForm({
  filters,
}: {
  filters: ReturnType<typeof parseOrderFilters>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Search and filter</CardTitle>
        <CardDescription>
          Filter by order number, retailer, status, or order date.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          method="get"
          action="/orders"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6 xl:items-end"
        >
          <div className="space-y-1.5 xl:col-span-2">
            <Label htmlFor="orders-q">Order or retailer</Label>
            <Input
              id="orders-q"
              name="q"
              defaultValue={filters.query}
              maxLength={80}
              placeholder="TP-2026… or shop name"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="orders-status">Status</Label>
            <Select
              id="orders-status"
              name="status"
              defaultValue={filters.status}
            >
              <option value="all">All statuses</option>
              {ORDER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {orderStatusLabel(status)}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="orders-from">From</Label>
            <Input
              id="orders-from"
              name="from"
              type="date"
              defaultValue={filters.from ?? ""}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="orders-to">To</Label>
            <Input
              id="orders-to"
              name="to"
              type="date"
              defaultValue={filters.to ?? ""}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="orders-sort">Sort</Label>
            <Select id="orders-sort" name="sort" defaultValue={filters.sort}>
              {ORDER_SORTS.map((sort) => (
                <option key={sort} value={sort}>
                  {SORT_LABELS[sort]}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-6">
            <button type="submit" className={cn(buttonVariants(), "min-h-11")}>
              Apply filters
            </button>
            <Link
              href="/orders"
              className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
            >
              Reset
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAnyPermission([
    PERMISSIONS.ORDERS_VIEW_OWN,
    PERMISSIONS.ORDERS_VIEW_ASSIGNED,
    PERMISSIONS.ORDERS_VIEW_ALL,
  ]);
  const filters = parseOrderFilters(await searchParams);
  const scope = await resolveOrderScope(session);

  const isRetailer = session.user.role === "RETAILER";
  const canManage = hasPermission(session.user.role, PERMISSIONS.ORDERS_MANAGE);
  const showRetailer = !isRetailer;

  if (!scope.ok) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={isRetailer ? "Retailer workspace" : "Salesman workspace"}
          title={isRetailer ? "My Orders" : "Orders"}
          description="Order access follows your authorized retailer scope."
        />
        {scopeEmptyState(scope.reason)}
      </div>
    );
  }

  const data = await listOrders(scope.where, filters);
  const scopedTotal = Object.values(data.statusCounts).reduce(
    (total, count) => total + count,
    0,
  );
  const awaitingReview =
    (data.statusCounts.PENDING_REVIEW ?? 0) +
    (data.statusCounts.ON_CREDIT_HOLD ?? 0);
  const hasFilters =
    Boolean(filters.query) ||
    filters.status !== "all" ||
    Boolean(filters.from) ||
    Boolean(filters.to);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          isRetailer
            ? "Retailer workspace"
            : canManage
              ? "Order desk workspace"
              : "Salesman workspace"
        }
        title={
          isRetailer ? "My Orders" : canManage ? "Order Management" : "Orders"
        }
        description={
          isRetailer
            ? "Your store's orders, credit status, and fulfilment progress. Other retailers' orders and pricing are never included."
            : canManage
              ? "Review, approve, process, dispatch, and deliver orders across the network. Rejections and cancellations require a reason."
              : "Orders from your assigned retailers only. Access outside this field scope is denied on the server."
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {canManage ? (
          <>
            <StatCard
              label="Pending review"
              value={String(data.statusCounts.PENDING_REVIEW ?? 0)}
              detail="Waiting for an Order Desk decision"
              icon={Clock3}
            />
            <StatCard
              label="On credit hold"
              value={String(data.statusCounts.ON_CREDIT_HOLD ?? 0)}
              detail="Held orders with no stock reservation"
              icon={AlertTriangle}
            />
            <StatCard
              label="Ready for dispatch"
              value={String(data.statusCounts.READY_FOR_DISPATCH ?? 0)}
              detail="Reserved stock awaiting dispatch"
              icon={ClipboardList}
            />
          </>
        ) : (
          <>
            <StatCard
              label="Orders in scope"
              value={String(scopedTotal)}
              detail="All statuses visible to your role"
              icon={ClipboardList}
            />
            <StatCard
              label="Awaiting action"
              value={String(awaitingReview)}
              detail="Pending review or on credit hold"
              icon={Clock3}
            />
            <StatCard
              label="Delivered"
              value={String(data.statusCounts.DELIVERED ?? 0)}
              detail="Orders marked delivered"
              icon={Store}
            />
          </>
        )}
        <StatCard
          label="Filtered value"
          value={formatInr(data.filteredValue)}
          detail={`${data.total} matching ${data.total === 1 ? "order" : "orders"}`}
          icon={IndianRupee}
        />
      </div>

      <FilterForm filters={filters} />

      {data.items.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={hasFilters ? "No matching orders" : "No orders yet"}
          description={
            hasFilters
              ? "No orders match the current search, status, or date filters. Adjust the filters or reset them."
              : isRetailer
                ? "Your submitted orders will appear here with their credit, stock, and fulfilment status."
                : "Orders in your authorized scope will appear here as retailers submit them."
          }
          action={
            hasFilters ? (
              <Link
                href="/orders"
                className={cn(buttonVariants(), "min-h-11")}
              >
                Clear filters
              </Link>
            ) : isRetailer ? (
              <Link
                href="/catalogue"
                className={cn(buttonVariants(), "min-h-11")}
              >
                Browse catalogue
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <ul className="space-y-3 md:hidden">
            {data.items.map((order) => (
              <OrderMobileCard
                key={order.id}
                order={order}
                showRetailer={showRetailer}
                showOperations={canManage}
              />
            ))}
          </ul>

          <Card className="hidden md:flex">
            <CardHeader>
              <CardTitle>Order register</CardTitle>
              <CardDescription>
                Page {data.page} of {data.pageCount} · {data.total} matching{" "}
                {data.total === 1 ? "order" : "orders"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse text-left text-sm">
                  <caption className="sr-only">
                    Orders visible to your authorized role
                  </caption>
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted-foreground">
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Order
                      </th>
                      {showRetailer ? (
                        <th scope="col" className="py-2 pr-4 font-medium">
                          Retailer
                        </th>
                      ) : null}
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Placed
                      </th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">
                        Items
                      </th>
                      {canManage ? (
                        <th scope="col" className="py-2 pr-4 font-medium">
                          Credit / stock
                        </th>
                      ) : null}
                      <th scope="col" className="py-2 text-right font-medium">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.items.map((order) => (
                      <tr key={order.id}>
                        <td className="py-3 pr-4">
                          <div className="flex flex-col gap-1">
                            <Link
                              href={`/orders/${order.id}`}
                              className="font-mono text-xs font-medium text-primary hover:underline"
                            >
                              {order.orderNumber}
                            </Link>
                            <OrderStatusBadge status={order.status} />
                          </div>
                        </td>
                        {showRetailer ? (
                          <td className="max-w-[14rem] truncate py-3 pr-4">
                            {order.retailer.shopName}
                          </td>
                        ) : null}
                        <td className="whitespace-nowrap py-3 pr-4 text-muted-foreground">
                          {formatDateTime(order.createdAt)}
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums">
                          {order._count.items}
                        </td>
                        {canManage ? (
                          <td className="py-3 pr-4 text-xs text-muted-foreground">
                            {creditCheckLabel(order.creditCheckStatus)} ·{" "}
                            {stockStateLabel(order.stockState)}
                          </td>
                        ) : null}
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

      {data.pageCount > 1 ? (
        <nav
          aria-label="Order pagination"
          className="flex flex-wrap items-center justify-between gap-3"
        >
          {data.page > 1 ? (
            <Link
              href={buildOrdersHref("/orders", filters, data.page - 1)}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "min-h-11",
              )}
              rel="prev"
            >
              Previous
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "min-h-11 opacity-50",
              )}
            >
              Previous
            </span>
          )}

          <p className="text-sm text-muted-foreground">
            Page {data.page} of {data.pageCount}
          </p>

          {data.page < data.pageCount ? (
            <Link
              href={buildOrdersHref("/orders", filters, data.page + 1)}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "min-h-11",
              )}
              rel="next"
            >
              Next
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "min-h-11 opacity-50",
              )}
            >
              Next
            </span>
          )}
        </nav>
      ) : null}
    </div>
  );
}

import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Package,
  ShieldCheck,
  Store,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { OrderActions } from "@/components/orders/order-actions";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PERMISSIONS, hasAnyPermission } from "@/lib/auth/permissions";
import { requireAnyPermission } from "@/lib/auth/session";
import { formatDateTime, formatInr } from "@/lib/format";
import { describeOrderAuditEvent } from "@/lib/orders/presentation";
import {
  creditCheckLabel,
  isOrderStatus,
  orderEventLabel,
  stockStateLabel,
  type OrderStatusValue,
} from "@/lib/orders/status";
import { findOrderForSession } from "@/lib/orders/repository";
import { getAvailableOrderActions } from "@/lib/orders/transitions";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Order detail — TradePulse",
  description:
    "Order items, price snapshots, credit state, stock reservation, and audit timeline.",
};

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAnyPermission([
    PERMISSIONS.ORDERS_VIEW_OWN,
    PERMISSIONS.ORDERS_VIEW_ASSIGNED,
    PERMISSIONS.ORDERS_VIEW_ALL,
  ]);
  const { id } = await params;
  const query = await searchParams;
  const data = await findOrderForSession(id, session);

  if (!data) {
    notFound();
  }

  const { order, auditEvents } = data;
  const status: OrderStatusValue = isOrderStatus(order.status)
    ? order.status
    : "DRAFT";
  const actions = getAvailableOrderActions(session.user.role, status);
  // Credit visibility follows the permission model: retailers may see their
  // own credit data and Order Desk/Admin may see all of it, but salesmen have
  // no credit permission and must not see limit or exposure snapshots here.
  const canViewCredit = hasAnyPermission(session.user.role, [
    PERMISSIONS.CREDIT_VIEW_OWN,
    PERMISSIONS.CREDIT_VIEW_ALL,
  ]);
  const placed = query.placed === "1";
  const itemCount = order.items.reduce(
    (count, item) => count + item.quantity,
    0,
  );
  const freeCount = order.items.reduce(
    (count, item) => count + item.freeQuantity,
    0,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          session.user.role === "RETAILER"
            ? "Retailer workspace"
            : "Order operations"
        }
        title={`Order ${order.orderNumber}`}
        description={`${order.retailer.shopName} · placed ${formatDateTime(
          order.createdAt,
        )} · ${order.items.length} ${order.items.length === 1 ? "line" : "lines"}`}
        actions={
          <Link
            href="/orders"
            className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
          >
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            Back to orders
          </Link>
        }
      />

      {placed ? (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex items-start gap-3">
            <CheckCircle2
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-primary"
            />
            <div>
              <p className="text-sm font-semibold text-primary">
                Order submitted successfully
              </p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                The order number is {order.orderNumber}. Credit checks, stock
                reservations, and later status changes are recorded in the
                timeline below.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {canViewCredit &&
      status === "ON_CREDIT_HOLD" &&
      order.creditHoldReason ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent>
            <p className="text-sm font-semibold text-destructive">
              Credit hold
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {order.creditHoldReason}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {order.statusReason ? (
        <Card className="border-border bg-muted/40">
          <CardContent>
            <p className="text-sm font-semibold">
              {order.status === "REJECTED" ? "Rejection" : "Cancellation"}{" "}
              reason
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {order.statusReason}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Order items</CardTitle>
              <CardDescription>
                Price, scheme, and tax values are the snapshots captured when the
                order was submitted.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {order.items.length === 0 ? (
                <EmptyState
                  icon={Package}
                  title="No items recorded"
                  description="This order has no item snapshot."
                />
              ) : (
                <>
                  <ul className="space-y-4 md:hidden">
                    {order.items.map((item) => (
                      <li
                        key={item.id}
                        className="rounded-lg border border-border p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">
                              {item.productName}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {item.productSku} · {item.unitLabel}
                            </p>
                          </div>
                          <p className="text-sm font-semibold tabular-nums">
                            {formatInr(item.lineTotal)}
                          </p>
                        </div>
                        <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <dt className="text-muted-foreground">
                              Paid quantity
                            </dt>
                            <dd>{item.quantity}</dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">Free</dt>
                            <dd>{item.freeQuantity}</dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">
                              Unit price
                            </dt>
                            <dd>{formatInr(item.unitPrice)}</dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">GST</dt>
                            <dd>{formatInr(item.gstAmount)}</dd>
                          </div>
                        </dl>
                        {item.schemeName ? (
                          <p className="mt-2 text-xs font-medium text-primary">
                            Scheme: {item.schemeName}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>

                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted-foreground">
                          <th scope="col" className="py-2 pr-4 font-medium">
                            Product
                          </th>
                          <th scope="col" className="py-2 pr-4 text-right font-medium">
                            Paid
                          </th>
                          <th scope="col" className="py-2 pr-4 text-right font-medium">
                            Free
                          </th>
                          <th scope="col" className="py-2 pr-4 text-right font-medium">
                            Unit price
                          </th>
                          <th scope="col" className="py-2 pr-4 text-right font-medium">
                            Discount
                          </th>
                          <th scope="col" className="py-2 pr-4 text-right font-medium">
                            GST
                          </th>
                          <th scope="col" className="py-2 text-right font-medium">
                            Line total
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {order.items.map((item) => (
                          <tr key={item.id}>
                            <td className="py-3 pr-4">
                              <p className="font-medium">{item.productName}</p>
                              <p className="text-xs text-muted-foreground">
                                {item.productSku} · {item.unitLabel}
                              </p>
                              {item.schemeName ? (
                                <p className="mt-0.5 text-xs text-primary">
                                  {item.schemeName}
                                </p>
                              ) : null}
                            </td>
                            <td className="py-3 pr-4 text-right tabular-nums">
                              {item.quantity}
                            </td>
                            <td className="py-3 pr-4 text-right tabular-nums">
                              {item.freeQuantity}
                            </td>
                            <td className="py-3 pr-4 text-right tabular-nums">
                              {formatInr(item.unitPrice)}
                            </td>
                            <td className="py-3 pr-4 text-right tabular-nums">
                              {formatInr(item.discount)}
                            </td>
                            <td className="py-3 pr-4 text-right tabular-nums">
                              {formatInr(item.gstAmount)}
                            </td>
                            <td className="py-3 text-right font-semibold tabular-nums">
                              {formatInr(item.lineTotal)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Audit timeline</CardTitle>
              <CardDescription>
                Status, credit-hold, and stock events recorded atomically with
                each order change.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {auditEvents.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  No order audit events have been recorded yet.
                </p>
              ) : (
                <ol className="relative space-y-4 border-l border-border pl-5">
                  {auditEvents.map((event) => {
                    const detail = describeOrderAuditEvent(
                      event.eventType,
                      event.metadata,
                    );

                    return (
                      <li key={event.id} className="relative">
                        <span className="absolute -left-[1.4rem] top-1 grid size-2.5 place-items-center rounded-full bg-primary ring-4 ring-background" />
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                          <p className="text-sm font-medium">
                            {orderEventLabel(event.eventType)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDateTime(event.createdAt)}
                          </p>
                        </div>
                        {detail ? (
                          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                            {detail}
                          </p>
                        ) : null}
                        {event.actor ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            By {event.actor.name}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 xl:sticky xl:top-24">
          <Card>
            <CardHeader>
              <CardTitle>Order state</CardTitle>
              <CardDescription>
                {canViewCredit
                  ? "Derived from the order record, credit check, and stock ledger."
                  : "Derived from the order record and stock ledger."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>
                    <OrderStatusBadge status={order.status} />
                  </dd>
                </div>
                {canViewCredit ? (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">Credit check</dt>
                      <dd className="font-medium">
                        {creditCheckLabel(order.creditCheckStatus)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">Credit limit</dt>
                      <dd className="font-medium">
                        {order.creditLimitSnapshot
                          ? formatInr(order.creditLimitSnapshot)
                          : "Not recorded"}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">
                        Exposure at check
                      </dt>
                      <dd className="text-right font-medium">
                        {order.creditOutstandingSnapshot
                          ? formatInr(order.creditOutstandingSnapshot)
                          : "Not recorded"}
                      </dd>
                    </div>
                  </>
                ) : null}
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Stock</dt>
                  <dd className="text-right font-medium">
                    {stockStateLabel(order.stockState)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                  <dt className="flex items-center gap-2 text-muted-foreground">
                    <Store aria-hidden="true" className="size-4" />
                    Retailer
                  </dt>
                  <dd className="text-right font-medium">
                    {order.retailer.shopName}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="flex items-center gap-2 text-muted-foreground">
                    <Clock3 aria-hidden="true" className="size-4" />
                    Placed
                  </dt>
                  <dd className="text-right font-medium">
                    {formatDateTime(order.createdAt)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="flex items-center gap-2 text-muted-foreground">
                    <ShieldCheck aria-hidden="true" className="size-4" />
                    Created by
                  </dt>
                  <dd className="text-right font-medium">
                    {order.createdBy.name}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Totals</CardTitle>
              <CardDescription>
                {itemCount} paid {itemCount === 1 ? "case" : "cases"}
                {freeCount > 0
                  ? ` + ${freeCount} free ${freeCount === 1 ? "case" : "cases"}`
                  : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd>{formatInr(order.subtotal)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Discount</dt>
                  <dd className="text-primary">
                    {formatInr(order.discount)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">GST</dt>
                  <dd>{formatInr(order.gstAmount)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3">
                  <dt className="text-base font-semibold">Total</dt>
                  <dd className="text-xl font-semibold tracking-tight">
                    {formatInr(order.total)}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <OrderActions
            orderId={order.id}
            orderNumber={order.orderNumber}
            actions={actions}
          />
        </div>
      </div>
    </div>
  );
}

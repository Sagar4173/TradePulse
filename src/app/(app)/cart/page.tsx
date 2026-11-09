import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { AlertTriangle, ShoppingCart, Store } from "lucide-react";
import Link from "next/link";

import { CartLine } from "@/components/cart/cart-line";
import { CartSummary } from "@/components/cart/cart-summary";
import { ClearCartButton } from "@/components/cart/clear-cart-button";
import { CheckoutForm } from "@/components/orders/checkout-form";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { resolveRetailerCartOwner } from "@/lib/cart/owner";
import { loadCart } from "@/lib/cart/service";
import { catalogueCopy } from "@/lib/i18n/catalogue-copy";
import { cartCopy } from "@/lib/i18n/cart-copy";
import {
  buildCheckoutReview,
  encodeCheckoutReview,
} from "@/lib/orders/checkout";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Shopping Cart — TradePulse",
  description:
    "Your retailer cart with server-calculated prices, schemes, stock checks and GST estimates.",
};

export default async function CartPage() {
  const session = await requirePermission(PERMISSIONS.CATALOGUE_VIEW);
  const owner = resolveRetailerCartOwner(session.user);

  if (!owner) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={cartCopy.eyebrow}
          title={cartCopy.title}
          description={cartCopy.description}
        />
        <EmptyState
          icon={Store}
          title={catalogueCopy.retailerRequired.title}
          description={catalogueCopy.retailerRequired.description}
        />
      </div>
    );
  }

  const summary = await loadCart(owner);
  const hasLines = summary.lines.length > 0;
  // Both values are generated on the server. The review token only lets the
  // submission detect a changed cart; the idempotency key only prevents the
  // same reviewed cart from creating two orders.
  const reviewToken = hasLines
    ? encodeCheckoutReview(buildCheckoutReview(summary.lines))
    : "";
  const idempotencyKey = randomUUID();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={cartCopy.eyebrow}
        title={cartCopy.title}
        description={cartCopy.description}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/catalogue"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "min-h-11",
              )}
            >
              <ShoppingCart aria-hidden="true" data-icon="inline-start" />
              {cartCopy.continueShopping}
            </Link>
            {hasLines ? <ClearCartButton /> : null}
          </div>
        }
      />

      {summary.unavailableSkus.length > 0 ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-start gap-3">
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-destructive"
            />
            <p className="text-sm leading-6 text-destructive">
              {cartCopy.unavailable(summary.unavailableSkus.length)}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {!hasLines ? (
        <EmptyState
          icon={ShoppingCart}
          title={cartCopy.empty.title}
          description={cartCopy.empty.description}
          action={
            <Link
              href="/catalogue"
              className={cn(buttonVariants(), "min-h-11")}
            >
              {cartCopy.empty.action}
            </Link>
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <Card>
            <CardHeader>
              <CardTitle>{cartCopy.itemsHeading}</CardTitle>
              <CardDescription>
                {cartCopy.summary.items(summary.itemCount)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {summary.lines.map((line) => (
                  <CartLine
                    key={`${line.sku}-${line.paidQuantity}`}
                    line={line}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>

          <div className="space-y-6 lg:sticky lg:top-24">
            <CartSummary summary={summary} />
            <CheckoutForm
              reviewToken={reviewToken}
              idempotencyKey={idempotencyKey}
              disabled={summary.hasIssues}
              disabledReason={
                summary.hasIssues
                  ? "Resolve the highlighted cart notices and re-check the quantities before placing the order."
                  : null
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

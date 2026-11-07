import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CartSummary as CartSummaryData } from "@/lib/cart/types";
import { cartCopy } from "@/lib/i18n/cart-copy";
import { formatBasisPointsPercent, formatPaise } from "@/lib/money";

export function CartSummary({ summary }: { summary: CartSummaryData }) {
  const copy = cartCopy.summary;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.items(summary.itemCount)}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{copy.subtotal}</dt>
            <dd className="font-medium">{formatPaise(summary.subtotalPaise)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{copy.discount}</dt>
            <dd className="font-medium text-primary">
              {formatPaise(-summary.discountPaise)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{copy.taxable}</dt>
            <dd className="font-medium">{formatPaise(summary.taxablePaise)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{copy.gst}</dt>
            <dd className="font-medium">{formatPaise(summary.gstPaise)}</dd>
          </div>

          {summary.gstBreakdown.length > 0 ? (
            <div className="space-y-1 border-t border-border pt-2">
              {summary.gstBreakdown.map((row) => (
                <div
                  key={row.rateBasisPoints.toString()}
                  className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
                >
                  <dt>
                    {copy.gstLine(
                      formatBasisPointsPercent(row.rateBasisPoints),
                    )}
                  </dt>
                  <dd>{formatPaise(row.gstPaise)}</dd>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3">
            <dt className="text-base font-semibold">{copy.total}</dt>
            <dd className="text-xl font-semibold tracking-tight">
              {formatPaise(summary.totalPaise)}
            </dd>
          </div>
        </dl>

        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          {copy.priceNote}
        </p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {copy.checkoutNote}
        </p>
      </CardContent>
    </Card>
  );
}

import { AlertTriangle, Package } from "lucide-react";
import Image from "next/image";

import { CartLineControls } from "@/components/cart/cart-line-controls";
import { StockBadge } from "@/components/catalogue/stock-badge";
import { resolveProductImage } from "@/lib/catalogue/image";
import type { CartLineResult } from "@/lib/cart/types";
import { cartCopy } from "@/lib/i18n/cart-copy";
import { formatBasisPointsPercent, formatPaise } from "@/lib/money";

export function CartLine({ line }: { line: CartLineResult }) {
  const image = resolveProductImage(line.imageUrl);
  const gstPercent =
    line.gstRateBasisPoints !== null
      ? formatBasisPointsPercent(line.gstRateBasisPoints)
      : null;
  const canUpdate =
    line.availableCases !== null &&
    line.availableCases > 0 &&
    line.unitPricePaise !== null &&
    line.gstRateBasisPoints !== null;

  return (
    <li className="py-5 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="relative size-20 shrink-0 overflow-hidden rounded-lg bg-muted">
            {image ? (
              <Image
                src={image}
                alt=""
                width={80}
                height={80}
                unoptimized
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="grid h-full w-full place-items-center text-muted-foreground">
                <Package aria-hidden="true" className="size-6" />
              </span>
            )}
          </div>

          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold leading-6">{line.name}</h3>
              <StockBadge status={line.stockStatus} />
            </div>
            <p className="text-xs text-muted-foreground">
              SKU {line.sku} · {line.unitLabel}
              {line.brand ? ` · ${line.brand}` : ""}
            </p>
            <p className="text-sm">
              {line.unitPricePaise !== null
                ? formatPaise(line.unitPricePaise)
                : cartCopy.notices.PRICE_UNAVAILABLE}
              {gstPercent ? (
                <span className="text-muted-foreground">
                  {" "}
                  · {cartCopy.line.gstRate(gstPercent)}
                </span>
              ) : null}
            </p>

            {line.freeQuantity > 0 ? (
              <p className="text-xs font-medium text-primary">
                {cartCopy.line.freeUnits(line.freeQuantity)}
              </p>
            ) : null}

            {line.scheme?.type === "PERCENTAGE_DISCOUNT" ? (
              <p className="text-xs font-medium text-primary">
                {cartCopy.line.schemeDiscount}:{" "}
                {formatPaise(-line.discountPaise)}
              </p>
            ) : null}

            {line.availableCases !== null ? (
              <p className="text-xs text-muted-foreground">
                {cartCopy.line.stockLeft(line.availableCases)}
              </p>
            ) : null}

            {line.notices.length > 0 ? (
              <ul className="space-y-1 pt-1">
                {line.notices.map((notice) => (
                  <li
                    key={notice}
                    className="flex items-start gap-1.5 text-xs leading-5 text-destructive"
                  >
                    <AlertTriangle
                      aria-hidden="true"
                      className="mt-0.5 size-3.5 shrink-0"
                    />
                    <span>{cartCopy.notices[notice]}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        <div className="w-full space-y-3 lg:ml-auto lg:w-80 lg:shrink-0">
          <div className="flex items-baseline justify-between gap-3 lg:justify-end">
            <span className="text-xs text-muted-foreground">
              {cartCopy.line.lineTotal}
            </span>
            <span className="text-lg font-semibold tracking-tight">
              {formatPaise(line.totalPaise)}
            </span>
          </div>

          <CartLineControls
            key={`${line.sku}-${line.paidQuantity}`}
            sku={line.sku}
            name={line.name}
            quantity={line.paidQuantity}
            maxQuantity={line.availableCases ?? 0}
            canUpdate={canUpdate}
          />
        </div>
      </div>
    </li>
  );
}

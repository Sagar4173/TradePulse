import { BadgePercent, Package } from "lucide-react";
import Image from "next/image";

import { AddToCart } from "@/components/catalogue/add-to-cart";
import { StockBadge } from "@/components/catalogue/stock-badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { resolveProductImage } from "@/lib/catalogue/image";
import type { CatalogueItem } from "@/lib/catalogue/types";
import { catalogueCopy } from "@/lib/i18n/catalogue-copy";
import { formatBasisPointsPercent, formatPaise } from "@/lib/money";

export function ProductCard({ item }: { item: CatalogueItem }) {
  const copy = catalogueCopy.card;
  const image = resolveProductImage(item.imageUrl);
  const disabledReason =
    item.pricePaise === null
      ? copy.priceUnavailable
      : item.gstRateBasisPoints === null
        ? copy.gstUnavailable
        : item.stock.availableCases === null
          ? copy.stock.UNAVAILABLE
          : item.stock.availableCases === 0
            ? copy.stock.OUT_OF_STOCK
            : null;
  const maxQuantity = item.stock.availableCases ?? 0;

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <div className="relative -mt-4 aspect-[4/3] w-auto bg-muted">
        {image ? (
          <Image
            src={image}
            alt={copy.imageAlt(item.name)}
            width={640}
            height={480}
            unoptimized
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="grid h-full w-full place-items-center text-muted-foreground">
            <Package aria-hidden="true" className="size-10" />
            <span className="sr-only">{copy.imageAlt(item.name)}</span>
          </span>
        )}
        <div className="absolute left-3 top-3">
          <StockBadge status={item.stock.status} />
        </div>
      </div>

      <CardHeader className="gap-1">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {item.brand ? <span className="font-medium">{item.brand}</span> : null}
          {item.brand && item.category ? (
            <span aria-hidden="true">·</span>
          ) : null}
          {item.category ? <span>{item.category}</span> : null}
        </div>
        <CardTitle className="text-base leading-6">{item.name}</CardTitle>
        <p className="text-xs text-muted-foreground">
          SKU {item.sku} · {copy.perUnit(item.unitLabel)}
        </p>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        {item.description ? (
          <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
            {item.description}
          </p>
        ) : null}

        <div>
          {item.pricePaise !== null ? (
            <p className="text-xl font-semibold tracking-tight">
              {formatPaise(item.pricePaise)}
            </p>
          ) : (
            <p className="text-sm font-medium text-muted-foreground">
              {copy.priceUnavailable}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {item.gstRateBasisPoints !== null
              ? copy.gst(formatBasisPointsPercent(item.gstRateBasisPoints))
              : copy.gstUnavailable}
          </p>
        </div>

        <div className="text-xs text-muted-foreground">
          {item.stock.availableCases !== null
            ? copy.available(item.stock.availableCases)
            : copy.stock.UNAVAILABLE}
        </div>

        {item.schemeLabels.length > 0 ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {copy.schemesHeading}
            </p>
            <ul className="mt-1.5 space-y-1">
              {item.schemeLabels.map((label) => (
                <li
                  key={label}
                  className="flex items-start gap-1.5 text-xs font-medium text-primary"
                >
                  <BadgePercent
                    aria-hidden="true"
                    className="mt-0.5 size-3.5 shrink-0"
                  />
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>

      <CardFooter className="mt-auto pt-0">
        <div className="w-full">
          <AddToCart
            sku={item.sku}
            name={item.name}
            maxQuantity={maxQuantity}
            disabledReason={disabledReason}
          />
        </div>
      </CardFooter>
    </Card>
  );
}

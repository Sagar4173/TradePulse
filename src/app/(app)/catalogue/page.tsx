import { Boxes, Package, Store } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getPrismaClient } from "@/lib/db";
import { formatInr } from "@/lib/format";

export default async function CataloguePage() {
  const session = await requirePermission(PERMISSIONS.CATALOGUE_VIEW);
  const retailerId = session.user.retailerId;

  if (session.user.role !== "RETAILER" || !retailerId) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Catalogue"
          title="Product Catalogue"
          description="Retailer-specific pricing and stock visibility."
        />
        <EmptyState
          icon={Store}
          title={
            session.user.role === "RETAILER"
              ? "Store link pending"
              : "Retailer-scoped catalogue"
          }
          description={
            session.user.role === "RETAILER"
              ? "Your account is verified but not linked to a retailer record yet. An administrator must link your store before pricing is visible."
              : "This catalogue shows retailer-specific selling prices. It is available to retailer accounts linked to a store."
          }
        />
      </div>
    );
  }

  const prisma = getPrismaClient();
  const products = await prisma.product.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      sku: true,
      name: true,
      description: true,
      unitLabel: true,
      gstRate: true,
      inventory: { select: { stockCases: true } },
      prices: {
        where: { retailerId },
        select: { sellingPrice: true },
        take: 1,
      },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Catalogue"
        title="Product Catalogue"
        description="Prices shown are specific to your retailer account. Distributor dealer prices are never included."
      />

      {products.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No active products"
          description="The distributor has not published any active catalogue items yet."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {products.map((product) => {
            const sellingPrice = product.prices[0]?.sellingPrice;
            const stock = product.inventory?.stockCases ?? 0;

            return (
              <Card key={product.sku} className="h-full">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-base">{product.name}</CardTitle>
                      <CardDescription className="mt-1 font-mono text-xs">
                        {product.sku}
                      </CardDescription>
                    </div>
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                      {product.unitLabel}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="min-h-10 text-sm leading-5 text-muted-foreground">
                    {product.description ?? "Catalogue item"}
                  </p>
                  <div className="flex items-end justify-between gap-3 border-t border-border pt-3">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                        Your price
                      </p>
                      <p className="mt-1 text-lg font-semibold tabular-nums">
                        {sellingPrice
                          ? formatInr(sellingPrice)
                          : "Price on request"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                        Stock
                      </p>
                      <p className="mt-1 flex items-center justify-end gap-1.5 text-sm font-medium">
                        <Boxes aria-hidden="true" className="size-3.5" />
                        {stock} {stock === 1 ? "case" : "cases"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        GST {product.gstRate.toString()}%
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm leading-6 text-muted-foreground">
        Ordering, carts, scheme calculations, and checkout are intentionally not
        part of this milestone. This catalogue is read-only.
      </p>
    </div>
  );
}

import { Boxes, IndianRupee, Package, Tags } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
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

export const metadata: Metadata = {
  title: "Products — TradePulse",
  description: "Administrator product and pricing register.",
};

export default async function ProductsPage() {
  await requirePermission(PERMISSIONS.PRODUCTS_VIEW);
  const prisma = getPrismaClient();
  const products = await prisma.product.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      sku: true,
      name: true,
      description: true,
      unitLabel: true,
      dealerPrice: true,
      gstRate: true,
      isActive: true,
      inventory: { select: { stockCases: true, reservedCases: true } },
      _count: { select: { prices: true, schemes: true } },
    },
  });

  const activeCount = products.filter((product) => product.isActive).length;
  const outOfStockCount = products.filter(
    (product) => (product.inventory?.stockCases ?? 0) <= 0,
  ).length;
  const retailerPriceCount = products.reduce(
    (sum, product) => sum + product._count.prices,
    0,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administrator workspace"
        title="Products"
        description="Dealer pricing, tax rates, stock posture, and retailer-specific price coverage. Product editing belongs to a later milestone."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Products"
          value={String(products.length)}
          detail={`${activeCount} active in the catalogue`}
          icon={Package}
        />
        <StatCard
          label="Out of stock"
          value={String(outOfStockCount)}
          detail="Products with zero stock cases"
          icon={Boxes}
        />
        <StatCard
          label="Retailer prices"
          value={String(retailerPriceCount)}
          detail="Configured retailer-specific prices"
          icon={IndianRupee}
        />
        <StatCard
          label="Schemes"
          value={String(
            products.reduce((sum, product) => sum + product._count.schemes, 0),
          )}
          detail="Scheme records across products"
          icon={Tags}
        />
      </div>

      {products.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No products"
          description="Seed the development catalogue or add products before pricing and ordering workflows are enabled."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Product register</CardTitle>
            <CardDescription>
              Dealer prices are distributor-only and are never exposed to
              retailer sessions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] border-collapse text-left text-sm">
                <caption className="sr-only">Products and dealer pricing</caption>
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Product
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Unit
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Dealer price
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      GST
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Stock
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Retailer prices
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {products.map((product) => {
                    const available =
                      (product.inventory?.stockCases ?? 0) -
                      (product.inventory?.reservedCases ?? 0);

                    return (
                      <tr key={product.sku}>
                        <td className="max-w-[20rem] py-3 pr-4">
                          <p className="truncate font-medium">{product.name}</p>
                          <p className="font-mono text-xs text-muted-foreground">
                            {product.sku}
                          </p>
                        </td>
                        <td className="whitespace-nowrap py-3 pr-4 text-muted-foreground">
                          {product.unitLabel}
                        </td>
                        <td className="whitespace-nowrap py-3 pr-4 text-right tabular-nums">
                          {formatInr(product.dealerPrice)}
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums">
                          {product.gstRate.toString()}%
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums">
                          {available}
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums">
                          {product._count.prices}
                        </td>
                        <td className="py-3 text-right">
                          <span
                            className={
                              product.isActive
                                ? "rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                                : "rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                            }
                          >
                            {product.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

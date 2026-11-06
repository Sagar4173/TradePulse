import { AlertTriangle, Boxes, PackageCheck, Warehouse } from "lucide-react";
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
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = {
  title: "Inventory — TradePulse",
  description: "Administrator stock and reservation register.",
};

const LOW_STOCK_THRESHOLD = 10;

export default async function InventoryPage() {
  await requirePermission(PERMISSIONS.INVENTORY_VIEW);
  const prisma = getPrismaClient();
  const products = await prisma.product.findMany({
    orderBy: { name: "asc" },
    select: {
      sku: true,
      name: true,
      unitLabel: true,
      isActive: true,
      inventory: {
        select: {
          stockCases: true,
          reservedCases: true,
          updatedAt: true,
        },
      },
    },
  });

  const tracked = products.filter((product) => product.inventory);
  const totalStock = tracked.reduce(
    (sum, product) => sum + (product.inventory?.stockCases ?? 0),
    0,
  );
  const totalReserved = tracked.reduce(
    (sum, product) => sum + (product.inventory?.reservedCases ?? 0),
    0,
  );
  const lowStockCount = tracked.filter(
    (product) =>
      (product.inventory?.stockCases ?? 0) -
        (product.inventory?.reservedCases ?? 0) <
      LOW_STOCK_THRESHOLD,
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administrator workspace"
        title="Inventory"
        description="Stock cases, reservations, and available-to-sell quantities across the catalogue. Stock mutations belong to a later milestone."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Tracked products"
          value={String(tracked.length)}
          detail={`${products.length - tracked.length} without an inventory record`}
          icon={Warehouse}
        />
        <StatCard
          label="Stock cases"
          value={String(totalStock)}
          detail="Physical cases recorded"
          icon={Boxes}
        />
        <StatCard
          label="Reserved cases"
          value={String(totalReserved)}
          detail="Held for pending orders"
          icon={PackageCheck}
        />
        <StatCard
          label="Low stock"
          value={String(lowStockCount)}
          detail={`Available cases below ${LOW_STOCK_THRESHOLD}`}
          icon={AlertTriangle}
        />
      </div>

      {products.length === 0 ? (
        <EmptyState
          icon={Warehouse}
          title="No inventory"
          description="Products and inventory records will appear here once the development catalogue is seeded."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Stock register</CardTitle>
            <CardDescription>
              Available cases are stock minus reservations. Low-stock rows are
              highlighted for attention.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <caption className="sr-only">
                  Inventory by product
                </caption>
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Product
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Stock
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Reserved
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Available
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Status
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Updated
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {products.map((product) => {
                    const stock = product.inventory?.stockCases ?? 0;
                    const reserved = product.inventory?.reservedCases ?? 0;
                    const available = stock - reserved;
                    const isLowStock =
                      Boolean(product.inventory) &&
                      available < LOW_STOCK_THRESHOLD;

                    return (
                      <tr key={product.sku}>
                        <td className="max-w-[20rem] py-3 pr-4">
                          <p className="truncate font-medium">{product.name}</p>
                          <p className="font-mono text-xs text-muted-foreground">
                            {product.sku} · {product.unitLabel}
                          </p>
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums">
                          {product.inventory ? stock : "—"}
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums">
                          {product.inventory ? reserved : "—"}
                        </td>
                        <td className="py-3 pr-4 text-right font-semibold tabular-nums">
                          {product.inventory ? available : "—"}
                        </td>
                        <td className="py-3 pr-4">
                          {!product.inventory ? (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                              Not tracked
                            </span>
                          ) : isLowStock ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                              <AlertTriangle
                                aria-hidden="true"
                                className="size-3"
                              />
                              Low stock
                            </span>
                          ) : (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                              Healthy
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap py-3 text-right text-xs text-muted-foreground">
                          {product.inventory
                            ? formatDateTime(product.inventory.updatedAt)
                            : "—"}
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

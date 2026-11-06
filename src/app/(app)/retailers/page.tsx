import { IndianRupee, Store, Users } from "lucide-react";
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
import { PERMISSIONS, hasPermission } from "@/lib/auth/permissions";
import { requireAnyPermission } from "@/lib/auth/session";
import { getPrismaClient } from "@/lib/db";
import { formatPhoneForDisplay } from "@/lib/auth/phone";
import { formatInr } from "@/lib/format";

export const metadata: Metadata = {
  title: "Retailers — TradePulse",
  description: "Retailers visible within your authorized scope.",
};

export default async function RetailersPage() {
  const session = await requireAnyPermission([
    PERMISSIONS.RETAILERS_VIEW_ASSIGNED,
    PERMISSIONS.RETAILERS_VIEW_ALL,
  ]);
  const prisma = getPrismaClient();
  const canViewCredit = hasPermission(
    session.user.role,
    PERMISSIONS.CREDIT_VIEW_ALL,
  );

  let retailerIds: string[] | null = null;

  if (session.user.role === "SALESMAN") {
    const assignments = await prisma.salesmanRetailerAssignment.findMany({
      where: { salesmanId: session.user.id },
      select: { retailerId: true },
    });
    retailerIds = assignments.map((assignment) => assignment.retailerId);

    if (retailerIds.length === 0) {
      return (
        <div className="space-y-6">
          <PageHeader
            eyebrow="Salesman workspace"
            title="Assigned Retailers"
            description="Your retailer list is limited to assignments made by an administrator."
          />
          <EmptyState
            icon={Store}
            title="No retailers assigned"
            description="Ask an administrator to assign retailers to your account. Until then, no retailer or credit data is accessible."
          />
        </div>
      );
    }
  }

  const retailers = await prisma.retailer.findMany({
    where: retailerIds ? { id: { in: retailerIds } } : {},
    orderBy: { shopName: "asc" },
    select: {
      id: true,
      shopName: true,
      ownerName: true,
      phone: true,
      _count: { select: { orders: true, users: true } },
      // Credit limits are only fetched for roles authorized to see them.
      ...(canViewCredit ? { creditLimit: true } : {}),
    },
  });

  const title =
    session.user.role === "SALESMAN" ? "Assigned Retailers" : "Retailers";
  const totalOrders = retailers.reduce(
    (sum, retailer) => sum + retailer._count.orders,
    0,
  );
  const totalCredit = canViewCredit
    ? retailers.reduce(
        (sum, retailer) =>
          sum + ("creditLimit" in retailer ? Number(retailer.creditLimit) : 0),
        0,
      )
    : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          session.user.role === "SALESMAN"
            ? "Salesman workspace"
            : "Operations"
        }
        title={title}
        description={
          session.user.role === "SALESMAN"
            ? "Only the retailers assigned to you are shown. Credit information is not included in the salesman scope."
            : "Retailer accounts, contact details, order counts, and credit limits for authorized distributor roles."
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Visible retailers"
          value={String(retailers.length)}
          detail="Limited to your authorized scope"
          icon={Store}
        />
        <StatCard
          label="Orders"
          value={String(totalOrders)}
          detail="Orders from visible retailers"
          icon={Users}
        />
        {canViewCredit ? (
          <StatCard
            label="Credit exposure"
            value={formatInr(totalCredit)}
            detail="Combined configured credit limits"
            icon={IndianRupee}
          />
        ) : null}
      </div>

      {retailers.length === 0 ? (
        <EmptyState
          icon={Store}
          title="No retailers found"
          description="No retailer records are visible in your current scope."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Retailer register</CardTitle>
            <CardDescription>
              {retailers.length} retailer{retailers.length === 1 ? "" : "s"} in
              your authorized scope.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <caption className="sr-only">
                  Retailers visible to your role
                </caption>
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Store
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Owner
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Mobile
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Orders
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Users
                    </th>
                    {canViewCredit ? (
                      <th scope="col" className="py-2 text-right font-medium">
                        Credit limit
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {retailers.map((retailer) => (
                    <tr key={retailer.id}>
                      <td className="max-w-[16rem] py-3 pr-4">
                        <p className="truncate font-medium">
                          {retailer.shopName}
                        </p>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {retailer.id}
                        </p>
                      </td>
                      <td className="max-w-[12rem] truncate py-3 pr-4 text-muted-foreground">
                        {retailer.ownerName}
                      </td>
                      <td className="whitespace-nowrap py-3 pr-4 text-muted-foreground">
                        {formatPhoneForDisplay(retailer.phone)}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums">
                        {retailer._count.orders}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums">
                        {retailer._count.users}
                      </td>
                      {canViewCredit && "creditLimit" in retailer ? (
                        <td className="whitespace-nowrap py-3 text-right font-semibold tabular-nums">
                          {formatInr(retailer.creditLimit)}
                        </td>
                      ) : canViewCredit ? (
                        <td className="whitespace-nowrap py-3 text-right font-semibold tabular-nums">
                          —
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

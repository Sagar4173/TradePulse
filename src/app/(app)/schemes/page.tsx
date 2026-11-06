import { BadgePercent, CalendarClock, Percent, Tags } from "lucide-react";
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
import { SchemeType } from "@/generated/prisma/enums";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getPrismaClient } from "@/lib/db";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "Schemes — TradePulse",
  description: "Administrator scheme register.",
};

function schemeMechanics(scheme: {
  type: string;
  minimumQuantity: number | null;
  freeQuantity: number | null;
  discountPercent: { toString(): string } | null;
}): string {
  if (scheme.type === SchemeType.BUY_X_GET_Y) {
    const minimum = scheme.minimumQuantity ?? 0;
    const free = scheme.freeQuantity ?? 0;
    return `Buy ${minimum}, get ${free} free`;
  }

  return `${scheme.discountPercent?.toString() ?? "0"}% discount`;
}

function schemeStatus(scheme: {
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}): { label: string; className: string } {
  const now = new Date();

  if (!scheme.isActive) {
    return {
      label: "Inactive",
      className: "bg-muted text-muted-foreground",
    };
  }

  if (scheme.startsAt && scheme.startsAt > now) {
    return {
      label: "Scheduled",
      className: "bg-accent text-accent-foreground",
    };
  }

  if (scheme.endsAt && scheme.endsAt < now) {
    return {
      label: "Expired",
      className: "bg-destructive/10 text-destructive",
    };
  }

  return { label: "Live", className: "bg-primary/10 text-primary" };
}

export default async function SchemesPage() {
  await requirePermission(PERMISSIONS.SCHEMES_VIEW);
  const prisma = getPrismaClient();
  const schemes = await prisma.scheme.findMany({
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      type: true,
      isActive: true,
      startsAt: true,
      endsAt: true,
      minimumQuantity: true,
      freeQuantity: true,
      discountPercent: true,
      product: { select: { sku: true, name: true, unitLabel: true } },
    },
  });

  const liveCount = schemes.filter(
    (scheme) => schemeStatus(scheme).label === "Live",
  ).length;
  const buyXGetYCount = schemes.filter(
    (scheme) => scheme.type === SchemeType.BUY_X_GET_Y,
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administrator workspace"
        title="Schemes"
        description="Configured distributor offers and their products. Scheme calculation and application are intentionally handled in a later milestone."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Schemes"
          value={String(schemes.length)}
          detail="All configured offers"
          icon={Tags}
        />
        <StatCard
          label="Live now"
          value={String(liveCount)}
          detail="Active and within the validity window"
          icon={CalendarClock}
        />
        <StatCard
          label="Buy X get Y"
          value={String(buyXGetYCount)}
          detail="Quantity-based offers"
          icon={BadgePercent}
        />
        <StatCard
          label="Percentage"
          value={String(schemes.length - buyXGetYCount)}
          detail="Discount-based offers"
          icon={Percent}
        />
      </div>

      {schemes.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="No schemes configured"
          description="Scheme records will appear here once the distributor publishes offers for the catalogue."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Scheme register</CardTitle>
            <CardDescription>
              Read-only in this milestone. No scheme amounts are applied to
              orders yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <caption className="sr-only">
                  Configured product schemes
                </caption>
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Scheme
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Product
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Mechanics
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Validity
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {schemes.map((scheme) => {
                    const status = schemeStatus(scheme);

                    return (
                      <tr key={scheme.id}>
                        <td className="max-w-[14rem] py-3 pr-4">
                          <p className="truncate font-medium">{scheme.name}</p>
                          <p className="font-mono text-xs text-muted-foreground">
                            {scheme.id.slice(-8).toUpperCase()}
                          </p>
                        </td>
                        <td className="max-w-[16rem] py-3 pr-4">
                          <p className="truncate">{scheme.product.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {scheme.product.unitLabel}
                          </p>
                        </td>
                        <td className="whitespace-nowrap py-3 pr-4 text-muted-foreground">
                          {schemeMechanics(scheme)}
                        </td>
                        <td className="whitespace-nowrap py-3 pr-4 text-xs text-muted-foreground">
                          {scheme.startsAt || scheme.endsAt ? (
                            <>
                              {scheme.startsAt
                                ? formatDate(scheme.startsAt)
                                : "Open start"}
                              {" — "}
                              {scheme.endsAt
                                ? formatDate(scheme.endsAt)
                                : "Open end"}
                            </>
                          ) : (
                            "Always available"
                          )}
                        </td>
                        <td className="py-3 text-right">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}
                          >
                            {status.label}
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

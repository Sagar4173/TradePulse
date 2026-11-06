import { CalendarDays, LogOut, Phone, ShieldCheck, Store } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { logoutAction } from "@/lib/auth/actions";
import { ROLE_LABELS } from "@/lib/auth/navigation";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getPrismaClient } from "@/lib/db";
import { formatPhoneForDisplay } from "@/lib/auth/phone";
import { formatDate, formatInr } from "@/lib/format";

export default async function AccountPage() {
  const session = await requirePermission(PERMISSIONS.ACCOUNT_VIEW);
  const prisma = getPrismaClient();
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      phone: true,
      role: true,
      status: true,
      createdAt: true,
      phoneVerifiedAt: true,
      lastLoginAt: true,
      retailer: {
        select: {
          shopName: true,
          ownerName: true,
          phone: true,
          creditLimit: true,
        },
      },
      _count: { select: { assignedRetailers: true } },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Account"
        title="Your account"
        description="Your verified identity, role, and store link. Role and store changes are managed by an administrator."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              This number was verified with a one-time code.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Name
              </p>
              <p className="mt-1 font-medium">{user?.name ?? session.user.name}</p>
            </div>
            <div className="flex items-start gap-3">
              <Phone aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" />
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Verified mobile
                </p>
                <p className="mt-1 font-medium">
                  {formatPhoneForDisplay(session.user.phone)}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ShieldCheck aria-hidden="true" className="size-3.5" />
                  {user?.phoneVerifiedAt
                    ? `Verified ${formatDate(user.phoneVerifiedAt)}`
                    : "Phone verified"}
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Role
              </p>
              <p className="mt-1 font-medium">
                {ROLE_LABELS[session.user.role]}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Account status
              </p>
              <p className="mt-1 font-medium">
                {user?.status === "ACTIVE" ? "Active" : "Disabled"}
              </p>
            </div>
            <form action={logoutAction}>
              <Button type="submit" variant="outline" className="w-full sm:w-auto">
                <LogOut aria-hidden="true" data-icon="inline-start" />
                Sign out
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Store and permissions</CardTitle>
            <CardDescription>
              Access is always re-checked on the server for every page and
              action.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {user?.retailer ? (
              <>
                <div className="flex items-start gap-3">
                  <Store aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                      Retailer
                    </p>
                    <p className="mt-1 font-medium">{user.retailer.shopName}</p>
                    <p className="text-sm text-muted-foreground">
                      {user.retailer.ownerName}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatPhoneForDisplay(user.retailer.phone)}
                    </p>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    Credit limit
                  </p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">
                    {formatInr(user.retailer.creditLimit)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Visible only to your store and authorized distributor roles.
                  </p>
                </div>
              </>
            ) : session.user.role === "SALESMAN" ? (
              <div className="flex items-start gap-3">
                <Store aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" />
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    Assigned retailers
                  </p>
                  <p className="mt-1 text-xl font-semibold">
                    {user?._count.assignedRetailers ?? 0}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Only orders and retailers in this assignment scope are
                    accessible.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <ShieldCheck
                  aria-hidden="true"
                  className="mt-0.5 size-4 text-muted-foreground"
                />
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    Workspace access
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Your role uses explicit server-side permissions. Every
                    protected page and action re-checks your current role and
                    account status.
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-start gap-3 border-t border-border pt-4">
              <CalendarDays
                aria-hidden="true"
                className="mt-0.5 size-4 text-muted-foreground"
              />
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Account since
                </p>
                <p className="mt-1 text-sm">
                  {user ? formatDate(user.createdAt) : "—"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Last sign-in:{" "}
                  {user?.lastLoginAt ? formatDate(user.lastLoginAt) : "—"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

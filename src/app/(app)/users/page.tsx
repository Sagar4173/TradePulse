import { Link2, ShieldCheck, UserCheck, UserX, Users } from "lucide-react";
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
import {
  RetailerLinkReview,
  type PendingRetailerLinkRow,
} from "@/components/users/retailer-link-review";
import {
  UserAccessEditor,
  type RetailerOption,
  type UserAccessRow,
} from "@/components/users/user-access-editor";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import {
  listAdminUsers,
  listPendingRetailerLinkRequests,
  listRetailerOptions,
} from "@/lib/users/repository";

export const metadata: Metadata = {
  title: "Users — TradePulse",
  description: "Administrator-only user access management.",
};

export default async function UsersPage() {
  const session = await requirePermission(PERMISSIONS.USERS_VIEW);
  const [users, retailers, pendingLinkRequests] = await Promise.all([
    listAdminUsers(),
    listRetailerOptions(),
    listPendingRetailerLinkRequests(),
  ]);

  const rows: UserAccessRow[] = users.map((user) => ({
    id: user.id,
    name: user.name,
    phone: user.phone,
    role: user.role as UserAccessRow["role"],
    status: user.status as UserAccessRow["status"],
    retailerId: user.retailerId,
    retailerShopName: user.retailerShopName,
    assignedRetailerIds: user.assignedRetailerIds,
    createdAt: user.createdAt.toISOString(),
  }));
  const retailerOptions: RetailerOption[] = retailers;
  const pendingLinks: PendingRetailerLinkRow[] = pendingLinkRequests.map(
    (request) => ({
      id: request.id,
      userName: request.userName,
      userPhone: request.userPhone,
      retailerShopName: request.retailerShopName,
      retailerOwnerName: request.retailerOwnerName,
      createdAt: request.createdAt.toISOString(),
    }),
  );
  const activeCount = rows.filter((user) => user.status === "ACTIVE").length;
  const disabledCount = rows.length - activeCount;
  const adminCount = rows.filter((user) => user.role === "ADMIN").length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administrator workspace"
        title="Users"
        description="Review verified accounts and manage role, status, and retailer scope. Every change is re-authorized on the server and recorded in the audit trail."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Users"
          value={String(rows.length)}
          detail="All provisioned accounts"
          icon={Users}
        />
        <StatCard
          label="Active"
          value={String(activeCount)}
          detail="Accounts able to sign in"
          icon={UserCheck}
        />
        <StatCard
          label="Disabled"
          value={String(disabledCount)}
          detail="Blocked from signing in"
          icon={UserX}
        />
        <StatCard
          label="Administrators"
          value={String(adminCount)}
          detail="At least one active admin must remain"
          icon={ShieldCheck}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 aria-hidden="true" className="size-4" />
            Retailer link requests
          </CardTitle>
          <CardDescription>
            A verified phone that matches an existing retailer is never linked
            automatically. Approving uses the retailer stored on the request and
            is recorded in the audit trail.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RetailerLinkReview requests={pendingLinks} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>User access</CardTitle>
          <CardDescription>
            Public sign-in can only create retailer accounts. Administrator and
            order-desk access must be assigned here by an administrator.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No users yet"
              description="Users appear here after a verified phone number signs in or an administrator provisions an account."
            />
          ) : (
            <UserAccessEditor
              users={rows}
              retailers={retailerOptions}
              currentUserId={session.user.id}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

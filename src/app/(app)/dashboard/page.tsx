import {
  Boxes,
  ClipboardList,
  IndianRupee,
  ScrollText,
  Store,
  Users,
} from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { OrderStatus } from "@/generated/prisma/enums";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getPrismaClient } from "@/lib/db";
import {
  formatDateTime,
  formatInr,
  titleCase,
} from "@/lib/format";

type RecentOrder = {
  id: string;
  status: string;
  total: { toString(): string } | string | number;
  createdAt: Date;
  retailer?: { shopName: string } | null;
};

function RecentOrders({
  orders,
  showRetailer = false,
}: {
  orders: RecentOrder[];
  showRetailer?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent orders</CardTitle>
        <CardDescription>
          {orders.length > 0
            ? "The latest orders in your authorized scope."
            : "No orders are visible in your scope yet."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {orders.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            Order activity will appear here once orders are created in a later
            milestone.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {orders.map((order) => (
              <li
                key={order.id}
                className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {order.id.slice(-8).toUpperCase()}
                    </span>
                    <OrderStatusBadge status={order.status} />
                  </div>
                  <p className="mt-1 truncate text-sm">
                    {showRetailer && order.retailer
                      ? order.retailer.shopName
                      : formatDateTime(order.createdAt)}
                  </p>
                  {showRetailer ? (
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(order.createdAt)}
                    </p>
                  ) : null}
                </div>
                <p className="text-sm font-semibold tabular-nums">
                  {formatInr(order.total)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

async function RetailerDashboard({
  retailerId,
}: {
  retailerId: string | null;
}) {
  if (!retailerId) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Retailer workspace"
          title="Dashboard"
          description="Your verified number is ready, but your store is not linked yet."
        />
        <EmptyState
          icon={Store}
          title="Store link pending"
          description="Your phone number is verified. Ask a TradePulse administrator to link your user account to your retailer record to see store pricing and orders."
        />
      </div>
    );
  }

  const prisma = getPrismaClient();
  const [retailer, activeProducts, orderCount, recentOrders] = await Promise.all(
    [
      prisma.retailer.findUnique({
        where: { id: retailerId },
        select: { shopName: true, creditLimit: true },
      }),
      prisma.product.count({ where: { isActive: true } }),
      prisma.order.count({ where: { retailerId } }),
      prisma.order.findMany({
        where: { retailerId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, status: true, total: true, createdAt: true },
      }),
    ],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Retailer workspace"
        title="Dashboard"
        description={`Overview for ${retailer?.shopName ?? "your store"} with your authorized pricing and order scope.`}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Store"
          value={retailer?.shopName ?? "Linked store"}
          detail="Your retailer account"
          icon={Store}
        />
        <StatCard
          label="Credit limit"
          value={formatInr(retailer?.creditLimit ?? 0)}
          detail="Visible only to your account"
          icon={IndianRupee}
        />
        <StatCard
          label="Catalogue"
          value={String(activeProducts)}
          detail="Active products in the TradePulse catalogue"
          icon={Boxes}
        />
        <StatCard
          label="Orders"
          value={String(orderCount)}
          detail="Orders placed by your store"
          icon={ClipboardList}
        />
      </div>
      <RecentOrders orders={recentOrders} />
    </div>
  );
}

async function SalesmanDashboard({ userId }: { userId: string }) {
  const prisma = getPrismaClient();
  const assignments = await prisma.salesmanRetailerAssignment.findMany({
    where: { salesmanId: userId },
    select: { retailerId: true },
  });
  const retailerIds = assignments.map((assignment) => assignment.retailerId);
  const [orderCount, recentOrders] = await Promise.all([
    retailerIds.length > 0
      ? prisma.order.count({ where: { retailerId: { in: retailerIds } } })
      : Promise.resolve(0),
    retailerIds.length > 0
      ? prisma.order.findMany({
          where: { retailerId: { in: retailerIds } },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            status: true,
            total: true,
            createdAt: true,
            retailer: { select: { shopName: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Salesman workspace"
        title="Dashboard"
        description="Your assigned retailers and their order activity. Access is limited to assignments made by an administrator."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Assigned retailers"
          value={String(retailerIds.length)}
          detail="Stores in your field scope"
          icon={Store}
        />
        <StatCard
          label="Assigned orders"
          value={String(orderCount)}
          detail="Orders from your assigned retailers"
          icon={ClipboardList}
        />
        <StatCard
          label="Access model"
          value="Assigned only"
          detail="Retailers outside your assignment are not accessible"
          icon={Users}
        />
      </div>
      {retailerIds.length === 0 ? (
        <EmptyState
          icon={Store}
          title="No retailers assigned yet"
          description="An administrator can assign retailers to your account. Until then, no retailer or order data is accessible."
        />
      ) : (
        <RecentOrders orders={recentOrders} showRetailer />
      )}
    </div>
  );
}

async function OrderDeskDashboard() {
  const prisma = getPrismaClient();
  const [retailerCount, pendingCount, orderCount, recentOrders] =
    await Promise.all([
      prisma.retailer.count(),
      prisma.order.count({ where: { status: OrderStatus.PENDING_REVIEW } }),
      prisma.order.count(),
      prisma.order.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          status: true,
          total: true,
          createdAt: true,
          retailer: { select: { shopName: true } },
        },
      }),
    ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Order desk workspace"
        title="Dashboard"
        description="Distributor-wide order and retailer visibility with explicit order-desk permissions."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Retailers"
          value={String(retailerCount)}
          detail="Retailer accounts in the network"
          icon={Store}
        />
        <StatCard
          label="Awaiting review"
          value={String(pendingCount)}
          detail="Orders pending order-desk review"
          icon={ClipboardList}
        />
        <StatCard
          label="All orders"
          value={String(orderCount)}
          detail="Visible to Order Desk and Admin"
          icon={ScrollText}
        />
        <StatCard
          label="Credit visibility"
          value="Network"
          detail="Retailer credit data is available on the retailers page"
          icon={IndianRupee}
        />
      </div>
      <RecentOrders orders={recentOrders} showRetailer />
    </div>
  );
}

async function AdminDashboard() {
  const prisma = getPrismaClient();
  const [userCount, retailerCount, productCount, pendingCount, auditEvents] =
    await Promise.all([
      prisma.user.count(),
      prisma.retailer.count(),
      prisma.product.count({ where: { isActive: true } }),
      prisma.order.count({ where: { status: OrderStatus.PENDING_REVIEW } }),
      prisma.auditEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: 6,
        select: {
          id: true,
          eventType: true,
          entityType: true,
          entityId: true,
          createdAt: true,
          actor: { select: { name: true } },
        },
      }),
    ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administrator workspace"
        title="Dashboard"
        description="Central operational visibility, user access, and audit activity for the TradePulse network."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Users"
          value={String(userCount)}
          detail="All provisioned accounts"
          icon={Users}
        />
        <StatCard
          label="Retailers"
          value={String(retailerCount)}
          detail="Retailer records in the network"
          icon={Store}
        />
        <StatCard
          label="Active products"
          value={String(productCount)}
          detail="Products available in the catalogue"
          icon={Boxes}
        />
        <StatCard
          label="Awaiting review"
          value={String(pendingCount)}
          detail="Orders pending order-desk review"
          icon={ClipboardList}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Recent audit activity</CardTitle>
          <CardDescription>
            Access changes and operational events recorded by the system.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {auditEvents.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              Audit events will appear here as users and operations are managed.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {auditEvents.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {titleCase(event.eventType)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {event.entityType} · {event.entityId.slice(-8)}
                      {event.actor ? ` · ${event.actor.name}` : ""}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(event.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default async function DashboardPage() {
  const session = await requirePermission(PERMISSIONS.DASHBOARD_VIEW);

  switch (session.user.role) {
    case "RETAILER":
      return <RetailerDashboard retailerId={session.user.retailerId} />;
    case "SALESMAN":
      return <SalesmanDashboard userId={session.user.id} />;
    case "ORDER_DESK":
      return <OrderDeskDashboard />;
    case "ADMIN":
      return <AdminDashboard />;
  }
}

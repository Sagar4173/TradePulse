import { Activity, ScrollText, Users } from "lucide-react";
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
import { formatDateTime, titleCase } from "@/lib/format";

export const metadata: Metadata = {
  title: "Audit Logs — TradePulse",
  description: "Administrator audit trail.",
};

const MAX_METADATA_LENGTH = 1_200;

export default async function AuditLogsPage() {
  await requirePermission(PERMISSIONS.AUDIT_VIEW);
  const prisma = getPrismaClient();
  const events = await prisma.auditEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      eventType: true,
      entityType: true,
      entityId: true,
      metadata: true,
      createdAt: true,
      actor: { select: { name: true, role: true } },
    },
  });

  const uniqueActors = new Set(
    events.map((event) => event.actor?.name).filter(Boolean),
  ).size;
  const lastEventAt = events[0]?.createdAt ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administrator workspace"
        title="Audit Logs"
        description="An append-only record of access changes and operational events. Metadata is shown only to administrators."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Events shown"
          value={String(events.length)}
          detail="Most recent 100 records"
          icon={ScrollText}
        />
        <StatCard
          label="Actors"
          value={String(uniqueActors)}
          detail="Distinct signed-in actors"
          icon={Users}
        />
        <StatCard
          label="Last activity"
          value={lastEventAt ? formatDateTime(lastEventAt) : "—"}
          detail="Most recent recorded event"
          icon={Activity}
        />
      </div>

      {events.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No audit activity"
          description="Audit events appear when administrators change user access or future operational workflows record activity."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Activity trail</CardTitle>
            <CardDescription>
              Newest first. This milestone records user access changes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="divide-y divide-border">
              {events.map((event) => {
                let metadata = "";

                try {
                  metadata = JSON.stringify(event.metadata, null, 2).slice(
                    0,
                    MAX_METADATA_LENGTH,
                  );
                } catch {
                  metadata = "Metadata could not be displayed.";
                }

                return (
                  <li key={event.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {titleCase(event.eventType)}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {event.entityType} ·{" "}
                          <span className="font-mono text-xs">
                            {event.entityId}
                          </span>
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {event.actor
                            ? `${event.actor.name} (${titleCase(event.actor.role)})`
                            : "System"}
                        </p>
                      </div>
                      <time
                        dateTime={event.createdAt.toISOString()}
                        className="shrink-0 text-xs text-muted-foreground"
                      >
                        {formatDateTime(event.createdAt)}
                      </time>
                    </div>
                    <details className="mt-2">
                      <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-md text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        View metadata
                      </summary>
                      <pre className="mt-2 max-h-64 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-xs leading-5">
                        {metadata}
                      </pre>
                    </details>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

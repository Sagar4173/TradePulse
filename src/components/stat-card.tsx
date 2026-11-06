import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type StatCardProps = {
  label: string;
  value: string;
  detail?: string;
  icon: LucideIcon;
  className?: string;
};

export function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  className,
}: StatCardProps) {
  return (
    <Card size="sm" className={cn("min-w-0", className)}>
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 truncate text-2xl font-semibold tracking-tight">
            {value}
          </p>
          {detail ? (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {detail}
            </p>
          ) : null}
        </div>
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground">
          <Icon aria-hidden="true" className="size-4.5" />
        </span>
      </CardContent>
    </Card>
  );
}

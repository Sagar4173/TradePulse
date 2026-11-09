import { orderStatusLabel } from "@/lib/orders/status";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground ring-border",
  PENDING_REVIEW: "bg-accent text-accent-foreground ring-accent-foreground/15",
  APPROVED: "bg-secondary text-secondary-foreground ring-primary/15",
  PROCESSING: "bg-accent text-accent-foreground ring-accent-foreground/15",
  READY_FOR_DISPATCH:
    "bg-[color-mix(in_oklab,var(--primary)_10%,transparent)] text-primary ring-primary/20",
  DISPATCHED:
    "bg-[color-mix(in_oklab,var(--primary)_10%,transparent)] text-primary ring-primary/20",
  DELIVERED: "bg-secondary text-secondary-foreground ring-primary/15",
  ON_CREDIT_HOLD:
    "bg-[color-mix(in_oklab,var(--destructive)_12%,transparent)] text-destructive ring-destructive/20",
  REJECTED:
    "bg-[color-mix(in_oklab,var(--destructive)_12%,transparent)] text-destructive ring-destructive/20",
  FULFILLED: "bg-secondary text-secondary-foreground ring-primary/15",
  CANCELLED: "bg-muted text-muted-foreground ring-border",
};

export function OrderStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        STATUS_STYLES[status] ?? STATUS_STYLES.DRAFT,
      )}
    >
      {orderStatusLabel(status)}
    </span>
  );
}

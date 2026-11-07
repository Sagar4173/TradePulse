import { Badge } from "@/components/ui/badge";
import type { StockStatus } from "@/lib/inventory/stock";
import { catalogueCopy } from "@/lib/i18n/catalogue-copy";
import { cn } from "@/lib/utils";

const STATUS_CLASSES: Record<StockStatus, string> = {
  IN_STOCK: "border-emerald-200 bg-emerald-50 text-emerald-800",
  LOW_STOCK: "border-amber-200 bg-amber-50 text-amber-900",
  OUT_OF_STOCK: "border-destructive/30 bg-destructive/10 text-destructive",
  UNAVAILABLE: "border-border bg-muted text-muted-foreground",
};

export function StockBadge({
  status,
  className,
}: {
  status: StockStatus;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("border", STATUS_CLASSES[status], className)}
    >
      {catalogueCopy.card.stock[status]}
    </Badge>
  );
}

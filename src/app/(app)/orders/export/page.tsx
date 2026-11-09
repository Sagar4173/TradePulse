import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  IndianRupee,
  ListOrdered,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { formatInr } from "@/lib/format";
import { orderStatusLabel } from "@/lib/orders/status";
import {
  TALLY_EXPORT_EXCLUDED_STATUSES,
  TALLY_EXPORT_MAX_LINES,
  TALLY_EXPORT_MAX_ORDERS,
  TALLY_EXPORT_STATUSES,
  parseTallyExportFilters,
  tallyExportFilename,
  tallyExportLimitProblem,
  type TallyExportFilters,
} from "@/lib/orders/tally-export";
import { summarizeTallyExport } from "@/lib/orders/tally-export-repository";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Tally export — TradePulse",
  description:
    "Download approved orders as a Tally-compatible, line-level CSV export.",
};

export default async function TallyExportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission(PERMISSIONS.ORDERS_EXPORT);

  const filters = parseTallyExportFilters(await searchParams);
  const summary = await summarizeTallyExport(filters);
  const limitProblem = tallyExportLimitProblem(summary);
  const isEmpty = summary.orderCount === 0 || summary.lineCount === 0;
  const ready = !limitProblem && !isEmpty;
  const overOrderLimit = summary.orderCount > TALLY_EXPORT_MAX_ORDERS;
  const orderLimit = TALLY_EXPORT_MAX_ORDERS.toLocaleString("en-IN");
  const lineLimit = TALLY_EXPORT_MAX_LINES.toLocaleString("en-IN");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Order desk workspace"
        title="Tally export"
        description="Download approved orders as a UTF-8 CSV for Tally import or field mapping. Only approved and post-approval orders are included."
        actions={
          <Link
            href="/orders"
            className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
          >
            Back to orders
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Eligible orders"
          value={
            overOrderLimit
              ? `${orderLimit}+`
              : summary.orderCount.toLocaleString("en-IN")
          }
          detail={
            overOrderLimit
              ? "More than the export maximum; narrow the dates"
              : `Maximum ${orderLimit} per export`
          }
          icon={FileText}
        />
        <StatCard
          label="Order lines"
          value={
            overOrderLimit
              ? "—"
              : summary.lineCount.toLocaleString("en-IN")
          }
          detail={
            overOrderLimit
              ? "Not counted because the order limit is exceeded"
              : `Maximum ${lineLimit} per export`
          }
          icon={ListOrdered}
        />
        <StatCard
          label="Order value"
          value={overOrderLimit ? "—" : formatInr(summary.total)}
          detail={
            overOrderLimit
              ? "Narrow the dates for an exact total"
              : "GST-inclusive total of eligible orders"
          }
          icon={IndianRupee}
        />
      </div>

      <ExportFilterForm filters={filters} />

      {ready ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2
                aria-hidden="true"
                className="size-5 text-primary"
              />
              Ready to export
            </CardTitle>
            <CardDescription>
              {summary.orderCount.toLocaleString("en-IN")} eligible orders and{" "}
              {summary.lineCount.toLocaleString("en-IN")} order lines. The file
              will be named{" "}
              <span className="font-mono text-xs">
                {tallyExportFilename(filters)}
              </span>
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              method="post"
              action="/orders/export/download"
              className="flex flex-wrap items-center gap-3"
            >
              {filters.from ? (
                <input type="hidden" name="from" value={filters.from} />
              ) : null}
              {filters.to ? (
                <input type="hidden" name="to" value={filters.to} />
              ) : null}
              <button
                type="submit"
                className={cn(buttonVariants(), "min-h-11")}
              >
                <Download aria-hidden="true" className="size-4" />
                Download CSV
              </button>
              <p className="text-xs text-muted-foreground">
                UTF-8 CSV · bounded to {orderLimit} orders / {lineLimit} lines
              </p>
            </form>
            <p className="text-xs leading-5 text-muted-foreground">
              Each successful download is recorded in the audit trail. Exporting
              is read-only: it never creates, approves, or modifies an order.
            </p>
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          icon={limitProblem ? AlertTriangle : FileText}
          title={
            limitProblem === "ORDER_LIMIT"
              ? "Too many orders to export"
              : limitProblem === "LINE_LIMIT"
                ? "Too many order lines to export"
                : "No eligible orders"
          }
          description={
            limitProblem === "ORDER_LIMIT"
              ? overOrderLimit
                ? `This range contains more than ${orderLimit} eligible orders. Narrow the order dates to ${orderLimit} orders or fewer.`
                : `This range contains ${summary.orderCount.toLocaleString("en-IN")} eligible orders. Narrow the order dates to ${orderLimit} orders or fewer.`
              : limitProblem === "LINE_LIMIT"
                ? `This range contains ${summary.lineCount.toLocaleString("en-IN")} order lines. Narrow the order dates to ${lineLimit} lines or fewer.`
                : "No approved or post-approval orders match these dates. Draft, pending-review, credit-held, rejected, and cancelled orders are never exported."
          }
          action={
            <Link
              href="/orders/export"
              className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
            >
              Clear date filters
            </Link>
          }
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>What the CSV contains</CardTitle>
          <CardDescription>
            One row per order line, copied from the immutable order snapshot.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-6 text-muted-foreground">
          <div>
            <h2 className="font-medium text-foreground">Included columns</h2>
            <p>
              Order number, order date, customer name, SKU, product name, unit,
              paid quantity, free quantity, unit price, discount, scheme
              name/type/percentage, GST rate, GST amount, line total, and order
              total. The customer name is the retailer&apos;s current shop name;
              no GSTIN is exported because it is not stored on the order.
            </p>
          </div>
          <div>
            <h2 className="font-medium text-foreground">
              Price and GST basis
            </h2>
            <p>
              Product prices are stored and exported{" "}
              <strong className="text-foreground">excluding GST</strong>. The
              scheme discount reduces the taxable value, GST is added at the
              stored rate, and line total and order total{" "}
              <strong className="text-foreground">include GST</strong>. The order
              total repeats on every line for flat-file mapping.
            </p>
          </div>
          <div>
            <h2 className="font-medium text-foreground">Eligible statuses</h2>
            <p>
              Exported:{" "}
              {TALLY_EXPORT_STATUSES.map((status) =>
                orderStatusLabel(status),
              ).join(", ")}
              . Never exported:{" "}
              {TALLY_EXPORT_EXCLUDED_STATUSES.map((status) =>
                orderStatusLabel(status),
              ).join(", ")}
              .
            </p>
          </div>
          <div>
            <h2 className="font-medium text-foreground">Format notes</h2>
            <p>
              UTF-8 with BOM, comma-separated, CRLF line endings, every cell
              quoted, and formula-leading cells neutralized — including values
              that start with whitespace. This is a CSV for Tally import or
              field mapping — not native Tally XML. Historical prices, scheme
              discounts, and free quantities are never recalculated from
              today&apos;s catalogue. Eligibility is evaluated when the export
              query runs, and exporting never changes order state.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ExportFilterForm({ filters }: { filters: TallyExportFilters }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Order date range</CardTitle>
        <CardDescription>
          Inclusive Asia/Kolkata dates. Only approved and post-approval orders
          are counted.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          method="get"
          action="/orders/export"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 xl:items-end"
        >
          <div className="space-y-1.5">
            <Label htmlFor="export-from">From</Label>
            <Input
              id="export-from"
              name="from"
              type="date"
              defaultValue={filters.from ?? ""}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="export-to">To</Label>
            <Input
              id="export-to"
              name="to"
              type="date"
              defaultValue={filters.to ?? ""}
            />
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button
              type="submit"
              className={cn(buttonVariants(), "min-h-11")}
            >
              Apply dates
            </button>
            <Link
              href="/orders/export"
              className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
            >
              Reset
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

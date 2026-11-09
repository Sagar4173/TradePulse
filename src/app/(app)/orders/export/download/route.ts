import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { PERMISSIONS, hasPermission } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import {
  createTallyExport,
  parseTallyExportFilters,
  tallyExportAuditMetadata,
  tallyExportLimitProblem,
  type TallyExportFilters,
} from "@/lib/orders/tally-export";
import {
  loadTallyExportOrders,
  recordTallyExportAudit,
  summarizeTallyExport,
} from "@/lib/orders/tally-export-repository";

/**
 * CSV download for the Order Desk. This route reads orders and appends one
 * audit event; it never creates or modifies an order. Empty and over-limit
 * ranges are sent back to the preview page, which explains the state.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();

  if (!session) {
    return textResponse("Sign in required.", 401);
  }

  if (!hasPermission(session.user.role, PERMISSIONS.ORDERS_EXPORT)) {
    return textResponse(
      "Order export is restricted to the Order Desk and administrators.",
      403,
    );
  }

  try {
    const form = await request.formData();
    const filters = parseTallyExportFilters({
      from: formValue(form, "from"),
      to: formValue(form, "to"),
    });
    const summary = await summarizeTallyExport(filters);

    // Eligibility is evaluated when this query runs. The pure builder re-checks
    // the loaded rows so a stale or future caller cannot emit a non-eligible
    // order, and an empty or over-limit range is explained on the preview page.
    if (
      summary.orderCount === 0 ||
      summary.lineCount === 0 ||
      tallyExportLimitProblem(summary)
    ) {
      return redirectToPreview(request, filters);
    }

    const result = createTallyExport(
      await loadTallyExportOrders(filters),
      filters,
    );

    if (!result.ok) {
      return redirectToPreview(request, filters);
    }

    const audit = tallyExportAuditMetadata(result.summary, filters);

    await recordTallyExportAudit({
      actorId: session.user.id,
      exportId: randomUUID(),
      audit,
    });

    return new Response(result.csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    // Never expose driver or connection details in a download failure.
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "unknown";

    console.error(`Tally export failed (code: ${code}).`);
    return textResponse(
      "The export could not be generated. Try again or contact an administrator.",
      500,
    );
  }
}

function formValue(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  return typeof value === "string" ? value : undefined;
}

function redirectToPreview(
  request: Request,
  filters: TallyExportFilters,
): Response {
  const url = new URL("/orders/export", request.url);

  if (filters.from) {
    url.searchParams.set("from", filters.from);
  }

  if (filters.to) {
    url.searchParams.set("to", filters.to);
  }

  return NextResponse.redirect(url, 303);
}

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

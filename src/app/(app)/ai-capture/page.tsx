import type { Metadata } from "next";
import { MessageSquareText, Store } from "lucide-react";

import { CaptureWorkbench } from "@/components/ai-capture/capture-workbench";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "AI Order Capture — TradePulse",
  description:
    "Capture a Hindi, Hinglish or English order with deterministic matching, then confirm every line before adding it to the cart.",
};

export default async function AiCapturePage() {
  const session = await requirePermission(PERMISSIONS.AI_CAPTURE_USE);

  if (session.user.role !== "RETAILER" || !session.user.retailerId) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Retailer ordering"
          title="AI Order Capture"
          description="Turn a free-form order message into reviewed cart lines."
        />
        <EmptyState
          icon={Store}
          title="Store link pending"
          description="Your account is not linked to a retailer yet. Ask a TradePulse administrator to complete the link before capturing an order."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Retailer ordering"
        title="AI Order Capture"
        description="Describe the order in Hindi, Hinglish or English. The deterministic matcher uses your catalogue, saved shorthand and order history. Every captured line must be reviewed and confirmed; nothing is ordered automatically."
      />

      <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <MessageSquareText
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-primary"
        />
        <p>
          Raw order text is not stored or sent to an external AI service. Only a
          shorthand phrase you explicitly confirm as a correction is saved for
          this retailer.
        </p>
      </div>

      <CaptureWorkbench />
    </div>
  );
}

import { ShieldX } from "lucide-react";
import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Forbidden() {
  return (
    <main className="tradepulse-backdrop relative flex min-h-svh flex-1 items-center justify-center px-5 py-12">
      <div
        aria-hidden="true"
        className="tradepulse-grid pointer-events-none absolute inset-0"
      />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-card/95 p-6 text-center shadow-[0_24px_80px_-48px_rgba(15,42,38,0.45)] backdrop-blur sm:p-8">
        <div className="mb-5 flex justify-center">
          <BrandMark />
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-destructive/20 bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive">
          <ShieldX aria-hidden="true" className="size-3.5" />
          403 · Access denied
        </span>
        <h1 className="mt-5 text-balance text-2xl font-semibold tracking-tight">
          You do not have access
        </h1>
        <p className="mt-3 text-pretty text-sm leading-6 text-muted-foreground">
          Your current role does not include this page. If you need access, ask a
          TradePulse administrator to review your role or scope.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Link
            href="/dashboard"
            className={cn(buttonVariants({ size: "lg" }), "h-11")}
          >
            Back to dashboard
          </Link>
          <Link
            href="/account"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11")}
          >
            View account
          </Link>
        </div>
      </div>
    </main>
  );
}

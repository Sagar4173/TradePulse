import Link from "next/link";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="tradepulse-backdrop relative flex min-h-svh flex-1 flex-col overflow-x-hidden">
      <div
        aria-hidden="true"
        className="tradepulse-grid pointer-events-none absolute inset-0"
      />
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-5 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="TradePulse home"
        >
          <BrandMark />
          <span className="flex flex-col">
            <span className="text-base font-semibold tracking-tight">
              TradePulse
            </span>
            <span className="text-xs text-muted-foreground">
              Distribution operations
            </span>
          </span>
        </Link>
        <span className="hidden shrink-0 rounded-full border border-border bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur sm:inline-flex">
          Secure sign-in
        </span>
      </header>

      <main className="relative z-10 flex w-full flex-1 items-center justify-center px-4 py-8 sm:px-8">
        <div className="w-full min-w-0 max-w-md rounded-2xl border border-border bg-card/95 p-5 shadow-[0_24px_80px_-48px_rgba(15,42,38,0.45)] backdrop-blur sm:p-8">
          {children}
        </div>
      </main>

      <footer className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-6 text-center text-xs leading-5 text-muted-foreground sm:px-8">
        TradePulse keeps sessions in HTTP-only cookies and never exposes
        verification codes in production logs.
      </footer>
    </div>
  );
}

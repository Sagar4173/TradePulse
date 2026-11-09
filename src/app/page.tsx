import {
  Activity,
  ArrowDown,
  ArrowUpRight,
  Check,
  LogIn,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Store,
} from "lucide-react";
import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

const foundationChecks = [
  {
    title: "Retailer catalogue and pricing",
    detail: "Retailer-specific prices, stock visibility and active schemes.",
  },
  {
    title: "Server-priced cart and orders",
    detail: "Validated cart lines, order submission and order history.",
  },
  {
    title: "Credit and order desk",
    detail: "Credit exposure checks, lifecycle controls and audit events.",
  },
  {
    title: "AI capture and Tally export",
    detail: "Hindi, Hinglish or English order text with Tally-compatible CSV export.",
  },
] as const;

const upcomingCapabilities = [
  {
    icon: Store,
    title: "Retailer catalogue",
    description:
      "Retailer-specific pricing, live stock visibility and active schemes in one focused ordering surface.",
  },
  {
    icon: ShoppingCart,
    title: "Fast, repeat ordering",
    description:
      "Server-priced carts and a straightforward order submission flow for busy kirana counters.",
  },
  {
    icon: Sparkles,
    title: "AI-assisted capture",
    description:
      "Hindi, Hinglish or English order text turned into reviewable cart lines with deterministic matching.",
  },
  {
    icon: ShieldCheck,
    title: "Control and audit",
    description:
      "Order-desk review, credit holds, lifecycle controls and a dependable activity trail.",
  },
] as const;

export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-1 flex-col overflow-hidden">
      <div aria-hidden="true" className="tradepulse-backdrop absolute inset-0" />
      <div aria-hidden="true" className="tradepulse-grid absolute inset-0" />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 lg:px-8">
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
            <span className="hidden text-xs text-muted-foreground sm:block">
              Distribution operations
            </span>
          </span>
        </Link>

        <div className="flex items-center gap-2 sm:gap-4">
          <a
            href="#platform"
            className="hidden rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:block"
          >
            Platform
          </a>
          <Link
            href="/login"
            className={cn(buttonVariants({ size: "sm" }), "h-9 px-3")}
          >
            <LogIn data-icon="inline-start" />
            Sign in
          </Link>
          <a
            href="/api/health"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "hidden h-9 bg-background/70 px-3 backdrop-blur sm:inline-flex",
            )}
          >
            <Activity data-icon="inline-start" />
            System health
            <ArrowUpRight data-icon="inline-end" />
          </a>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 lg:px-8">
        <section className="grid gap-12 py-14 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:gap-16 lg:py-24">
          <div>
            <Badge
              variant="outline"
              className="mb-6 rounded-full border-primary/20 bg-background/70 px-3 py-1 text-primary backdrop-blur"
            >
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-primary"
              />
              Built for FMCG distribution
            </Badge>

            <h1 className="max-w-3xl text-balance text-5xl font-semibold leading-[0.98] tracking-[-0.04em] sm:text-6xl lg:text-7xl">
              Smarter Distribution.{" "}
              <span className="text-primary">Faster Ordering.</span>
            </h1>

            <p className="mt-6 max-w-2xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
              TradePulse connects catalogue, pricing, stock and orders for
              distributor teams serving kirana retailers — in the office, on the
              road and at the counter.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="/api/health"
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ size: "lg" })}
              >
                Check system health
                <ArrowUpRight data-icon="inline-end" />
              </a>
              <a
                href="#platform"
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "bg-background/70 backdrop-blur",
                )}
              >
                Explore the platform
                <ArrowDown data-icon="inline-end" />
              </a>
            </div>

            <div className="mt-10 grid max-w-lg grid-cols-1 gap-3 text-sm text-muted-foreground sm:grid-cols-3">
              <div className="flex items-center gap-2">
                <Check aria-hidden="true" className="size-4 text-primary" />
                Retailer-first
              </div>
              <div className="flex items-center gap-2">
                <Check aria-hidden="true" className="size-4 text-primary" />
                Audit-ready
              </div>
              <div className="flex items-center gap-2">
                <Check aria-hidden="true" className="size-4 text-primary" />
                PostgreSQL-backed
              </div>
            </div>
          </div>

          <Card className="relative overflow-hidden border-0 bg-card/90 shadow-[0_24px_80px_-32px_rgba(15,61,54,0.35)] ring-1 ring-border/80 backdrop-blur">
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,var(--primary),var(--chart-4),var(--primary))]"
            />
            <CardHeader className="gap-3">
              <div className="flex items-center justify-between gap-4">
                <Badge variant="secondary" className="rounded-full">
                  Release ready
                </Badge>
                <span className="text-xs font-medium tracking-[0.18em] text-muted-foreground">
                  MILESTONES 2–5
                </span>
              </div>
              <CardTitle className="max-w-sm text-2xl leading-tight tracking-tight">
                One workflow from catalogue to order desk.
              </CardTitle>
              <CardDescription className="max-w-md leading-6">
                Retailer ordering, server-side pricing, credit-aware order
                management, AI order capture and Tally-compatible export are
                integrated in this release.
              </CardDescription>
            </CardHeader>

            <CardContent>
              <div className="grid gap-2.5">
                {foundationChecks.map((check) => (
                  <div
                    key={check.title}
                    className="flex gap-3 rounded-lg border border-border/70 bg-background/65 p-3.5"
                  >
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                      <Check aria-hidden="true" className="size-3" />
                    </span>
                    <div>
                      <p className="text-sm font-medium">{check.title}</p>
                      <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                        {check.detail}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>

            <CardFooter className="justify-between gap-4 border-border/70 bg-muted/40 text-xs text-muted-foreground">
              <span>Live status is served by the health endpoint.</span>
              <a
                href="/api/health"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline"
              >
                /api/health
                <ArrowUpRight aria-hidden="true" className="size-3" />
              </a>
            </CardFooter>
          </Card>
        </section>

        <section
          id="platform"
          aria-labelledby="platform-heading"
          className="scroll-mt-8 border-t border-border/70 py-14 lg:py-20"
        >
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">
                Integrated release
              </p>
              <h2
                id="platform-heading"
                className="mt-3 max-w-2xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl"
              >
                Built for the way distribution actually works.
              </h2>
            </div>
            <Badge
              variant="outline"
              className="w-fit rounded-full bg-background/70 px-3 py-1 text-muted-foreground backdrop-blur"
            >
              Shipped modules
            </Badge>
          </div>

          <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {upcomingCapabilities.map((capability) => (
              <Card
                key={capability.title}
                size="sm"
                className="bg-card/80 ring-border/75 backdrop-blur transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-28px_rgba(15,61,54,0.45)]"
              >
                <CardHeader>
                  <div className="mb-2 grid size-9 place-items-center rounded-lg bg-secondary text-secondary-foreground ring-1 ring-border/70">
                    <capability.icon aria-hidden="true" className="size-4" />
                  </div>
                  <CardTitle>{capability.title}</CardTitle>
                  <CardDescription className="leading-6">
                    {capability.description}
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>

          <p className="mt-6 max-w-3xl text-xs leading-5 text-muted-foreground">
            Milestones 2–5 are integrated in this release: phone authentication
            and role-based access, retailer catalogue and pricing, order and
            credit workflows, deterministic AI order capture, and
            Tally-compatible CSV export. Production SMS delivery requires a
            configured provider.
          </p>
        </section>
      </main>

      <footer className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-2 border-t border-border/70 px-6 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between lg:px-8">
        <p>TradePulse · Smarter Distribution. Faster Ordering.</p>
        <p>Milestones 2–5 · Authentication, catalogue, orders &amp; AI capture</p>
      </footer>
    </div>
  );
}

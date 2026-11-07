"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { routeErrorCopy } from "@/lib/i18n/common-copy";
import { cn } from "@/lib/utils";

export function RouteErrorCard({
  digest,
  reset,
}: {
  digest?: string;
  reset: () => void;
}) {
  return (
    <Card className="mx-auto max-w-xl">
      <CardHeader>
        <span className="mb-2 grid size-11 place-items-center rounded-xl bg-destructive/10 text-destructive">
          <AlertTriangle aria-hidden="true" className="size-5" />
        </span>
        <CardTitle>{routeErrorCopy.title}</CardTitle>
        <CardDescription>{routeErrorCopy.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {digest ? (
          <p className="rounded-lg border border-border bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
            Reference: {digest}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={reset} className="min-h-11">
            <RefreshCw aria-hidden="true" data-icon="inline-start" />
            {routeErrorCopy.retry}
          </Button>
          <Link
            href="/dashboard"
            className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
          >
            Dashboard
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

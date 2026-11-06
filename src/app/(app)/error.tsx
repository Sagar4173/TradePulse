"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Card className="mx-auto max-w-xl">
      <CardHeader>
        <span className="mb-2 grid size-11 place-items-center rounded-xl bg-destructive/10 text-destructive">
          <AlertTriangle aria-hidden="true" className="size-5" />
        </span>
        <CardTitle>Something went wrong</CardTitle>
        <CardDescription>
          This page could not be loaded. No error details are shown here to avoid
          exposing private data.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error.digest ? (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground">
            Reference: {error.digest}
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" size="lg" className="h-11" onClick={reset}>
            <RefreshCw aria-hidden="true" data-icon="inline-start" />
            Try again
          </Button>
          <Link
            href="/dashboard"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11")}
          >
            Back to dashboard
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

"use client";

import { RouteErrorCard } from "@/components/route-error";

export default function OrderDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorCard digest={error.digest} reset={reset} />;
}

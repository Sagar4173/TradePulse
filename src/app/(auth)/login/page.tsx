import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in — TradePulse",
  description:
    "Sign in to TradePulse with your verified Indian mobile number and a one-time code.",
};

function LoginFallback() {
  return (
    <div aria-hidden="true" className="space-y-6">
      <div className="space-y-3">
        <div className="h-6 w-36 rounded-full bg-muted" />
        <div className="h-9 w-56 rounded-lg bg-muted" />
        <div className="h-4 w-full rounded bg-muted" />
      </div>
      <div className="h-12 w-full rounded-lg bg-muted" />
      <div className="h-11 w-full rounded-lg bg-muted" />
      <div className="h-16 w-full rounded-lg bg-muted" />
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}

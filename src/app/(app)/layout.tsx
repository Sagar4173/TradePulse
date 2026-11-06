import { unauthorized } from "next/navigation";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { AppShellSkeleton } from "@/components/app-shell-skeleton";
import { getSession } from "@/lib/auth/session";

async function AuthenticatedFrame({ children }: { children: ReactNode }) {
  const session = await getSession();

  if (!session) {
    unauthorized();
  }

  return (
    <AppShell
      user={{
        id: session.user.id,
        name: session.user.name,
        phone: session.user.phone,
        role: session.user.role,
      }}
    >
      {children}
    </AppShell>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<AppShellSkeleton />}>
      <AuthenticatedFrame>{children}</AuthenticatedFrame>
    </Suspense>
  );
}

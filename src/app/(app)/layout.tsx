import { unauthorized } from "next/navigation";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { AppShellSkeleton } from "@/components/app-shell-skeleton";
import { getSession } from "@/lib/auth/session";
import { resolveRetailerCartOwner } from "@/lib/cart/owner";
import { getCartItemCount } from "@/lib/cart/store";

async function AuthenticatedFrame({ children }: { children: ReactNode }) {
  const session = await getSession();

  if (!session) {
    unauthorized();
  }

  const cartOwner = resolveRetailerCartOwner(session.user);
  const cartItemCount = cartOwner ? await getCartItemCount(cartOwner) : 0;

  return (
    <AppShell
      user={{
        id: session.user.id,
        name: session.user.name,
        phone: session.user.phone,
        role: session.user.role,
      }}
      cartItemCount={cartItemCount}
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

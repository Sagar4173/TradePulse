"use client";

import {
  BadgePercent,
  Boxes,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  ScrollText,
  Store,
  UserCircle,
  Users,
  Warehouse,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/lib/auth/actions";
import {
  getNavigationForRole,
  ROLE_LABELS,
} from "@/lib/auth/navigation";
import type { NavigationIcon } from "@/lib/auth/navigation";
import type { Role } from "@/lib/auth/types";
import { formatPhoneForDisplay } from "@/lib/auth/phone";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

const NAV_ICONS = {
  dashboard: LayoutDashboard,
  catalogue: Package,
  orders: ClipboardList,
  retailers: Store,
  account: UserCircle,
  users: Users,
  products: Boxes,
  inventory: Warehouse,
  schemes: BadgePercent,
  audit: ScrollText,
} satisfies Record<NavigationIcon, typeof LayoutDashboard>;

export type ShellUser = {
  id: string;
  name: string;
  phone: string;
  role: Role;
};

function NavigationLinks({
  role,
  onNavigate,
}: {
  role: Role;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main navigation" className="mt-6 space-y-1">
      {getNavigationForRole(role).map((item) => {
        const Icon = NAV_ICONS[item.icon];
        const isActive =
          pathname === item.href ||
          (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon aria-hidden="true" className="size-4.5 shrink-0" />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function UserCard({ user }: { user: ShellUser }) {
  return (
    <div className="rounded-xl border border-sidebar-border bg-background/70 p-3">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
        >
          {initials(user.name)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {ROLE_LABELS[user.role]} · {formatPhoneForDisplay(user.phone)}
          </p>
        </div>
      </div>
      <form action={logoutAction} className="mt-3">
        <Button type="submit" variant="outline" size="sm" className="w-full">
          <LogOut aria-hidden="true" data-icon="inline-start" />
          Sign out
        </Button>
      </form>
    </div>
  );
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function AppShell({
  user,
  children,
}: {
  user: ShellUser;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileNavRef = useRef<HTMLDivElement>(null);

  const closeMobileNav = useCallback(() => {
    setMobileOpen(false);
    window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!mobileOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeMobileNav();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const container = mobileNavRef.current;

      if (!container) {
        return;
      }

      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => element.offsetParent !== null);

      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeMobileNav, mobileOpen]);

  return (
    <div className="min-h-svh bg-background">
      <a
        href="#main-content"
        className="sr-only z-[60] rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[17rem] flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-sidebar-border px-4">
          <BrandMark />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">
              TradePulse
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {ROLE_LABELS[user.role]} workspace
            </p>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3">
          <NavigationLinks role={user.role} />
          <div className="mt-auto pt-6">
            <UserCard user={user} />
          </div>
        </div>
      </aside>

      <div className="lg:pl-[17rem]">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur sm:px-6">
          <Button
            ref={menuButtonRef}
            type="button"
            variant="outline"
            size="icon-lg"
            className="lg:hidden"
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu aria-hidden="true" />
          </Button>

          <Link
            href="/dashboard"
            className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            aria-label="TradePulse dashboard"
          >
            <BrandMark className="size-8 rounded-lg" />
            <span className="text-sm font-semibold">TradePulse</span>
          </Link>

          <div className="ml-auto flex min-w-0 items-center gap-3">
            <div className="hidden min-w-0 text-right sm:block">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {ROLE_LABELS[user.role]}
              </p>
            </div>
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground"
            >
              {initials(user.name)}
            </span>
          </div>
        </header>

        <main
          id="main-content"
          className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
        >
          {children}
        </main>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-foreground/35 backdrop-blur-[2px]"
            onClick={closeMobileNav}
          />
          <div
            ref={mobileNavRef}
            id="mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
            className="relative flex h-full w-[min(20rem,88vw)] flex-col border-r border-sidebar-border bg-sidebar p-3 shadow-2xl"
          >
            <div className="flex h-12 items-center justify-between gap-3 px-1">
              <Link
                href="/dashboard"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                <BrandMark className="size-8 rounded-lg" />
                <span className="text-sm font-semibold">TradePulse</span>
              </Link>
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                aria-label="Close navigation"
                onClick={closeMobileNav}
                autoFocus
              >
                <X aria-hidden="true" />
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <NavigationLinks
                role={user.role}
                onNavigate={() => setMobileOpen(false)}
              />
              <div className="mt-auto pt-6">
                <UserCard user={user} />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

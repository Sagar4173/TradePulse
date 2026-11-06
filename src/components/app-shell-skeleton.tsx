import { BrandMark } from "@/components/brand-mark";

export function AppShellSkeleton() {
  return (
    <div aria-hidden="true" className="min-h-svh bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-[17rem] flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-4">
          <BrandMark />
          <div className="space-y-1.5">
            <div className="h-3.5 w-24 rounded bg-muted" />
            <div className="h-3 w-20 rounded bg-muted" />
          </div>
        </div>
        <div className="space-y-2 p-3 pt-6">
          {Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className="h-11 rounded-lg bg-muted/70" />
          ))}
        </div>
      </aside>
      <div className="lg:pl-[17rem]">
        <header className="flex h-16 items-center justify-between border-b border-border px-4 sm:px-6">
          <div className="h-8 w-28 rounded bg-muted lg:hidden" />
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden space-y-1.5 sm:block">
              <div className="h-3.5 w-28 rounded bg-muted" />
              <div className="h-3 w-20 rounded bg-muted" />
            </div>
            <div className="size-9 rounded-full bg-muted" />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="space-y-2">
            <div className="h-8 w-56 rounded bg-muted" />
            <div className="h-4 w-full max-w-xl rounded bg-muted" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-28 rounded-xl bg-muted/70" />
            ))}
          </div>
          <div className="h-72 rounded-xl bg-muted/60" />
        </main>
      </div>
    </div>
  );
}

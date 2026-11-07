export default function CatalogueLoading() {
  return (
    <div
      className="space-y-6"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading catalogue"
    >
      <span className="sr-only">Loading catalogue…</span>
      <div aria-hidden="true" className="space-y-3">
        <div className="h-3 w-28 rounded bg-muted" />
        <div className="h-8 w-64 max-w-full rounded bg-muted" />
        <div className="h-4 w-full max-w-2xl rounded bg-muted" />
      </div>
      <div aria-hidden="true" className="h-40 rounded-xl bg-muted/70" />
      <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="overflow-hidden rounded-xl bg-muted/60">
            <div className="aspect-[4/3] w-full bg-muted" />
            <div className="space-y-3 p-4">
              <div className="h-3 w-24 rounded bg-muted-foreground/15" />
              <div className="h-5 w-3/4 rounded bg-muted-foreground/15" />
              <div className="h-4 w-1/2 rounded bg-muted-foreground/15" />
              <div className="h-10 w-full rounded bg-muted-foreground/15" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function OrdersLoading() {
  return (
    <div
      className="space-y-6"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading orders"
    >
      <span className="sr-only">Loading orders…</span>
      <div aria-hidden="true" className="space-y-3">
        <div className="h-3 w-32 rounded bg-muted" />
        <div className="h-8 w-64 max-w-full rounded bg-muted" />
        <div className="h-4 w-full max-w-2xl rounded bg-muted" />
      </div>
      <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-28 rounded-xl bg-muted/70" />
        ))}
      </div>
      <div aria-hidden="true" className="h-44 rounded-xl bg-muted/60" />
      <div aria-hidden="true" className="space-y-3 rounded-xl bg-muted/50 p-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-12 rounded-lg bg-muted" />
        ))}
      </div>
    </div>
  );
}

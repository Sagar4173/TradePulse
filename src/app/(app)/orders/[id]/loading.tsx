export default function OrderDetailLoading() {
  return (
    <div
      className="space-y-6"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading order"
    >
      <span className="sr-only">Loading order…</span>
      <div aria-hidden="true" className="space-y-3">
        <div className="h-3 w-36 rounded bg-muted" />
        <div className="h-8 w-72 max-w-full rounded bg-muted" />
        <div className="h-4 w-full max-w-xl rounded bg-muted" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <div aria-hidden="true" className="space-y-6">
          <div className="h-80 rounded-xl bg-muted/60" />
          <div className="h-64 rounded-xl bg-muted/50" />
        </div>
        <div aria-hidden="true" className="space-y-6">
          <div className="h-72 rounded-xl bg-muted/60" />
          <div className="h-56 rounded-xl bg-muted/50" />
        </div>
      </div>
    </div>
  );
}

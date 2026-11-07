export default function CartLoading() {
  return (
    <div
      className="space-y-6"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading cart"
    >
      <span className="sr-only">Loading cart…</span>
      <div aria-hidden="true" className="space-y-3">
        <div className="h-3 w-24 rounded bg-muted" />
        <div className="h-8 w-56 max-w-full rounded bg-muted" />
        <div className="h-4 w-full max-w-2xl rounded bg-muted" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div aria-hidden="true" className="space-y-4 rounded-xl bg-muted/60 p-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex gap-3">
              <div className="size-20 shrink-0 rounded-lg bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-5 w-2/3 rounded bg-muted" />
                <div className="h-3 w-1/2 rounded bg-muted" />
                <div className="h-3 w-1/3 rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
        <div aria-hidden="true" className="h-72 rounded-xl bg-muted/60" />
      </div>
    </div>
  );
}

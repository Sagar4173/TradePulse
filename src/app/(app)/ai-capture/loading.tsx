export default function AiCaptureLoading() {
  return (
    <div
      className="space-y-6"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading AI order capture"
    >
      <span className="sr-only">Loading AI order capture…</span>
      <div aria-hidden="true" className="space-y-3">
        <div className="h-3 w-32 rounded bg-muted" />
        <div className="h-8 w-64 max-w-full rounded bg-muted" />
        <div className="h-4 w-full max-w-2xl rounded bg-muted" />
      </div>
      <div aria-hidden="true" className="h-16 rounded-xl bg-muted/70" />
      <div aria-hidden="true" className="h-80 rounded-xl bg-muted/60" />
    </div>
  );
}

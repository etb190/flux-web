/* ── Small shared UI pieces ────────────────────────────────────────────── */

export function Spinner({ large = false }) {
  return <div className={'spinner' + (large ? ' spinner-lg' : '')} role="status" />;
}

export function LoadingPane({ label, testid }) {
  return (
    <section data-testid={testid} className="flex flex-col items-center justify-center gap-4 py-32 text-dim">
      <Spinner />
      <p>{label}</p>
    </section>
  );
}

export function ErrorPane({ title, message, testid }) {
  return (
    <section data-testid={testid} className="flex flex-col items-center justify-center gap-2 py-32 px-6 text-center">
      <h2 className="text-xl font-semibold text-ink">{title}</h2>
      <p className="text-dim max-w-md">{message}</p>
    </section>
  );
}

export function EmptyPane() {
  return (
    <section data-testid="empty" className="flex flex-col items-center justify-center gap-2 py-32 px-6 text-center">
      <h2 className="text-xl font-semibold text-ink">No results found</h2>
      <p className="text-dim">Try a different title or check the spelling.</p>
    </section>
  );
}

export function GenreChip({ children }) {
  return (
    <span className="rounded-full bg-hover border border-edge px-2.5 py-0.5 text-xs text-dim whitespace-nowrap">
      {children}
    </span>
  );
}

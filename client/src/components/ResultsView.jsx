/* ── Search results grid ───────────────────────────────────────────────── */

import PosterCard from './PosterCard.jsx';

export default function ResultsView({ query, items, onOpen }) {
  return (
    <section data-testid="results-wrap" className="px-8 py-6">
      <div className="flex items-baseline gap-3 mb-5">
        <h2 data-testid="results-title" className="text-xl font-semibold">
          Results for &ldquo;{query}&rdquo;
        </h2>
        <span data-testid="results-count" className="text-sm text-dim">
          {items.length} {items.length === 1 ? 'title' : 'titles'}
        </span>
      </div>
      <div
        data-testid="results-grid"
        className="grid gap-x-4 gap-y-6 grid-cols-[repeat(auto-fill,minmax(150px,1fr))]"
      >
        {items.map((item, i) => (
          <PosterCard key={item.type + item.id + i} item={item} onClick={() => onOpen(item, 'results')} />
        ))}
      </div>
    </section>
  );
}

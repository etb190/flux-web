/* ── Poster card (home rows + search results) ──────────────────────────── */

import { useState } from 'react';

export default function PosterCard({ item, onClick, testid }) {
  const [imgOk, setImgOk] = useState(true);
  const hasPoster = Boolean(item.poster);
  const showImg = hasPoster && imgOk;

  return (
    <div
      data-testid={testid || 'card'}
      title={item.name}
      onClick={onClick}
      className={(item.landscape ? 'home-poster-card ' : '') + 'w-full cursor-pointer group'}
    >
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-hover border border-edge transition-transform duration-150 group-hover:scale-[1.04] group-hover:border-accent/60">
        {showImg ? (
          <img
            src={item.poster}
            alt={item.name + ' poster'}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgOk(false)}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-3xl text-dim">
            🎬
          </div>
        )}

        {item.rank ? (
          <span className="rank-badge">{String(item.rank)}</span>
        ) : null}

        {item.imdbRating && item.imdbRating !== 'null' ? (
          <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold text-gold">
            ★ {item.imdbRating}
          </span>
        ) : null}

        <span
          className={
            'absolute top-1.5 right-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white ' +
            (item.type === 'series' ? 'bg-series' : 'bg-movie')
          }
        >
          {item.type === 'series' ? 'Series' : 'Movie'}
        </span>
      </div>

      <div className="pt-1.5">
        <div className="text-[13px] font-medium text-ink truncate">{item.name}</div>
        <div className="text-xs text-dim truncate">{item.year || ''}</div>
      </div>
    </div>
  );
}

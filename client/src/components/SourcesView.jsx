/* ── Sources view: scan status, filters, provider results ──────────────── */

import { useMemo, useState } from 'react';
import { GB, fmtSize } from '../lib/format.js';
import { PlayIcon, SearchIcon } from './icons.jsx';

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (_err) {
    return '';
  }
}

function SourceRow({ src, onPlay }) {
  const formatClass =
    src.format === 'Embed'
      ? 'bg-series/15 text-series'
      : src.format === 'HLS'
        ? 'bg-accent/15 text-accent'
        : src.format === 'DASH'
          ? 'bg-gold/15 text-gold'
          : 'bg-movie/15 text-movie';
  const sizeLabel = fmtSize(src.sizeBytes);

  return (
    <div
      data-testid="source-row"
      onClick={() => onPlay(src)}
      className={
        'flex items-center gap-3.5 p-3 rounded-xl bg-raised border border-edge cursor-pointer transition-colors hover:bg-hover hover:border-accent/50 ' +
        (src.format === 'Embed' ? 'opacity-90' : '')
      }
    >
      <div className="w-10 h-10 rounded-lg bg-hover border border-edge flex items-center justify-center text-base font-bold text-accent shrink-0">
        {(src.provider || '?').charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[15px] font-medium text-ink truncate max-w-full">
            {src.title || src.provider || 'Source'}
          </span>
          <span className={'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ' + formatClass}>
            {src.format || 'LINK'}
          </span>
          {src.quality ? (
            <span className="rounded bg-hover px-1.5 py-0.5 text-[10px] font-semibold text-dim">
              {src.quality}
            </span>
          ) : null}
          {sizeLabel ? (
            <span className="text-[11px] text-dim">{sizeLabel}</span>
          ) : null}
        </div>
        <div className="text-xs text-dim mt-0.5 truncate">
          {[src.description, hostOf(src.url)].filter(Boolean).join(' \u00b7 ')}
        </div>
      </div>
      <div className="text-dim shrink-0 pr-1">
        <PlayIcon size={20} />
      </div>
    </div>
  );
}

export default function SourcesView({ meta, episode, scan, onPlay }) {
  const [query, setQuery] = useState('');
  const [sizeFilter, setSizeFilter] = useState('all');

  const normalizedQuery = query.trim().toLowerCase();

  const { direct, embeds, shown } = useMemo(() => {
    const matches = (src) => {
      if (normalizedQuery) {
        const hay = ((src.title || '') + ' ' + (src.provider || '') + ' ' +
          (src.description || '')).toLowerCase();
        if (!hay.includes(normalizedQuery)) return false;
      }
      if (sizeFilter === 'gt1gb' && (src.sizeBytes == null || src.sizeBytes <= GB)) return false;
      if (sizeFilter === 'lt1gb' && (src.sizeBytes == null || src.sizeBytes >= GB)) return false;
      return true;
    };
    const d = [];
    const e = [];
    let shown = 0;
    for (const src of scan.sources) {
      if (!matches(src)) continue;
      shown++;
      (src.format === 'Embed' ? e : d).push(src);
    }
    return { direct: d, embeds: e, shown };
  }, [scan.sources, normalizedQuery, sizeFilter]);

  const isSeries = meta.type === 'series';
  const title = isSeries
    ? 'S' + (episode.season ?? 1) + ' E' + (episode.episode ?? 1) + ' \u00b7 ' + episode.title
    : episode.title;

  // Status line: scanning → summary → error, plus filter info.
  let status;
  if (scan.scanError) {
    status = scan.scanError;
  } else if (scan.summaryText !== null) {
    status = scan.summaryText;
  } else {
    status = 'Scanning ' + scan.providerCount + ' providers\u2026';
  }
  if (scan.sources.length > 0 && (normalizedQuery || sizeFilter !== 'all')) {
    status += ' \u00b7 showing ' + shown + ' of ' + scan.sources.length;
  }

  const showEmpty = scan.summaryText !== null && scan.sources.length === 0;
  const showNomatch = scan.sources.length > 0 && shown === 0;

  return (
    <div data-testid="sources-view" className="px-8 pb-10">
      <div className="mt-1 mb-4">
        <h2 data-testid="sources-title" className="text-xl font-semibold">{title}</h2>
        <div data-testid="sources-sub" className="text-sm text-dim mt-0.5">{meta.name}</div>
      </div>

      <div data-testid="sources-status" className="text-sm text-dim mb-3">
        {status}
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <SearchIcon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
          <input
            data-testid="sources-search"
            type="text"
            value={query}
            placeholder="Filter sources..."
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-lg bg-raised border border-edge pl-8 pr-3 py-2 text-sm text-ink outline-none placeholder:text-dim focus:border-accent"
          />
        </div>
        <select
          data-testid="sources-size"
          title="Filter by size"
          aria-label="Filter by size"
          value={sizeFilter}
          onChange={(e) => setSizeFilter(e.target.value)}
          className="rounded-lg bg-raised border border-edge px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        >
          <option value="all">All sizes</option>
          <option value="gt1gb">Greater than 1 GB</option>
          <option value="lt1gb">Less than 1 GB</option>
        </select>
      </div>

      {showEmpty ? (
        <div data-testid="sources-empty" className="py-16 text-center">
          <h3 className="text-lg font-semibold">No sources found</h3>
          <p className="text-dim mt-1">None of the providers had this episode. Try another one.</p>
        </div>
      ) : null}
      {showNomatch ? (
        <div data-testid="sources-nomatch" className="py-10 text-center text-dim">
          No sources match the current filter.
        </div>
      ) : null}

      <div data-testid="sources-list" className="flex flex-col gap-2.5">
        {direct.concat(embeds).map((src, i) => (
          <SourceRow key={src.url + i} src={src} onPlay={onPlay} />
        ))}
      </div>
    </div>
  );
}

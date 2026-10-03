/* ── Home page: left sidebar (Home / Watched) + rows ──────────────────────
 * Rows (feed tab, top → bottom):
 *   1. "Continue watching"        — local watch history (S/E badge + X)
 *   2. "Because you watched …"    — TMDB recommendations from the Watched list
 *   3. API rows                   — SA top 10s / popular / new + TMDB trending
 * The hero banner was removed in v0.13.0 (user preference).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import PosterCard from './PosterCard.jsx';
import WatchedView from './WatchedView.jsx';
import {
  ChevronLeftIcon, ChevronRightIcon, CloseIcon, EyeIcon, HomeIcon
} from './icons.jsx';

// ── Sidebar ───────────────────────────────────────────────────────────────

function Sidebar({ tab, onTab }) {
  const btn = (id, label, icon) => (
    <button
      data-testid={'side-' + id}
      onClick={() => onTab(id)}
      className={
        'flex items-center gap-2.5 rounded-[9px] px-3.5 py-2.5 text-[13.5px] font-bold text-left transition-colors ' +
        (tab === id
          ? 'bg-accent text-white shadow-[0_0_12px_rgba(91,140,255,0.35)]'
          : 'text-dim hover:text-ink hover:bg-white/5')
      }
    >
      {icon}
      <span>{label}</span>
    </button>
  );
  return (
    <aside
      data-testid="home-sidebar"
      className="w-[172px] shrink-0 flex flex-col gap-1 px-3 py-5 bg-raised border-r border-edge self-stretch"
    >
      {btn('feed', 'Home', <HomeIcon />)}
      {btn('watched', 'Watched', <EyeIcon />)}
    </aside>
  );
}

// ── Carousel row with arrow buttons (no scrollbar) ───────────────────────

function ArrowBtn({ dir, disabled, onClick }) {
  return (
    <button
      data-testid={'row-arrow-' + dir}
      aria-label={'Scroll ' + dir}
      disabled={disabled}
      onClick={onClick}
      className="row-arrow"
    >
      {dir === 'left' ? <ChevronLeftIcon /> : <ChevronRightIcon />}
    </button>
  );
}

function CarouselRow({ title, children, testid }) {
  const scrollerRef = useRef(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const [noScroll, setNoScroll] = useState(true);

  const sync = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setNoScroll(max <= 4);
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft < max - 4);
  }, []);

  useEffect(() => {
    sync();
    const el = scrollerRef.current;
    if (!el) return undefined;
    el.addEventListener('scroll', sync, { passive: true });
    // scrollWidth settles as posters load — re-check + observe resizes
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    const t1 = setTimeout(sync, 900);
    const t2 = setTimeout(sync, 2600);
    return () => {
      el.removeEventListener('scroll', sync);
      ro.disconnect();
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [sync, children]);

  const page = () =>
    Math.max((scrollerRef.current ? scrollerRef.current.clientWidth : 600) * 0.85, 320);

  return (
    <section data-testid={testid || 'home-row'} className="mt-7">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {noScroll ? null : (
          <div className="flex gap-1.5">
            <ArrowBtn dir="left" disabled={!canLeft}
              onClick={() => scrollerRef.current?.scrollBy({ left: -page(), behavior: 'smooth' })} />
            <ArrowBtn dir="right" disabled={!canRight}
              onClick={() => scrollerRef.current?.scrollBy({ left: page(), behavior: 'smooth' })} />
          </div>
        )}
      </div>
      <div ref={scrollerRef} className="row-scroll flex gap-4 overflow-x-auto pb-3 -mx-1 px-1">
        {children}
      </div>
    </section>
  );
}

// ── Continue watching (watch history) ─────────────────────────────────────

function HistoryCard({ entry, onOpen, onRemove }) {
  const badge = entry.type === 'series'
    ? 'S' + (entry.season ?? 1) + ' \u00b7 E' + (entry.episode ?? 1)
    : (entry.year || 'Movie');
  return (
    <div className="w-[150px] shrink-0 snap-start">
      <div
        data-testid="card"
        title={entry.title}
        onClick={() => onOpen({
          id: entry.imdbId, type: entry.type,
          name: entry.title, poster: entry.poster
        })}
        className="relative aspect-[2/3] rounded-xl overflow-hidden bg-hover border border-edge cursor-pointer transition-transform duration-150 hover:scale-[1.04] hover:border-accent/60 group"
      >
        {entry.poster ? (
          <img
            src={entry.poster}
            alt={entry.title + ' poster'}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { e.currentTarget.remove(); }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-3xl text-dim">🎬</div>
        )}
        <span data-testid="cw-badge" className="cw-badge">{badge}</span>
        <button
          data-testid="cw-remove"
          title="Remove from Continue watching"
          aria-label="Remove from Continue watching"
          onClick={(e) => { e.stopPropagation(); onRemove(entry); }}
          className="card-x z-10"
        >
          <CloseIcon size={13} />
        </button>
      </div>
      <div className="pt-1.5">
        <div className="text-[13px] font-medium text-ink truncate">{entry.title}</div>
      </div>
    </div>
  );
}

function ContinueRow({ active, onOpen }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    const api = window.fluxAPI;
    if (!api || typeof api.historyList !== 'function') return undefined;
    Promise.resolve(api.historyList())
      .then((list) => { if (alive) setItems(Array.isArray(list) ? list : []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [active]);

  const remove = useCallback(async (entry) => {
    const api = window.fluxAPI;
    if (api && typeof api.historyRemove === 'function') {
      try { await api.historyRemove(entry.imdbId); } catch (_err) { /* ignore */ }
    }
    setItems((list) => list.filter((it) => it.imdbId !== entry.imdbId));
  }, []);

  if (!items.length) return null;
  return (
    <CarouselRow title="Continue watching" testid="continue-row">
      {items.map((entry) => (
        <HistoryCard
          key={entry.imdbId + entry.type}
          entry={entry}
          onOpen={onOpen}
          onRemove={remove}
        />
      ))}
    </CarouselRow>
  );
}

// ── Suggestions ("Because you watched …", TMDB) ───────────────────────────

function SuggestionCard({ item, onOpen }) {
  const open = useCallback(async () => {
    const api = window.fluxAPI;
    if (!api || typeof api.tmdbToImdb !== 'function') return;
    let imdbId = item.imdbId;
    if (!imdbId) {
      try {
        const res = await api.tmdbToImdb(item.tmdbId, item.tmdbType);
        imdbId = res && res.imdbId;
      } catch (_err) { return; }
    }
    if (!imdbId) return;
    onOpen({ id: imdbId, type: item.tmdbType, name: item.name, poster: item.poster });
  }, [item, onOpen]);

  return (
    <div className="home-card w-[150px] shrink-0 snap-start">
      <PosterCard
        item={{
          id: item.tmdbId, type: item.tmdbType, name: item.name,
          poster: item.poster, year: item.year, imdbRating: item.imdbRating,
          landscape: true
        }}
        onClick={open}
      />
    </div>
  );
}

function SuggestionRows({ active, onOpen }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    const api = window.fluxAPI;
    if (!api || typeof api.getSuggestions !== 'function') return undefined;
    Promise.resolve(api.getSuggestions())
      .then((data) => {
        if (!alive) return;
        setRows(data && Array.isArray(data.rows)
          ? data.rows.filter((r) => r.items && r.items.length)
          : []);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [active]);

  if (!rows.length) return null;
  return (
    <>
      {rows.map((row) => (
        <CarouselRow key={row.title} title={row.title} testid="suggestion-row">
          {row.items.map((item) => (
            <SuggestionCard
              key={(item.tmdbType || '') + (item.tmdbId || item.name)}
              item={item}
              onOpen={onOpen}
            />
          ))}
        </CarouselRow>
      ))}
    </>
  );
}

// ── States ────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div data-testid="home-loading" className="-mt-6">
      <div className="skeleton h-6 w-56 mt-8" />
      <div className="flex gap-4 mt-4 overflow-hidden">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="skeleton w-[150px] h-[225px] shrink-0" />
        ))}
      </div>
      <div className="skeleton h-6 w-56 mt-8" />
      <div className="flex gap-4 mt-4 overflow-hidden pb-6">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="skeleton w-[150px] h-[225px] shrink-0" />
        ))}
      </div>
    </div>
  );
}

function SetupCard({ onOpenSettings }) {
  return (
    <div data-testid="home-setup" className="flex justify-center py-24 px-6">
      <div className="max-w-xl bg-raised border border-edge rounded-2xl p-8 text-center">
        <h2 className="text-xl font-semibold mb-3">Set up the home page</h2>
        <p className="text-dim text-[15px] leading-relaxed">
          The home page mixes the Streaming Availability API (daily Top&nbsp;10
          lists, popular titles per service, new &amp; leaving soon) with TMDB
          trending. Flux ships with a working key, so you only see this if the
          key was cleared — paste your own (free at{' '}
          <a
            className="text-accent hover:underline"
            href="https://developers.movieofthenight.com"
            title="Get a free API key"
          >
            developers.movieofthenight.com
          </a>
          ) in Settings.
        </p>
        <button
          data-testid="home-setup-btn"
          onClick={onOpenSettings}
          className="mt-6 rounded-xl bg-accent px-5 py-2.5 font-medium text-white hover:brightness-110"
        >
          Open Settings
        </button>
        <p className="mt-4 text-sm text-dim">Search keeps working without a key.</p>
      </div>
    </div>
  );
}

function ErrorCard({ errorMsg, onRetry }) {
  return (
    <div data-testid="home-error" className="flex justify-center py-24 px-6">
      <div className="max-w-xl bg-raised border border-edge rounded-2xl p-8 text-center">
        <h2 className="text-xl font-semibold mb-3">Couldn&rsquo;t load the home page</h2>
        <p data-testid="home-error-msg" className="text-dim text-[15px]">{errorMsg}</p>
        <button
          data-testid="home-retry"
          onClick={onRetry}
          className="mt-6 rounded-xl bg-accent px-5 py-2.5 font-medium text-white hover:brightness-110"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

// ── Feed body ─────────────────────────────────────────────────────────────

function HomeBody({ data, onOpen, active }) {
  return (
    <div data-testid="home-body">
      <ContinueRow active={active} onOpen={onOpen} />
      <SuggestionRows active={active} onOpen={onOpen} />
      {data.notice ? (
        <p
          data-testid="home-notice"
          className="mt-4 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-gold"
        >
          {data.notice}
        </p>
      ) : null}
      {(data.rows || []).map((row, ri) =>
        row.items && row.items.length ? (
          <CarouselRow key={row.key || ri} title={row.title}>
            {row.items.map((item, ii) => (
              <div key={ii} className="home-card w-[150px] shrink-0 snap-start">
                <PosterCard item={{ ...item, landscape: true }} onClick={() => onOpen(item)} />
              </div>
            ))}
          </CarouselRow>
        ) : null
      )}
      <p className="py-6 text-xs leading-relaxed text-dim/80">
        Home data by the Streaming Availability API (Movie of the Night) &middot;
        Trending &amp; suggestions by TMDB. This product uses the TMDB API but
        is not endorsed or certified by TMDB.
      </p>
    </div>
  );
}

// ── HomeView ──────────────────────────────────────────────────────────────

export default function HomeView({ home, onOpen, onOpenSettings, tab, onTab }) {
  const feedActive = tab === 'feed';
  return (
    <div className="home-dashboard flex min-h-full items-stretch">
      <Sidebar tab={tab} onTab={onTab} />
      <div className="home-feed flex-1 min-w-0 px-8 pt-4 pb-2">
        {tab === 'watched' ? (
          <WatchedView onOpen={onOpen} />
        ) : home.status === 'loading' || home.status === 'idle' ? (
          <Skeleton />
        ) : home.status === 'setup' ? (
          <SetupCard onOpenSettings={onOpenSettings} />
        ) : home.status === 'error' ? (
          <ErrorCard errorMsg={home.errorMsg} onRetry={() => home.load(true)} />
        ) : (
          <HomeBody data={home.data} onOpen={onOpen} active={feedActive} />
        )}
      </div>
    </div>
  );
}

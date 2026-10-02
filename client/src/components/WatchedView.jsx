/* ── Watched tab (sidebar): curate the list that drives the suggestions ────
 * Search a title (Cinemeta, same source as the topbar search), add it to
 * the watched list, remove entries from the grid. The home feed builds
 * "Because you watched …" rows from this list via TMDB recommendations.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import PosterCard from './PosterCard.jsx';
import { CloseIcon, SearchIcon } from './icons.jsx';

const TYPE_LABEL = (t) => (t === 'series' ? 'Series' : 'Movie');

function WatchedHit({ item, added, onAdd }) {
  return (
    <div data-testid="watched-hit" className="watched-hit flex items-center gap-3 px-3 py-2">
      {item.poster ? (
        <img
          src={item.poster}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="w-[34px] h-[50px] rounded-md object-cover bg-hover shrink-0"
          onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
        />
      ) : (
        <div className="w-[34px] h-[50px] rounded-md bg-hover shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold truncate">{item.name}</div>
        <div className="text-xs text-dim">
          {[item.year, TYPE_LABEL(item.type)].filter(Boolean).join(' \u00b7 ')}
        </div>
      </div>
      <button
        data-testid="watched-add"
        onClick={() => { if (!added) onAdd(item); }}
        className={
          'shrink-0 rounded-lg px-3.5 py-1.5 text-xs font-bold text-white ' +
          (added
            ? 'bg-emerald-700 pointer-events-none'
            : 'bg-accent hover:brightness-110')
        }
      >
        {added ? 'Added \u2713' : 'Add'}
      </button>
    </div>
  );
}

export default function WatchedView({ onOpen }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [watched, setWatched] = useState([]);
  const seqRef = useRef(0);
  const debounceRef = useRef(null);
  const queryRef = useRef('');

  const refreshWatched = useCallback(() => {
    const api = window.fluxAPI;
    if (!api || typeof api.watchedList !== 'function') return;
    Promise.resolve(api.watchedList())
      .then((items) => setWatched(Array.isArray(items) ? items : []))
      .catch(() => {});
  }, []);

  useEffect(() => { refreshWatched(); }, [refreshWatched]);

  const isAdded = useCallback(
    (item) => watched.some((w) => w.imdbId === item.id && w.type === item.type),
    [watched]
  );

  const runSearch = useCallback(async (q) => {
    queryRef.current = q;
    const seq = ++seqRef.current;
    try {
      const api = window.fluxAPI;
      const items = api && typeof api.search === 'function'
        ? await api.search(q)
        : [];
      if (seq !== seqRef.current) return;
      setResults(Array.isArray(items) ? items.slice(0, 12) : []);
    } catch (_err) {
      if (seq === seqRef.current) setResults([]);
    }
  }, []);

  const handleInput = useCallback((q) => {
    setQuery(q);
    clearTimeout(debounceRef.current);
    if (!q.trim()) {
      seqRef.current++;
      queryRef.current = '';
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(q.trim()), 350);
  }, [runSearch]);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const add = useCallback(async (item) => {
    const api = window.fluxAPI;
    if (!api || typeof api.watchedAdd !== 'function') return;
    try {
      const res = await api.watchedAdd({
        imdbId: item.id,
        type: item.type,
        title: item.name,
        poster: item.poster || null,
        genres: Array.isArray(item.genres) ? item.genres : []
      });
      if (res && res.watched) setWatched(res.watched);
    } catch (_err) { /* leave the row as-is on failure */ }
  }, []);

  const remove = useCallback(async (entry) => {
    const api = window.fluxAPI;
    if (!api || typeof api.watchedRemove !== 'function') return;
    try {
      const res = await api.watchedRemove(entry.imdbId);
      if (res && res.watched) setWatched(res.watched);
      else setWatched((list) => list.filter((w) => w.imdbId !== entry.imdbId));
    } catch (_err) { /* ignore */ }
  }, []);

  return (
    <div data-testid="watched-view">
      <h2 className="text-[22px] font-semibold mt-1">Watched</h2>
      <p className="mt-1.5 mb-5 text-[13px] leading-relaxed text-dim max-w-xl">
        Add the movies &amp; series you&rsquo;ve seen &mdash; Flux uses this
        list to suggest similar titles on the Home tab.
      </p>

      <div className="relative max-w-md">
        <SearchIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
        <input
          data-testid="watched-search"
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          placeholder="Search a movie or series to add..."
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-xl border border-edge bg-raised py-2.5 pl-9 pr-3.5 text-[13.5px] font-medium outline-none placeholder:text-dim/70 focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
      </div>

      {results.length ? (
        <div
          data-testid="watched-results"
          className="max-w-md mt-2 bg-raised border border-edge rounded-xl overflow-hidden divide-y divide-edge"
        >
          {results.map((item) => (
            <WatchedHit
              key={item.id + item.type}
              item={item}
              added={isAdded(item)}
              onAdd={add}
            />
          ))}
        </div>
      ) : null}

      {watched.length ? (
        <div data-testid="watched-grid" className="mt-7 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4.5 gap-4">
          {watched.map((entry) => (
            <div key={entry.imdbId + entry.type} className="w-[150px]">
              <div className="relative">
                <PosterCard
                  item={{ id: entry.imdbId, type: entry.type, name: entry.title, poster: entry.poster, year: null }}
                  onClick={() => onOpen({
                    id: entry.imdbId, type: entry.type,
                    name: entry.title, poster: entry.poster
                  })}
                />
                <button
                  data-testid="watched-remove"
                  title="Remove from Watched"
                  aria-label="Remove from Watched"
                  onClick={(e) => { e.stopPropagation(); remove(entry); }}
                  className="card-x z-10"
                >
                  <CloseIcon size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p data-testid="watched-empty" className="mt-5 text-[13px] text-dim/80">
          Nothing here yet. Search above and add what you&rsquo;ve watched.
        </p>
      )}
    </div>
  );
}

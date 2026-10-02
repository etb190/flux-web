/* ── Details: hero + seasons/episodes (Helix player_episodes_panel) ────── */

import { useState } from 'react';
import { buildSeasonTabs, formatAirDate } from '../lib/format.js';
import { PlayIcon } from './icons.jsx';

function Thumb({ src, alt, fallbackText }) {
  const [imgOk, setImgOk] = useState(true);
  const showImg = Boolean(src) && imgOk;
  return (
    <div className="w-[140px] aspect-video shrink-0 rounded-lg overflow-hidden bg-hover border border-edge relative">
      {showImg ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImgOk(false)}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-xl text-dim font-semibold">
          {fallbackText || '🎬'}
        </div>
      )}
    </div>
  );
}

function EpisodeRow({ ep, onOpen }) {
  return (
    <div
      data-testid="episode-row"
      title="Find sources for this episode"
      onClick={() => onOpen(ep)}
      className="flex gap-4 p-3 rounded-xl bg-raised border border-edge cursor-pointer transition-colors hover:bg-hover hover:border-accent/50"
    >
      <Thumb
        src={ep.thumbnail}
        alt={ep.title}
        fallbackText={ep.episode != null ? String(ep.episode) : '🎬'}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          {ep.season != null && ep.episode != null ? (
            <span className="text-xs font-bold text-accent shrink-0">
              S{ep.season} E{ep.episode}
            </span>
          ) : null}
          <span className="text-[15px] font-medium text-ink truncate">{ep.title}</span>
        </div>
        {formatAirDate(ep.released) ? (
          <div className="text-xs text-dim mt-0.5">{formatAirDate(ep.released)}</div>
        ) : null}
        {ep.overview ? (
          <p title={ep.overview} className="text-sm text-dim mt-1 line-clamp-2">
            {ep.overview}
          </p>
        ) : null}
      </div>
      <div className="flex items-center pr-2 text-dim">
        <PlayIcon size={22} />
      </div>
    </div>
  );
}

export default function DetailsView({ meta, onFindSources }) {
  const seasonTabs = meta.type === 'series' && meta.videos.length
    ? buildSeasonTabs(meta.videos)
    : [];
  const [currentTab, setCurrentTab] = useState(0);

  return (
    <div data-testid="details-content" className="px-8 pb-10">
      {/* Hero: backdrop, poster, title, meta line, description */}
      <div className="relative -mx-8 -mt-1 overflow-hidden">
        {meta.background ? (
          <img
            src={meta.background}
            alt=""
            referrerPolicy="no-referrer"
            onError={(e) => e.currentTarget.remove()}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : null}
        <div className="hero-shade absolute inset-0" />
        <div className="relative flex gap-6 p-8">
          <div className="w-[180px] shrink-0">
            <Thumb
              src={meta.poster}
              alt={meta.name + ' poster'}
              fallbackText={meta.name}
            />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-3xl font-bold drop-shadow">{meta.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              {meta.imdbRating && meta.imdbRating !== 'null' ? (
                <span className="font-semibold text-gold">★ {meta.imdbRating}</span>
              ) : null}
              {meta.year ? <span className="text-dim">{meta.year}</span> : null}
              {meta.runtime ? <span className="text-dim">{meta.runtime}</span> : null}
              {meta.genres.slice(0, 3).map((g, i) => (
                <span
                  key={i}
                  className="rounded-full bg-black/40 border border-edge px-2.5 py-0.5 text-xs text-dim"
                >
                  {g}
                </span>
              ))}
            </div>
            {meta.description ? (
              <p className="mt-3 text-[15px] leading-relaxed text-ink/90 line-clamp-4 max-w-3xl">
                {meta.description}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {meta.type === 'series' && meta.videos.length > 0 ? (
        <>
          <div className="flex items-baseline gap-3 mt-6 mb-3">
            <h2 className="text-xl font-semibold">Episodes</h2>
            <span data-testid="episodes-count" className="text-sm text-dim">
              {meta.videos.length} total
            </span>
          </div>
          <div data-testid="seasons-row" className="flex gap-2 flex-wrap mb-4">
            {seasonTabs.map((tab, idx) => (
              <button
                key={idx}
                data-testid="season-chip"
                onClick={() => setCurrentTab(idx)}
                className={
                  'rounded-full px-4 py-1.5 text-sm border transition-colors ' +
                  (idx === currentTab
                    ? 'bg-accent border-accent text-white font-medium'
                    : 'bg-raised border-edge text-dim hover:text-ink hover:border-accent/50')
                }
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div data-testid="episodes-list" className="flex flex-col gap-2.5">
            {(seasonTabs[currentTab] || seasonTabs[0]).episodes.map((ep, i) => (
              <EpisodeRow key={ep.id + i} ep={ep} onOpen={onFindSources} />
            ))}
          </div>
        </>
      ) : meta.type === 'series' ? (
        <div className="mt-6 rounded-xl bg-raised border border-edge px-5 py-4 text-dim">
          No episode data available for this series yet.
        </div>
      ) : (
        <div className="mt-6 flex justify-center">
          <button
            data-testid="find-sources"
            onClick={() => onFindSources({ title: meta.name, season: 1, episode: 1 })}
            className="flex items-center gap-2 rounded-xl bg-accent px-6 py-3 font-medium text-white hover:brightness-110"
          >
            <PlayIcon size={18} />
            <span>Find sources</span>
          </button>
        </div>
      )}
    </div>
  );
}

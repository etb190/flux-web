// ── Flux TMDB API client (main process) ──────────────────────────────────
// Powers the home-page suggestion rows ("Because you watched …") from the
// user's curated Watched list. API v3, docs:
// https://developer.themoviedb.org/docs/getting-started
//
// Endpoints used:
//   /find/{imdbId}?external_source=imdb_id     IMDb id → TMDB id
//   /{movie|tv}/{id}/recommendations           "people also liked" engine
//   /discover/tv?with_genres=…                 same-genre TV slice for rows
//                                              built from a watched MOVIE
//                                              (recommendations are
//                                              same-type only, but the user
//                                              wants series suggestions too)
//   /genre/tv/list                             genre name → TV genre id
//   /{movie|tv}/{id}/external_ids              TMDB id → IMDb id (card
//                                              click → Cinemeta details)
//
// Pure Node module with an injectable fetch for
// tests. Responses are cached in memory for 6h (TMDB data changes slowly;
// the free-tier rate limit is ~50 req/10s so we stay far below it).

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;   // 6h
const ROW_CAP = 16;                        // cards per suggestion row
const TV_SLICE = 5;                        // TV titles mixed into movie rows
const SUGGEST_ROWS_CAP = 4;                // watched titles per home load
const IMG_BASE = 'https://image.tmdb.org/t/p';

const cache = new Map();                   // url → { at, data }

let fetchImpl = (url, opts) => fetch(url, opts);

function _setFetcher(fn) { fetchImpl = fn; }
function _clearCache() { cache.clear(); }

// ── HTTP ──────────────────────────────────────────────────────────────────

async function apiGet(key, tmdbPath, params) {
  const qs = new URLSearchParams({ api_key: key, ...(params || {}) });
  const url = 'https://api.themoviedb.org/3' + tmdbPath + '?' + qs.toString();

  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
  } catch (e) {
    throw new Error('Could not reach TMDB (' +
      ((e && e.name) === 'AbortError' ? 'timeout' : 'network') + ').');
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error('TMDB rejected the API key (check Settings).');
  }
  if (res.status === 429) {
    throw new Error('TMDB rate limit reached — try again in a moment.');
  }
  if (!res.ok) {
    throw new Error('TMDB request failed (HTTP ' + res.status + ').');
  }

  const data = await res.json();
  cache.set(url, { at: Date.now(), data });
  return data;
}

// ── Mappers ───────────────────────────────────────────────────────────────

// One suggestion card. `id` is left null — details open through the IMDb id
// resolved on click (tmdbToImdb), so the renderer's Cinemeta pipeline works
// unchanged. Cards carry tmdbId/tmdbType instead.
function mapCard(result, tmdbType) {
  if (!result || !result.poster_path) return null;
  const name = String(result.title || result.name || '').trim();
  if (!name) return null;
  const date = String(result.release_date || result.first_air_date || '');
  return {
    tmdbId: result.id,
    tmdbType: tmdbType || result.media_type || 'movie',
    id: null,
    type: tmdbType || result.media_type || 'movie',
    name,
    poster: IMG_BASE + '/w342' + result.poster_path,
    backdrop: result.backdrop_path ? IMG_BASE + '/w780' + result.backdrop_path : null,
    year: date ? date.slice(0, 4) : null,
    imdbRating: result.vote_average
      ? Number(result.vote_average).toFixed(1)
      : null,
    overview: String(result.overview || '')
  };
}

function mapList(results, tmdbType, cap) {
  const arr = Array.isArray(results) ? results : [];
  const out = [];
  const seen = new Set();
  for (const r of arr) {
    const card = mapCard(r, tmdbType);
    if (!card || seen.has(card.tmdbId)) continue;
    seen.add(card.tmdbId);
    out.push(card);
    if (out.length >= cap) break;
  }
  return out;
}

// ── Lookups ───────────────────────────────────────────────────────────────

// IMDb id → TMDB numeric id (the watched list stores Cinemeta/IMDb ids).
async function tmdbFromImdb(key, imdbId, type) {
  const data = await apiGet(key, '/find/' + encodeURIComponent(imdbId),
    { external_source: 'imdb_id' });
  const bucket = type === 'series' ? 'tv_results' : 'movie_results';
  const hit = (data && Array.isArray(data[bucket]) && data[bucket][0]) ||
    (data && ((data.movie_results || []).concat(data.tv_results || []))[0]);
  return hit && hit.id ? hit.id : null;
}

// TMDB id → IMDb id (so a suggestion card can open Cinemeta details).
async function tmdbToImdb(key, tmdbId, type) {
  const data = await apiGet(key, '/' + (type === 'series' ? 'tv' : 'movie') +
    '/' + encodeURIComponent(tmdbId) + '/external_ids');
  const imdb = data && data.imdb_id ? String(data.imdb_id) : null;
  return /^tt\d{5,}$/.test(imdb) ? imdb : null;
}

async function recommendations(key, tmdbId, type) {
  const data = await apiGet(key, '/' + (type === 'series' ? 'tv' : 'movie') +
    '/' + encodeURIComponent(tmdbId) + '/recommendations');
  return mapList(data && data.results, type, ROW_CAP);
}

// Popular same-genre series (TV genre ids differ from movie genre ids —
// resolve the id by name via /genre/tv/list).
async function tvByGenreName(key, genreName) {
  const name = String(genreName || '').trim().toLowerCase();
  if (!name) return [];
  const genres = await apiGet(key, '/genre/tv/list');
  const hit = (genres && genres.genres || [])
    .find((g) => String(g.name || '').toLowerCase() === name);
  if (!hit) return [];
  const data = await apiGet(key, '/discover/tv', {
    with_genres: hit.id,
    sort_by: 'popularity.desc',
    'vote_count.gte': 200,
    include_null_first_air_dates: 'false'
  });
  return mapList(data && data.results, 'series', TV_SLICE);
}

// ── Suggestion rows for the home page ─────────────────────────────────────
// watched: [{imdbId, type, title, genres, ...}] (most recent first)
// Returns { rows: [{ title, items }] } — per-row failures are dropped so a
// single bad lookup never blanks the whole section.
async function buildSuggestionRows(key, watched) {
  if (!key) return { rows: [] };
  const list = (Array.isArray(watched) ? watched : [])
    .slice(0, SUGGEST_ROWS_CAP);
  if (!list.length) return { rows: [] };

  const settled = await Promise.allSettled(list.map(async (entry) => {
    const tmdbId = await tmdbFromImdb(key, entry.imdbId, entry.type);
    if (!tmdbId) return [];

    // Same-type recommendations ("people who liked X also liked Y")…
    const items = await recommendations(key, tmdbId, entry.type);
    const seen = new Set(items.map((c) => c.tmdbId));

    // …plus a same-genre TV slice for watched movies (recommendations are
    // same-type only; the user explicitly wants series suggestions too).
    if (entry.type !== 'series' && Array.isArray(entry.genres) &&
        entry.genres.length) {
      try {
        for (const tv of await tvByGenreName(key, entry.genres[0])) {
          if (!seen.has(tv.tmdbId)) { items.push(tv); seen.add(tv.tmdbId); }
        }
      } catch (_) { /* TV slice is best-effort */ }
    }
    return items;
  }));

  const rows = [];
  for (let i = 0; i < list.length; i++) {
    const r = settled[i];
    if (r.status !== 'fulfilled' || !r.value.length) continue;
    rows.push({
      title: 'Because you watched ' + (list[i].title || 'something'),
      items: r.value
    });
  }
  return { rows };
}

module.exports = {
  CACHE_TTL_MS, ROW_CAP, TV_SLICE, SUGGEST_ROWS_CAP, IMG_BASE,
  apiGet, mapCard, mapList,
  tmdbFromImdb, tmdbToImdb, recommendations, tvByGenreName,
  buildSuggestionRows, _setFetcher, _clearCache
};

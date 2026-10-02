// ── Flux: TMDB home-page rows (main process) ─────────────────────────────
// TMDB layer of the home page (https://developer.themoviedb.org/):
//   - "Trending This Week" row from /trending/all/week
//
// TMDB results carry TMDB ids, but Flux details/episodes flow (Cinemeta)
// needs IMDb ids. Cinemeta does NOT resolve "tmdb:" prefixed ids, so each
// trending item is enriched via /{media_type}/{id}/external_ids → imdb_id.
// That's one lightweight call per item; TMDB's free tier comfortably allows
// it, and results are cached on disk for 6h.
//
// Pure Node module: the server passes the cache dir per
// call, and tests can inject a fetch implementation.

const fs = require('fs');
const path = require('path');
const { TMDB_API_KEY } = require('./tmdb.js');

const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;   // 6h — trending refreshes daily
const ROW_CAP = 18;
const ENRICH_CONCURRENCY = 6;

// Overridable fetch (tests inject a stub).
let fetchImpl = (url, opts) => fetch(url, opts);

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function tmdbUrl(endpoint, params, key) {
  const qs = new URLSearchParams({ api_key: key || TMDB_API_KEY, ...(params || {}) });
  return TMDB_BASE + endpoint + '?' + qs.toString();
}

// ── Disk cache (same pattern as saa.js, separate file) ───────────────────
function cacheFile(dir) { return path.join(dir, 'tmdb-cache.json'); }

function readCache(dir, key) {
  try {
    const all = JSON.parse(fs.readFileSync(cacheFile(dir), 'utf8'));
    const hit = all && all[key];
    if (hit && typeof hit.t === 'number' && Date.now() - hit.t < CACHE_TTL_MS) {
      return hit.data;
    }
  } catch (_) { /* missing/corrupt cache → miss */ }
  return null;
}

function writeCache(dir, key, data) {
  try {
    let all = {};
    try { all = JSON.parse(fs.readFileSync(cacheFile(dir), 'utf8')) || {}; } catch (_) {}
    const now = Date.now();
    for (const k of Object.keys(all)) {
      if (!all[k] || typeof all[k].t !== 'number' || now - all[k].t >= CACHE_TTL_MS) {
        delete all[k];
      }
    }
    all[key] = { t: now, data };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cacheFile(dir), JSON.stringify(all), 'utf8');
  } catch (_) { /* cache is best-effort */ }
}

async function cachedGet(dir, urlKey, fn) {
  if (dir) {
    const hit = readCache(dir, urlKey);
    if (hit) return { data: hit, cached: true };
  }
  const data = await fn();
  if (dir) writeCache(dir, urlKey, data);
  return { data, cached: false };
}

// ── TMDB item → Flux card item ───────────────────────────────────────────
function mapItem(raw, imdbId) {
  const isTv = raw.media_type === 'tv' || raw.first_air_date != null;
  const name = String(raw.title || raw.name || '').trim();
  const dateStr = String(raw.release_date || raw.first_air_date || '');
  const year = dateStr.length >= 4 ? dateStr.slice(0, 4) : '';
  const poster = raw.poster_path ? IMG + '/w342' + raw.poster_path : null;
  const backdrop = raw.backdrop_path ? IMG + '/w780' + raw.backdrop_path : null;
  const rating = Number(raw.vote_average);
  if (!name || !imdbId || !poster) return null;   // details flow needs imdb + art
  return {
    id: String(imdbId),
    name,
    poster,
    backdrop,
    year,
    type: isTv ? 'series' : 'movie',
    imdbRating: rating > 0 ? rating.toFixed(1) : null,
    overview: String(raw.overview || ''),
    genres: [],
    services: []
  };
}

// Fetch imdb_id for each TMDB item with a small worker pool.
async function enrichWithImdbIds(items, key) {
  const out = new Array(items.length).fill(null);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const idx = next++;
      const it = items[idx];
      try {
        const ext = await getJson(tmdbUrl('/' + it.media_type + '/' + it.id + '/external_ids', null, key));
        out[idx] = mapItem(it, ext && ext.imdb_id);
      } catch (_) {
        out[idx] = null;             // skip items that fail enrichment
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(ENRICH_CONCURRENCY, items.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return out.filter(Boolean);
}

// ── Trending row ──────────────────────────────────────────────────────────
// Returns { items: [...] } on success, { items: [], error: 'msg' } on failure.
// opts.key: the user's TMDB key (settings); falls back to the built-in one.
async function getTrending(opts) {
  const dir = opts && opts.cacheDir;
  const key = opts && opts.key;
  try {
    const { data } = await cachedGet(dir, '/trending/all/week?cap=' + ROW_CAP,
      async () => {
        const body = await getJson(tmdbUrl('/trending/all/week', null, key));
        const raw = (body && Array.isArray(body.results) ? body.results : [])
          .filter((r) => r && (r.media_type === 'movie' || r.media_type === 'tv'))
          .slice(0, ROW_CAP);
        return await enrichWithImdbIds(raw, key);
      });
    return { items: data };
  } catch (e) {
    return {
      items: [],
      error: (e && e.message) || 'Trending failed to load.'
    };
  }
}

// Test hooks
function _setFetcher(fn) { fetchImpl = fn; }

module.exports = {
  CACHE_TTL_MS, ROW_CAP, ENRICH_CONCURRENCY,
  tmdbUrl, getTrending, mapItem, enrichWithImdbIds, _setFetcher
};

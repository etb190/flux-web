// ── Flux: Streaming Availability API client (main process) ───────────────
// Data source for the home page: https://github.com/movieofthenight/streaming-availability-api
// ("Streaming Availability API" by Movie of the Night — daily streaming
// availability for Netflix, Prime Video, Disney+, Max, Hulu, ... across
// ~60 countries, plus daily Top 10 lists and new/expiring title changes.)
//
// Gateway auto-detection (mirrors the official client libraries):
//   key starts with "motn-key-" -> https://api.movieofthenight.com/v4  (X-API-Key)
//   any other key               -> RapidAPI gateway (X-RapidAPI-Key/-Host)
//
// Pure Node module: the server passes the cache dir per
// call, and tests can inject a fetch implementation. Free plan users have a
// daily request quota, so responses are cached on disk for 12h (the API
// updates its data daily).

const fs = require('fs');
const path = require('path');

const DEFAULT_COUNTRY = 'us';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h — upstream data updates daily
const ROW_CAP = 20;

// Streaming service id → display name (ids as returned by the API)
const SERVICE_NAMES = {
  netflix: 'Netflix',
  prime: 'Prime Video',
  'prime-video': 'Prime Video',
  disney: 'Disney+',
  apple: 'Apple TV+',
  'apple-tv-plus': 'Apple TV+',
  max: 'Max',
  hulu: 'Hulu',
  peacock: 'Peacock',
  'paramount-plus': 'Paramount+',
  hbo: 'Max',
  'hbo-max': 'Max',
  applestore: 'Apple TV Store',
  yyy: 'Vudu',
  'vudu': 'Vudu',
  amcplus: 'AMC+',
  crunchyroll: 'Crunchyroll',
  discovery: 'Discovery+',
  'discovery-plus': 'Discovery+',
  mubi: 'MUBI',
  curzon: 'Curzon',
  'now': 'NOW',
  'sky-showcase': 'Sky Showcase',
  'sky-go': 'Sky Go',
  'britbox': 'BritBox',
  starz: 'Starz',
  showtime: 'Showtime',
  ' Stan': 'Stan'
};

// Overridable fetch (tests inject a stub); Node 20+ has global fetch
// where global fetch exists.
let fetchImpl = (url, opts) => fetch(url, opts);

function gatewayFor(key) {
  const k = String(key || '').trim();
  if (!k) return null;
  if (k.startsWith('motn-key-')) {
    return { base: 'https://api.movieofthenight.com/v4', headers: { 'X-API-Key': k } };
  }
  return {
    base: 'https://streaming-availability.p.rapidapi.com',
    headers: {
      'X-RapidAPI-Key': k,
      'X-RapidAPI-Host': 'streaming-availability.p.rapidapi.com'
    }
  };
}

async function apiGet(gw, endpoint, params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null || v === '') continue;
    qs.set(k, String(v));
  }
  const url = gw.base + endpoint + (qs.toString() ? '?' + qs.toString() : '');
  const res = await fetchImpl(url, {
    headers: { Accept: 'application/json', ...gw.headers }
  });
  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try {
      const body = await res.json();
      if (body && body.message) msg = body.message;
    } catch (_) { /* keep HTTP status message */ }
    if (res.status === 401 || res.status === 403) {
      throw new Error('API key rejected — check the key in Settings (' + msg + ')');
    }
    if (res.status === 429) throw new Error('API quota reached — try again tomorrow (' + msg + ')');
    throw new Error(msg);
  }
  return res.json();
}

// ── Disk cache (one JSON file: { urlKey: {t, data} }) ────────────────────
function cacheFile(dir) { return path.join(dir, 'saa-cache.json'); }

function readCache(dir, key) {
  try {
    const all = JSON.parse(fs.readFileSync(cacheFile(dir), 'utf8'));
    const hit = all && all[key];
    if (hit && typeof hit.t === 'number' && Date.now() - hit.t < CACHE_TTL_MS) return hit.data;
  } catch (_) { /* missing/corrupt cache → miss */ }
  return null;
}

function writeCache(dir, key, data) {
  try {
    let all = {};
    try { all = JSON.parse(fs.readFileSync(cacheFile(dir), 'utf8')) || {}; } catch (_) {}
    // prune stale entries so the file stays small
    const now = Date.now();
    for (const k of Object.keys(all)) {
      if (!all[k] || typeof all[k].t !== 'number' || now - all[k].t >= CACHE_TTL_MS) delete all[k];
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

// ── API Show → Flux card item ─────────────────────────────────────────────
function pickPoster(imageSet) {
  const p = imageSet && imageSet.verticalPoster;
  return (p && (p.w360 || p.w480 || p.w240 || p.w600 || p.w720)) || null;
}

function pickBackdrop(imageSet) {
  const b = imageSet && imageSet.horizontalBackdrop;
  return (b && (b.w720 || b.w480 || b.w360 || b.w1440)) || null;
}

function serviceLabel(id) { return SERVICE_NAMES[id] || id; }

// streamingOptions: { "<COUNTRY>": [{service, link, type, quality, ...}] }
// `service` is usually the string id ("netflix") but the API also returns a
// full service object {id, name, homePage, themeColorCode, imageSet} —
// normalize both (a raw object leaking into the renderer crashes React).
function mapServices(show, country) {
  const optsByCc = show && show.streamingOptions ? show.streamingOptions : {};
  const opts = optsByCc[country.toUpperCase()] || optsByCc[country.toLowerCase()] || [];
  const seen = new Set();
  const out = [];
  for (const o of opts) {
    const raw = o && o.service;
    const id = typeof raw === 'string' ? raw : (raw && raw.id) || '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: serviceLabel(id), type: o.type || 'sub', link: o.link || '' });
    if (out.length >= 4) break;
  }
  out.sort((a, b) => (a.type === 'sub' ? 0 : 1) - (b.type === 'sub' ? 0 : 1));
  return out;
}

function mapShow(show, country) {
  if (!show || !show.imdbId) return null;   // Cinemeta details need an IMDb id
  const poster = pickPoster(show.imageSet);
  if (!poster) return null;                 // cards without art look broken
  // SA ratings are integers on a 0-100 scale (e.g. 60 → IMDb 6.0).
  const rating = Number(show.rating);
  const imdbRating = rating > 0 ? (rating / 10).toFixed(1) : null;
  return {
    id: String(show.imdbId),
    name: String(show.title || show.originalTitle || 'Unknown'),
    poster,
    backdrop: pickBackdrop(show.imageSet),
    year: String(show.releaseYear || show.firstAirYear || show.lastAirYear || ''),
    type: show.showType === 'series' ? 'series' : 'movie',
    imdbRating,
    overview: String(show.overview || ''),
    genres: (Array.isArray(show.genres) ? show.genres : [])
      .map((g) => (g && (g.name || g.shortName)) || '')
      .filter(Boolean)
      .slice(0, 4),
    services: mapServices(show, country)
  };
}

function mapList(raw, country, cap) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const s of arr) {
    const item = mapShow(s, country);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= cap) break;
  }
  return out;
}

// /changes returns `shows` as a map keyed by show id, plus a `changes` array
// (the events, ordered by change date). Rebuild the show list in that event
// order, deduped, so "New This Week" reads newest-first.
function showsFromChanges(data) {
  const map = (data && data.shows) || {};
  const changes = Array.isArray(data && data.changes) ? data.changes : [];
  const ordered = [];
  const seen = new Set();
  for (const ch of changes) {
    const id = ch && ch.showId;
    if (id && map[id] && !seen.has(id)) {
      seen.add(id);
      ordered.push(map[id]);
    }
  }
  // Defensive: any show not referenced by a change event goes last.
  for (const [id, show] of Object.entries(map)) {
    if (!seen.has(id)) {
      seen.add(id);
      ordered.push(show);
    }
  }
  return ordered;
}

// ── Row fetchers (all hit the v4 endpoints) ──────────────────────────────
async function fetchTop(gw, country, service, showType, dir) {
  const params = { country, service, show_type: showType || '' };
  const { data } = await cachedGet(dir, '/shows/top?' + JSON.stringify(params),
    () => apiGet(gw, '/shows/top', params));
  const items = mapList(data, country, 10);
  // Official Top 10s are rank-ordered → expose the rank for the UI badge.
  items.forEach((item, i) => { item.rank = i + 1; });
  return items;
}

async function fetchPopular(gw, country, catalog, dir) {
  const params = {
    country,
    catalogs: catalog,
    order_by: 'popularity_1week',
    order_direction: 'desc'
  };
  const { data } = await cachedGet(dir, '/shows/search/filters?' + JSON.stringify(params),
    () => apiGet(gw, '/shows/search/filters', params));
  return mapList(data && data.shows, country, ROW_CAP);
}

async function fetchChanges(gw, country, changeType, dir) {
  const params = {
    country,
    change_type: changeType,
    item_type: 'show',
    order_direction: 'desc'          // newest change first
  };
  const { data } = await cachedGet(dir, '/changes?' + JSON.stringify(params),
    () => apiGet(gw, '/changes', params));
  return mapList(showsFromChanges(data), country, ROW_CAP);
}

// ── Home payload ──────────────────────────────────────────────────────────
// Returns one of:
//   { noKey: true }
//   { error: 'message' }
//   { country, hero, rows: [{key, title, items, error?}] }
async function getHomeData(key, country, opts) {
  const dir = opts && opts.cacheDir;
  const gw = gatewayFor(key);
  if (!gw) return { noKey: true };
  const c = String(country || DEFAULT_COUNTRY).toLowerCase().trim() || DEFAULT_COUNTRY;

  const defs = [
    { key: 'netflix-movies', title: 'Top 10 Movies on Netflix',
      fn: () => fetchTop(gw, c, 'netflix', 'movie', dir) },
    { key: 'netflix-series', title: 'Top 10 Series on Netflix',
      fn: () => fetchTop(gw, c, 'netflix', 'series', dir) },
    { key: 'prime', title: 'Popular on Prime Video',
      fn: () => fetchPopular(gw, c, 'prime', dir) },
    { key: 'disney', title: 'Popular on Disney+',
      fn: () => fetchPopular(gw, c, 'disney', dir) },
    { key: 'new', title: 'New This Week',
      fn: () => fetchChanges(gw, c, 'new', dir) },
    { key: 'leaving', title: 'Leaving Soon',
      fn: () => fetchChanges(gw, c, 'expiring', dir) }
  ];

  const settled = await Promise.allSettled(defs.map((d) => d.fn()));
  const rows = [];
  let firstGood = null;
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    const r = settled[i];
    if (r.status === 'fulfilled' && r.value.length) {
      rows.push({ key: d.key, title: d.title, items: r.value });
      if (!firstGood) firstGood = r.value;
    } else {
      const msg = r.status === 'rejected'
        ? String((r.reason && r.reason.message) || r.reason || 'failed')
        : 'No titles right now';
      rows.push({ key: d.key, title: d.title, items: [], error: msg });
    }
  }

  // Hero: best backdrop among the Netflix top movies, else any good item.
  const heroFrom = (rows[0] && rows[0].items) || firstGood || [];
  const hero = heroFrom.find((x) => x.backdrop) || heroFrom[0] || null;

  const anyLoaded = rows.some((r) => r.items.length);
  if (!anyLoaded) {
    const firstErr = rows.find((r) => r.error);
    return { error: (firstErr && firstErr.error) || 'No data available right now.' };
  }
  return { country: c, hero, rows };
}

// Test hooks
function _setFetcher(fn) { fetchImpl = fn; }

module.exports = {
  DEFAULT_COUNTRY, CACHE_TTL_MS, SERVICE_NAMES,
  gatewayFor, getHomeData, mapShow, mapList, showsFromChanges, serviceLabel,
  pickPoster, pickBackdrop, _setFetcher
};

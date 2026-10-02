/* ── Data layer ───────────────────────────────────────────────────────────
 * Network calls run in the Express backend via fluxAPI (no CORS, stream
 * scraping lives there too). If the bridge is missing, fall back to a
 * direct fetch — Cinemeta is CORS-enabled.
 */

const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';

function fluxApi() {
  return typeof window !== 'undefined' ? window.fluxAPI : null;
}

function num(val) {
  if (val == null) return null;
  const n = parseInt(val, 10);
  return Number.isNaN(n) ? null : n;
}

async function searchCatalogDirect(type, query) {
  const url =
    CINEMETA_BASE +
    '/catalog/' + encodeURIComponent(type) +
    '/top/search=' + encodeURIComponent(query) + '.json';
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return [];
  const body = await res.json();
  const metas = Array.isArray(body.metas) ? body.metas : [];
  return metas
    .map((m) => ({
      id: String(m.id ?? ''),
      name: String(m.name ?? 'Unknown'),
      poster: m.poster ? String(m.poster) : null,
      year:
        m.releaseInfo != null ? String(m.releaseInfo)
        : m.year != null ? String(m.year)
        : null,
      type: String(m.type ?? type),
      imdbRating:
        m.imdbRating != null ? String(m.imdbRating)
        : m.rating != null ? String(m.rating)
        : null
    }))
    .filter((m) => m.id && m.name && m.name !== 'Unknown');
}

async function getMetaDirect(type, id) {
  const url =
    CINEMETA_BASE +
    '/meta/' + encodeURIComponent(type) +
    '/' + encodeURIComponent(id) + '.json';
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const body = await res.json();
  const m = body && body.meta;
  if (!m) return null;
  return {
    id: String(m.id ?? id),
    type: String(m.type ?? type),
    name: String(m.name ?? 'Unknown'),
    poster: m.poster ? String(m.poster) : null,
    background: m.background ? String(m.background) : null,
    description: m.description ? String(m.description) : null,
    year: m.releaseInfo != null ? String(m.releaseInfo) : null,
    imdbRating: m.imdbRating != null ? String(m.imdbRating) : null,
    genres: Array.isArray(m.genres) ? m.genres.map(String) : [],
    runtime: m.runtime != null ? String(m.runtime) : null,
    videos: (Array.isArray(m.videos) ? m.videos : [])
      .map((v) => ({
        id: String(v.id ?? ''),
        title: String(v.title ?? v.name ?? 'Episode'),
        season: num(v.season),
        episode: num(v.episode ?? v.number),
        released: v.released ? String(v.released) : null,
        thumbnail: v.thumbnail ? String(v.thumbnail) : null,
        overview: String(v.overview ?? v.description ?? '')
      }))
      .filter((v) => v.id)
  };
}

export async function doSearch(query) {
  const api = fluxApi();
  if (api && typeof api.search === 'function') {
    return api.search(query);
  }
  // Browser fallback: search movie + series in parallel, interleave
  const [movies, series] = await Promise.all([
    searchCatalogDirect('movie', query).catch(() => []),
    searchCatalogDirect('series', query).catch(() => [])
  ]);
  const mixed = [];
  const max = Math.max(movies.length, series.length);
  for (let i = 0; i < max; i++) {
    if (movies[i]) mixed.push(movies[i]);
    if (series[i]) mixed.push(series[i]);
  }
  return mixed;
}

export async function getMeta(type, id) {
  const api = fluxApi();
  if (api && typeof api.getMeta === 'function') {
    return api.getMeta(type, id);
  }
  return getMetaDirect(type, id);
}

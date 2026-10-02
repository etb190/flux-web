// ── Flux search: Stremio Cinemeta (same source Helix uses) ──────────────
const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';

// Search one catalog on Cinemata — mirrors Helix's MetadataService.search:
// GET /catalog/{type}/top/search={query}.json
async function searchCatalog(type, query) {
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
        : null,
      // kept for the Watched list → TMDB genre lookups (suggestion rows)
      genres: Array.isArray(m.genres) ? m.genres.map(String).slice(0, 6) : []
    }))
    .filter((m) => m.id && m.name && m.name !== 'Unknown');
}

// Search movies + series in parallel (Helix pattern), interleave the
// results so neither type drowns out the other.
async function searchAll(query) {
  const q = String(query || '').trim();
  if (!q) return [];

  const [movies, series] = await Promise.all([
    searchCatalog('movie', q).catch(() => []),
    searchCatalog('series', q).catch(() => [])
  ]);

  const mixed = [];
  const max = Math.max(movies.length, series.length);
  for (let i = 0; i < max; i++) {
    if (movies[i]) mixed.push(movies[i]);
    if (series[i]) mixed.push(series[i]);
  }
  return mixed;
}

// Fetch full metadata for one title (Helix: MetadataService.fetchMeta →
// GET /meta/{type}/{id}.json). Returns videos[] for series (episodes).
async function fetchMeta(type, id) {
  const num = (val) => {
    if (val == null) return null;
    if (typeof val === 'number') return val;
    const n = parseInt(val, 10);
    return Number.isNaN(n) ? null : n;
  };

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
    logo: m.logo ? String(m.logo) : null,
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

module.exports = { searchCatalog, searchAll, fetchMeta };

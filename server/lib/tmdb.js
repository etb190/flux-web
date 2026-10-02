// ── Flux TMDB helper: IMDb → TMDB ID resolution (port of Helix
//    lib/services/scraper/sites/tmdb_helper.dart, 1:1) ────────────────────
const TMDB_API_KEY = '19d475b19a2a345b560687918d8ee98b';
const TMDB_DIRECT = 'https://api.themoviedb.org/3';
const TMDB_PROXY = 'https://db.speedracelight.com/3';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json'
};

const cache = new Map();

function cleanString(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function getJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 7000);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Resolve a TMDB numeric id from an IMDb id (tt…) / title + year.
// Order mirrors Helix: 1) direct numeric, 2) TMDB /find by imdb,
//   (proxy fallback), 3) /search by title+year (proxy fallback).
async function resolveTmdbId({ imdbId, title, type, year }) {
  const cacheKey = (imdbId || '') + '|' + (title || '') + '|' + type + '|' + (year || '');
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  let cleanId = String(imdbId || '').trim();
  cleanId = cleanId.replace(/^(tmdb|movie|tv|imdb):/i, '');
  if (cleanId.includes(':')) cleanId = cleanId.split(':')[0];

  const isTv = type === 'tv' || type === 'series';
  const endpoint = isTv ? 'tv' : 'movie';

  if (cleanId) {
    // 1. Direct numeric ID
    if (/^\d+$/.test(cleanId)) {
      const id = parseInt(cleanId, 10);
      cache.set(cacheKey, id);
      return id;
    }

    // 2. TMDB Find API for tt… IMDb IDs
    if (cleanId.startsWith('tt')) {
      const findData = await getJson(
        TMDB_DIRECT + '/find/' + encodeURIComponent(cleanId) +
        '?api_key=' + TMDB_API_KEY + '&external_source=imdb_id', 7000);
      const results = findData ? (isTv ? findData.tv_results : findData.movie_results) : null;
      if (Array.isArray(results) && results.length && results[0].id != null) {
        cache.set(cacheKey, results[0].id);
        return results[0].id;
      }

      // Backup find via proxy
      const proxyData = await getJson(
        TMDB_PROXY + '/find/' + encodeURIComponent(cleanId) +
        '?external_source=imdb_id', 6000);
      const pResults = proxyData ? (isTv ? proxyData.tv_results : proxyData.movie_results) : null;
      if (Array.isArray(pResults) && pResults.length && pResults[0].id != null) {
        cache.set(cacheKey, pResults[0].id);
        return pResults[0].id;
      }
    }
  }

  // 3. Search by title / type / year
  if (title) {
    const targetClean = cleanString(title);
    const data = await getJson(
      TMDB_DIRECT + '/search/' + endpoint +
      '?api_key=' + TMDB_API_KEY + '&query=' + encodeURIComponent(title), 7000);
    const results = data && Array.isArray(data.results) ? data.results : null;
    if (results && results.length) {
      let bestMatchId = null;

      for (const item of results) {
        const itemTitle = String(
          item.title ?? item.name ?? item.original_title ?? item.original_name ?? '');
        const itemClean = cleanString(itemTitle);
        const dateStr = String(item.release_date ?? item.first_air_date ?? '');
        const itemYear = dateStr.length >= 4 ? parseInt(dateStr.substring(0, 4), 10) : null;

        const titleMatch =
          itemClean === targetClean ||
          itemClean.includes(targetClean) ||
          targetClean.includes(itemClean);

        if (titleMatch) {
          if (year != null && itemYear != null) {
            if (itemYear === year || Math.abs(itemYear - year) <= 1) {
              if (item.id != null) {
                cache.set(cacheKey, item.id);
                return item.id;
              }
            }
          } else if (bestMatchId == null) {
            bestMatchId = item.id;
          }
        }
      }

      if (bestMatchId != null) {
        cache.set(cacheKey, bestMatchId);
        return bestMatchId;
      }
      if (results[0].id != null) {
        cache.set(cacheKey, results[0].id);
        return results[0].id;
      }
    }

    // Backup search via proxy
    const proxyData = await getJson(
      TMDB_PROXY + '/search/' + endpoint +
      '?query=' + encodeURIComponent(title), 6000);
    const pResults = proxyData && Array.isArray(proxyData.results) ? proxyData.results : null;
    if (pResults && pResults.length) {
      for (const item of pResults) {
        const itemTitle = String(
          item.title ?? item.name ?? item.original_title ?? item.original_name ?? '');
        const itemClean = cleanString(itemTitle);
        const dateStr = String(item.release_date ?? item.first_air_date ?? '');
        const itemYear = dateStr.length >= 4 ? parseInt(dateStr.substring(0, 4), 10) : null;

        if (itemClean === targetClean || itemClean.includes(targetClean)) {
          if (year == null || itemYear == null || itemYear === year ||
              Math.abs(itemYear - year) <= 1) {
            if (item.id != null) {
              cache.set(cacheKey, item.id);
              return item.id;
            }
          }
        }
      }
      if (pResults[0].id != null) {
        cache.set(cacheKey, pResults[0].id);
        return pResults[0].id;
      }
    }
  }

  return null;
}

module.exports = { resolveTmdbId, TMDB_API_KEY };

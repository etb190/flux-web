// ── Flux: home-page orchestrator (main process) ──────────────────────────
// Combines the two data sources of the home page:
//
//   Streaming Availability API  →  Top 10s per service, popular per service,
//                                  new this week, leaving soon (needs a key)
//   TMDB                        →  "Trending This Week" row (key built in)
//
// Every source fails independently: the page renders whichever rows loaded,
// shows a small notice for sources that failed, and only errors out when
// nothing at all could be loaded. Hero picks the SA pick (it carries the
// streaming-service chips) and falls back to the best trending backdrop.

const saa = require('./saa.js');
const tmdb = require('./tmdbhome.js');

function pickHero(rows) {
  // Prefer an item that has a backdrop so the hero banner looks right.
  for (const row of rows) {
    const hit = row.items.find((x) => x.backdrop);
    if (hit) return hit;
  }
  for (const row of rows) {
    if (row.items.length) return row.items[0];
  }
  return null;
}

// Returns one of:
//   { noKey: true }                      — SA key missing AND trending empty
//   { error: 'message' }                 — nothing at all loaded
//   { country, hero, rows, notice? }     — success (notice = partial failure)
async function getHomeData(opts) {
  const saaKey = opts && opts.saaKey;
  const tmdbKey = opts && opts.tmdbKey;
  const country = opts && opts.country;
  const cacheDir = opts && opts.cacheDir;

  const [saaRes, tmdbRes] = await Promise.allSettled([
    saa.getHomeData(saaKey, country, { cacheDir }),
    tmdb.getTrending({ cacheDir, key: tmdbKey })
  ]);

  const saaData = saaRes.status === 'fulfilled'
    ? saaRes.value
    : { error: String((saaRes.reason && saaRes.reason.message) || saaRes.reason) };
  const tmdbData = tmdbRes.status === 'fulfilled'
    ? tmdbRes.value
    : { items: [], error: String((tmdbRes.reason && tmdbRes.reason.message) || tmdbRes.reason) };

  const rows = [];
  const notices = [];

  // TMDB trending first — it's the "what's hot right now" opener.
  if (tmdbData.items && tmdbData.items.length) {
    rows.push({ key: 'trending', title: 'Trending This Week', items: tmdbData.items });
  } else if (tmdbData.error) {
    notices.push('Trending row unavailable: ' + tmdbData.error);
  }

  let saHero = null;
  if (saaData.rows) {
    for (const row of saaData.rows) {
      if (row.items && row.items.length) rows.push(row);
    }
    saHero = saaData.hero || null;
    if (saaData.notice) notices.push(saaData.notice);
  } else if (saaData.noKey) {
    notices.push(
      'Streaming-availability rows are hidden — no API key (Settings \u2192 Streaming Availability API key).'
    );
  } else if (saaData.error) {
    notices.push('Streaming-availability rows unavailable: ' + saaData.error);
  }

  if (!rows.length) {
    if (saaData.noKey) return { noKey: true };
    const firstErr = saaData.error || tmdbData.error;
    return { error: firstErr || 'No data available right now.' };
  }

  // Hero: SA pick (has service chips) when available, else best trending
  // backdrop. The hero row items already include the trending row itself.
  const hero = saHero || pickHero(rows.filter((r) => r.key !== 'trending')) ||
    pickHero(rows);

  const payload = { country: saaData.country || country, hero, rows };
  if (notices.length) payload.notice = notices.join(' ');
  return payload;
}

module.exports = { getHomeData };

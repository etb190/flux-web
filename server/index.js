// ── Flux web backend ─────────────────────────────────────────────────────
// Express server that replaces the old Electron main process. The renderer
// modules (scrapers, subtitle engine, home orchestrator, library) run here
// unchanged; the browser talks to them over REST + SSE instead of IPC.
//
//   /api/events            SSE multiplexer (streams + subtitles progress)
//   /api/search            Cinemeta search (movies + series in parallel)
//   /api/meta              full metadata (episodes/seasons for series)
//   /api/streams           multi-provider source scan (progress over SSE)
//   /api/subtitles/*       Helix subtitle search / download / cancel
//   /api/player-rules      header + CORS rules used by the media proxy
//   /api/media             stream proxy: injects UA/Referer, adds CORS
//   /api/settings          persisted settings (data/settings.json)
//   /api/home              Streaming Availability API + TMDB home rows
//   /api/history, /api/watched   watch history + watched list (data/)
//   /api/suggestions       TMDB "Because you watched ..." rows
//
// Static: serves the built client from dist/ (npm run build first).

const express = require('express');
const path = require('path');
const { Readable } = require('stream');
const { searchAll, fetchMeta } = require('./lib/search.js');
const { fetchStreams, cancelStreams } = require('./lib/streams.js');
const { searchSubtitles, downloadSubtitle, cancelSubtitles } = require('./lib/subtitles.js');
const home = require('./lib/home.js');
const library = require('./lib/library.js');
const tmdbapi = require('./lib/tmdbapi.js');
const { UA } = require('./lib/http.js');
const { loadSettings, saveSettings } = require('./lib/settings.js');

const PORT = Number(process.env.PORT || 5175);
const DATA_DIR = path.join(__dirname, '..', 'data');
const settingsFile = path.join(DATA_DIR, 'settings.json');
const libraryFile = path.join(DATA_DIR, 'library.json');
const cacheDir = path.join(DATA_DIR, 'cache');

const app = express();
app.use(express.json({ limit: '2mb' }));

// ── SSE: progress events (streams + subtitles) ───────────────────────────
// Mirrors the old webContents.send('flux:streams:progress', payload) pushes.
const sseClients = new Set();

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write(':connected\n\n');
  sseClients.add(res);

  const ping = setInterval(() => {
    try { res.write(':ping\n\n'); } catch (_) { /* closed */ }
  }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
});

function broadcast(channel, payload) {
  const frame = 'event: ' + channel + '\ndata: ' + JSON.stringify(payload) + '\n\n';
  for (const res of sseClients) {
    try { res.write(frame); } catch (_) { /* dropped client */ }
  }
}

// ── Search + metadata ────────────────────────────────────────────────────
app.post('/api/search', async (req, res) => {
  try { res.json(await searchAll(String((req.body && req.body.query) || ''))); }
  catch (e) { res.status(500).json({ error: (e && e.message) || 'Search failed.' }); }
});

app.post('/api/meta', async (req, res) => {
  try {
    const { type, id } = req.body || {};
    res.json(await fetchMeta(String(type || ''), String(id || '')));
  } catch (e) { res.status(500).json({ error: (e && e.message) || 'Meta failed.' }); }
});

// ── Source scan (returns requestId; progress streams over SSE) ───────────
let streamRequestSeq = 0;

app.post('/api/streams', (req, res) => {
  const requestId = ++streamRequestSeq;
  cancelStreams();                       // abort any previous scan

  const send = (payload) => broadcast('streams', { requestId, ...payload });

  fetchStreams(req.body || {}, {
    onInit: (providers) => send({ kind: 'init', providers }),
    onProvider: (p) => send({ kind: 'provider', ...p }),
    onDone: (summary) => send({
      kind: 'done',
      total: summary.total,
      directCount: summary.directCount,
      embedCount: summary.embedCount,
      providers: summary.providers,
      sources: summary.sources,
      embeds: summary.embeds
    })
  });

  res.json({ requestId });
});

app.post('/api/streams/cancel', (_req, res) => {
  cancelStreams();
  res.json(true);
});

// ── Subtitles (Helix SubtitleService pattern) ────────────────────────────
let subsRequestSeq = 0;

app.post('/api/subtitles/search', (req, res) => {
  const requestId = ++subsRequestSeq;
  cancelSubtitles();                     // abort any previous search

  const send = (payload) => broadcast('subs', { requestId, ...payload });

  searchSubtitles(req.body || {}, {
    onBatch: (variants, provider) => send({ kind: 'batch', variants, provider }),
    onDone: (total) => send({ kind: 'done', total })
  });

  res.json({ requestId });
});

app.post('/api/subtitles/cancel', (_req, res) => {
  cancelSubtitles();
  res.json(true);
});

app.post('/api/subtitles/download', async (req, res) => {
  try {
    res.json(await downloadSubtitle((req.body && req.body.variant) || null));
  } catch (e) {
    res.status(500).json(null);
  }
});

// ── Player rules + media proxy ───────────────────────────────────────────
// A browser can't inject Referer/UA into <video>/hls.js requests and can't
// relax CORS on third-party media hosts. Instead, direct links are played
// through /api/media, which applies the same per-host header rules the old
// Electron webRequest interceptors used and answers with CORS enabled.
let playerRules = { headers: [], corsHosts: [] };

app.post('/api/player-rules', (req, res) => {
  const rules = req.body || {};
  playerRules = {
    headers: Array.isArray(rules.headers) ? rules.headers : [],
    corsHosts: Array.isArray(rules.corsHosts) ? rules.corsHosts : []
  };
  res.json(true);
});

app.post('/api/player-rules/clear', (_req, res) => {
  playerRules = { headers: [], corsHosts: [] };
  res.json(true);
});

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailer'
]);

app.get('/api/media', async (req, res) => {
  const target = String(req.query.u || '');
  let parsed;
  try { parsed = new URL(target); } catch (_) { parsed = null; }
  if (!parsed || !/^https?:$/.test(parsed.protocol)) {
    return res.status(400).json({ error: 'Invalid media URL.' });
  }

  const host = parsed.hostname;
  const rule = playerRules.headers.find(
    (r) => host === r.host || host.endsWith('.' + r.host)
  );

  // Forward the client's Range/Accept so seeking works, then layer the
  // scraper's required headers (User-Agent / Referer / cookies) on top.
  // Referer priority: per-host rule > parent playlist's referer (r param,
  // set automatically when rewriting HLS playlists) > target origin.
  const headers = {};
  for (const h of ['range', 'accept', 'accept-language']) {
    if (req.headers[h]) headers[h] = req.headers[h];
  }
  for (const [k, v] of Object.entries((rule && rule.headers) || {})) headers[k] = v;
  const hasHeader = (obj, name) =>
    Object.keys(obj).some((k) => k.toLowerCase() === name);
  if (!hasHeader(headers, 'user-agent')) headers['User-Agent'] = UA;

  const parentReferer = String(req.query.r || '')
    .replace(/[\r\n]+/g, '')
    .slice(0, 500);
  let referer;
  if (hasHeader(headers, 'referer')) {
    referer = Object.entries(headers)
      .find(([k]) => k.toLowerCase() === 'referer')[1];
  } else if (parentReferer) {
    referer = parentReferer;
    headers.Referer = referer;
  } else {
    referer = parsed.origin + '/';
    headers.Referer = referer;
  }

  try {
    const upstream = await fetch(parsed.href, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(45000)
    });

    const out = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': '*' };
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (!HOP_BY_HOP.has(lower) && lower !== 'content-security-policy'
        && lower !== 'access-control-allow-origin') {
        out[key] = value;
      }
    });

    // HLS playlists must be rewritten: hls.js resolves every relative URI
    // against the proxy URL it requested, so absolutize each entry against
    // the upstream playlist URL and re-wrap it in the proxy.
    const finalUrl = upstream.url || parsed.href;
    const type = String(upstream.headers.get('content-type') || '');
    const looksPlaylist = /mpegurl/i.test(type) || /\.m3u8($|\?)/i.test(finalUrl);
    if (looksPlaylist) {
      const text = await upstream.text();
      out['Content-Type'] = 'application/vnd.apple.mpegurl';
      delete out['Content-Length'];
      res.status(upstream.status);
      for (const [key, value] of Object.entries(out)) res.setHeader(key, value);
      res.end(rewritePlaylist(text, finalUrl, referer));
      return;
    }

    res.status(upstream.status);
    for (const [key, value] of Object.entries(out)) res.setHeader(key, value);

    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ error: 'Media fetch failed.' });
    else res.end();
  }
});

// Rewrap an absolute URL through the media proxy. `referer` rides along so
// child entries (segments / child playlists) reuse the referer that worked
// for their parent playlist.
function proxied(absUrl, referer) {
  let out = '/api/media?u=' + encodeURIComponent(absUrl);
  if (referer) out += '&r=' + encodeURIComponent(referer);
  return out;
}

// Absolutize a playlist entry against the playlist's own URL and proxy it.
function proxiedRelative(uri, baseUrl, referer) {
  try {
    return proxied(new URL(uri, baseUrl).href, referer);
  } catch (_) {
    return uri;
  }
}

// Rewrite all URIs inside an M3U8 playlist (master + media playlists):
//   - tag attributes: URI="…" (#EXT-X-KEY, #EXT-X-MAP, #EXT-X-MEDIA, …)
//   - plain entry lines (child playlists, segments)
function rewritePlaylist(text, baseUrl, referer) {
  return text.split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (_m, uri) => {
        if (/^\/api\/media\?/.test(uri)) return 'URI="' + uri + '"';
        return 'URI="' + proxiedRelative(uri, baseUrl, referer) + '"';
      });
    }
    if (/^\/api\/media\?/.test(trimmed)) return line;
    return proxiedRelative(trimmed, baseUrl, referer);
  }).join('\n');
}

// ── Settings ─────────────────────────────────────────────────────────────
app.get('/api/settings', (_req, res) => {
  res.json(loadSettings(settingsFile));
});

app.post('/api/settings', (req, res) => {
  try { res.json(saveSettings(settingsFile, req.body || {})); }
  catch (e) { res.status(500).json({ error: (e && e.message) || 'Save failed.' }); }
});

// ── Home page (Streaming Availability API + TMDB) ────────────────────────
app.get('/api/home', async (_req, res) => {
  const s = loadSettings(settingsFile);
  try {
    res.json(await home.getHomeData({
      saaKey: s.saaApiKey,
      tmdbKey: s.tmdbApiKey,
      country: s.saaCountry,
      cacheDir
    }));
  } catch (e) {
    res.json({ error: (e && e.message) || 'Home data failed to load.' });
  }
});

// ── Watch history ("Continue watching" row) ──────────────────────────────
app.get('/api/history', (_req, res) => {
  res.json(library.listHistory(libraryFile));
});

app.post('/api/history', (req, res) => {
  try { res.json({ history: library.addHistory(libraryFile, req.body) }); }
  catch (e) { res.json({ error: (e && e.message) || 'Failed to record.' }); }
});

app.post('/api/history/remove', (req, res) => {
  res.json(library.removeHistory(libraryFile, String((req.body && req.body.imdbId) || '')));
});

// ── Watched list (drives the suggestion rows) ────────────────────────────
app.get('/api/watched', (_req, res) => {
  res.json(library.listWatched(libraryFile));
});

app.post('/api/watched', (req, res) => {
  try { res.json({ watched: library.addWatched(libraryFile, req.body) }); }
  catch (e) { res.json({ error: (e && e.message) || 'Failed to add.' }); }
});

app.post('/api/watched/remove', (req, res) => {
  res.json(library.removeWatched(libraryFile, String((req.body && req.body.imdbId) || '')));
});

// ── TMDB suggestions + TMDB→IMDb lookup ──────────────────────────────────
app.get('/api/suggestions', async (_req, res) => {
  const s = loadSettings(settingsFile);
  const key = s.tmdbApiKey || '';
  if (!key) return res.json({ rows: [] });   // TMDB key cleared → no suggestions
  try {
    res.json(await tmdbapi.buildSuggestionRows(key, library.listWatched(libraryFile)));
  } catch (e) {
    res.json({ error: (e && e.message) || 'Suggestions failed to load.' });
  }
});

app.get('/api/tmdb-to-imdb', async (req, res) => {
  const s = loadSettings(settingsFile);
  try {
    res.json({
      imdbId: await tmdbapi.tmdbToImdb(
        s.tmdbApiKey,
        String(req.query.tmdbId || ''),
        String(req.query.type || '')
      )
    });
  } catch (e) {
    res.json({ error: (e && e.message) || 'Lookup failed.' });
  }
});

// ── Static client (built with `npm run build`) ───────────────────────────
const distDir = path.join(__dirname, '..', 'dist');
app.use(express.static(distDir));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(distDir, 'index.html'), (err) => {
    if (err && !res.headersSent) {
      res.status(503).send('Client not built yet — run: npm run build');
    }
  });
});

app.listen(PORT, () => {
  console.log('[Flux] web server on http://localhost:' + PORT);
  console.log('[Flux] data dir: ' + DATA_DIR);
});

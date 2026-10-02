// ── Flux streams: episode source providers ───────────────────────────────
// Direct-extraction scrapers ported 1:1 from Helix
// (lib/services/scraper/sites/*.dart) + guaranteed embed-player sources.
// Each provider is an async fn(ctx) -> [source] where ctx = {
//   type ('series'|'movie'), isTv, tmdbId, imdbId, title, year, season, episode }
const { resolveTmdbId } = require('./tmdb.js');
const p2 = require('./providers2.js');
const p3 = require('./providers3.js');
const {
  UA, fetchJson, fetchText, fetchRaw, fmtOf, streamKey, cancelAll,
  coerceSizeBytes, parseSizeBytes
} = require('./http.js');

// ── 1. VidSrc (Helix vidsrc.dart: data.vidsrcme.ru + vidsrc.me fallback) ──
async function scrapeVidSrc(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;

  const params = new URLSearchParams({
    type: ctx.isTv ? 'tv' : 'movie',
    tmdb: String(ctx.tmdbId),
    stream_urls: ''
  });
  if (ctx.isTv) {
    params.set('season', String(ctx.season ?? 1));
    params.set('episode', String(ctx.episode ?? 1));
  }

  try {
    const json = await fetchJson('https://data.vidsrcme.ru/api.php?' + params.toString(), {
      headers: { 'User-Agent': UA, Referer: 'https://cloudorchestranova.com/', Accept: 'application/json' }
    });
    const urls = json && json.data ? json.data.stream_urls : null;
    if (Array.isArray(urls)) {
      urls.forEach((u, i) => {
        const url = String(u).trim();
        if (!url.startsWith('http')) return;
        out.push({
          provider: 'VidSrc',
          title: urls.length > 1 ? 'VidSrc ' + (i + 1) : 'VidSrc',
          format: fmtOf(url),
          quality: null,
          description: 'VidSrc direct stream source',
          url,
          headers: { 'User-Agent': UA, Referer: 'https://cloudorchestranova.com/' }
        });
      });
    }
  } catch (_) {}

  // Fallback: scrape the VidSrc embed page for direct m3u8 links
  if (out.length === 0) {
    const embedUrl = ctx.isTv
      ? 'https://vidsrc.me/embed/tv/' + ctx.tmdbId + '/' + (ctx.season ?? 1) + '/' + (ctx.episode ?? 1)
      : 'https://vidsrc.me/embed/movie/' + ctx.tmdbId;
    try {
      const html = await fetchText(embedUrl, {
        headers: { 'User-Agent': UA, Referer: 'https://vidsrc.me/' }
      });
      if (html) {
        const matches = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/g) || [];
        for (const url of matches.slice(0, 6)) {
          out.push({
            provider: 'VidSrc',
            title: 'VidSrc Direct',
            format: 'HLS',
            quality: null,
            description: 'VidSrc direct HLS stream',
            url,
            headers: { 'User-Agent': UA, Referer: 'https://vidsrc.me/' }
          });
        }
      }
    } catch (_) {}
  }

  return out;
}

// ── 2. VidAPI (Helix vidapi.dart: streamdata.vaplayer.ru) ─────────────────
function extractStreamUrls(obj, urls) {
  if (obj == null) return;
  if (typeof obj === 'string') {
    if (obj.startsWith('http') &&
        (obj.includes('.m3u8') || obj.includes('.mp4') || obj.includes('.mpd'))) {
      urls.add(obj);
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) extractStreamUrls(item, urls);
  } else if (typeof obj === 'object') {
    for (const val of Object.values(obj)) extractStreamUrls(val, urls);
  }
}

async function scrapeVidApi(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;

  const params = new URLSearchParams({
    tmdb: String(ctx.tmdbId),
    type: ctx.isTv ? 'tv' : 'movie'
  });
  if (ctx.isTv) {
    params.set('season', String(ctx.season ?? 1));
    params.set('episode', String(ctx.episode ?? 1));
  }

  try {
    const data = await fetchJson('https://streamdata.vaplayer.ru/api.php?' + params.toString(), {
      headers: {
        Accept: '*/*',
        Origin: 'https://nextgencloudfabric.com',
        Referer: 'https://nextgencloudfabric.com/',
        'User-Agent': UA
      }
    });
    if (!data) return out;

    const urls = new Set();
    extractStreamUrls(data, urls);

    // Collapse same-stream token variants: vaplayer returns several
    // master.m3u8 URLs that differ only by their encoded token (same host,
    // same path prefix, same filename) — they are one playable source.
    const seenKeys = new Set();
    for (const url of urls) {
      const key = streamKey(url);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      out.push({
        provider: 'VidAPI',
        title: 'VidAPI · ' + fmtOf(url) + ' · 1080p',
        format: fmtOf(url),
        quality: null,
        description: 'VidAPI stream · ' + fmtOf(url),
        url,
        headers: {
          'User-Agent': UA,
          Referer: 'https://nextgencloudfabric.com/',
          Origin: 'https://nextgencloudfabric.com'
        }
      });
    }
  } catch (_) {}

  return out;
}

// ── 3. VidLink (Helix vidlink.dart: enc-dec.app + vidlink.pro) ────────────
async function scrapeVidLink(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;

  try {
    const encData = await fetchJson('https://enc-dec.app/api/enc-vidlink?text=' + ctx.tmdbId, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      timeoutMs: 6000
    });
    if (!encData || encData.status !== 200 || encData.result == null) return out;
    const encKey = String(encData.result);

    const endpoint = ctx.isTv
      ? 'https://vidlink.pro/api/b/tv/' + encKey + '/' + (ctx.season ?? 1) + '/' + (ctx.episode ?? 1)
      : 'https://vidlink.pro/api/b/movie/' + encKey;

    const data = await fetchJson(endpoint, {
      headers: {
        'User-Agent': UA,
        Origin: 'https://vidlink.pro',
        Referer: 'https://vidlink.pro/',
        Accept: 'application/json, text/plain, */*'
      }
    });
    if (!data || !data.stream || typeof data.stream !== 'object') return out;

    const stream = data.stream;
    const linkHeaders = {
      'User-Agent': UA,
      Origin: 'https://vidlink.pro',
      Referer: 'https://vidlink.pro/'
    };

    if (stream.playlist) {
      const playlistUrl = String(stream.playlist);
      if (playlistUrl) {
        out.push({
          provider: 'VidLink',
          title: 'VidLink · Master HLS · 1080p',
          format: 'HLS',
          quality: '1080p',
          description: 'VidLink HLS stream',
          url: playlistUrl,
          headers: linkHeaders
        });
      }
    }

    if (stream.qualities && typeof stream.qualities === 'object') {
      for (const q of ['1080', '720', '480', '360']) {
        const qEntry = stream.qualities[q];
        if (qEntry && qEntry.url) {
          out.push({
            provider: 'VidLink',
            title: 'VidLink · ' + q + 'p',
            format: fmtOf(String(qEntry.url)),
            quality: q + 'p',
            description: 'VidLink MP4 stream',
            url: String(qEntry.url),
            headers: linkHeaders
          });
          break;
        }
      }
    }
  } catch (_) {}

  return out;
}

// ── 4. VidCore (Helix vidcore.dart: vidcore.org/api/sources + skip rounds) ─
function parseVidCoreSources(outerSources, apiBase) {
  const rows = [];
  const skipped = new Set();
  const seen = new Set();

  for (const o of Array.isArray(outerSources) ? outerSources : []) {
    if (!o || typeof o !== 'object') continue;
    const label = String(o.label ?? o.provider ?? o.server ?? 'VidCore');
    if (o.label != null) skipped.add(String(o.label));

    let inners = [];
    if (o.data && typeof o.data === 'object' && Array.isArray(o.data.sources)) {
      inners = o.data.sources;
    } else if (Array.isArray(o.sources)) {
      inners = o.sources;
    } else if (o.url) {
      inners = [o];
    }

    for (const s of inners) {
      if (!s || typeof s !== 'object') continue;
      const url = s.url ? String(s.url) : '';
      if (!url || !url.startsWith('http') || seen.has(url)) continue;
      seen.add(url);
      const quality = String(s.quality ?? o.quality ?? 'Auto');
      rows.push({
        provider: 'VidCore',
        title: 'VidCore ' + label + ' · ' + quality,
        format: fmtOf(url),
        quality: /^\d+$/.test(quality) ? quality + 'p' : null,
        description: 'VidCore direct stream',
        url,
        headers: { 'User-Agent': UA, Referer: apiBase + '/' }
      });
    }
  }
  return { rows, skipped };
}

async function scrapeVidCore(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;

  const bases = ['https://www.vidcore.org', 'https://vidcore.org'];
  try {
    for (const base of bases) {
      const params = new URLSearchParams({
        id: String(ctx.tmdbId),
        type: ctx.isTv ? 'tv' : 'movie'
      });
      if (ctx.isTv) {
        params.set('season', String(ctx.season ?? 1));
        params.set('episode', String(ctx.episode ?? 1));
      }

      const fetchRound = async (skipLabels) => {
        const p = new URLSearchParams(params);
        if (skipLabels && skipLabels.size) p.set('skip', [...skipLabels].join(','));
        return fetchJson(base + '/api/sources?' + p.toString(), {
          headers: {
            'User-Agent': UA,
            Referer: base + '/embed/movie/' + ctx.tmdbId,
            Origin: base,
            Accept: 'application/json'
          },
          timeoutMs: 10000
        });
      };

      let skipped = new Set();
      for (let round = 0; round < 4 && skipped.size < 12; round++) {
        const data = await fetchRound(round === 0 ? null : skipped);
        if (!data || !Array.isArray(data.sources)) break;

        const { rows, skipped: newSkipped } = parseVidCoreSources(data.sources, base);
        for (const r of rows) if (!out.some((x) => x.url === r.url)) out.push(r);
        newSkipped.forEach((s) => skipped.add(s));

        if (rows.length === 0) break;
      }

      if (out.length) break; // first working base wins (Helix behavior)
    }
  } catch (_) {}

  return out;
}

// ── 5. FlyStream (Helix flystream.dart: flystream.net/api/streams) ────────
async function scrapeFlyStream(ctx) {
  const out = [];
  try {
    const viewerId = [...Array(32)].map(() =>
      Math.floor(Math.random() * 16).toString(16)).join('');

    const params = new URLSearchParams({
      type: ctx.isTv ? 'tv' : 'movie',
      viewerId,
      title: ctx.title || ''
    });
    if (ctx.tmdbId) params.set('tmdbId', String(ctx.tmdbId));
    if (ctx.imdbId) params.set('imdb', ctx.imdbId);
    if (ctx.year) params.set('year', String(ctx.year));
    if (ctx.isTv) {
      params.set('season', String(ctx.season ?? 1));
      params.set('episode', String(ctx.episode ?? 1));
    }

    const data = await fetchJson('https://flystream.net/api/streams?' + params.toString(), {
      headers: { 'User-Agent': UA, Referer: 'https://flystream.net/', Accept: 'application/json' },
      timeoutMs: 5000
    });

    const streams = data && Array.isArray(data.streams) ? data.streams : [];
    for (const s of streams) {
      if (!s || typeof s !== 'object' || !s.url) continue;
      let url = String(s.url);
      if (url.startsWith('/')) url = 'https://flystream.net' + url;
      if (!url.startsWith('http')) continue;

      const quality = s.quality ? String(s.quality) : 'Auto';
      const codec = s.videoCodec ? String(s.videoCodec).toUpperCase() : '';
      const size = s.size ? String(s.size) : '';
      const name = String(s.name ?? s.title ?? ctx.title ?? 'Stream');
      const details = [quality, codec, size].filter(Boolean).join(' · ');

      out.push({
        provider: 'FlyStream',
        title: 'FlyStream ' + name,
        format: fmtOf(url),
        quality: /^\d+p$/.test(quality) ? quality : null,
        description: details ? 'FlyStream ' + details : 'FlyStream direct HLS stream',
        url,
        headers: { 'User-Agent': UA, Referer: 'https://flystream.net/' }
      });
    }
  } catch (_) {}

  return out;
}

// ── 6. 2Embed / MultiEmbed (Helix multiembed.dart: HTML + XPS chain) ──────
// Parse server URLs out of the 2embed embed page
function parse2EmbedServers(html) {
  const servers = [];
  const onclickRe = /onclick=\x22go\('([^']+)'\)\x22/g;
  let m;
  while ((m = onclickRe.exec(html)) !== null) {
    if (m[1].startsWith('http')) servers.push(m[1]);
  }
  const dataSrc = /data-src="([^"]+)"/.exec(html);
  if (dataSrc && dataSrc[1].startsWith('http') && !servers.includes(dataSrc[1])) {
    servers.unshift(dataSrc[1]);
  }
  return servers;
}

// Parse the play.xpass.top playlist.json chain
function parseXpsPlaylist(json) {
  const files = [];
  const playlists = json && Array.isArray(json.playlist) ? json.playlist : [];
  for (const pl of playlists) {
    const sources = pl && Array.isArray(pl.sources) ? pl.sources : [];
    for (const src of sources) {
      const file = src && src.file ? String(src.file) : '';
      if (file.startsWith('http') &&
          !file.includes('/error') &&
          !file.includes('.txt') &&
          (file.includes('.m3u8') || file.includes('.mp4') || file.includes('/playlist/'))) {
        files.push({ file, label: src.label ? String(src.label) : 'Auto' });
      }
    }
  }
  return files;
}

async function scrape2Embed(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;
  const s = ctx.season ?? 1;
  const e = ctx.episode ?? 1;

  try {
    const embedPath = ctx.isTv
      ? '/embedtv/' + ctx.tmdbId + '&s=' + s + '&e=' + e
      : (ctx.imdbId && ctx.imdbId.startsWith('tt')
        ? '/embed/' + ctx.imdbId
        : '/embed/' + ctx.tmdbId);

    const html = await fetchText('https://www.2embed.cc' + embedPath, {
      headers: {
        'User-Agent': UA,
        Referer: 'https://www.2embed.cc/',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeoutMs: 10000
    });
    if (!html) return out;

    const serverUrls = parse2EmbedServers(html);

    for (const sUrl of serverUrls) {
      if (out.length >= 6) break;
      if (!sUrl.includes('/xps')) continue;

      // XPS chain: play.xpass.top → playlist.json → m3u8
      let pImdb = ctx.imdbId || '';
      let pTmdb = String(ctx.tmdbId);
      try {
        const q = new URL(sUrl).searchParams;
        pImdb = q.get('imdb') || pImdb;
        pTmdb = q.get('tmdb') || pTmdb;
      } catch (_) {}

      const xpsPageUrl = ctx.isTv
        ? 'https://play.xpass.top/e/tv/' + pTmdb + '/' + s + '/' + e + '?autostart=true'
        : 'https://play.xpass.top/e/movie/' + pImdb + '?autostart=true';

      const xpsHtml = await fetchText(xpsPageUrl, {
        headers: { 'User-Agent': UA, Referer: 'https://streamsrcs.2embed.cc/' },
        timeoutMs: 8000
      });
      if (!xpsHtml) continue;

      let playlistPath = null;
      const dataMatch = /var data\s*=\s*(\{[\s\S]*?\});/.exec(xpsHtml);
      if (dataMatch) {
        try {
          playlistPath = JSON.parse(dataMatch[1]).playlist;
        } catch (_) {}
      }
      if (!playlistPath) {
        const plMatch = /"playlist"\s*:\s*"([^"]+)"/.exec(xpsHtml);
        playlistPath = plMatch ? plMatch[1] : null;
      }
      if (!playlistPath) continue;

      const playlistUrl = playlistPath.startsWith('http')
        ? playlistPath
        : 'https://play.xpass.top' + (playlistPath.startsWith('/') ? '' : '/') + playlistPath;

      const plJson = await fetchJson(playlistUrl, {
        headers: {
          'User-Agent': UA,
          Referer: xpsPageUrl,
          Origin: 'https://play.xpass.top',
          Accept: 'application/json,*/*'
        },
        timeoutMs: 8000
      });
      if (!plJson) continue;

      for (const { file, label } of parseXpsPlaylist(plJson)) {
        if (out.length >= 6) break;
        out.push({
          provider: '2Embed',
          title: '2embed XPS · ' + label,
          format: fmtOf(file),
          quality: /^\d+p$/.test(label) ? label : null,
          description: '2Embed multi-CDN stream',
          url: file,
          headers: { 'User-Agent': UA, Referer: 'https://play.xpass.top/' }
        });
      }
    }
  } catch (_) {}

  return out;
}

// ── Embed-player sources (always available playback pages) ────────────────
// These are the well-known embed players that carry the episode; the future
// Flux player can open them in a webview/iframe. Listed after direct links.
function embedSources(ctx) {
  const s = ctx.season ?? 1;
  const e = ctx.episode ?? 1;
  const out = [];

  if (ctx.isTv) {
    if (ctx.tmdbId) {
      out.push(
        {
          provider: 'VidSrc.xyz', title: 'VidSrc.xyz', format: 'Embed', quality: null,
          description: 'Embed player · vidsrc.xyz', url:
            'https://vidsrc.xyz/embed/tv/' + ctx.tmdbId + '/' + s + '-' + e
        },
        {
          provider: 'VidLink', title: 'VidLink Embed', format: 'Embed', quality: null,
          description: 'Embed player · vidlink.pro', url:
            'https://vidlink.pro/tv/' + ctx.tmdbId + '/' + s + '/' + e
        },
        {
          provider: 'Videasy', title: 'Videasy Embed', format: 'Embed', quality: null,
          description: 'Embed player · player.videasy.net', url:
            'https://player.videasy.net/tv/' + ctx.tmdbId + '/' + s + '/' + e
        },
        {
          provider: 'VidFast', title: 'VidFast Embed', format: 'Embed', quality: null,
          description: 'Embed player · vidfast.pro', url:
            'https://vidfast.pro/tv/' + ctx.tmdbId + '/' + s + '/' + e
        },
        {
          provider: '2Embed', title: '2Embed Embed', format: 'Embed', quality: null,
          description: 'Embed player · 2embed.cc', url:
            'https://www.2embed.cc/embedtv/' + ctx.tmdbId + '&s=' + s + '&e=' + e
        }
      );
    }
    if (ctx.imdbId && ctx.imdbId.startsWith('tt')) {
      out.push({
        provider: 'MultiEmbed', title: 'MultiEmbed', format: 'Embed', quality: null,
        description: 'Embed player · multiembed.mov', url:
          'https://multiembed.mov/?video_id=' + ctx.imdbId + '&s=' + s + '&e=' + e
      });
    }
  } else {
    if (ctx.tmdbId) {
      out.push(
        {
          provider: 'VidSrc.xyz', title: 'VidSrc.xyz', format: 'Embed', quality: null,
          description: 'Embed player · vidsrc.xyz', url:
            'https://vidsrc.xyz/embed/movie/' + ctx.tmdbId
        },
        {
          provider: 'VidLink', title: 'VidLink Embed', format: 'Embed', quality: null,
          description: 'Embed player · vidlink.pro', url:
            'https://vidlink.pro/movie/' + ctx.tmdbId
        },
        {
          provider: 'Videasy', title: 'Videasy Embed', format: 'Embed', quality: null,
          description: 'Embed player · player.videasy.net', url:
            'https://player.videasy.net/movie/' + ctx.tmdbId
        },
        {
          provider: 'VidFast', title: 'VidFast Embed', format: 'Embed', quality: null,
          description: 'Embed player · vidfast.pro', url:
            'https://vidfast.pro/movie/' + ctx.tmdbId
        }
      );
    }
    if (ctx.imdbId && ctx.imdbId.startsWith('tt')) {
      out.push(
        {
          provider: 'MultiEmbed', title: 'MultiEmbed', format: 'Embed', quality: null,
          description: 'Embed player · multiembed.mov', url:
            'https://multiembed.mov/?video_id=' + ctx.imdbId
        },
        {
          provider: '2Embed', title: '2Embed Embed', format: 'Embed', quality: null,
          description: 'Embed player · 2embed.cc', url:
            'https://www.2embed.cc/embed/' + ctx.imdbId
        }
      );
    }
  }
  return out;
}

// ── Orchestrator (Helix ScraperManager.scrapeAll pattern) ─────────────────
const HTTP_PROVIDERS = [
  { name: 'VidSrc', fn: scrapeVidSrc },
  { name: 'VidAPI', fn: scrapeVidApi },
  { name: 'VidLink', fn: scrapeVidLink },
  { name: 'VidCore', fn: scrapeVidCore },
  { name: 'FlyStream', fn: scrapeFlyStream },
  { name: '2Embed', fn: scrape2Embed },
  // ── expanded set (providers2.js) ──
  { name: 'VixSrc', fn: p2.scrapeVixSrc },
  { name: 'VidZee', fn: p2.scrapeVidZee },
  { name: 'CineSrc', fn: p2.scrapeCineSrc },
  { name: 'Bcine', fn: p2.scrapeBcine },
  { name: 'Nova', fn: p2.scrapeNova },
  { name: 'MegaSource', fn: p2.scrapeMegaSource },
  { name: '111477', fn: p2.scrapeA111477 },
  { name: 'Frame', fn: p2.scrapeFrame },
  { name: 'Purstream', fn: p2.scrapePurstream },
  { name: 'MovieNight', fn: p2.scrapeMovieNight },
  { name: 'MeowTV', fn: p2.scrapeMeowTv },
  { name: 'VidUp', fn: p2.scrapeVidUp },
  { name: 'Hexa', fn: p2.scrapeHexa },
  { name: 'VidRock', fn: p2.scrapeVidRock },
  // ── batch 3 (providers3.js) — remaining Helix scrapers ──
  { name: 'Videasy', fn: p3.scrapeVideasy },
  { name: 'VidFast', fn: p3.scrapeVidFast },
  { name: 'PeeStream', fn: p3.scrapePeeStream },
  { name: 'XPass', fn: p3.scrapeXPass },
  { name: 'Movy', fn: p3.scrapeMovy },
  { name: 'Vuflix', fn: p3.scrapeVuflix },
  { name: 'RiveStream', fn: p3.scrapeRiveStream },
  { name: 'Cinejoy', fn: p3.scrapeCinejoy },
  { name: 'ZxcStream', fn: p3.scrapeZxcStream },
  { name: 'VidGod', fn: p3.scrapeVidGod },
  { name: 'VidVault', fn: p3.scrapeVidVault },
  { name: 'LookMovie', fn: p3.scrapeLookMovie },
  { name: 'FlaxMovies', fn: p3.scrapeFlaxMovies },
  { name: 'Mapple', fn: p3.scrapeMapple },
  { name: 'Dulo', fn: p3.scrapeDulo },
  { name: 'CineSu', fn: p3.scrapeCineSu },
  { name: 'Vadapav', fn: p3.scrapeVadapav },
  { name: '4KHDHub', fn: p3.scrape4KHDHub },
  { name: 'DownloadEverything', fn: p3.scrapeDownloadEverything },
  { name: 'LMScript', fn: p3.scrapeLMScript },
  { name: 'X-Downloader', fn: p3.scrapeXDownloader },
  { name: 'KissKH', fn: p3.scrapeKissKH },
  { name: 'FshareTV', fn: p3.scrapeFshareTV },
  { name: 'FSonic', fn: p3.scrapeFSonic },
  { name: 'FSOnline', fn: p3.scrapeFSOnline }
];

function cancelStreams() {
  cancelAll();
}

// Runs every provider in parallel, reporting progress per provider.
// cb: { onInit, onProvider({provider,status,count,sources}), onDone(summary) }
async function fetchStreams(params, cb) {
  cb = cb || {};
  const type = params.type === 'series' ? 'series' : 'movie';
  const isTv = type === 'series';

  const ctx = {
    type,
    isTv,
    imdbId: params.imdbId ? String(params.imdbId) : null,
    title: params.title ? String(params.title) : '',
    year: parseInt(params.year, 10) || null,
    season: isTv ? (parseInt(params.season, 10) || 1) : null,
    episode: isTv ? (parseInt(params.episode, 10) || 1) : null,
    tmdbId: null
  };

  const onInit = cb.onInit || (() => {});
  const onProvider = cb.onProvider || (() => {});
  const onDone = cb.onDone || (() => {});

  // Fire init immediately so the renderer can build its provider chips
  // before any network wait.
  onInit(HTTP_PROVIDERS.map((p) => p.name).concat(['Embed players']));

  // Resolve TMDB id once, shared by all providers (Helix TmdbHelper cache)
  try {
    ctx.tmdbId = await resolveTmdbId({
      imdbId: ctx.imdbId, title: ctx.title, type: ctx.isTv ? 'tv' : 'movie', year: ctx.year
    });
  } catch (_) {}

  const sources = [];
  const seenUrls = new Set();
  const providerStats = {};

  const runProvider = async (p) => {
    try {
      const list = await p.fn(ctx);
      const fresh = [];
      for (const src of list) {
        if (!src || !src.url || !String(src.url).startsWith('http')) continue;
        if (seenUrls.has(src.url)) continue;
        seenUrls.add(src.url);
        // Structured size for the renderer's size filter: explicit sizeBytes /
        // size from the provider, else parse the size text many providers put
        // in their title/description ("2.35 GB", "700 MB", raw bytes...).
        if (src.sizeBytes == null) {
          const explicit = coerceSizeBytes(src.size);
          const fromText = explicit != null ? explicit
            : parseSizeBytes([src.title, src.description].filter(Boolean).join(' '));
          if (fromText != null) src.sizeBytes = fromText;
        }
        fresh.push(src);
      }
      providerStats[p.name] = { status: fresh.length ? 'ok' : 'empty', count: fresh.length };
      if (fresh.length) sources.push(...fresh);
      onProvider({ provider: p.name, status: providerStats[p.name].status, count: fresh.length, sources: fresh });
    } catch (_) {
      providerStats[p.name] = { status: 'error', count: 0 };
      onProvider({ provider: p.name, status: 'error', count: 0, sources: [] });
    }
  };

  await Promise.all(HTTP_PROVIDERS.map(runProvider));

  // Embed players last so direct links stay on top
  const embeds = embedSources(ctx).filter((s) => !seenUrls.has(s.url));
  for (const s of embeds) seenUrls.add(s.url);
  providerStats['Embed players'] = { status: embeds.length ? 'ok' : 'empty', count: embeds.length };
  onProvider({ provider: 'Embed players', status: embeds.length ? 'ok' : 'empty', count: embeds.length, sources: embeds });

  const direct = sources.length;
  const summary = {
    sources,
    embeds,
    total: direct + embeds.length,
    directCount: direct,
    embedCount: embeds.length,
    providers: providerStats,
    tmdbId: ctx.tmdbId
  };
  onDone(summary);
  return summary;
}

// Expose internals for unit tests
const _internals = {
  extractStreamUrls,
  parse2EmbedServers,
  parseXpsPlaylist,
  parseVidCoreSources,
  embedSources,
  fmtOf
};

module.exports = { fetchStreams, cancelStreams, _internals };

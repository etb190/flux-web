// ── Flux streams: batch-3 provider set (1:1 ports of the remaining Helix
//    lib/services/scraper/sites/*.dart scrapers) ───────────────────────────
// Videasy, VidFast, PeeStream, XPass, Movy, Vuflix, RiveStream, Cinejoy,
// ZxcStream, VidGod, VidVault, LookMovie, FlaxMovies, Mapple, Dulo, CineSu,
// Vadapav, 4KHDHub, DownloadEverything, LMScript, XDownloader, KissKH,
// FshareTV, FSonic, FSOnline
const crypto = require('crypto');
const {
  UA, fetchPage, resCookies, cookieOf, fetchJson, fetchText, fetchRaw, fmtOf
} = require('./http.js');
const { generateCryptoHlsUrl, encDecPost } = require('./providers2.js');

// ── Shared "mvm1" keystream cipher (Videasy + Movy use the same scheme) ──
const MV_F = [
  1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993,
  2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987,
  1925078388, 2162078206, 2614888103, 3248222580
];

function mvMix(e) {
  let v = e >>> 0;
  v = (v ^ (v >>> 16)) >>> 0;
  v = Math.imul(v, 0x85ebca6b) >>> 0;
  v = (v ^ (v >>> 13)) >>> 0;
  v = Math.imul(v, 0xc2b2ae35) >>> 0;
  return (v ^ (v >>> 16)) >>> 0;
}

function mvRotl(e, t) {
  t &= 31;
  if (t === 0) return e >>> 0;
  return ((e << t) | (e >>> (32 - t))) >>> 0;
}

function mvFnv1a(str) {
  let t = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    t = Math.imul(t ^ str.charCodeAt(i), 0x1000193) >>> 0;
  }
  return mvMix(t);
}

function mvIsEvenTri(e) { return (((e * (e + 1)) & 1) === 0); }
function mvIsOddTri(e) { return (((e * (e + 1)) & 1) === 1); }

function mvRc4Sbox(seed) {
  const t = Array.from({ length: 256 }, (_, i) => i);
  let s = 0;
  for (let a = 0; a < 256; a++) {
    s = (s + t[a] + seed.charCodeAt(a % seed.length)) & 255;
    const r = t[a];
    t[a] = t[s];
    t[s] = r;
  }
  return t;
}

function mvAccSeed(str) {
  let t = 1732584193;
  for (let s = 0; s < str.length; s++) {
    t = mvRotl((t ^ Math.imul(str.charCodeAt(s), MV_F[15 & s])) >>> 0, 5);
  }
  return mvMix(t);
}

function mvBuildState(seed, mediaId) {
  if (mvIsOddTri(seed.length)) {
    return { S: mvRc4Sbox(seed), acc: mvAccSeed(seed) };
  }
  const S = new Array(61).fill(null);
  let a = mvMix((mvFnv1a(seed) ^ mvMix(((mediaId >>> 0) ^ 0x9e3779b9) >>> 0)) >>> 0);
  for (let e = 0; e < 8; e++) {
    if (mvIsEvenTri(e)) {
      const t = a % 61;
      a = mvRotl((a + 0x9e3779b9) >>> 0, 7 + (7 & e));
      S[t] = (a ^ mvMix(a)) >>> 0;
      a = mvMix((a + t) >>> 0);
    } else {
      S[e] = MV_F[15 & e] >>> 0;
    }
  }
  return { S, acc: mvMix((0xa5a5a5a5 ^ a) >>> 0) };
}

function mvNextWord(state, counter) {
  const S = state.S;
  let acc = state.acc >>> 0;
  const n = acc % 61;
  const exists = n < S.length && S[n] != null;
  const i = exists ? -1 : 0;
  const l = (exists ? S[n] : 0) >>> 0;
  const a = (l ^ Math.imul(0x9e3779b9, counter + 1)) >>> 0;
  let d = ((acc ^ a) | (acc & a & i)) >>> 0;
  d = (mvRotl((d + acc) >>> 0, 31 & n) ^ mvRotl(acc, 31 & (n * 7))) >>> 0;
  acc = mvMix((d + 0x9e3779b9) >>> 0);
  if (n < S.length) S[n] = acc;
  state.acc = acc;
  return acc;
}

function mvKeystream(seed, mediaId, len) {
  const state = mvBuildState(String(seed), mediaId >>> 0);
  const out = Buffer.alloc(len);
  let counter = 0;
  let e = 0;
  while (e < len) {
    const t = mvNextWord(state, counter++);
    out[e++] = t & 255;
    if (e < len) out[e++] = (t >>> 8) & 255;
    if (e < len) out[e++] = (t >>> 16) & 255;
    if (e < len) out[e++] = (t >>> 24) & 255;
  }
  return out;
}

function mvDecrypt(payload, seed, mediaId) {
  try {
    let norm = String(payload).trim().replace(/-/g, '+').replace(/_/g, '/');
    while (norm.length % 4) norm += '=';
    const data = Buffer.from(norm, 'base64');
    if (data.length <= 4) return null;
    const ks = mvKeystream(seed, mediaId, data.length);
    for (let i = 0; i < data.length; i++) data[i] ^= ks[i];
    if (data[0] !== 109 || data[1] !== 118 || data[2] !== 109 || data[3] !== 49) return null;
    return data.subarray(4).toString('utf8');
  } catch (_) {
    return null;
  }
}

// ── Videasy (Helix videasy.dart: api.speedracelight.com, 5 providers) ────
const VIDEASY_PROVIDERS = [
  { path: '/cdn/sources-with-title', label: 'Yoru' },
  { path: '/neon2/sources-with-title', label: 'Neon' },
  { path: '/m4uhd/sources-with-title', label: 'Breach' },
  { path: '/meine/sources-with-title', label: 'Killjoy' },
  { path: '/lamovie/sources-with-title', label: 'Omen' }
];

async function scrapeVideasy(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;
  const API = 'https://api.speedracelight.com';
  const HEADERS = {
    'User-Agent': UA,
    Referer: 'https://player.videasy.to/',
    Origin: 'https://player.videasy.to',
    Accept: 'application/json, text/plain, */*'
  };
  try {
    const seedRes = await fetchJson(API + '/seed?mediaId=' + ctx.tmdbId, {
      headers: HEADERS, timeoutMs: 8000
    });
    const seed = seedRes && seedRes.seed != null ? String(seedRes.seed) : null;
    if (!seed) return out;

    const params = new URLSearchParams({
      title: ctx.title || '',
      mediaType: ctx.isTv ? 'tv' : 'movie',
      tmdbId: String(ctx.tmdbId),
      enc: '2',
      seed
    });
    if (ctx.year) params.set('year', String(ctx.year));
    if (ctx.imdbId) params.set('imdbId', ctx.imdbId);
    if (ctx.isTv) {
      params.set('seasonId', String(ctx.season ?? 1));
      params.set('episodeId', String(ctx.episode ?? 1));
    }

    for (const p of VIDEASY_PROVIDERS) {
      if (out.length >= 6) break;
      const body = await fetchText(API + p.path + '?' + params.toString(), {
        headers: HEADERS, timeoutMs: 8000
      });
      if (!body) continue;
      let enc = body.trim();
      if (enc.startsWith('"') && enc.endsWith('"')) {
        try { enc = JSON.parse(enc); } catch (_) { enc = body.trim(); }
      }
      const dec = mvDecrypt(enc, seed, ctx.tmdbId);
      if (!dec) continue;
      let data = null;
      try { data = JSON.parse(dec); } catch (_) { continue; }
      const rawSources = Array.isArray(data && data.sources) ? data.sources : [];
      for (const s of rawSources) {
        const streamUrl = s && (s.url || s.file) ? String(s.url || s.file) : '';
        if (!streamUrl.startsWith('http')) continue;
        const q = s.quality ? String(s.quality) : 'Auto';
        out.push({
          provider: 'Videasy',
          title: 'Videasy ' + p.label + ' · ' + q,
          format: fmtOf(streamUrl),
          quality: /^\d+p$/.test(q) ? q : null,
          description: 'Videasy Multi-CDN HLS Stream',
          url: streamUrl,
          headers: { 'User-Agent': UA, Referer: 'https://player.videasy.to/' }
        });
      }
    }
  } catch (_) {}
  return out;
}

// ── VidFast (Helix vidfast.dart: vidfast.vc + enc-dec.app pipeline) ──────
async function scrapeVidFast(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;
  const DOMAIN = 'https://vidfast.vc';
  try {
    const embedUrl = ctx.isTv
      ? DOMAIN + '/tv/' + ctx.tmdbId + '/' + (ctx.season ?? 1) + '/' + (ctx.episode ?? 1) + '/'
      : DOMAIN + '/movie/' + ctx.tmdbId + '/';
    const html = await fetchText(embedUrl, {
      headers: { 'User-Agent': UA, Referer: DOMAIN + '/' }, timeoutMs: 10000
    });
    if (!html) return out;

    let m = /\\"(?:en|token)\\":\\"(.*?)\\"/.exec(html);
    if (!m) m = /"(?:en|token)":"(.*?)"/.exec(html);
    if (!m) return out;
    const rawToken = m[1];

    const enc = await fetchJson('https://enc-dec.app/api/enc-vidfast?text=' + encodeURIComponent(rawToken), {
      headers: { 'User-Agent': UA, Accept: 'application/json' }, timeoutMs: 10000
    });
    if (!enc || enc.status !== 200 || !enc.result) return out;
    const serversUrl = enc.result.servers ? String(enc.result.servers) : null;
    const streamUrl = enc.result.stream ? String(enc.result.stream) : null;
    const csrfToken = enc.result.token ? String(enc.result.token) : null;
    if (!serversUrl || !streamUrl || !csrfToken) return out;

    const reqHeaders = {
      'User-Agent': UA, Referer: DOMAIN + '/', Origin: DOMAIN,
      'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': csrfToken
    };

    const serversRes = await fetchRaw(serversUrl, {
      headers: reqHeaders, method: 'POST', timeoutMs: 10000
    });
    if (!serversRes.ok || serversRes.text == null) return out;
    const decServers = await encDecPost('/dec-vidfast', { text: serversRes.text });
    if (!decServers || decServers.status !== 200 || !Array.isArray(decServers.result)) return out;

    const resolved = await Promise.all(decServers.result.map(async (srv) => {
      try {
        if (!srv || typeof srv !== 'object') return null;
        const srvName = srv.name ? String(srv.name) : 'Server';
        const srvData = srv.data ? String(srv.data) : null;
        if (!srvData) return null;
        const sRes = await fetchRaw(streamUrl + '/' + srvData, {
          headers: reqHeaders, method: 'POST', timeoutMs: 10000
        });
        if (!sRes.ok || sRes.text == null) return null;
        const dec2 = await encDecPost('/dec-vidfast', { text: sRes.text });
        if (!dec2 || dec2.status !== 200 || !dec2.result) return null;
        const finalUrl = dec2.result.url ? String(dec2.result.url) : null;
        if (!finalUrl || !finalUrl.startsWith('http')) return null;
        return { name: srvName, url: finalUrl };
      } catch (_) {
        return null;
      }
    }));

    for (const item of resolved) {
      if (!item) continue;
      const is4K = item.name.toLowerCase().includes('2160') ||
        item.name.toLowerCase().includes('4k') || item.url.includes('2160p');
      const q = is4K ? '4K' : '1080p';
      out.push({
        provider: 'VidFast',
        title: 'VidFast · ' + item.name + ' · ' + q,
        format: fmtOf(item.url),
        quality: q,
        description: 'VidFast Multi-CDN Stream · ' + q,
        url: item.url,
        headers: { 'User-Agent': UA, Referer: DOMAIN + '/', Origin: DOMAIN }
      });
    }
  } catch (_) {}
  return out;
}

// ── PeeStream (Helix peestream.dart: providers.peestream.in SSE + search) ─
async function scrapePeeStream(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;
  const BASE = 'https://providers.peestream.in';

  const params = new URLSearchParams({
    type: ctx.isTv ? 'tv' : 'movie',
    tmdbId: String(ctx.tmdbId),
    title: ctx.title || ''
  });
  if (ctx.year) params.set('releaseYear', String(ctx.year));
  if (ctx.imdbId) params.set('imdbId', ctx.imdbId);
  if (ctx.isTv) {
    params.set('season', String(ctx.season ?? 1));
    params.set('episode', String(ctx.episode ?? 1));
  }

  // 1. SSE scrape route
  try {
    const res = await fetchRaw(BASE + '/scrape?' + params.toString(), {
      headers: { 'User-Agent': UA, Accept: 'text/event-stream', Referer: BASE + '/' },
      timeoutMs: 15000
    });
    if (res.ok && res.text) {
      for (const ev of res.text.split('\n\n')) {
        if (!ev.includes('event: completed')) continue;
        const m = /data:\s*(.+)/.exec(ev);
        if (!m) continue;
        try {
          const parsed = JSON.parse(m[1].trim());
          if (parsed && parsed.stream && typeof parsed.stream === 'object') {
            const st = parsed.stream;
            const streamUrl = st.playlist != null ? String(st.playlist)
              : st.url != null ? String(st.url)
              : st.file != null ? String(st.file) : '';
            if (streamUrl.startsWith('http')) {
              const sourceId = parsed.sourceId ? String(parsed.sourceId) : 'Poseidon';
              const quality = st.quality ? String(st.quality) : '1080p';
              let reqHeaders = { 'User-Agent': UA };
              if (st.headers && typeof st.headers === 'object') {
                reqHeaders = {};
                for (const [k, v] of Object.entries(st.headers)) reqHeaders[k] = String(v);
              }
              out.push({
                provider: 'PeeStream',
                title: 'PeeStream · ' + sourceId + ' · ' + quality,
                format: fmtOf(streamUrl),
                quality: /^\d+p$/.test(quality) ? quality : null,
                description: 'PeeStream Multi-Server Stream · ' + quality,
                url: streamUrl,
                headers: reqHeaders
              });
            }
          }
        } catch (_) {}
      }
    }
  } catch (_) {}

  // 2. Fallback search route
  if (out.length === 0) {
    try {
      const sp = new URLSearchParams({
        q: ctx.title || '', type: ctx.isTv ? 'tv' : 'movie', tmdbId: String(ctx.tmdbId)
      });
      if (ctx.isTv) {
        sp.set('season', String(ctx.season ?? 1));
        sp.set('episode', String(ctx.episode ?? 1));
      }
      const data = await fetchJson(BASE + '/api/search?' + sp.toString(), {
        headers: { 'User-Agent': UA, Accept: 'application/json', Referer: BASE + '/' },
        timeoutMs: 10000
      });
      if (data && Array.isArray(data.results)) {
        for (const result of data.results) {
          if (!result || !Array.isArray(result.streams)) continue;
          const pName = result.providerName || result.provider || 'PeeStream';
          for (const st of result.streams) {
            if (!st || !st.url || !String(st.url).startsWith('http')) continue;
            const stName = st.name ? String(st.name) : String(pName);
            const quality = st.quality ? String(st.quality) : '1080p';
            out.push({
              provider: 'PeeStream',
              title: 'PeeStream · ' + stName + ' · ' + quality,
              format: fmtOf(String(st.url)),
              quality: /^\d+p$/.test(quality) ? quality : null,
              description: 'PeeStream Stream · ' + quality,
              url: String(st.url),
              headers: { 'User-Agent': UA }
            });
          }
        }
      }
    } catch (_) {}
  }
  return out;
}

// ── XPass (Helix xpass.dart: play.xpass.top backups / data endpoints) ────
async function scrapeXPass(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;
  const BASE = 'https://play.xpass.top';
  const HEADERS = {
    Accept: '*/*',
    'User-Agent': UA,
    Origin: BASE,
    Referer: BASE + '/',
    Cookie: 'auth_token=de21073d24bca9b50f189b402ac870734cf945f2085cb7e1a4fc453fcfe4f57e'
  };

  let sources = null;
  try {
    if (ctx.isTv) {
      const res = await fetchJson(
        BASE + '/data/tv/' + ctx.tmdbId + '/' + (ctx.season ?? 1) + '/' + (ctx.episode ?? 1) + '?autostart=true&force=true',
        { headers: HEADERS, timeoutMs: 8000 }
      );
      if (Array.isArray(res)) sources = res;
    } else {
      const res = await fetchRaw(BASE + '/e/movie/' + ctx.tmdbId + '?autostart=true', {
        headers: HEADERS, timeoutMs: 8000
      });
      if (res.ok && res.text) {
        const m = /var backups=(\[[\s\S]*?\])/.exec(res.text);
        if (m) {
          try { sources = JSON.parse(m[1]); } catch (_) {}
        }
      }
    }
  } catch (_) {}

  if (!Array.isArray(sources)) return out;
  for (const src of sources) {
    if (!src || typeof src !== 'object' || !src.url) continue;
    const sUrl = String(src.url);
    const sName = src.name ? String(src.name) : 'Server';
    try {
      const mdata = await fetchJson(BASE + sUrl, { headers: HEADERS, timeoutMs: 6000 });
      if (!mdata || !Array.isArray(mdata.playlist) || mdata.playlist.length === 0) continue;
      const pl0 = mdata.playlist[0];
      if (!pl0 || !Array.isArray(pl0.sources)) continue;
      let target = pl0.sources.find((it) => it && it.type === 'hls') ||
        pl0.sources.find((it) => it && it.file);
      if (!target || !target.file) continue;
      const streamUrl = String(target.file);
      const isHls = target.type === 'hls' || streamUrl.includes('.m3u8');
      out.push({
        provider: 'XPass',
        title: 'XPass · ' + sName + ' · 1080p',
        format: fmtOf(streamUrl),
        quality: '1080p',
        description: 'XPass Stream · ' + (isHls ? 'HLS' : 'MP4'),
        url: streamUrl,
        headers: { Origin: BASE, Referer: BASE, 'User-Agent': UA }
      });
    } catch (_) {}
  }
  return out;
}

// ── Movy (Helix movy.dart: api.wecollege.net, 14 city servers, mvm1) ─────
const MOVY_SERVERS = [
  { endpoint: 'miami', name: 'Miami', note: 'Original audio (Up to 4K)' },
  { endpoint: 'seattle', name: 'Seattle', note: 'Original audio' },
  { endpoint: 'denver', name: 'Denver', note: 'Original audio' },
  { endpoint: 'chicago', name: 'Chicago', note: 'Original audio' },
  { endpoint: 'dallas', name: 'Dallas', note: 'Original audio' },
  { endpoint: 'atlanta', name: 'Atlanta', note: 'Original audio' },
  { endpoint: 'houston', name: 'Houston', note: 'Original audio' },
  { endpoint: 'austin', name: 'Austin', note: 'Original audio' },
  { endpoint: 'boston', name: 'Boston', note: 'Original audio' },
  { endpoint: 'munich', name: 'Munich', note: 'German audio', extra: 'language=german' },
  { endpoint: 'berlin', name: 'Berlin', note: 'German audio' },
  { endpoint: 'paris', name: 'Paris', note: 'French audio' },
  { endpoint: 'delhi', name: 'Delhi', note: 'Hindi audio' },
  { endpoint: 'cancun', name: 'Cancun', note: 'Spanish audio' }
];

const movySeedCache = new Map();

async function movyGetSeed(tmdbId) {
  const now = Date.now();
  const cached = movySeedCache.get(tmdbId);
  if (cached && cached.expiresAt > now + 5000) return cached.seed;
  try {
    const data = await fetchJson('https://api.wecollege.net/seed?mediaId=' + tmdbId, {
      headers: { 'User-Agent': UA, Referer: 'https://www.movy.bz/', Origin: 'https://www.movy.bz' },
      timeoutMs: 8000
    });
    if (data && data.seed) {
      const ttlMs = typeof data.ttlMs === 'number' ? data.ttlMs : 30000;
      movySeedCache.set(tmdbId, { seed: String(data.seed), expiresAt: now + ttlMs });
      return String(data.seed);
    }
  } catch (_) {}
  return null;
}

function movyFormatQuality(raw) {
  const lower = raw.toLowerCase();
  if (lower.includes('2160') || lower.includes('4k')) return '4K';
  if (lower.includes('1080')) return '1080p';
  if (lower.includes('720')) return '720p';
  if (lower.includes('480')) return '480p';
  if (lower.includes('360')) return '360p';
  if (raw) return raw;
  return 'Auto';
}

async function scrapeMovy(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;
  const API = 'https://api.wecollege.net';
  const HEADERS = { 'User-Agent': UA, Referer: 'https://www.movy.bz/', Origin: 'https://www.movy.bz' };

  const seed = await movyGetSeed(ctx.tmdbId);
  if (!seed) return out;

  const seen = new Set();
  const baseQuery =
    'title=' + encodeURIComponent(ctx.title || '') +
    '&mediaType=' + (ctx.isTv ? 'tv' : 'movie') +
    (ctx.year ? '&year=' + ctx.year : '') +
    (ctx.isTv ? '&seasonId=' + (ctx.season ?? 1) + '&episodeId=' + (ctx.episode ?? 1) : '') +
    '&tmdbId=' + ctx.tmdbId +
    (ctx.imdbId ? '&imdbId=' + ctx.imdbId : '') +
    '&enc=2&seed=' + seed;

  const results = await Promise.all(MOVY_SERVERS.map(async (srv) => {
    try {
      let url = API + '/' + srv.endpoint + '/sources?' + baseQuery;
      if (srv.extra) url += '&' + srv.extra;
      const res = await fetchRaw(url, { headers: HEADERS, timeoutMs: 8000 });
      if (!res.ok || !res.text) return [];
      const encText = res.text.trim();
      if (!encText || encText.startsWith('<')) return [];
      const dec = mvDecrypt(encText, seed, ctx.tmdbId);
      if (!dec) return [];
      let parsed;
      try { parsed = JSON.parse(dec); } catch (_) { return []; }
      const rows = [];
      if (Array.isArray(parsed.sources)) {
        for (const src of parsed.sources) {
          if (!src || !src.url) continue;
          const u = String(src.url);
          if (!u.startsWith('http')) continue;
          rows.push({ url: u, rawQuality: src.quality ? String(src.quality) : 'Auto' });
        }
      }
      return rows;
    } catch (_) {
      return [];
    }
  }));

  for (let i = 0; i < results.length; i++) {
    const srv = MOVY_SERVERS[i];
    for (const row of results[i]) {
      if (seen.has(row.url)) continue;
      seen.add(row.url);
      const cleanQuality = movyFormatQuality(row.rawQuality);
      const isSpecificAudio = srv.note.toLowerCase().includes('audio') &&
        !srv.note.toLowerCase().includes('original');
      const langLabel = isSpecificAudio ? srv.note.split(' ')[0] : '';
      const streamTitle = isSpecificAudio
        ? '[Movy - ' + srv.name + ' · ' + langLabel + '] ' + cleanQuality
        : '[Movy - ' + srv.name + '] ' + cleanQuality;
      out.push({
        provider: 'Movy',
        title: streamTitle,
        format: 'HLS',
        quality: cleanQuality !== 'Auto' ? cleanQuality : null,
        description: srv.note + ' • HLS',
        url: row.url,
        headers: { 'User-Agent': UA, Referer: 'https://www.movy.bz/' }
      });
    }
  }
  return out;
}

// ── Vuflix (Helix vuflix.dart: vuflix.co, dynamic providers + relay unwrap) ─
const VUFLIX_FALLBACK = [
  { id: 'vsembed', name: 'Sigma' },
  { id: 'moonflix', name: 'Source 40' },
  { id: 'megasource', name: 'Source 39' },
  { id: 'hdghar', name: 'Source 44' },
  { id: 'moviebox', name: 'Pi' },
  { id: 'cineplay', name: '4K' },
  { id: 'huhu', name: 'Beta' },
  { id: 'bingr', name: 'Upsilon' },
  { id: 'onlyflix', name: 'Gamma' },
  { id: 'vaplayer', name: 'Alpha' },
  { id: 'flixhqz', name: 'Gamma' },
  { id: 'castle', name: 'Source 40' },
  { id: 'cinejoy', name: '4K2' },
  { id: 'filesun', name: 'Tau' },
  { id: 'yoru', name: 'Yoru' }
];

let vuflixProviderCache = null;
let vuflixProviderCacheAt = 0;

async function vuflixProviders() {
  if (vuflixProviderCache && Date.now() - vuflixProviderCacheAt < 15 * 60 * 1000) {
    return vuflixProviderCache;
  }
  try {
    const data = await fetchJson('https://vuflix.co/api/player/providers', {
      headers: {
        'User-Agent': UA, Referer: 'https://vuflix.co/', Origin: 'https://vuflix.co',
        Accept: 'application/json, text/plain, */*'
      },
      timeoutMs: 6000
    });
    if (data && data.ok === true && Array.isArray(data.providers)) {
      const list = [];
      for (const p of data.providers) {
        if (!p || typeof p !== 'object') continue;
        const id = String(p.id ?? '').trim();
        if (!id) continue;
        const name = String(p.publicLabel ?? p.providerName ?? p.name ?? id);
        list.push({ id, name });
      }
      if (list.length) {
        vuflixProviderCache = list;
        vuflixProviderCacheAt = Date.now();
        return list;
      }
    }
  } catch (_) {}
  return VUFLIX_FALLBACK;
}

// Unwrap v-relay/a-relay token URLs into { url, headers }
function vuflixUnwrap(rawUrl, fallbackHeaders) {
  const defaultH = fallbackHeaders || {
    'User-Agent': UA, Referer: 'https://vuflix.co/', Origin: 'https://vuflix.co'
  };
  if (!rawUrl) return { url: '', headers: defaultH };
  if (!rawUrl.includes('v-relay?t=') && !rawUrl.includes('a-relay?t=')) {
    return { url: rawUrl, headers: defaultH };
  }
  try {
    const t = new URL(rawUrl).searchParams.get('t');
    if (!t) return { url: rawUrl, headers: defaultH };
    let b64 = t.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    if (parsed && typeof parsed === 'object') {
      const directUrl = String(parsed.u ?? '').trim();
      const headers = { 'User-Agent': UA, Referer: 'https://vuflix.co/', Origin: 'https://vuflix.co' };
      if (parsed.h && typeof parsed.h === 'object') {
        for (const [k, v] of Object.entries(parsed.h)) headers[k] = String(v);
      }
      if (directUrl) return { url: directUrl, headers };
    }
  } catch (_) {}
  return { url: rawUrl, headers: defaultH };
}

async function scrapeVuflix(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;
  const API = 'https://vuflix.co';
  const providers = await vuflixProviders();
  const seen = new Set();

  const push = (rawUrl, providerName, quality, typeDesc) => {
    const unwrapped = vuflixUnwrap(rawUrl);
    if (!unwrapped.url || !unwrapped.url.startsWith('http') || seen.has(unwrapped.url)) return;
    seen.add(unwrapped.url);
    out.push({
      provider: 'Vuflix',
      title: '[Vuflix - ' + providerName + '] ' + quality,
      format: fmtOf(unwrapped.url),
      quality: /^\d+p$/.test(quality) ? quality : (quality === '4K' ? '4K' : null),
      description: typeDesc,
      url: unwrapped.url,
      headers: unwrapped.headers
    });
  };

  await Promise.all(providers.map(async (prov) => {
    try {
      const qs = 'type=' + (ctx.isTv ? 'tv' : 'movie') + '&tmdbId=' + ctx.tmdbId +
        (ctx.isTv ? '&season=' + (ctx.season ?? 1) + '&episode=' + (ctx.episode ?? 1) : '');
      const data = await fetchJson(API + '/api/player/sources?' + qs + '&provider=' + encodeURIComponent(prov.id), {
        headers: {
          'User-Agent': UA, Referer: API + '/', Origin: API,
          Accept: 'application/json, text/plain, */*'
        },
        timeoutMs: 8000
      });
      if (!data || data.ok !== true || !Array.isArray(data.sources)) return;

      for (const item of data.sources) {
        if (!item || typeof item !== 'object') continue;
        const providerName = String(item.providerName ?? item.publicLabel ?? prov.name);
        const primaryRawUrl = String(item.url ?? '').trim();
        const itemType = String(item.type ?? 'hls').toLowerCase();

        // 1. quality variants
        if (Array.isArray(item.qualities)) {
          for (const q of item.qualities) {
            if (!q || typeof q !== 'object') continue;
            const qRawUrl = String(q.url ?? '').trim();
            if (!qRawUrl) continue;
            const qQuality = String(q.quality ?? 'Auto');
            push(qRawUrl, providerName, qQuality, providerName + ' • ' + qQuality + ' • ' + String(q.type ?? itemType).toUpperCase());
          }
        }
        // 2. candidate mirrors
        if (Array.isArray(item.candidates)) {
          let candIndex = 1;
          for (const c of item.candidates) {
            if (!c || typeof c !== 'object') continue;
            const cRawUrl = String(c.url ?? '').trim();
            if (!cRawUrl) continue;
            const cQuality = String(c.quality ?? '1080p');
            push(cRawUrl, providerName, 'Mirror ' + candIndex + ' • ' + cQuality, providerName + ' Mirror ' + candIndex + ' • ' + String(c.type ?? itemType).toUpperCase());
            candIndex++;
          }
        }
        // 3. multi-language audio tracks
        if (Array.isArray(item.audioTracks)) {
          for (const a of item.audioTracks) {
            if (!a || typeof a !== 'object') continue;
            const aRawUrl = String(a.switchUrl ?? a.url ?? '').trim();
            if (!aRawUrl) continue;
            const rawLabel = String(a.label ?? a.name ?? a.language ?? 'Audio').trim();
            const cleanLabel = rawLabel.replace(/\s*audio\s*$/i, '').trim() || 'Audio';
            push(aRawUrl, providerName, cleanLabel + ' Audio', providerName + ' • ' + cleanLabel + ' Audio • ' + itemType.toUpperCase());
          }
        }
        // 4. primary URL fallback
        if (primaryRawUrl) {
          let displayQuality = String(item.quality ?? '');
          if (!displayQuality) displayQuality = itemType === 'mp4' ? 'MP4' : 'HD';
          push(primaryRawUrl, providerName, displayQuality,
            providerName + (item.language ? ' • ' + item.language : '') + ' • ' + itemType.toUpperCase());
        }
      }
    } catch (_) {}
  }));
  return out;
}

// ── RiveStream (Helix rivestream.dart: scrapper.rivestream.app, 11 providers) ─
async function scrapeRiveStream(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;
  const API = 'https://scrapper.rivestream.app';
  const HEADERS = {
    'User-Agent': UA, Referer: 'https://www.rivestream.app/', Origin: 'https://www.rivestream.app',
    Accept: 'application/json, text/plain, */*'
  };
  let providers = ['apex', 'pulse', 'solstice', 'quasar', 'primevids', 'flowcast', 'citadel', 'guru', 'asiacloud', 'horizon', 'hindicast'];
  try {
    const pData = await fetchJson(API + '/api/providers', { headers: HEADERS, timeoutMs: 3000 });
    if (pData && Array.isArray(pData.data)) providers = pData.data.map(String);
    else if (Array.isArray(pData)) providers = pData.map(String);
  } catch (_) {}

  const cbValue = Math.floor(Date.now() / 3000000);
  const seen = new Set();

  await Promise.all(providers.map(async (provider) => {
    try {
      const cbParam = (provider === 'primevids' || provider === 'citadel') ? '&cb=' + cbValue : '';
      const endpoint = ctx.isTv
        ? API + '/api/provider?provider=' + encodeURIComponent(provider) + '&id=' + ctx.tmdbId + '&season=' + (ctx.season ?? 1) + '&episode=' + (ctx.episode ?? 1) + cbParam
        : API + '/api/provider?provider=' + encodeURIComponent(provider) + '&id=' + ctx.tmdbId + cbParam;
      const data = await fetchJson(endpoint, { headers: HEADERS, timeoutMs: 6000 });
      const sources = data && data.data && Array.isArray(data.data.sources) ? data.data.sources : [];
      for (const src of sources) {
        if (!src || typeof src !== 'object') continue;
        const rawUrl = String(src.url ?? '').trim();
        if (!rawUrl.startsWith('http') || seen.has(rawUrl)) continue;
        seen.add(rawUrl);
        const srcName = String(src.source ?? provider);
        const quality = String(src.quality ?? 'Auto');
        const format = String(src.format ?? 'hls').toUpperCase();
        const size = src.size ? String(src.size) : null;
        let sizeStr = '';
        let sizeBytes = null;
        if (size) {
          const bytes = parseInt(size, 10);
          if (!isNaN(bytes) && bytes > 0) {
            sizeBytes = bytes;
            if (bytes >= 1024 * 1024 * 1024) sizeStr = (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
            else if (bytes >= 1024 * 1024) sizeStr = (bytes / (1024 * 1024)).toFixed(1) + ' MB';
            else sizeStr = bytes + ' B';
          } else sizeStr = size;
        }
        out.push({
          provider: 'RiveStream',
          title: '[Rive - ' + srcName + '] ' + quality,
          format: fmtOf(rawUrl),
          quality: /^\d+p$/.test(quality) ? quality : null,
          description: srcName + ' • ' + quality + ' • ' + format + (sizeStr ? ' • ' + sizeStr : ''),
          url: rawUrl,
          sizeBytes,
          headers: { 'User-Agent': UA, Referer: 'https://www.rivestream.app/', Origin: 'https://www.rivestream.app' }
        });
      }
    } catch (_) {}
  }));
  return out;
}

// ── Cinejoy (Helix cinejoy.dart: api.shegu.st ECDH/HKDF/AES-GCM gate) ────
const CINEJOY_SERVER_PUB = Buffer.from(
  '0483c7a82132b8516e3eb4061b82e9c881cc585593a4709001131bff7443eabc1701c1f0d50e23ac02b0b9a5979903dbd7e9055aab5e4a5532132d1d200707f5f2', 'hex');

function cinejoySeal(path, payload) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const clientPub = ecdh.getPublicKey(null, 'uncompressed');   // 65 bytes, 0x04||X||Y
  const z = ecdh.computeSecret(CINEJOY_SERVER_PUB);            // 32-byte shared x

  const reqKey = Buffer.from(crypto.hkdfSync('sha256', z, clientPub, Buffer.from('lumen-gate-v2|c2s'), 32));
  const resKey = Buffer.from(crypto.hkdfSync('sha256', z, clientPub, Buffer.from('lumen-gate-v2|s2c'), 32));

  const reqJson = JSON.stringify({ path, payload });
  const iv = crypto.randomBytes(12);
  const prefix = Buffer.from('lumen-gate-v2');

  const reqAad = Buffer.concat([prefix, Buffer.from([0, 1, 1]), clientPub]);
  const cipher = crypto.createCipheriv('aes-256-gcm', reqKey, iv);
  cipher.setAAD(reqAad);
  const ctAndTag = Buffer.concat([cipher.update(reqJson, 'utf8'), cipher.final(), cipher.getAuthTag()]);

  const body = Buffer.concat([Buffer.from([2, 1]), clientPub, iv, ctAndTag]);
  const resAad = Buffer.concat([prefix, Buffer.from([0, 2, 1]), clientPub]);
  return { body, resKey, resAad };
}

async function cinejoyQuery(path, payload) {
  try {
    const sealed = cinejoySeal(path, payload);
    const res = await fetchPage('https://api.shegu.st/g', {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        Origin: 'https://cinejoy.to',
        Referer: 'https://cinejoy.to/watch',
        'Content-Type': 'application/octet-stream'
      },
      body: sealed.body,
      timeoutMs: 7000
    });
    if (!res.ok) return null;
    const respBytes = Buffer.from(await res.arrayBuffer());
    if (respBytes.length <= 28) return null;
    const iv = respBytes.subarray(0, 12);
    const ct = respBytes.subarray(12);
    const decipher = crypto.createDecipheriv('aes-256-gcm', sealed.resKey, iv);
    decipher.setAAD(sealed.resAad);
    decipher.setAuthTag(ct.subarray(ct.length - 16));
    const plain = Buffer.concat([
      decipher.update(ct.subarray(0, ct.length - 16)), decipher.final()
    ]).toString('utf8');
    return JSON.parse(plain);
  } catch (_) {
    return null;
  }
}

const CINEJOY_FALLBACK_SERVERS = [
  { name: 'Lisbon', '4k': true, status: 'ok' },
  { name: 'Solara', '4k': false, status: 'ok' },
  { name: 'Athens', '4k': false, status: 'ok' },
  { name: 'Castle', '4k': false, status: 'ok' },
  { name: 'Canaias', '4k': false, status: 'ok' }
];

async function scrapeCinejoy(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;
  const API = 'https://api.shegu.st';
  const HEADERS = {
    'User-Agent': UA, Origin: 'https://cinejoy.to', Referer: 'https://cinejoy.to/',
    Accept: 'application/json, text/plain, */*'
  };

  let servers = CINEJOY_FALLBACK_SERVERS;
  try {
    const data = await fetchJson(API + '/servers', { headers: HEADERS, timeoutMs: 4000 });
    if (data && Array.isArray(data.servers)) servers = data.servers;
  } catch (_) {}

  const seen = new Set();
  await Promise.all(servers.map(async (srv) => {
    try {
      const srvName = srv && srv.name ? String(srv.name) : '';
      if (!srvName || srv.status === 'disabled') return;
      if (srvName.toLowerCase() === 'sakura' && !ctx.isTv) return;

      const payload = { tmdb: String(ctx.tmdbId) };
      const targetPath = ctx.isTv ? '/' + srvName + '/series' : '/' + srvName + '/movie';
      if (ctx.isTv) {
        payload.season = String(ctx.season ?? 1);
        payload.episode = String(ctx.episode ?? 1);
      }

      const result = await cinejoyQuery(targetPath, payload);
      const streamData = result && result.data && typeof result.data === 'object'
        ? result.data.stream : (result ? result.stream : null);
      const streams = Array.isArray(streamData) ? streamData : [];
      const is4k = srv['4k'] === true;

      for (const st of streams) {
        if (!st || typeof st !== 'object') continue;
        const stType = st.type ? String(st.type) : null;
        if (stType === 'hls') {
          const playlistUrl = String(st.playlist ?? '').trim();
          if (!playlistUrl || seen.has(playlistUrl)) continue;
          seen.add(playlistUrl);
          const quality = is4k ? '4K / 1080p' : 'Auto';
          out.push({
            provider: 'Cinejoy',
            title: '[Cinejoy - ' + srvName + '] ' + quality,
            format: 'HLS',
            quality: is4k ? '4K' : null,
            description: srvName + ' • ' + quality + ' • HLS',
            url: playlistUrl,
            headers: { 'User-Agent': UA, Referer: 'https://cinejoy.to/', Origin: 'https://cinejoy.to' }
          });
        } else if (stType === 'file' && st.qualities && typeof st.qualities === 'object') {
          const subId = st.id ? String(st.id) : null;
          for (const [qKey, qVal] of Object.entries(st.qualities)) {
            if (!qVal || typeof qVal !== 'object') continue;
            const fileUrl = String(qVal.url ?? '').trim();
            if (!fileUrl.startsWith('http') || seen.has(fileUrl)) continue;
            seen.add(fileUrl);
            const quality = qKey.endsWith('p') || qKey.toLowerCase() === '4k' ? qKey : qKey + 'p';
            const label = subId ? srvName + ' (' + subId + ')' : srvName;
            out.push({
              provider: 'Cinejoy',
              title: '[Cinejoy - ' + label + '] ' + quality,
              format: String(qVal.type ?? 'mp4').toUpperCase(),
              quality: /^\d+p$/.test(quality) ? quality : (quality === '4K' ? '4K' : null),
              description: label + ' • ' + quality + ' • ' + String(qVal.type ?? 'mp4').toUpperCase(),
              url: fileUrl,
              headers: { 'User-Agent': UA, Referer: 'https://cinejoy.to/', Origin: 'https://cinejoy.to' }
            });
          }
        }
      }
    } catch (_) {}
  }));
  return out;
}

// ── ZxcStream (Helix zxcstream.dart: player.zxcstream.xyz, CryptoJS AES) ─
const ZXC_AES_KEY = '7f4c9e2a81d63b05c4f7a9e8126d3b50e1a8c7f23d9465ab0c6e9f1d4a7b832c';
const ZXC_SERVERS = ['berkas', 'orion', 'aquarius', 'resshin'];

function zxcAesCbc(alg, key, iv, data, stripPad) {
  const d = crypto.createDecipheriv(alg, key, iv);
  d.setAutoPadding(false);
  const out = Buffer.concat([d.update(data), d.final()]);
  if (stripPad && out.length > 0) {
    const pad = out[out.length - 1];
    if (pad > 0 && pad <= 16) return out.subarray(0, out.length - pad).toString('utf8');
  }
  return out.toString('utf8');
}

function zxcDecrypt(ciphertextB64, passphrase) {
  try {
    const buf = Buffer.from(ciphertextB64, 'base64');
    if (buf.length < 16) return null;
    const prefix = buf.subarray(0, 8).toString('utf8');
    if (prefix !== 'Salted__') {
      const key = crypto.createHash('md5').update(passphrase, 'utf8').digest();
      // Strip PKCS7 when present (upstream JSON never ends in bytes 1-16)
      return zxcAesCbc('aes-128-cbc', key, Buffer.alloc(16), buf, true);
    }
    const salt = buf.subarray(8, 16);
    const data = buf.subarray(16);
    const hashes = [];
    let hash = Buffer.alloc(0);
    while (Buffer.concat(hashes).length < 48) {
      hash = crypto.createHash('md5')
        .update(Buffer.concat([hash, Buffer.from(passphrase, 'utf8'), salt]))
        .digest();
      hashes.push(hash);
    }
    const ki = Buffer.concat(hashes);
    return zxcAesCbc('aes-256-cbc', ki.subarray(0, 32), ki.subarray(32, 48), data, true);
  } catch (_) {
    return null;
  }
}

async function scrapeZxcStream(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;
  const BASE = 'https://player.zxcstream.xyz';
  const HEADERS = {
    'User-Agent': UA, Referer: BASE + '/', Origin: BASE,
    Accept: 'application/json, text/plain, */*'
  };

  const results = await Promise.all(ZXC_SERVERS.map(async (server) => {
    try {
      const tokenRes = await fetchJson(BASE + '/backend/you-are-gay', {
        headers: { ...HEADERS, 'Content-Type': 'application/json' },
        method: 'POST',
        body: JSON.stringify({
          id: ctx.tmdbId,
          media_type: ctx.isTv ? 'tv' : 'movie',
          path: server,
          ...(ctx.isTv ? { season: ctx.season ?? 1, episode: ctx.episode ?? 1 } : {})
        }),
        timeoutMs: 8000
      });
      if (!tokenRes || tokenRes.token == null) return [];

      const qp = new URLSearchParams({
        id: String(ctx.tmdbId),
        b: ctx.isTv ? 'tv' : 'movie',
        ts: String(tokenRes.ts ?? ''),
        token: String(tokenRes.token),
        title: ctx.title || '',
        year: String(ctx.year ?? 2024),
        date: String(ctx.year ?? 2024)
      });
      if (ctx.isTv) {
        qp.set('season', String(ctx.season ?? 1));
        qp.set('episode', String(ctx.episode ?? 1));
      }

      const res = await fetchRaw(BASE + '/backend_/sources/' + server + '?' + qp.toString(), {
        headers: HEADERS, timeoutMs: 8000
      });
      if (!res.ok || res.text == null) return [];
      let sourcesData;
      try { sourcesData = JSON.parse(res.text); } catch (_) { sourcesData = res.text; }
      if (typeof sourcesData === 'string') {
        const dec = zxcDecrypt(sourcesData, ZXC_AES_KEY);
        if (!dec) return [];
        try { sourcesData = JSON.parse(dec); } catch (_) { return []; }
      }

      const list = [];
      const addItem = (it) => {
        if (it && it.url != null) list.push({ url: String(it.url), server });
      };
      if (Array.isArray(sourcesData)) {
        for (const it of sourcesData) addItem(it);
      } else if (sourcesData && typeof sourcesData === 'object') {
        addItem(sourcesData);
        if (Array.isArray(sourcesData.sources)) {
          for (const it of sourcesData.sources) addItem(it);
        }
      }
      return list;
    } catch (_) {
      return [];
    }
  }));

  for (const list of results) {
    for (const item of list) {
      out.push({
        provider: 'ZxcStream',
        title: 'ZxcStream · ' + item.server + ' · 1080p',
        format: fmtOf(item.url),
        quality: '1080p',
        description: 'ZxcStream Stream · ' + (item.url.includes('.m3u8') ? 'HLS' : 'MP4'),
        url: item.url,
        headers: { 'User-Agent': UA, Referer: BASE + '/', Origin: BASE }
      });
    }
  }
  return out;
}

// ── VidGod (Helix vidgod.dart: redis cache + 3 extractor workers) ────────
const VIDGOD_SERVERS = [
  { name: 'Pulsar', key: 'pulsar', base: 'https://vidnest-extractor.vividdubbing.workers.dev/api', param: 'prime' },
  { name: 'Orion', key: 'orion', base: 'https://404-vidnest.lofiserver.workers.dev/api', param: 'gama' },
  { name: 'Stellar', key: 'stellar', base: 'https://404-vidnest.lofiserver.workers.dev/api', param: 'sigma' }
];

async function vidgodCache(serverKey, mediaType, tmdbId, season, episode) {
  const cacheKey = mediaType === 'tv'
    ? serverKey + ':' + mediaType + ':' + tmdbId + ':' + (season ?? 1) + ':' + (episode ?? 1)
    : serverKey + ':' + mediaType + ':' + tmdbId;
  try {
    const data = await fetchJson('https://vidnest-redis-fell-prism-rest.cloud.layerbase.dev/', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ve8z9XSKatu74M7FjLU8eQ29',
        'Content-Type': 'application/json',
        Accept: '*/*',
        Origin: 'https://vidgod.space',
        Referer: 'https://vidgod.space/',
        'User-Agent': UA
      },
      body: JSON.stringify(['GET', cacheKey]),
      timeoutMs: 4000
    });
    if (data && data.result != null) {
      const parsed = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
      if (parsed && Array.isArray(parsed.streams) && parsed.streams.length) return parsed;
    }
  } catch (_) {}
  return null;
}

async function scrapeVidGod(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;
  const mediaType = ctx.isTv ? 'tv' : 'movie';

  const results = await Promise.all(VIDGOD_SERVERS.map(async (srv) => {
    let data = await vidgodCache(srv.key, mediaType, ctx.tmdbId, ctx.season, ctx.episode);
    if (!data) {
      try {
        const endpoint = mediaType === 'movie'
          ? srv.base + '/movie/' + ctx.tmdbId + '?server=' + srv.param
          : srv.base + '/tv/' + ctx.tmdbId + '/' + (ctx.season ?? 1) + '/' + (ctx.episode ?? 1) + '?server=' + srv.param;
        const d = await fetchJson(endpoint, {
          headers: {
            Accept: 'application/json',
            Origin: 'https://vidgod.space',
            Referer: 'https://vidgod.space/',
            'User-Agent': UA
          },
          timeoutMs: 8000
        });
        if (d && Array.isArray(d.streams) && d.streams.length) data = d;
      } catch (_) {}
    }
    return data ? { serverName: srv.name, streams: data.streams } : null;
  }));

  for (const r of results) {
    if (!r || !Array.isArray(r.streams)) continue;
    for (const item of r.streams) {
      if (!item || !item.url) continue;
      const streamUrl = String(item.url);
      if (!streamUrl.startsWith('http')) continue;
      const quality = item.quality ? String(item.quality) : '1080p';
      out.push({
        provider: 'VidGod',
        title: 'VidGod · ' + r.serverName + ' · ' + quality,
        format: fmtOf(streamUrl),
        quality: /^\d+p$/.test(quality) ? quality : null,
        description: 'VidGod Cloud Stream · ' + quality,
        url: streamUrl,
        headers: { 'User-Agent': UA, Referer: 'https://vidgod.space/', Origin: 'https://vidgod.space' }
      });
    }
  }
  return out;
}

// ── VidVault (Helix vidvault.dart: vidvault.ru MP4/MKV direct files) ─────
async function scrapeVidVault(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;
  const BASE = 'https://vidvault.ru';
  const HEADERS = { Referer: BASE + '/', Origin: BASE, 'User-Agent': UA };

  try {
    const tokenData = await fetchJson(BASE + '/api/get-token', { headers: HEADERS, timeoutMs: 6000 });
    const token = tokenData && tokenData.t != null ? String(tokenData.t) : null;
    if (!token) return out;

    const payload = { type: ctx.isTv ? 'tv' : 'movie', tmdbId: String(ctx.tmdbId) };
    if (ctx.isTv) {
      payload.season = String(ctx.season ?? 1);
      payload.episode = String(ctx.episode ?? 1);
    }

    const data = await fetchJson(BASE + '/api/download-proxy', {
      headers: { ...HEADERS, 'Content-Type': 'application/json', 'x-request-token': token },
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: 10000
    });
    if (!data || typeof data !== 'object') return out;

    // mp4Data downloads
    const mp4 = data.mp4Data;
    if (mp4 && typeof mp4 === 'object') {
      const lanName = String(mp4.lanName ?? '').trim();
      const country = String(mp4.country ?? '').trim();
      const detailPath = String(mp4.detailPath ?? '').trim();
      const downloads = mp4.downloadInfo && mp4.downloadInfo.data
        ? mp4.downloadInfo.data.downloads : null;
      if (Array.isArray(downloads)) {
        for (const d of downloads) {
          if (!d || !d.url) continue;
          const dUrl = String(d.url);
          if (!dUrl.startsWith('http')) continue;
          const resLabel = d.resolution ? String(d.resolution) : '1080';
          const titleParts = ['VidVault', 'MP4'];
          if (lanName) titleParts.push(lanName);
          if (country && country !== lanName) titleParts.push(country);
          titleParts.push(resLabel + 'p');
          out.push({
            provider: 'VidVault',
            title: titleParts.join(' · '),
            format: fmtOf(dUrl),
            quality: /^\d+$/.test(resLabel) ? resLabel + 'p' : null,
            description: ['VidVault Direct MP4', lanName, country, detailPath].filter(Boolean).join(' · '),
            url: dUrl,
            headers: HEADERS
          });
        }
      }
    }

    // mkvData files
    const mkvFiles = data.mkvData && data.mkvData.files;
    if (Array.isArray(mkvFiles)) {
      for (const f of mkvFiles) {
        if (!f || !f.url) continue;
        const fUrl = String(f.url);
        if (!fUrl.startsWith('http')) continue;
        const size = f.size ? String(f.size) : '';
        out.push({
          provider: 'VidVault',
          title: 'VidVault · ' + (size ? 'MKV · ' + size : 'MKV'),
          format: 'MP4',
          quality: null,
          description: 'VidVault Direct File',
          url: fUrl,
          headers: HEADERS
        });
      }
    }

    // mkvV2Data / mkvV3Data
    for (const key of ['mkvV2Data', 'mkvV3Data']) {
      const mkvExtra = data[key];
      if (mkvExtra && typeof mkvExtra === 'object' && mkvExtra.url) {
        const eUrl = String(mkvExtra.url);
        if (!eUrl.startsWith('http')) continue;
        const eQuality = String(mkvExtra.quality ?? '').trim();
        const eLang = String(mkvExtra.language ?? '').trim();
        const eCountry = String(mkvExtra.country ?? '').trim();
        const eSize = String(mkvExtra.size ?? '').trim();
        const parts = ['VidVault', 'MKV'];
        if (eLang) parts.push(eLang);
        if (eCountry && eCountry !== eLang) parts.push(eCountry);
        if (eQuality) parts.push(eQuality);
        if (eSize) parts.push(eSize);
        out.push({
          provider: 'VidVault',
          title: parts.join(' · '),
          format: 'MP4',
          quality: null,
          description: ('VidVault Direct MKV · ' + eLang + ' ' + eCountry + ' ' + eSize).trim(),
          url: eUrl,
          headers: HEADERS
        });
      }
    }
  } catch (_) {}
  return out;
}

// ── LookMovie (Helix lookmovie.dart: lookmovie2.to multi-quality HLS) ────
async function scrapeLookMovie(ctx) {
  const out = [];
  const domains = ['https://www.lookmovie2.to', 'https://lookmovie2.to', 'https://lookmovie.foundation'];
  const typeStr = ctx.isTv ? 'shows' : 'movies';
  const title = ctx.title || '';
  const year = ctx.year;

  let base = null;
  let match = null;
  for (const d of domains) {
    try {
      const data = await fetchJson(d + '/api/v1/' + typeStr + '/do-search/?q=' + encodeURIComponent(title), {
        headers: {
          'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9',
          Accept: 'application/json', Referer: d + '/', 'X-Requested-With': 'XMLHttpRequest'
        },
        timeoutMs: 4000
      });
      if (data && Array.isArray(data.result) && data.result.length) {
        const results = data.result;
        let m = null;
        if (year != null) {
          m = results.find((r) => r && String(r.year) === String(year));
        }
        if (!m) m = results.find((r) => r && String(r.title).toLowerCase() === title.toLowerCase()) || results[0];
        if (m) { match = m; base = d; break; }
      }
    } catch (_) {}
  }
  if (!base || !match) return out;

  try {
    const slug = match.slug ? String(match.slug) : '';
    if (!slug) return out;
    const html = await fetchText(base + '/' + typeStr + '/play/' + slug, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html', Referer: base + '/' },
      timeoutMs: 8000
    });
    if (!html) return out;

    const storageMatch = /window\[['"](?:movie|show)_storage['"]\]\s*=\s*\{([^}]+)\}/.exec(html);
    if (!storageMatch) return out;
    const block = storageMatch[1];
    const hashMatch = /hash\s*:\s*['"]([^'"]+)['"]/.exec(block);
    const expiresMatch = /expires\s*:\s*(\d+)/.exec(block);
    if (!hashMatch || !expiresMatch) return out;
    const hash = hashMatch[1];
    const expires = expiresMatch[1];

    let streamId = null;
    if (ctx.isTv) {
      const s = ctx.season ?? 1;
      const e = ctx.episode ?? 1;
      const sm = /seasons\s*:\s*(\[[\s\S]+?\])\s*[,}]/.exec(block);
      if (sm) {
        try {
          const seasons = JSON.parse(sm[1]);
          if (Array.isArray(seasons)) {
            const season = seasons.find((x) => x && String(x.season ?? (x.meta && x.meta.season)) === String(s));
            if (season && season.episodes) {
              const eps = season.episodes;
              if (Array.isArray(eps)) {
                const ep = eps.find((x) => x && String(x.episode) === String(e));
                if (ep) streamId = String(ep.id_episode ?? ep.id ?? '');
              } else if (typeof eps === 'object') {
                const ep = eps[String(e)] ||
                  Object.values(eps).find((x) => x && String(x.episode) === String(e));
                if (ep) streamId = String(ep.id_episode ?? ep.id ?? '');
              }
            }
          }
        } catch (_) {}
      }
      if (!streamId) {
        const am = new RegExp('data-season=["\']' + s + '["\'][^>]*?data-episode=["\']' + e + '["\'][^>]*?data-id=["\'](\\d+)["\']').exec(html) ||
          new RegExp('data-episode=["\']' + e + '["\'][^>]*?data-season=["\']' + s + '["\'][^>]*?data-id=["\'](\\d+)["\']').exec(html);
        if (am) streamId = am[1];
      }
    } else {
      const mid = match.id_movie ?? match.id;
      streamId = mid != null ? String(mid) : null;
      if (!streamId) {
        const im = /['"]?(?:id_movie|movieId)['"]?\s*[:=]\s*['"]?(\d+)['"]?/.exec(html);
        if (im) streamId = im[1];
      }
    }
    if (!streamId) return out;

    const accessParam = ctx.isTv ? 'episode' : 'movie';
    const data = await fetchJson(
      base + '/api/v1/security/' + accessParam + '-access?id_' + accessParam + '=' + streamId + '&hash=' + hash + '&expires=' + expires,
      {
        headers: {
          'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9',
          Accept: 'application/json', Referer: base + '/', 'X-Requested-With': 'XMLHttpRequest'
        },
        timeoutMs: 8000
      });
    if (!data) return out;
    const streams = data.streams ?? (data.result && data.result.streams) ?? (data.data && data.data.streams) ?? data;
    if (!streams || typeof streams !== 'object' || Array.isArray(streams)) return out;

    for (const [q, url] of Object.entries(streams)) {
      const u = url == null ? '' : String(url);
      if (!u.includes('.m3u8')) continue;
      const qualityLabel = q.includes('1080') ? '1080p' : q.includes('720') ? '720p' : q + ' p';
      out.push({
        provider: 'LookMovie',
        title: 'LookMovie · ' + qualityLabel,
        format: 'HLS',
        quality: /^\d+ p$/.test(qualityLabel) ? qualityLabel.replace(' ', '') : null,
        description: 'LookMovie HLS Stream · ' + qualityLabel,
        url: u,
        headers: { 'User-Agent': UA, Referer: base + '/' }
      });
    }
  } catch (_) {}
  return out;
}

// ── FlaxMovies (Helix flaxmovies.dart: workers + multi-CDN streams) ──────
const FLAX_DEFAULT_WORKERS = [
  'https://freakyniki.elaxo.lol',
  'https://vidlove.nabilekson.workers.dev'
];

async function scrapeFlaxMovies(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;
  const BASE = 'https://flaxmovies.xyz';
  const embedUrl = ctx.isTv
    ? BASE + '/embed/tv/' + ctx.tmdbId + '/' + (ctx.season ?? 1) + '/' + (ctx.episode ?? 1)
    : BASE + '/embed/movie/' + ctx.tmdbId;

  const workerUrls = [];
  try {
    const res = await fetchRaw(embedUrl, {
      headers: { 'User-Agent': UA, Referer: BASE + '/', Origin: BASE }, timeoutMs: 8000
    });
    if (res.ok && res.text) {
      const html = res.text;
      const directMatch = /WORKER_URL\s*[:=]\s*["'](https?:\/\/[^"']+)["']/i.exec(html);
      if (directMatch) {
        const wUrl = directMatch[1].replace(/\/+$/, '');
        if (!workerUrls.includes(wUrl)) workerUrls.push(wUrl);
      }
      for (const sm of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
        let scriptUrl = sm[1];
        if (scriptUrl.startsWith('//')) scriptUrl = 'https:' + scriptUrl;
        else if (scriptUrl.startsWith('/')) scriptUrl = BASE + scriptUrl;
        else if (!scriptUrl.startsWith('http')) scriptUrl = BASE + '/' + scriptUrl;
        if (scriptUrl.includes('jsdelivr') || scriptUrl.includes('google') || scriptUrl.includes('cloudflare')) continue;
        try {
          const sRes = await fetchRaw(scriptUrl, {
            headers: { 'User-Agent': UA, Referer: embedUrl }, timeoutMs: 5000
          });
          if (sRes.ok && sRes.text) {
            const m = /WORKER_URL\s*[:=]\s*["'](https?:\/\/[^"']+)["']/i.exec(sRes.text);
            if (m) {
              const wUrl = m[1].replace(/\/+$/, '');
              if (!workerUrls.includes(wUrl)) workerUrls.push(wUrl);
            }
          }
        } catch (_) {}
      }
    }
  } catch (_) {}
  for (const d of FLAX_DEFAULT_WORKERS) {
    if (!workerUrls.includes(d)) workerUrls.push(d);
  }

  const query = ctx.isTv
    ? 'tmdb_id=' + ctx.tmdbId + '&tmdbId=' + ctx.tmdbId + '&season=' + (ctx.season ?? 1) + '&episode=' + (ctx.episode ?? 1)
    : 'tmdb_id=' + ctx.tmdbId + '&tmdbId=' + ctx.tmdbId;

  for (const worker of workerUrls) {
    try {
      const data = await fetchJson(worker + '/?' + query, {
        headers: { 'User-Agent': UA, Referer: BASE + '/', Origin: BASE, Accept: 'application/json, text/plain, */*' },
        timeoutMs: 10000
      });
      if (!data || !Array.isArray(data.streams) || data.streams.length === 0) continue;
      for (const st of data.streams) {
        if (!st || !st.url) continue;
        const streamUrl = String(st.url);
        if (!streamUrl.startsWith('http')) continue;
        const provider = st.provider ? String(st.provider) : 'CDN';
        const resolution = st.resolution ? String(st.resolution) : '1080p';
        out.push({
          provider: 'FlaxMovies',
          title: 'FlaxMovies · ' + provider + ' · ' + resolution,
          format: fmtOf(streamUrl),
          quality: /^\d+p$/.test(resolution) ? resolution : null,
          description: 'FlaxMovies Multi-CDN Stream · ' + resolution,
          url: streamUrl,
          headers: { 'User-Agent': UA, Referer: BASE + '/', Origin: BASE }
        });
      }
      if (out.length) break;   // Helix: first worker with streams wins
    } catch (_) {}
  }
  return out;
}

// ── Mapple (Helix mapple.dart: mapple.club PoW + 6 servers) ──────────────
const MAPPLE_SERVERS = [
  { id: 'mapple', name: 'Mapple' },
  { id: 's1', name: 'Nexus' },
  { id: 's2', name: 'Cipher' },
  { id: 's3', name: 'Pulse' },
  { id: 's4', name: 'Vertex' },
  { id: 's10', name: 'Chimp' }
];

function mappleSolvePoW(challenge, difficulty) {
  const maskBytes = Math.floor(difficulty / 8);
  const maskBits = difficulty % 8;
  const finalMask = maskBits > 0 ? (0xFF << (8 - maskBits)) & 0xFF : 0;
  const challengeBytes = Buffer.from(challenge, 'utf8');
  for (let nonce = 0; nonce < 1000000; nonce++) {
    const nonceStr = String(nonce);
    const digest = crypto.createHash('sha256')
      .update(challengeBytes)
      .update(Buffer.from(nonceStr, 'utf8'))
      .digest();
    let ok = true;
    for (let i = 0; i < maskBytes; i++) {
      if (digest[i] !== 0) { ok = false; break; }
    }
    if (ok && (finalMask === 0 || (digest[maskBytes] & finalMask) === 0)) return nonceStr;
  }
  return null;
}

async function scrapeMapple(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;
  const BASE = 'https://mapple.club';
  const mediaType = ctx.isTv ? 'tv' : 'movie';
  const pageUrl = ctx.isTv
    ? BASE + '/watch/tv/' + ctx.tmdbId + '/' + (ctx.season ?? 1) + '/' + (ctx.episode ?? 1)
    : BASE + '/watch/movie/' + ctx.tmdbId;

  try {
    const pageRes = await fetchPage(pageUrl, {
      headers: { 'User-Agent': UA, Referer: BASE + '/', Origin: BASE }, timeoutMs: 8000
    });
    if (!pageRes.ok) return out;
    const html = await pageRes.text();
    const cookies = cookieOf(resCookies(pageRes), /_mapple_site(?:_partitioned)?=[^;]+/g);

    const reqMatch = /window\.__REQUEST_TOKEN__\s*=\s*"([^"]+)"/.exec(html);
    if (!reqMatch) return out;
    const requestToken = reqMatch[1];

    const initHeaders = {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      Referer: pageUrl,
      Origin: BASE,
      ...(cookies ? { Cookie: cookies } : {})
    };

    const initBody = { mediaId: ctx.tmdbId, mediaType, requestToken };
    const initRes = await fetchJson(BASE + '/api/playback-init', {
      headers: initHeaders, method: 'POST', body: JSON.stringify(initBody), timeoutMs: 8000
    });
    if (!initRes || typeof initRes !== 'object') return out;

    let streamToken = initRes.token ? String(initRes.token) : null;
    if (initRes.requiresPow === true && initRes.pow && typeof initRes.pow === 'object') {
      const challenge = String(initRes.pow.challenge ?? '');
      const difficulty = typeof initRes.pow.difficulty === 'number' ? initRes.pow.difficulty : 10;
      const nonce = mappleSolvePoW(challenge, difficulty);
      if (nonce) {
        const solveRes = await fetchJson(BASE + '/api/playback-init', {
          headers: initHeaders,
          method: 'POST',
          body: JSON.stringify({
            mediaId: ctx.tmdbId, mediaType, requestToken,
            pow: { challengeId: initRes.pow.challengeId, nonce }
          }),
          timeoutMs: 8000
        });
        if (solveRes && solveRes.token) streamToken = String(solveRes.token);
      }
    }
    if (!streamToken) return out;

    const tvSlug = ctx.isTv ? (ctx.season ?? 1) + '-' + (ctx.episode ?? 1) : '';

    const results = await Promise.all(MAPPLE_SERVERS.map(async (srv) => {
      try {
        const encryptRes = await fetchJson(BASE + '/api/encrypt', {
          headers: initHeaders,
          method: 'POST',
          body: JSON.stringify({
            data: {
              mediaId: ctx.tmdbId, mediaType, tv_slug: tvSlug,
              source: srv.id, apikey: 'mptv_sk_a8f29c4e7b3d1f'
            }
          }),
          timeoutMs: 6000
        });
        const encrypted = encryptRes && encryptRes.encrypted ? String(encryptRes.encrypted) : null;
        if (!encrypted) return null;

        const sp = new URLSearchParams({ data: encrypted, requestToken, token: streamToken });
        const streamRes = await fetchJson(BASE + '/api/stream-encrypted?' + sp.toString(), {
          headers: { 'User-Agent': UA, Referer: pageUrl, Origin: BASE, ...(cookies ? { Cookie: cookies } : {}) },
          timeoutMs: 8000
        });
        if (streamRes && streamRes.success === true && streamRes.data && typeof streamRes.data === 'object') {
          let fileUrl = streamRes.data.stream_url ? String(streamRes.data.stream_url) : null;
          if (fileUrl) {
            if (fileUrl.includes('omena-puu') || fileUrl.includes('nocach')) {
              fileUrl += fileUrl.includes('?') ? '&format=.m3u8' : '?format=.m3u8';
            }
            return { name: srv.name, url: fileUrl };
          }
        }
        return null;
      } catch (_) {
        return null;
      }
    }));

    for (const r of results) {
      if (!r) continue;
      out.push({
        provider: 'Mapple',
        title: 'Mapple · ' + r.name + ' · 1080p',
        format: 'HLS',
        quality: '1080p',
        description: 'Mapple ' + r.name + ' HLS Stream',
        url: r.url,
        headers: { 'User-Agent': UA, Referer: BASE + '/', Origin: BASE }
      });
    }
  } catch (_) {}
  return out;
}

// ── Dulo (Helix dulo.dart + dulo_client.dart: SSE with session cookie) ───
const DULO_DOMAINS = ['https://dulo.gd', 'https://dulo.cx'];
let duloSession = { cookie: null, expiresAt: 0, domain: null };

async function duloSessionCookie(domain) {
  if (duloSession.cookie && Date.now() < duloSession.expiresAt) return duloSession.cookie;
  try {
    const res = await fetchPage(domain + '/api/session', {
      headers: { 'User-Agent': UA, Accept: 'application/json', Referer: domain + '/', Origin: domain },
      timeoutMs: 8000
    });
    if (res.ok) {
      const setCookie = resCookies(res).join('\n');
      const m = /__Host-amri_session=[^;]+/.exec(setCookie);
      const cookieVal = m ? m[0] : (setCookie.split('\n')[0] || '').split(';')[0];
      if (cookieVal) {
        duloSession = { cookie: cookieVal, expiresAt: Date.now() + 6 * 3600 * 1000, domain };
        return cookieVal;
      }
    }
  } catch (_) {}
  return null;
}

async function scrapeDulo(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;
  const payload = ctx.isTv
    ? { type: 'tv', tmdbId: ctx.tmdbId, season: ctx.season ?? 1, episode: ctx.episode ?? 1 }
    : { type: 'movie', tmdbId: ctx.tmdbId };

  for (const domain of DULO_DOMAINS) {
    let receivedAny = false;
    try {
      const cookie = await duloSessionCookie(domain);
      const res = await fetchRaw(domain + '/api/source', {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Referer: domain + '/',
          Origin: domain,
          ...(cookie ? { Cookie: cookie } : {})
        },
        body: JSON.stringify(payload),
        timeoutMs: 20000
      });
      if (res.ok && res.text) {
        for (const rawLine of res.text.split('\n')) {
          const line = rawLine.trim();
          if (line.startsWith('event: complete')) break;
          if (!line.startsWith('data:')) continue;
          const jsonPart = line.slice(5).trim();
          if (!jsonPart || !jsonPart.startsWith('{')) continue;
          try {
            const data = JSON.parse(jsonPart);
            if (data && Array.isArray(data.sources)) {
              for (const item of data.sources) {
                if (!item || !item.url) continue;
                const url = String(item.url);
                if (!url.startsWith('http') || out.some((x) => x.url === url)) continue;
                receivedAny = true;
                out.push({
                  provider: 'Dulo',
                  title: 'Dulo · ' + (item.title ? String(item.title) : 'Stream') + ' · ' +
                    (item.quality && item.quality !== 'Auto' ? String(item.quality) : '1080p'),
                  format: fmtOf(url),
                  quality: item.quality && /^\d+p$/.test(String(item.quality)) ? String(item.quality) : null,
                  description: 'Dulo Multi-CDN HLS Stream',
                  url,
                  headers: { 'User-Agent': UA, Referer: 'https://d.dulo.gd/', Origin: 'https://d.dulo.gd' }
                });
              }
            }
          } catch (_) {}
        }
        if (receivedAny) return out;
      } else if (res.status === 401 || res.status === 403) {
        duloSession = { cookie: null, expiresAt: 0, domain: null };
      }
    } catch (_) {}
  }
  return out;
}

// ── CineSu (Helix cinesu.dart: same crypto master generator, cine.su referer) ─
async function scrapeCineSu(ctx) {
  if (!ctx.tmdbId) return [];
  const url = generateCryptoHlsUrl(ctx.tmdbId, ctx.isTv ? ctx.season : null, ctx.isTv ? ctx.episode : null);
  return [{
    provider: 'CineSu',
    title: 'CineSu · Direct Master · 1080p',
    format: 'HLS',
    quality: '1080p',
    description: 'CineSu Master HLS Stream',
    url,
    headers: { 'User-Agent': UA, Referer: 'https://cine.su/', Origin: 'https://cine.su' }
  }];
}

// ── Vadapav (Helix vadapav.dart: stremio.vadapav.mov addon) ──────────────
async function scrapeVadapav(ctx) {
  const out = [];
  const targetIds = [];
  if (ctx.imdbId && ctx.imdbId.startsWith('tt')) targetIds.push(ctx.imdbId);
  if (ctx.tmdbId) targetIds.push('tmdb:' + ctx.tmdbId);
  if (targetIds.length === 0) return out;

  const seen = new Set();
  for (const id of targetIds) {
    const endpoint = ctx.isTv
      ? 'https://stremio.vadapav.mov/stream/series/' + id + ':' + (ctx.season ?? 1) + ':' + (ctx.episode ?? 1) + '.json'
      : 'https://stremio.vadapav.mov/stream/movie/' + id + '.json';
    try {
      const json = await fetchJson(endpoint, {
        headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*' },
        timeoutMs: 12000
      });
      if (!json || !Array.isArray(json.streams)) continue;
      for (const item of json.streams) {
        if (!item || !item.url) continue;
        const url = String(item.url);
        if (!url.startsWith('http') || seen.has(url)) continue;
        seen.add(url);
        const rawTitle = item.title ? String(item.title) : '';
        const rawName = item.name ? String(item.name) : 'vadapav.mov';
        out.push({
          provider: 'Vadapav',
          title: rawTitle || (rawName + ' • Direct Stream'),
          format: fmtOf(url),
          quality: null,
          description: rawTitle,
          url,
          headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*' }
        });
      }
      if (json.streams.length) break;   // Helix: stop after first ID with streams
    } catch (_) {}
  }
  return out;
}

// ── 4KHDHub (Helix fourkhdhub.dart: 4khdhub.one search + redirect resolve) ─
function rot13(input) {
  return input.replace(/[a-zA-Z]/g, (ch) => {
    const code = ch.charCodeAt(0);
    const base = code >= 65 && code <= 90 ? 65 : 97;
    return String.fromCharCode(((code - base + 13) % 26) + base);
  });
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const d = [];
  for (let i = 0; i <= a.length; i++) d[i] = [i];
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[a.length][b.length];
}

let fourKBaseUrl = null;
let fourKBaseUrlExpiry = 0;

async function fourKGetBaseUrl() {
  if (fourKBaseUrl && Date.now() < fourKBaseUrlExpiry) return fourKBaseUrl;
  let currentUrl = 'https://4khdhub.one';
  try {
    const res = await fetchPage(currentUrl, { headers: { 'User-Agent': UA }, timeoutMs: 10000 });
    if (res.url) currentUrl = res.url;   // final URL after redirects
  } catch (_) {}
  try {
    fourKBaseUrl = new URL(currentUrl).origin;
  } catch (_) {
    fourKBaseUrl = 'https://4khdhub.one';
  }
  fourKBaseUrlExpiry = Date.now() + 3600 * 1000;
  return fourKBaseUrl;
}

async function fourKFetchText(url) {
  const text = await fetchText(url, { headers: { 'User-Agent': UA }, timeoutMs: 15000 });
  if (text == null) throw new Error('fetch failed: ' + url);
  return text;
}

async function fourKResolveRedirectUrl(redirectUrl) {
  const html = await fourKFetchText(redirectUrl);
  const downloadMatch = /<a id="download" href="(.*?)"/.exec(html);
  const varMatch = downloadMatch ? null : /var url = '(.*?)';/.exec(html);
  if (downloadMatch || varMatch) {
    const nextUrl = downloadMatch ? downloadMatch[1] : varMatch[1];
    const intermediateHtml = await fourKFetchText(nextUrl);
    const finalLinkMatch = /<a href="([^"]+)"[^>]*class="[^"]*btn-success/.exec(intermediateHtml);
    if (finalLinkMatch) return finalLinkMatch[1];
    return null;
  }
  // Older obfuscated links: base64 -> base64 -> rot13 -> base64 -> {o}
  const match = /'o','(.*?)'/.exec(html);
  if (!match) return null;
  const step1 = Buffer.from(match[1], 'base64').toString('utf8');
  const step2 = Buffer.from(step1, 'base64').toString('utf8');
  const step3 = rot13(step2);
  const step4 = Buffer.from(step3, 'base64').toString('utf8');
  const data = JSON.parse(step4);
  return Buffer.from(data.o, 'base64').toString('utf8');
}

async function fourKValidateStreamUrl(url) {
  try {
    const res = await fetchPage(url, {
      headers: { 'User-Agent': UA, Range: 'bytes=0-1024' }, timeoutMs: 4000
    });
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const isSuccess = (res.status >= 200 && res.status < 300) || res.status === 206;
    const isHtmlOrJson = contentType.includes('text/html') || contentType.includes('application/json');
    if (!isSuccess || isHtmlOrJson) return false;
    return true;
  } catch (_) {
    return true;   // keep URL on network/timeout errors (Helix behavior)
  }
}

async function scrape4KHDHub(ctx) {
  const out = [];
  const title = ctx.title || '';
  try {
    const baseUrl = await fourKGetBaseUrl();
    const searchHtml = await fourKFetchText(baseUrl + '/?s=' + encodeURIComponent(title));
    const formatFilter = ctx.isTv ? 'Series' : 'Movies';
    const year = ctx.year;

    // Find movie-card anchors and inspect each card's inner HTML
    const cards = [];
    const cardRe = /<a[^>]*class="[^"]*movie-card[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let cm;
    while ((cm = cardRe.exec(searchHtml)) !== null) cards.push({ href: cm[1], body: cm[2] });

    let pageUrl = null;
    for (const card of cards) {
      const formatTexts = [...card.body.matchAll(/class="[^"]*movie-card-format[^"]*"[^>]*>([\s\S]*?)<\//g)].map((m) => m[1]);
      if (!formatTexts.some((t) => t.includes(formatFilter))) continue;
      if (year != null) {
        const metaMatch = /class="[^"]*movie-card-meta[^"]*"[^>]*>([\s\S]*?)<\//.exec(card.body);
        const cardYear = metaMatch ? parseInt(metaMatch[1].trim(), 10) : NaN;
        if (!isNaN(cardYear) && Math.abs(cardYear - year) > 1) continue;
      }
      const titleMatch = /class="[^"]*movie-card-title[^"]*"[^>]*>([\s\S]*?)<\//.exec(card.body);
      let cardTitle = titleMatch ? titleMatch[1].replace(/\[.*?\]/g, '').trim() : '';
      const diff = levenshtein(cardTitle.toLowerCase(), title.toLowerCase());
      const okTitle = diff < 5 || (cardTitle.toLowerCase().includes(title.toLowerCase()) && diff < 16);
      if (!okTitle) continue;
      pageUrl = card.href.startsWith('http') ? card.href : baseUrl + card.href;
      break;
    }
    if (!pageUrl) return out;

    const html = await fourKFetchText(pageUrl);
    let blocks = [];
    if (ctx.isTv && ctx.season != null && ctx.episode != null) {
      const seasonStr = String(ctx.season).padStart(2, '0');
      const episodeStr = String(ctx.episode).padStart(2, '0');
      const episodeRe = /<div[^>]*class="[^"]*episode-item[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*episode-item|<footer|<\/main|$)/g;
      let em;
      while ((em = episodeRe.exec(html)) !== null) {
        const block = em[1];
        if (!block.includes('S' + seasonStr)) continue;
        const dlRe = /<div[^>]*class="[^"]*episode-download-item[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*episode-download-item|<\/div>\s*<\/div>\s*<\/div>|$)/g;
        let dm;
        while ((dm = dlRe.exec(block)) !== null) {
          if (dm[1].includes('Episode-' + episodeStr)) { blocks.push(dm[1]); break; }
        }
      }
    } else {
      const dlRe = /<div[^>]*class="[^"]*download-item[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*download-item|<footer|<\/main|$)/g;
      let dm;
      while ((dm = dlRe.exec(html)) !== null) blocks.push(dm[1]);
    }

    for (const el of blocks) {
      try {
        const sizeMatch = /([\d.]+ ?[GM]B)/.exec(el);
        const heightMatch = /\d{3,}p/.exec(el);
        const titleEl = /class="[^"]*(?:episode-)?file-title[^"]*"[^>]*>([\s\S]*?)<\//.exec(el);
        const fileTitle = titleEl ? titleEl[1].trim() : 'Unknown';
        const displayParts = [fileTitle];
        if (heightMatch) displayParts.push(heightMatch[0]);
        if (sizeMatch) displayParts.push(sizeMatch[1]);

        let hubCloudUrl = null;
        let hubDriveUrl = null;
        for (const am of el.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
          const text = am[2].replace(/<[^>]+>/g, '');
          if (text.includes('HubCloud') && !hubCloudUrl) hubCloudUrl = am[1];
          else if (text.includes('HubDrive') && !hubDriveUrl) hubDriveUrl = am[1];
        }
        const redirectUrl = hubCloudUrl || hubDriveUrl;
        if (!redirectUrl) continue;

        const resolvedUrl = await fourKResolveRedirectUrl(redirectUrl);
        if (!resolvedUrl) continue;
        // Sanitize '::' in the path portion (FFmpeg/MDK compatibility, Helix behavior)
        let finalUrl = resolvedUrl;
        try {
          const qIdx = resolvedUrl.indexOf('?');
          if (qIdx === -1) finalUrl = resolvedUrl.replace(/::/g, '%3A%3A');
          else finalUrl = resolvedUrl.slice(0, qIdx).replace(/::/g, '%3A%3A') + resolvedUrl.slice(qIdx);
        } catch (_) {}

        const isValid = await fourKValidateStreamUrl(finalUrl);
        if (!isValid) continue;
        out.push({
          provider: '4KHDHub',
          title: displayParts.join(' · '),
          format: fmtOf(finalUrl),
          quality: heightMatch ? heightMatch[0] : null,
          description: displayParts.join(' · '),
          url: finalUrl,
          headers: { 'User-Agent': UA }
        });
      } catch (_) {}
    }
  } catch (_) {}
  return out;
}

// ── DownloadEverything (Helix downloadeverything.dart: slave SSE + resolvers) ─
const DE_SLAVE = 'https://slave.downloadeverythingfromeverywhere.com/';
const DE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  Origin: 'https://downloadeverythingfromeverywhere.com',
  Referer: 'https://downloadeverythingfromeverywhere.com/',
  'Content-Type': 'application/json'
};

async function deResolveHubCloud(hubUrl) {
  try {
    const res = await fetchRaw(hubUrl, {
      headers: { 'User-Agent': UA, Referer: 'https://downloadeverythingfromeverywhere.com/' },
      timeoutMs: 8000
    });
    let html = res.text || '';
    const hubPhpMatch = /https?:\/\/[^\s"<>]*\/hubcloud\.php\?[^\s"<>]*/.exec(html);
    if (hubPhpMatch) {
      const phpRes = await fetchRaw(hubPhpMatch[0], {
        headers: { 'User-Agent': UA, Referer: hubUrl }, timeoutMs: 8000
      });
      const phpBody = phpRes.text || '';
      const r2Match = /https?:\/\/[a-zA-Z0-9.\-_]+\.r2\.cloudflarestorage\.com\/[^\s"<>]+/.exec(phpBody);
      if (r2Match) return r2Match[0].replace(/&amp;/g, '&');
      const pixelMatch = /https?:\/\/pixel\.hubcloud\.[a-z]+\/\?id=[^\s"<>]+/.exec(phpBody);
      if (pixelMatch) return pixelMatch[0];
    }
  } catch (_) {}
  return null;
}

async function deResolveClicknUpload(clicknUrl) {
  try {
    const res1 = await fetchPage(clicknUrl, {
      headers: { 'User-Agent': UA, Referer: 'https://downloadeverythingfromeverywhere.com/' },
      timeoutMs: 8000
    });
    if (!res1.ok) return null;
    const cookies = resCookies(res1).map((c) => c.split(';')[0]).join('; ');
    const formMatch = /<form[^>]+method=["']POST["'][^>]*>([\s\S]*?)<\/form>/i.exec(await res1.text());
    if (!formMatch) return null;

    const parseInputs = (formBody) => {
      const params = {};
      for (const im of formBody.matchAll(/<input[^>]+name=["']([^"']+)["'][^>]+value=["']([^"']*)["']/gi)) {
        params[im[1]] = im[2];
      }
      return params;
    };
    const toBody = (params) => Object.entries(params).map(([k, v]) =>
      encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');

    const params1 = parseInputs(formMatch[1]);
    params1.method_free = 'Slow Download';
    const res2 = await fetchRaw(clicknUrl, {
      method: 'POST',
      headers: {
        'User-Agent': UA, Referer: clicknUrl,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(cookies ? { Cookie: cookies } : {})
      },
      body: toBody(params1),
      timeoutMs: 8000
    });
    const formMatch2 = /<form[^>]+method=["']POST["'][^>]*>([\s\S]*?)<\/form>/i.exec(res2.text || '');
    if (!formMatch2) return null;
    const params2 = parseInputs(formMatch2[1]);
    params2.down_script = '1';

    await new Promise((r) => setTimeout(r, 4500));
    const res3 = await fetchRaw(clicknUrl, {
      method: 'POST',
      headers: {
        'User-Agent': UA, Referer: clicknUrl,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(cookies ? { Cookie: cookies } : {})
      },
      body: toBody(params2),
      timeoutMs: 8000
    });
    const body3 = res3.text || '';
    const directMatch = /https?:\/\/[a-zA-Z0-9.\-_:]+\/d\/[a-zA-Z0-9_\-/]+/.exec(body3) ||
      /window\.open\(["'](https?:\/\/[^"']+)["']\)/.exec(body3);
    if (directMatch) {
      const found = directMatch[1] || directMatch[0];
      if (found.includes('clicknupload.') && !found.includes('/d/')) return null;
      return found;
    }
  } catch (_) {}
  return null;
}

async function deResolveItem(item, fallbackTitle) {
  const rawUrl = item.url ? String(item.url) : '';
  if (!rawUrl) return null;
  if (rawUrl.includes('111477.xyz') || rawUrl.includes('vadapav.mov') ||
      rawUrl.includes('driveseed.org') || rawUrl.includes('new3.gdflix.io') ||
      rawUrl.includes('rapidrar.cr') || rawUrl.includes('megaup.net') ||
      rawUrl.includes('telegram.dog') || rawUrl.includes('t.me')) return null;

  let directStreamUrl = null;
  let provider = item.site ? String(item.site) : 'DownloadEverything';
  let streamHeaders = { 'User-Agent': UA };

  try {
    if (rawUrl.includes('hakunaymatata.com')) {
      directStreamUrl = rawUrl;
      provider = 'Moviebox';
      streamHeaders = { 'User-Agent': 'Lavf/60.16.100' };
    } else if (rawUrl.includes('pixeldrain.dev') || rawUrl.includes('pixeldrain.com')) {
      const m = /pixeldrain\.(?:dev|com)\/(?:u|l)\/([a-zA-Z0-9_-]+)/.exec(rawUrl);
      if (m) {
        directStreamUrl = 'https://pixeldrain.com/api/file/' + m[1];
        provider = 'Pixeldrain';
        streamHeaders = { 'User-Agent': UA };
      }
    } else if (rawUrl.includes('hubcloud.') || rawUrl.includes('vcloud.zip')) {
      directStreamUrl = await deResolveHubCloud(rawUrl);
      if (directStreamUrl) {
        provider = 'HubCloud';
        streamHeaders = { 'User-Agent': UA };
      }
    } else if (rawUrl.includes('clicknupload.')) {
      directStreamUrl = await deResolveClicknUpload(rawUrl);
      if (directStreamUrl) {
        provider = 'ClicknUpload';
        streamHeaders = { 'User-Agent': UA };
      }
    } else if (/\.(?:mp4|mkv)(?:\?|$)/i.test(rawUrl) &&
        !rawUrl.includes('111477.xyz') && !rawUrl.includes('vadapav.mov') &&
        !rawUrl.includes('.cyou/res/')) {
      try {
        const check = await fetchPage(rawUrl, { method: 'HEAD', headers: { 'User-Agent': UA }, timeoutMs: 1500 });
        if (check.status === 200 || check.status === 206 || check.status === 302) {
          directStreamUrl = rawUrl;
          provider = item.site ? String(item.site) : 'DirectStream';
          streamHeaders = { 'User-Agent': UA };
        }
      } catch (_) {}
    }
  } catch (_) {}

  if (!directStreamUrl) return null;
  const tags = Array.isArray(item.tags) ? item.tags.map(String) : [];
  const qualityMatch = tags.find((t) => /2160p|4k|1080p|720p|480p/i.test(t)) || '1080p';
  const rawTitle = item.name ? String(item.name) : (item.release ? String(item.release) : fallbackTitle);
  const tagsStr = tags.length ? tags.join(' · ') : qualityMatch;
  return {
    provider,
    title: '[' + provider + '] ' + rawTitle + ' (' + qualityMatch + ')',
    format: fmtOf(directStreamUrl),
    quality: /^\d+p$/.test(qualityMatch) ? qualityMatch : (qualityMatch.toLowerCase() === '4k' ? '4K' : null),
    description: qualityMatch + ' · ' + tagsStr + ' · ' + provider,
    url: directStreamUrl,
    headers: streamHeaders
  };
}

async function scrapeDownloadEverything(ctx) {
  const out = [];
  const payload = {
    mode: ctx.isTv ? 'series' : 'movie',
    title: ctx.title || ''
  };
  if (ctx.year) payload.year = String(ctx.year);
  if (ctx.tmdbId) payload.tmdb_id = ctx.tmdbId;
  if (ctx.imdbId) payload.imdb_id = ctx.imdbId;
  if (ctx.isTv) {
    payload.season = ctx.season ?? 1;
    payload.episode = ctx.episode ?? 1;
  }

  // Send with a bounded connect time, then read the SSE body generously
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let text = null;
  try {
    const res = await fetch(DE_SLAVE, {
      method: 'POST', headers: DE_HEADERS,
      body: JSON.stringify(payload), signal: controller.signal
    });
    clearTimeout(timer);
    const t2 = setTimeout(() => controller.abort(), 45000);
    try { text = await res.text(); } catch (_) {}
    clearTimeout(t2);
  } catch (_) {
    clearTimeout(timer);
  } finally {
    clearTimeout(timer);
  }
  if (!text) return out;

  const jobs = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && parsed.t === 'hit' && Array.isArray(parsed.links)) {
        const site = parsed.site ? String(parsed.site) : 'DownloadEverything';
        for (const l of parsed.links) {
          if (l && typeof l === 'object') {
            jobs.push(deResolveItem({ site, ...l }, ctx.title || ''));
          }
        }
      }
    } catch (_) {}
  }
  const resolved = await Promise.all(jobs);
  for (const r of resolved) if (r) out.push(r);
  return out;
}

// ── LMScript (Helix lmscript.xyz — movies only) ──────────────────────────
async function scrapeLMScript(ctx) {
  const out = [];
  if (ctx.isTv) return out;
  try {
    const url = 'https://lmscript.xyz/v1/movies?filters[q]=' + encodeURIComponent(ctx.title || '') + '&expand=streams';
    const data = await fetchJson(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' }, timeoutMs: 8000
    });
    if (!data || !Array.isArray(data.items)) return out;

    let movie = null;
    if (ctx.tmdbId) {
      movie = data.items.find((it) => it && (String(it.tmdb_prefix) === String(ctx.tmdbId) || String(it.tmdb_id) === String(ctx.tmdbId)));
    }
    if (!movie) {
      movie = data.items.find((it) => it && String(it.title).toLowerCase() === String(ctx.title).toLowerCase()) || data.items[0];
    }
    if (!movie || !movie.streams || typeof movie.streams !== 'object') return out;

    for (const [quality, streamUrl] of Object.entries(movie.streams)) {
      const u = streamUrl == null ? '' : String(streamUrl);
      if (!u) continue;
      out.push({
        provider: 'LMScript',
        title: 'LMScript · ' + quality,
        format: fmtOf(u),
        quality: /^\d+p$/.test(quality) ? quality : null,
        description: 'LMScript Stream · ' + (u.includes('.m3u8') ? 'HLS' : 'MP4'),
        url: u,
        headers: { 'User-Agent': UA }
      });
    }
  } catch (_) {}
  return out;
}

// ── XDownloader (Helix xdownloader.dart: films365.org API) ───────────────
async function scrapeXDownloader(ctx) {
  const out = [];
  const BASE = 'https://www.films365.org';
  const HEADERS = {
    Authorization: 'Bearer 79a02956be35835728a044b11e2ae793149d45fb2c89cb6d029ec01aac19bfdb',
    'Content-Type': 'application/json',
    'User-Agent': 'MovieDownloader/1.0'
  };
  try {
    const searchRes = await fetchJson(BASE + '/api/mobile/search', {
      method: 'POST', headers: HEADERS, body: JSON.stringify({ query: ctx.title || '' }),
      timeoutMs: 10000
    });
    const resultsObj = searchRes && searchRes.results ? searchRes.results : null;
    const items = resultsObj
      ? (Array.isArray(resultsObj.all) ? resultsObj.all
        : Array.isArray(resultsObj.movies) ? resultsObj.movies
        : Array.isArray(resultsObj.tvs) ? resultsObj.tvs : [])
      : [];
    if (!items.length) return out;

    const targetType = ctx.isTv ? 'tv' : 'movie';
    const cleanSearchTitle = String(ctx.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    let matched = null;
    for (const item of items) {
      const itemType = item && item.type ? String(item.type) : null;
      if (itemType && itemType !== targetType) continue;
      const itemTitle = item && item.title ? String(item.title) : '';
      const cleanItemTitle = itemTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanItemTitle === cleanSearchTitle || cleanItemTitle.includes(cleanSearchTitle)) {
        matched = item;
        break;
      }
    }
    if (!matched) {
      matched = items.find((i) => i && String(i.type) === targetType) || items[0];
    }
    const itemId = matched && (matched.id != null ? String(matched.id) : (matched.tmdbId != null ? String(matched.tmdbId) : null));
    if (!itemId) return out;

    const detailsRes = await fetchJson(BASE + '/api/mobile/details?id=' + encodeURIComponent(itemId) + '&type=' + targetType, {
      headers: HEADERS, timeoutMs: 10000
    });
    const data = detailsRes && detailsRes.data ? detailsRes.data : null;
    if (!data) return out;

    const spoken = Array.isArray(data.spokenLanguages)
      ? data.spokenLanguages.map((e) => String(e).trim()).filter(Boolean) : [];
    const langSuffix = spoken.length ? ' · ' + spoken.join(', ') : '';

    const pushStream = (streamUrl, descSuffix) => {
      if (!streamUrl) return;
      const safeUrl = (() => { try { return new URL(streamUrl).toString(); } catch (_) { return streamUrl; } })();
      if (!safeUrl.startsWith('http')) return;
      out.push({
        provider: 'X-Downloader',
        title: 'X-Downloader' + langSuffix,
        format: fmtOf(safeUrl),
        quality: null,
        description: 'X-Downloader Direct MP4 Stream' + (descSuffix || langSuffix),
        url: safeUrl,
        headers: { 'User-Agent': 'MovieDownloader/1.0' }
      });
    };

    if (!ctx.isTv) {
      const downloadUrl = data.downloadUrl ? String(data.downloadUrl) : '';
      const videoUrl = data.videoUrl ? String(data.videoUrl) : '';
      pushStream(downloadUrl || videoUrl, langSuffix);
    } else if (Array.isArray(data.seasons) && ctx.season != null) {
      const targetSeason = data.seasons.find((s) => s && s.seasonNumber === ctx.season);
      if (targetSeason && Array.isArray(targetSeason.episodes) && ctx.episode != null) {
        const targetEpisode = targetSeason.episodes.find((e) => e && e.episodeNumber === ctx.episode);
        if (targetEpisode) {
          const epDownloadUrl = targetEpisode.downloadUrl ? String(targetEpisode.downloadUrl) : '';
          const epVideoUrl = targetEpisode.videoUrl ? String(targetEpisode.videoUrl) : '';
          pushStream(epDownloadUrl || epVideoUrl, ' (S' + ctx.season + 'E' + ctx.episode + ')' + langSuffix);
        }
      }
    }
  } catch (_) {}
  return out;
}

// ── KissKH (Helix kisskh.dart: kisskh.do + enc-dec.app key) ──────────────
async function scrapeKissKH(ctx) {
  const out = [];
  const BASE = 'https://kisskh.do';
  const HEADERS = { 'User-Agent': UA, Accept: 'application/json' };
  const cleanTitle = (t) => String(t).toLowerCase().replace(/\(\d{4}\)/g, '').replace(/[^a-z0-9]/g, '');

  try {
    const searchRes = await fetchJson(BASE + '/api/DramaList/Search?q=' + encodeURIComponent(ctx.title || ''), {
      headers: HEADERS, timeoutMs: 6000
    });
    if (!Array.isArray(searchRes) || searchRes.length === 0) return out;
    const targetClean = cleanTitle(ctx.title || '');

    let drama = null;
    let bestScore = -1;
    for (const item of searchRes) {
      if (!item || !item.title) continue;
      const parts = String(item.title).split(/\s*-\s*/).map(cleanTitle);
      let score = 0;
      if (parts.some((p) => p === targetClean)) score += 5;
      else if (parts.some((p) => p.includes(targetClean) || targetClean.includes(p))) score += 3;
      if (score > bestScore) { bestScore = score; drama = item; }
    }
    if (!drama || drama.id == null) return out;

    const detail = await fetchJson(BASE + '/api/DramaList/Drama/' + drama.id, {
      headers: HEADERS, timeoutMs: 8000
    });
    if (!detail || !Array.isArray(detail.episodes)) return out;
    const targetEpNum = ctx.episode ?? 1;
    const epMatch = detail.episodes.find((ep) => ep && Number(ep.number) === targetEpNum) || detail.episodes[0];
    if (!epMatch || epMatch.id == null) return out;

    const encRes = await fetchJson('https://enc-dec.app/api/enc-kisskh?text=' + epMatch.id + '&type=vid', {
      headers: HEADERS, timeoutMs: 6000
    });
    const vidKey = encRes && encRes.status === 200 && encRes.result ? String(encRes.result) : null;
    if (!vidKey) return out;

    const videoRes = await fetchJson(BASE + '/api/DramaList/Episode/' + epMatch.id + '.png?err=false&ts=&time=&kkey=' + vidKey, {
      headers: HEADERS, timeoutMs: 10000
    });
    const streamUrl = videoRes && videoRes.Video ? String(videoRes.Video) : '';
    if (!streamUrl) return out;

    out.push({
      provider: 'KissKH',
      title: 'KissKH · Drama · 1080p',
      format: fmtOf(streamUrl),
      quality: '1080p',
      description: 'KissKH Stream · ' + (streamUrl.includes('.m3u8') ? 'HLS' : 'MP4'),
      url: streamUrl,
      headers: { 'User-Agent': UA, Referer: BASE + '/' }
    });
  } catch (_) {}
  return out;
}

// ── FshareTV (Helix fsharetv.dart — movies only) ─────────────────────────
async function scrapeFshareTV(ctx) {
  const out = [];
  if (ctx.isTv) return out;
  const BASE = 'https://fsharetv.cc';
  const HEADERS = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: BASE + '/'
  };

  try {
    let imdbId = ctx.imdbId;
    if (!imdbId || !imdbId.startsWith('tt')) {
      if (!ctx.tmdbId) return out;
      const meta = await fetchJson('https://api.themoviedb.org/3/movie/' + ctx.tmdbId + '?api_key=b3556f3b206e16f82df4d1f6fd4545e6', {
        headers: { 'User-Agent': UA }, timeoutMs: 4000
      });
      if (meta && meta.imdb_id) imdbId = String(meta.imdb_id);
    }
    if (!imdbId || !imdbId.startsWith('tt')) return out;

    const pageRes = await fetchRaw(BASE + '/movie/' + imdbId, { headers: HEADERS, timeoutMs: 8000 });
    if (!pageRes.ok || !pageRes.text) return out;
    const watchMatch = /href="(\/w\/[^"]+)"/.exec(pageRes.text);
    if (!watchMatch) return out;
    const watchPath = watchMatch[1];

    const watchRes = await fetchRaw(BASE + watchPath, { headers: HEADERS, timeoutMs: 8000 });
    if (!watchRes.ok || !watchRes.text) return out;
    const sidMatch = /(?:source_id|file_id|setSource)[\s=:\('"]+([^'"\)]+)/i.exec(watchRes.text);
    if (!sidMatch) return out;
    const sourceId = sidMatch[1];

    const json = await fetchJson(BASE + '/api/file/' + sourceId + '/source?trailer=Png81APqcxU&type=watch', {
      headers: { ...HEADERS, Accept: 'application/json, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest', Referer: BASE + watchPath },
      timeoutMs: 8000
    });
    if (!json || json.status !== 'ok') return out;

    const groups = [];
    if (json.data && json.data.file && Array.isArray(json.data.file.sources)) {
      groups.push(json.data.file.sources);
    }
    if (json.data && json.data.file && Array.isArray(json.data.file.alternatives)) {
      for (const g of json.data.file.alternatives) if (Array.isArray(g)) groups.push(g);
    }

    const seen = new Set();
    for (const group of groups) {
      for (const item of group) {
        if (!item || item.src == null) continue;
        const rawSrc = String(item.src);
        const srcUrl = rawSrc.startsWith('http') ? rawSrc : BASE + rawSrc;
        if (seen.has(srcUrl)) continue;
        seen.add(srcUrl);
        const quality = item.quality ? String(item.quality) : '1080';
        const label = item.label ? String(item.label).trim() : '';
        const titleParts = ['FshareTV'];
        if (label) titleParts.push(label);
        titleParts.push(quality + 'p');
        out.push({
          provider: 'FshareTV',
          title: titleParts.join(' · '),
          format: fmtOf(srcUrl),
          quality: /^\d+$/.test(quality) ? quality + 'p' : null,
          description: ['FshareTV Stream', label, srcUrl.includes('.m3u8') ? 'HLS' : 'MP4'].filter(Boolean).join(' · '),
          url: srcUrl,
          headers: HEADERS
        });
      }
    }
  } catch (_) {}
  return out;
}

// ── FSonic (Helix fsonic.dart — movies only) ─────────────────────────────
async function scrapeFSonic(ctx) {
  const out = [];
  if (ctx.isTv) return out;
  const BASE = 'https://www.fsonic.net';
  const FSHARE = 'https://fsharetv.co';
  const HEADERS = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
  };

  try {
    const sRes = await fetchRaw(BASE + '/movie/search/' + encodeURIComponent(ctx.title || ''), {
      headers: HEADERS, timeoutMs: 8000
    });
    if (!sRes.ok || !sRes.text) return out;
    const sHtml = sRes.text;

    let watchSlug = null;
    let idx = 0;
    const yearStr = ctx.year ? String(ctx.year) : '';
    while ((idx = sHtml.indexOf('href="/watch/', idx)) !== -1) {
      const start = idx + 6;
      const end = sHtml.indexOf('"', start);
      if (end === -1) break;
      const link = sHtml.substring(start, end);
      if (!watchSlug) watchSlug = link;
      if (yearStr && link.includes(yearStr)) { watchSlug = link; break; }
      idx = end;
    }
    if (!watchSlug) return out;

    const wRes = await fetchRaw(BASE + watchSlug, { headers: HEADERS, timeoutMs: 8000 });
    if (!wRes.ok || !wRes.text) return out;
    const match = /init\('([^']+)',\s*(?:'[^']*',\s*)?'([^']+)'\)/.exec(wRes.text);
    if (!match) return out;
    const token = match[1];
    const trailer = match[2] || '';

    const json = await fetchJson(BASE + '/api/source/' + token + '?trailer=' + trailer + '&type=watch', {
      headers: { ...HEADERS, Accept: 'application/json, text/plain, */*', Referer: BASE + watchSlug },
      timeoutMs: 8000
    });
    if (!json || json.status !== 'ok') return out;

    const groups = [];
    if (json.data && json.data.file && Array.isArray(json.data.file.sources)) {
      groups.push(json.data.file.sources);
    }
    if (json.data && json.data.file && Array.isArray(json.data.file.alternatives)) {
      for (const g of json.data.file.alternatives) if (Array.isArray(g)) groups.push(g);
    }

    const seen = new Set();
    for (const group of groups) {
      for (const item of group) {
        if (!item || item.src == null) continue;
        const rawSrc = String(item.src);
        const srcUrl = rawSrc.startsWith('http') ? rawSrc : FSHARE + rawSrc;
        if (seen.has(srcUrl)) continue;
        seen.add(srcUrl);
        const quality = item.quality ? String(item.quality) : '1080';
        const label = item.label ? String(item.label).trim() : '';
        const titleParts = ['FSonic'];
        if (label) titleParts.push(label);
        titleParts.push(quality + 'p');
        out.push({
          provider: 'FSonic',
          title: titleParts.join(' · '),
          format: fmtOf(srcUrl),
          quality: /^\d+$/.test(quality) ? quality + 'p' : null,
          description: ['FSonic Stream', label, srcUrl.includes('.m3u8') ? 'HLS' : 'MP4'].filter(Boolean).join(' · '),
          url: srcUrl,
          headers: { ...HEADERS, Referer: FSHARE + '/' }
        });
      }
    }
  } catch (_) {}
  return out;
}

// ── FSOnline (Helix fsonline.dart: www3.fsonline.app FileSuN) ────────────
async function scrapeFSOnline(ctx) {
  const out = [];
  const ORIGIN = 'https://www3.fsonline.app';
  const HEADERS = { 'User-Agent': UA, Origin: ORIGIN, Referer: ORIGIN + '/' };

  try {
    const query = ctx.year ? (ctx.title || '') + ' ' + ctx.year : (ctx.title || '');
    const searchRes = await fetchRaw(ORIGIN + '/?s=' + encodeURIComponent(query), {
      headers: HEADERS, timeoutMs: 8000
    });
    if (!searchRes.ok || !searchRes.text) return out;
    const typeFolder = ctx.isTv ? 'seriale' : 'film';
    const linkMatch = new RegExp(
      'href=["\'](https?://www3\\.fsonline\\.app/' + typeFolder + '/([^"\'/]+)/)["\']', 'i'
    ).exec(searchRes.text);
    if (!linkMatch) return out;

    let targetPageUrl;
    if (ctx.isTv) {
      const slug = linkMatch[2].replace(/-\d{4}$/, '');
      targetPageUrl = ORIGIN + '/episoade/' + slug + '-sezonul-' + (ctx.season ?? 1) + '-episodul-' + (ctx.episode ?? 1) + '/';
    } else {
      targetPageUrl = linkMatch[1];
    }

    const pageRes = await fetchRaw(targetPageUrl, { headers: HEADERS, timeoutMs: 8000 });
    if (!pageRes.ok || !pageRes.text) return out;
    const movieId = (/(?:movie-id=['"]([^'"]+)['"]|movie-id=([^ >]+))/.exec(pageRes.text) || [])[1] ||
      (/(?:movie-id=['"]([^'"]+)['"]|movie-id=([^ >]+))/.exec(pageRes.text) || [])[2];
    if (!movieId) return out;

    const ajaxRes = await fetchRaw(ORIGIN + '/wp-admin/admin-ajax.php', {
      method: 'POST',
      headers: {
        ...HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: targetPageUrl
      },
      body: 'action=lazy_player&movieID=' + encodeURIComponent(movieId),
      timeoutMs: 8000
    });
    if (!ajaxRes.ok || !ajaxRes.text) return out;

    let idx = 0;
    while ((idx = ajaxRes.text.indexOf('data-vs="', idx)) !== -1) {
      const embedStart = idx + 9;
      const embedEnd = ajaxRes.text.indexOf('"', embedStart);
      if (embedEnd === -1) break;
      const embedUrl = ajaxRes.text.substring(embedStart, embedEnd);

      const spanStart = ajaxRes.text.indexOf('<span>', embedEnd);
      const spanEnd = ajaxRes.text.indexOf('</span>', spanStart);
      const serverLabel = spanStart !== -1 && spanEnd !== -1
        ? ajaxRes.text.substring(spanStart + 6, spanEnd).trim().toLowerCase() : '';

      if (serverLabel.includes('filesun')) {
        try {
          const rRes = await fetchRaw(embedUrl, {
            headers: { Referer: ORIGIN, 'User-Agent': UA }, timeoutMs: 6000
          });
          if (rRes.ok && rRes.text) {
            const m3u8Match = /file:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/.exec(rRes.text) ||
              /["']?file["']?:\s*["'](https?:\/\/[^"']+)["']/.exec(rRes.text);
            if (m3u8Match) {
              const streamUrl = m3u8Match[1].replace(/\\\//g, '/');
              out.push({
                provider: 'FSOnline',
                title: 'FSOnline · FileSuN · 1080p',
                format: 'HLS',
                quality: '1080p',
                description: 'FSOnline HLS Stream',
                url: streamUrl,
                headers: { Referer: embedUrl, Origin: 'https://player.fsonline.app', 'User-Agent': UA }
              });
            }
          }
        } catch (_) {}
      }
      idx = spanEnd !== -1 ? spanEnd : embedEnd;
    }
  } catch (_) {}
  return out;
}

module.exports = {
  // shared cipher
  mvDecrypt,
  mvKeystream,
  // scrapers
  scrapeVideasy,
  scrapeVidFast,
  scrapePeeStream,
  scrapeXPass,
  scrapeMovy,
  scrapeVuflix,
  scrapeRiveStream,
  scrapeCinejoy,
  scrapeZxcStream,
  scrapeVidGod,
  scrapeVidVault,
  scrapeLookMovie,
  scrapeFlaxMovies,
  scrapeMapple,
  scrapeDulo,
  scrapeCineSu,
  scrapeVadapav,
  scrape4KHDHub,
  scrapeDownloadEverything,
  scrapeLMScript,
  scrapeXDownloader,
  scrapeKissKH,
  scrapeFshareTV,
  scrapeFSonic,
  scrapeFSOnline,
  // internals for unit tests
  cinejoySeal,
  zxcDecrypt,
  vuflixUnwrap,
  rot13,
  levenshtein,
  mappleSolvePoW,
  deResolveItem,
  fourKResolveRedirectUrl,
  fourKGetBaseUrl
};

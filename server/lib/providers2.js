// ── Flux streams: expanded provider set (port of Helix
//    lib/services/scraper/sites/*.dart, 1:1) ──────────────────────────────
const crypto = require('crypto');
const { UA, fetchJson, fetchText, fetchRaw, fmtOf } = require('./http.js');

// ── VixSrc (Helix vixsrc.to: tokenized master HLS) ───────────────────────
function vixExtract(re, text) {
  const m = re.exec(text);
  if (!m) return null;
  return m[1]
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/')
    .replace(/\\/g, '');
}

async function scrapeVixSrc(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;
  const BASE = 'https://vixsrc.to';
  const HEADERS = {
    'User-Agent': UA,
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: BASE + '/',
    Origin: BASE
  };

  const apiUrl = ctx.isTv
    ? BASE + '/api/tv/' + ctx.tmdbId + '/' + (ctx.season ?? 1) + '/' + (ctx.episode ?? 1)
    : BASE + '/api/movie/' + ctx.tmdbId;
  const api = await fetchJson(apiUrl, { headers: HEADERS });
  if (!api || api.src == null) return out;

  const rawEmbed = String(api.src);
  const embedUrl = rawEmbed.startsWith('http') ? rawEmbed : BASE + rawEmbed;
  const html = await fetchText(embedUrl, { headers: HEADERS });
  if (!html) return out;

  const token = vixExtract(/token["']\s*:\s*["']([^"']+)/, html);
  const expires = vixExtract(/expires["']\s*:\s*["']([^"']+)/, html);
  let playlist = vixExtract(/url["']\s*:\s*["']([^"']+)/, html);
  if (!token || !expires || !playlist) return out;
  if (playlist.startsWith('/')) playlist = BASE + playlist;

  const lang = vixExtract(/lang(?:uage)?["']\s*:\s*["']([a-z]{2,5})/i, html) || 'en';
  const delim = playlist.includes('?') ? '&' : '?';
  const masterUrl = playlist + delim + 'token=' + token + '&expires=' + expires + '&h=1&lang=' + lang;

  const langMap = { es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', ru: 'Russian', ja: 'Japanese', hi: 'Hindi' };
  const isForeign = lang.toLowerCase() !== 'en';
  const langName = langMap[lang.toLowerCase()] || lang.toUpperCase();
  const label = isForeign ? 'VixSrc · Master HLS · ' + langName + ' · 1080p' : 'VixSrc · Master HLS · 1080p';

  out.push({
    provider: 'VixSrc',
    title: label,
    format: 'HLS',
    quality: '1080p',
    description: isForeign ? 'VixSrc Master Stream · ' + langName : 'VixSrc Master Stream',
    url: masterUrl,
    headers: { ...HEADERS, Referer: embedUrl }
  });
  return out;
}

// ── VidZee (Helix core.vidzee.wtf: dcloud / ipcloud / tik) ───────────────
async function scrapeVidZee(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;
  const BASE = 'https://core.vidzee.wtf';
  const PLAYER = 'https://player.vidzee.wtf';
  const HEADERS = {
    'User-Agent': UA,
    Accept: 'application/json, text/plain, */*',
    Referer: PLAYER + '/',
    Origin: PLAYER
  };

  const services = ['dcloud', 'ipcloud', 'tik'];
  const results = await Promise.all(services.map(async (service) => {
    const url = ctx.isTv
      ? BASE + '/streams/tv/' + ctx.tmdbId + '/' + (ctx.season ?? 1) + '/' + (ctx.episode ?? 1) + '?s=' + service
      : BASE + '/streams/movie/' + ctx.tmdbId + '?s=' + service;
    const data = await fetchJson(url, { headers: HEADERS });
    if (data && data.url) {
      const streamUrl = String(data.url);
      if (streamUrl.startsWith('http')) {
        return { url: streamUrl, service, language: String(data.language || '').trim() };
      }
    }
    return null;
  }));

  for (const r of results) {
    if (!r) continue;
    const hasLang = r.language && r.language.toLowerCase() !== 'auto';
    const label = ['VidZee', r.service, hasLang ? r.language : null, '1080p'].filter(Boolean).join(' · ');
    out.push({
      provider: 'VidZee',
      title: label,
      format: fmtOf(r.url),
      quality: '1080p',
      description: hasLang ? 'VidZee Stream · ' + r.language : 'VidZee Stream',
      url: r.url,
      headers: { 'User-Agent': UA, Referer: PLAYER + '/', Origin: PLAYER }
    });
  }
  return out;
}

// ── CineSrc / Bcine shared crypto (Helix cinesrc.dart + bcine.dart) ──────
const CRYPTO_ND = '4860ac8bfddb';
const CRYPTO_AD = '224eff10e662e9635c9f671cf46351dcd69af42b1edd56f5e5fa21751f44b9c8';
const CRYPTO_LS = [17, 91, 203, 44, 8, 177, 62, 239, 119, 3, 154, 81, 28, 210, 101, 7];
const CRYPTO_WA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function cryptoAb(e) {
  let t = e >>> 0;
  t ^= t >>> 16;
  t = Math.imul(t, 2146121005) >>> 0;
  t ^= t >>> 15;
  t = Math.imul(t, 2221713035) >>> 0;
  return (t ^ (t >>> 16)) >>> 0;
}

function cryptoSd(e) {
  const t = Buffer.from(CRYPTO_AD, 'utf8');
  const r = Math.min(128, Math.max(32, e + 17));
  const n = new Uint8Array(r);
  let a = 2166136261;
  for (let s = 0; s < r; s++) {
    a = (a ^ t[s % t.length]) >>> 0;
    a = cryptoAb((a + CRYPTO_LS[s % CRYPTO_LS.length] + Math.imul(2654435761, s)) >>> 0);
    n[s] = a & 255;
  }
  return n;
}

// Dart _iD is a standard unpadded base64url encode
function cryptoId(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function generateCryptoHlsUrl(tmdbId, s, e) {
  const isTv = s != null && e != null;
  const season = isTv ? s : 0;
  const episode = isTv ? e : 0;
  const str = CRYPTO_ND + ':' + (isTv ? 's' : 'm') + ':' + tmdbId + ':' + season + ':' + episode;
  const a = Buffer.from(str, 'utf8');
  const sArr = cryptoSd(a.length);
  const i = new Uint8Array(a.length + 2);
  i[0] = a.length & 255;
  i[1] = (a.length >> 8) & 255;
  let o = (2654435769 ^ a.length) >>> 0;
  for (let l = 0; l < a.length; l++) {
    o = cryptoAb((o + sArr[l % sArr.length] + CRYPTO_LS[l % CRYPTO_LS.length] + l) >>> 0);
    i[l + 2] = (a[l] ^ (255 & o)) ^ sArr[(7 * l + 3) % sArr.length];
  }
  return 'https://glendale-plumbing.com/c/v1/' + cryptoId(i) + '/master.m3u8';
}

async function scrapeCineSrc(ctx) {
  if (!ctx.tmdbId) return [];
  const url = generateCryptoHlsUrl(ctx.tmdbId, ctx.isTv ? ctx.season : null, ctx.isTv ? ctx.episode : null) + '?_v=34403446';
  return [{
    provider: 'CineSrc',
    title: 'CineSrc · Direct Master · 1080p',
    format: 'HLS',
    quality: '1080p',
    description: 'CineSrc Direct Master HLS Stream',
    url,
    headers: { 'User-Agent': UA, Referer: 'https://cinesrc.st/', Origin: 'https://cinesrc.st' }
  }];
}

// ── Bcine (Helix bcine.dart: crypto master + 1embed.cc servers) ──────────
async function scrapeBcine(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;

  out.push({
    provider: 'Bcine',
    title: 'Bcine · Direct Master · 1080p',
    format: 'HLS',
    quality: '1080p',
    description: 'Bcine Direct Master HLS Stream',
    url: generateCryptoHlsUrl(ctx.tmdbId, ctx.isTv ? ctx.season : null, ctx.isTv ? ctx.episode : null) + '?_v=34403446',
    headers: { 'User-Agent': UA, Referer: 'https://bcine.ru/', Origin: 'https://bcine.ru' }
  });

  const tokRes = await fetchJson('https://1embed.cc/api/token', {
    headers: { 'User-Agent': UA, Referer: 'https://1embed.cc/', Accept: 'application/json, text/plain, */*' },
    timeoutMs: 4000
  });
  const token = tokRes && tokRes.token ? String(tokRes.token) : null;
  if (!token) return out;

  const query = ctx.isTv
    ? 'id=' + ctx.tmdbId + '?type=tv&s=' + (ctx.season ?? 1) + '&e=' + (ctx.episode ?? 1)
    : 'id=' + ctx.tmdbId + '?type=movie';
  const servers = [
    { endpoint: '/server/night', name: 'Night' },
    { endpoint: '/server/emp', name: 'Empire' },
    { endpoint: '/server/vidsrc', name: 'VidSrc' }
  ];
  const results = await Promise.all(servers.map(async (srv) => {
    const data = await fetchJson('https://1embed.cc' + srv.endpoint + '?' + query, {
      headers: {
        'User-Agent': UA,
        Referer: 'https://1embed.cc/',
        Authorization: 'Bearer ' + token,
        Accept: 'application/json, text/plain, */*'
      },
      timeoutMs: 6000
    });
    if (data && data.url && String(data.url).includes('.m3u8')) {
      return { name: srv.name, url: String(data.url) };
    }
    return null;
  }));
  for (const r of results) {
    if (!r) continue;
    out.push({
      provider: 'Bcine',
      title: 'Bcine · ' + r.name + ' · 1080p',
      format: 'HLS',
      quality: '1080p',
      description: 'Bcine ' + r.name + ' HLS Stream',
      url: r.url,
      headers: { 'User-Agent': UA, Referer: 'https://1embed.cc/' }
    });
  }
  return out;
}

// ── Nova (Helix nova-streamz.vercel.app multi-source manifest) ───────────
async function scrapeNova(ctx) {
  if (!ctx.imdbId) return [];
  const out = [];
  const path = ctx.isTv
    ? '/stream/series/' + ctx.imdbId + ':' + (ctx.season ?? 1) + ':' + (ctx.episode ?? 1) + '.json'
    : '/stream/movie/' + ctx.imdbId + '.json';
  const json = await fetchJson('https://nova-streamz.vercel.app' + path, {
    headers: { 'User-Agent': UA, Accept: 'application/json' }
  });
  if (!json || !Array.isArray(json.streams)) return out;
  for (const st of json.streams) {
    if (!st || typeof st !== 'object') continue;
    const url = st.url ? String(st.url) : null;
    if (!url || !url.startsWith('http')) continue;

    let headers = null;
    try {
      const req = st.behaviorHints.proxyHeaders.request;
      if (req && typeof req === 'object') {
        headers = {};
        for (const [k, v] of Object.entries(req)) headers[String(k)] = String(v);
      }
    } catch (_) {}

    const stName = (st.name ? String(st.name) : 'Nova').replace('Nova ', '');
    const rawTitle = st.title ? String(st.title) : '';
    const stTitle = rawTitle.includes(' | ') ? rawTitle.replace(/ \| /g, ' · ') : rawTitle;
    const label = stTitle ? stName + ' · ' + stTitle : stName;

    out.push({
      provider: 'Nova',
      title: 'Nova · ' + label,
      format: fmtOf(url),
      quality: null,
      description: 'Nova Multi-Source Stream',
      url,
      headers
    });
  }
  return out;
}

// ── MegaSource (Helix megasource.wasmer.app manifest pipeline) ───────────
const MEGASOURCE_CONFIG =
  'W3siaWQiOiJkZWZhdWx0IiwibmFtZSI6Ik1lZ2FTb3VyY2UgZGVmYXVsdCIsInVybCI6Imh0dHBzOi8vZ2l0aHViLmNvbS96b3JldS9tZWdhc291cmNlX3NjcmFwZXJzL3Jhdy9yZWZzL2hlYWRzL21haW4vZGVmYXVsdF9zY3JhcGVyLnB5IiwiZGVzY3JpcHRpb24iOiJEZWZhdWx0IHNjcmFwZXIgaG9zdGVkIG9uIEdpdEh1Yi4ifV0';

async function scrapeMegaSource(ctx) {
  if (!ctx.imdbId) return [];
  const path = ctx.isTv
    ? '/stream/series/' + ctx.imdbId + ':' + (ctx.season ?? 1) + ':' + (ctx.episode ?? 1) + '.json'
    : '/stream/movie/' + ctx.imdbId + '.json';
  const json = await fetchJson('https://megasource.wasmer.app/' + MEGASOURCE_CONFIG + path, {
    headers: { 'User-Agent': UA, Accept: 'application/json' }
  });
  const out = [];
  if (!json || !Array.isArray(json.streams)) return out;
  for (const st of json.streams) {
    if (!st || typeof st !== 'object') continue;
    const url = st.url ? String(st.url) : null;
    if (!url || !url.startsWith('http')) continue;

    let headers = null;
    try {
      const req = st.behaviorHints.proxyHeaders.request;
      if (req && typeof req === 'object') {
        headers = {};
        for (const [k, v] of Object.entries(req)) headers[String(k)] = String(v);
      }
    } catch (_) {}

    const stTitle = st.title ? String(st.title) : 'Stream';
    out.push({
      provider: 'MegaSource',
      title: 'MegaSource · ' + stTitle,
      format: fmtOf(url),
      quality: null,
      description: 'MegaSource HLS Stream',
      url,
      headers
    });
  }
  return out;
}

// ── 111477 (Helix a111477.dart: manifest with file server config) ────────
async function scrapeA111477(ctx) {
  const out = [];
  const config = 'https://a.111477.xyz/' + '::sort=file-desc' + '::limit=3';
  const b64 = Buffer.from(config, 'utf8').toString('base64url');
  const addonBase = 'https://st.111477.xyz/config/' + b64;

  const targetIds = [];
  if (ctx.imdbId && ctx.imdbId.startsWith('tt')) targetIds.push(ctx.imdbId);
  if (ctx.tmdbId) targetIds.push('tmdb:' + ctx.tmdbId);

  const seen = new Set();
  for (const id of targetIds) {
    const path = ctx.isTv
      ? addonBase + '/stream/series/' + id + ':' + (ctx.season ?? 1) + ':' + (ctx.episode ?? 1) + '.json'
      : addonBase + '/stream/movie/' + id + '.json';
    const json = await fetchJson(path, {
      headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*' },
      timeoutMs: 12000
    });
    if (!json || !Array.isArray(json.streams) || json.streams.length === 0) continue;

    for (const st of json.streams) {
      if (!st || typeof st !== 'object') continue;
      const url = st.url ? String(st.url) : null;
      if (!url || !url.startsWith('http') || seen.has(url)) continue;
      if (url.includes('/slowdown')) continue;   // addon rate-limit marker, not a stream
      seen.add(url);
      const rawTitle = st.title ? String(st.title) : '';
      const rawName = st.name ? String(st.name) : '111477';
      out.push({
        provider: '111477',
        title: rawTitle || (rawName + ' • Direct Stream'),
        format: fmtOf(url),
        quality: null,
        description: rawTitle || '111477 Direct Stream',
        url,
        headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*' }
      });
    }
    break;   // Helix: stop after first ID that returns streams
  }
  return out;
}

// ── Frame (Helix frame.dart: api.peestream.in, 7 providers) ──────────────
async function scrapeFrame(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;
  const providers = [
    { id: 'vaplayer', name: 'Zephyr' },
    { id: 'castle', name: 'Atlas' },
    { id: 'hera', name: 'Luna' },
    { id: 'multivid', name: 'Volt' },
    { id: 'netmirror', name: 'Echo' },
    { id: 'vidsuper-castle', name: 'Rift' },
    { id: 'vidsuper-vixsrc', name: 'Quill' }
  ];

  const lists = await Promise.all(providers.map(async (p) => {
    const params = new URLSearchParams({
      q: String(ctx.tmdbId),
      type: ctx.isTv ? 'tv' : 'movie',
      provider: p.id
    });
    if (ctx.isTv) {
      params.set('season', String(ctx.season ?? 1));
      params.set('episode', String(ctx.episode ?? 1));
    }
    const data = await fetchJson('https://api.peestream.in/api/search?' + params.toString(), {
      headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://peestream.in/' }
    });
    const rows = [];
    if (data && Array.isArray(data.results)) {
      for (const result of data.results) {
        if (!result || !Array.isArray(result.streams)) continue;
        for (const stream of result.streams) {
          if (!stream || typeof stream !== 'object') continue;
          const sUrl = stream.url ? String(stream.url) : null;
          if (!sUrl || !sUrl.startsWith('http')) continue;
          rows.push({
            url: sUrl,
            quality: stream.quality ? String(stream.quality) : '1080p',
            isHls: stream.type === 'm3u8' || sUrl.includes('.m3u8')
          });
        }
      }
    }
    return { name: p.name, rows };
  }));

  for (const { name, rows } of lists) {
    for (const r of rows) {
      out.push({
        provider: 'Frame',
        title: 'FRAME ' + name + ' · ' + r.quality,
        format: r.isHls ? 'HLS' : fmtOf(r.url),
        quality: r.quality,
        description: 'FRAME Stream · ' + (r.isHls ? 'HLS' : 'MP4'),
        url: r.url,
        headers: { 'User-Agent': UA }
      });
    }
  }
  return out;
}

// ── Purstream (Helix purstream.dart: api.purstream.club) ─────────────────
async function scrapePurstream(ctx) {
  const out = [];
  const DOMAIN = 'https://purstream.club';
  const API = 'https://api.purstream.club/api/v1';
  const HEADERS = {
    'User-Agent': UA,
    Accept: 'application/json, text/plain, */*',
    Referer: DOMAIN + '/',
    Origin: DOMAIN,
    'X-Requested-With': 'XMLHttpRequest',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site'
  };

  const search = await fetchJson(API + '/search-bar/search/' + encodeURIComponent(ctx.title), { headers: HEADERS });
  const items = search && search.data && search.data.items && search.data.items.movies
    ? search.data.items.movies.items
    : null;
  if (!Array.isArray(items) || items.length === 0) return out;

  const lowerTitle = String(ctx.title || '').toLowerCase();
  const mediaType = ctx.isTv ? 'tv' : 'movie';
  let match = null;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const itemType = item.type ? String(item.type) : null;
    const itemTitle = item.title ? String(item.title).toLowerCase() : null;
    const releaseDate = item.release_date ? String(item.release_date) : null;
    if (itemType === mediaType && itemTitle === lowerTitle) {
      if (ctx.year == null || (releaseDate && releaseDate.startsWith(String(ctx.year)))) {
        match = item;
        break;
      }
    }
  }
  if (!match) match = items.find((it) => it && it.type && String(it.type) === mediaType) || null;
  if (!match || match.id == null) return out;

  const streamUrl = ctx.isTv
    ? API + '/stream/' + match.id + '/episode?season=' + (ctx.season ?? 1) + '&episode=' + (ctx.episode ?? 1)
    : API + '/stream/' + match.id;
  const sJson = await fetchJson(streamUrl, { headers: HEADERS });
  if (!sJson || sJson.type !== 'success') return out;

  const sources = sJson.data && sJson.data.items ? sJson.data.items.sources : null;
  if (!Array.isArray(sources)) return out;

  for (const src of sources) {
    if (!src || typeof src !== 'object') continue;
    const sUrl = src.stream_url ? String(src.stream_url) : null;
    if (!sUrl || !sUrl.startsWith('http')) continue;
    const rawName = src.source_name ? String(src.source_name) : 'Purstream';
    const cleanName = rawName.replace(/^\s*\|\s*/, '').replace(/\s*\|\s*/g, ' · ').trim();
    const sQuality = src.quality ? String(src.quality) : 'Auto';
    const qLabel = sQuality !== 'Auto' && !cleanName.includes(sQuality) ? ' · ' + sQuality : '';
    out.push({
      provider: 'Purstream',
      title: 'Purstream · ' + cleanName + qLabel,
      format: fmtOf(sUrl),
      quality: sQuality !== 'Auto' ? sQuality : null,
      description: 'Purstream Multi-Audio HLS Stream',
      url: sUrl,
      headers: { 'User-Agent': UA, Referer: DOMAIN + '/' }
    });
  }
  return out;
}

// ── MovieNight (Helix movienig.ht: SSE responses, 7 servers) ─────────────
async function scrapeMovieNight(ctx) {
  const out = [];
  const BASE = 'https://movienig.ht';
  const HEADERS = {
    'User-Agent': UA,
    Referer: BASE + '/',
    Origin: BASE,
    Accept: 'text/event-stream'
  };
  const servers = [
    { id: 'dallas', label: 'Dallas 4K' },
    { id: 'austin', label: 'Austin' },
    { id: 'helena', label: 'Helena' },
    { id: 'seattle', label: 'Seattle 4K' },
    { id: 'vixsrc-1', label: 'Newport Beach' },
    { id: 'tucson', label: 'Tucson' },
    { id: 'salem', label: 'Salem' }
  ];

  const idToUse = ctx.tmdbId || ctx.imdbId;
  if (!idToUse) return out;
  const encTitle = encodeURIComponent(ctx.title || '');
  const yearQuery = ctx.year ? '&year=' + ctx.year : '';
  const imdbQuery = ctx.imdbId ? '&imdbId=' + ctx.imdbId : '';

  const results = await Promise.all(servers.map(async (srv) => {
    const url = ctx.isTv
      ? BASE + '/api/stream/v1/tv/' + idToUse + '/' + (ctx.season ?? 1) + '/' + (ctx.episode ?? 1) +
        '?title=' + encTitle + yearQuery + imdbQuery + '&server=' + srv.id + '&only=1'
      : BASE + '/api/stream/v1/movie/' + idToUse +
        '?title=' + encTitle + yearQuery + imdbQuery + '&server=' + srv.id + '&only=1';
    const res = await fetchRaw(url, { headers: HEADERS, timeoutMs: 4000 });
    if (!res.ok || !res.text || !res.text.includes('event: done')) return [];
    const doneIdx = res.text.indexOf('event: done');
    const dataIdx = res.text.indexOf('data: ', doneIdx);
    if (dataIdx === -1) return [];
    const jsonStart = dataIdx + 6;
    const jsonEnd = res.text.indexOf('\n', jsonStart);
    const jsonText = (jsonEnd !== -1 ? res.text.substring(jsonStart, jsonEnd) : res.text.substring(jsonStart)).trim();
    try {
      const data = JSON.parse(jsonText);
      const rows = [];
      if (Array.isArray(data.sources)) {
        for (const src of data.sources) {
          if (!src || typeof src !== 'object') continue;
          const rawUrl = src.url ? String(src.url) : null;
          if (!rawUrl || !rawUrl.startsWith('http')) continue;
          rows.push({ url: rawUrl, quality: src.quality ? String(src.quality) : 'Auto' });
        }
      }
      return { srv, rows };
    } catch (_) {
      return [];
    }
  }));

  for (const r of results) {
    if (!r || !r.rows) continue;
    for (const row of r.rows) {
      const qLabel = row.quality !== 'Auto' ? ' (' + row.quality + ')' : '';
      out.push({
        provider: 'MovieNight',
        title: 'MovieNight ' + r.srv.label + qLabel,
        format: 'HLS',
        quality: row.quality !== 'Auto' ? row.quality : null,
        description: 'MovieNight · ' + r.srv.label + ' · Quality: ' + row.quality + ' HLS',
        url: row.url,
        headers: { 'User-Agent': UA, Referer: BASE + '/' }
      });
    }
  }
  return out;
}

// ── enc-dec.app helpers (MeowTV / VidUp / Hexa pipelines) ────────────────
async function encDecPost(path, body) {
  return fetchJson('https://enc-dec.app/api' + path, {
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    timeoutMs: 10000,
    method: 'POST',
    body: JSON.stringify(body)
  });
}

// ── MeowTV (Helix meowtv.dart: api.meowtv.ru + dec-meowtv) ───────────────
async function scrapeMeowTv(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;
  const path = ctx.isTv
    ? '/streams/tv/' + ctx.tmdbId + '/' + (ctx.season ?? 1) + '/' + (ctx.episode ?? 1) + '?s=hindiv3'
    : '/streams/movie/' + ctx.tmdbId + '?s=hindiv3';
  const payload = await fetchJson('https://api.meowtv.ru' + path, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      Referer: 'https://meowtv.ru/',
      Origin: 'https://meowtv.ru',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  if (payload == null) return out;

  const dec = await encDecPost('/dec-meowtv', { data: payload });
  if (!dec || dec.status !== 200 || dec.result == null) return out;
  let data = dec.result;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (_) { return out; }
  }
  if (!data || typeof data !== 'object') return out;

  const urls = [];
  if (data.url && String(data.url).startsWith('http')) urls.push(String(data.url));
  if (Array.isArray(data.streams)) {
    for (const st of data.streams) {
      if (st && st.url && String(st.url).startsWith('http')) urls.push(String(st.url));
    }
  }

  for (const u of urls) {
    out.push({
      provider: 'MeowTV',
      title: 'MeowTV · Hindiv3 · 1080p',
      format: fmtOf(u),
      quality: '1080p',
      description: 'MeowTV Stream · ' + fmtOf(u),
      url: u,
      headers: { 'User-Agent': UA, Referer: 'https://meowtv.ru/', Origin: 'https://meowtv.ru' }
    });
  }
  return out;
}

// ── VidUp (Helix vidup.to: enc-vidup/dec-vidup multi-CDN chain) ──────────
async function scrapeVidUp(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;
  const DOMAIN = 'https://vidup.to';
  const DEFAULT_HEADERS = {
    'User-Agent': UA,
    Referer: DOMAIN + '/',
    Origin: DOMAIN,
    'X-Requested-With': 'XMLHttpRequest'
  };

  const embedUrl = ctx.isTv
    ? DOMAIN + '/tv/' + ctx.tmdbId + '/' + (ctx.season ?? 1) + '/' + (ctx.episode ?? 1) + '/'
    : DOMAIN + '/movie/' + ctx.tmdbId + '/';
  const html = await fetchText(embedUrl, { headers: { 'User-Agent': UA, Referer: DOMAIN + '/' }, timeoutMs: 10000 });
  if (!html) return out;

  let m = /\\\\"(?:en|token)\\\\":\\\\"(.*?)\\\\"/.exec(html);
  if (!m) m = /"(?:en|token)":"(.*?)"/.exec(html);
  if (!m) return out;
  const rawToken = m[1];

  const enc = await fetchJson('https://enc-dec.app/api/enc-vidup?text=' + encodeURIComponent(rawToken), {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    timeoutMs: 10000
  });
  if (!enc || enc.status !== 200 || !enc.result) return out;
  const serversUrl = enc.result.servers ? String(enc.result.servers) : null;
  const streamUrl = enc.result.stream ? String(enc.result.stream) : null;
  const csrfToken = enc.result.token ? String(enc.result.token) : null;
  if (!serversUrl || !streamUrl || !csrfToken) return out;

  const reqHeaders = { ...DEFAULT_HEADERS, 'X-CSRF-Token': csrfToken };

  const serversRes = await fetchRaw(serversUrl, { headers: reqHeaders, timeoutMs: 10000 });
  if (!serversRes.ok || serversRes.text == null) return out;
  const decServers = await encDecPost('/dec-vidup', { text: serversRes.text });
  if (!decServers || decServers.status !== 200 || !Array.isArray(decServers.result)) return out;

  const resolved = await Promise.all(decServers.result.map(async (srv) => {
    try {
      if (!srv || typeof srv !== 'object') return null;
      const srvName = srv.name ? String(srv.name) : 'Server';
      const srvData = srv.data ? String(srv.data) : null;
      if (!srvData) return null;
      const sRes = await fetchRaw(streamUrl + '/' + srvData, { headers: reqHeaders, timeoutMs: 10000 });
      if (!sRes.ok || sRes.text == null) return null;
      const dec = await encDecPost('/dec-vidup', { text: sRes.text });
      if (!dec || dec.status !== 200 || !dec.result) return null;
      const finalUrl = dec.result.url ? String(dec.result.url) : null;
      if (!finalUrl || !finalUrl.startsWith('http')) return null;
      return { name: srvName, url: finalUrl };
    } catch (_) {
      return null;
    }
  }));

  for (const item of resolved) {
    if (!item) continue;
    const is4K = item.name.toLowerCase().includes('2160') ||
      item.name.toLowerCase().includes('4k') ||
      item.url.includes('2160p');
    const quality = is4K ? '4K' : '1080p';
    out.push({
      provider: 'VidUp',
      title: 'VidUp · ' + item.name + ' · ' + quality,
      format: fmtOf(item.url),
      quality,
      description: 'VidUp Multi-CDN Stream · ' + quality,
      url: item.url,
      headers: { 'User-Agent': UA, Referer: DOMAIN + '/', Origin: DOMAIN }
    });
  }
  return out;
}

// ── Hexa (Helix hexa.su/flixer.su: challenge token + dec-hexa) ───────────
async function scrapeHexa(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;
  const domains = ['hexa.su', 'flixer.su'];

  const challenge = await fetchJson('https://enc-dec.app/api/enc-hexa', {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    timeoutMs: 6000
  });
  const capToken = challenge && challenge.status === 200 && challenge.result
    ? String(challenge.result.token || '')
    : null;
  if (!capToken) return out;

  const apiKey = crypto.randomBytes(32).toString('hex');

  let decrypted = null;
  for (const domain of domains) {
    const url = ctx.isTv
      ? 'https://theemoviedb.' + domain + '/api/tmdb/tv/' + ctx.tmdbId + '/season/' + (ctx.season ?? 1) + '/episode/' + (ctx.episode ?? 1) + '/images'
      : 'https://theemoviedb.' + domain + '/api/tmdb/movie/' + ctx.tmdbId + '/images';
    const encRes = await fetchRaw(url, {
      headers: {
        'User-Agent': UA,
        Referer: 'https://' + domain + '/',
        Accept: 'text/plain',
        'X-Fingerprint-Lite': 'e9136c41504646444',
        'X-Api-Key': apiKey,
        'X-Cap-Token': capToken
      },
      timeoutMs: 10000
    });
    if (!encRes.ok || !encRes.text) continue;
    const decRes = await encDecPost('/dec-hexa', { text: encRes.text, key: apiKey });
    if (decRes && decRes.status === 200 && decRes.result &&
        Array.isArray(decRes.result.sources) && decRes.result.sources.length) {
      decrypted = decRes.result;
      break;
    }
  }
  if (!decrypted || !Array.isArray(decrypted.sources)) return out;

  for (const src of decrypted.sources) {
    if (!src || typeof src !== 'object') continue;
    const streamUrl = src.url ? String(src.url) : null;
    if (!streamUrl || !streamUrl.startsWith('http')) continue;
    const sName = src.name ? String(src.name) : (src.server ? String(src.server) : 'Server');
    const quality = src.quality ? String(src.quality) : '1080p';
    out.push({
      provider: 'Hexa',
      title: 'Hexa · ' + sName + ' · ' + quality,
      format: fmtOf(streamUrl),
      quality,
      description: 'Hexa Stream · ' + quality,
      url: streamUrl,
      headers: { 'User-Agent': UA, Referer: 'https://hexa.su/' }
    });
  }
  return out;
}

// ── VidRock (Helix vidrock.ru: AES-256-GCM encrypted sources) ────────────
const ROCK_GCM_HEX_KEY = '7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f';

function rockDecrypt(value) {
  try {
    let b64 = String(value).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const data = Buffer.from(b64, 'base64');
    if (data.length < 28) return null;
    const iv = data.subarray(0, 12);
    const tag = data.subarray(data.length - 16);
    const ct = data.subarray(12, data.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(ROCK_GCM_HEX_KEY, 'hex'), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (_) {
    return null;
  }
}

async function scrapeVidRock(ctx) {
  const out = [];
  if (!ctx.tmdbId) return out;
  const BASE = 'https://vidrock.ru/';
  const HEADERS = { 'User-Agent': UA, Referer: BASE, Origin: 'https://vidrock.ru' };

  const path = ctx.isTv
    ? 'api/tv/' + ctx.tmdbId + '/' + (ctx.season ?? 1) + '/' + (ctx.episode ?? 1)
    : 'api/movie/' + ctx.tmdbId;
  const data = await fetchJson(BASE + path, { headers: HEADERS });
  if (!data || typeof data !== 'object') return out;

  for (const [provider, info] of Object.entries(data)) {
    let streamUrl = null;
    if (typeof info === 'string') {
      streamUrl = info.startsWith('http') ? info : rockDecrypt(info);
    } else if (info && typeof info === 'object') {
      const raw = info.url ? String(info.url) : (info.stream ? String(info.stream) : (info.file ? String(info.file) : null));
      if (raw) streamUrl = raw.startsWith('http') ? raw : rockDecrypt(raw);
    }
    if (!streamUrl || !streamUrl.startsWith('http')) continue;

    const push = (url, quality) => {
      out.push({
        provider: 'VidRock',
        title: 'VidRock · ' + provider + ' · ' + (quality || '1080p'),
        format: fmtOf(url),
        quality: quality || '1080p',
        description: 'VidRock Stream · ' + fmtOf(url),
        url,
        headers: { 'User-Agent': UA, Referer: BASE }
      });
    };

    if (streamUrl.includes('/playlist/')) {
      let pText = null;
      try {
        pText = await fetchText(streamUrl, { headers: { 'User-Agent': UA, Referer: BASE }, timeoutMs: 6000 });
      } catch (_) {}
      if (pText && pText.trim().startsWith('[')) {
        try {
          const pList = JSON.parse(pText);
          if (Array.isArray(pList) && pList.length) {
            for (const item of pList) {
              if (item && item.url && String(item.url).startsWith('http')) {
                push(String(item.url), (item.resolution ? String(item.resolution) : '1080') + 'p');
              }
            }
            continue;
          }
        } catch (_) {}
      }
    }
    push(streamUrl, null);
  }
  return out;
}

module.exports = {
  scrapeVixSrc,
  scrapeVidZee,
  scrapeCineSrc,
  scrapeBcine,
  scrapeNova,
  scrapeMegaSource,
  scrapeA111477,
  scrapeFrame,
  scrapePurstream,
  scrapeMovieNight,
  scrapeMeowTv,
  scrapeVidUp,
  scrapeHexa,
  scrapeVidRock,
  generateCryptoHlsUrl,
  cryptoAb,
  cryptoSd,
  cryptoId,
  rockDecrypt,
  encDecPost
};


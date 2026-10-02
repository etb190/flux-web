// ── Flux shared HTTP helpers for stream providers ────────────────────────
// Used by streams.js (original providers) and providers2.js (expanded set).
// All requests register their AbortController here so cancelStreams() from
// streams.js aborts everything, exactly like Helix's ScraperManager.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const activeControllers = new Set();

function fetchPage(url, { headers = {}, timeoutMs = 8000, method, body, redirect } = {}) {
  const controller = new AbortController();
  activeControllers.add(controller);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    headers, signal: controller.signal, method, body,
    redirect: redirect || undefined
  }).finally(() => {
    clearTimeout(timer);
    activeControllers.delete(controller);
  });
}

// set-cookie list from a fetch Response (undici exposes getSetCookie())
function resCookies(res) {
  try {
    if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
    const sc = res.headers.get('set-cookie');
    return sc ? [sc] : [];
  } catch (_) {
    return [];
  }
}

// Pull cookie pairs matching `re` out of a set-cookie array, e.g. /__Host-amri_session=[^;]+/
function cookieOf(cookies, re) {
  const parts = [];
  for (const c of cookies || []) {
    const m = re ? c.match(re) : null;
    if (m) parts.push(m[0]);
    else if (!re) parts.push(c.split(';')[0]);
  }
  return parts.join('; ');
}

async function fetchJson(url, opts) {
  let res;
  try {
    res = await fetchPage(url, opts);
  } catch (_) {
    return null;            // abort / network error / bad DNS
  }
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch (_) {
    return null;
  }
}

async function fetchText(url, opts) {
  let res;
  try {
    res = await fetchPage(url, opts);
  } catch (_) {
    return null;            // abort / network error / bad DNS
  }
  if (!res.ok) return null;
  try {
    return await res.text();
  } catch (_) {
    return null;
  }
}

async function fetchRaw(url, opts) {
  // Returns { ok, status, text } without throwing on HTTP errors
  try {
    const res = await fetchPage(url, opts);
    let text = null;
    try { text = await res.text(); } catch (_) {}
    return { ok: res.ok, status: res.status, text };
  } catch (_) {
    return { ok: false, status: 0, text: null };
  }
}

// Parse human size strings into bytes: "1.4 GB", "700MB", "850 MB", "1.10 GB".
// Returns bytes (number) or null when no size unit is present.
function parseSizeBytes(text) {
  if (text == null) return null;
  const m = /(\d+(?:[.,]\d+)?)\s*(TB|GB|MB|KB)\b/i.exec(String(text));
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = m[2].toUpperCase();
  const mult = u === 'TB' ? 1024 ** 4 : u === 'GB' ? 1024 ** 3 : u === 'MB' ? 1024 ** 2 : 1024;
  return Math.round(n * mult);
}

// Interpret a machine-provided size value: raw byte counts ("1458823504")
// pass through as bytes; unit strings ("700 MB") go through parseSizeBytes.
// Values under 1 MB as bare digits are ambiguous garbage -> null.
function coerceSizeBytes(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n >= 1024 * 1024 ? n : null;
  }
  return parseSizeBytes(s);
}

function fmtOf(url) {
  if (url.includes('.m3u8')) return 'HLS';
  if (url.includes('.mpd')) return 'DASH';
  return 'MP4';
}

// Collapse "same stream, different token" duplicates: same host + first
// path segment + filename (e.g. three master.m3u8 token variants from one
// vaplayer CDN count as ONE source).
function streamKey(url) {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    const file = segs.pop() || '';
    return u.hostname + '/' + (segs[0] || '') + '/' + file;
  } catch (_) {
    return url;
  }
}

function cancelAll() {
  const controllers = activeControllers;
  activeControllers.clear();
  for (const c of controllers) {
    try { c.abort(); } catch (_) {}
  }
}

module.exports = { UA, fetchPage, resCookies, cookieOf, fetchJson, fetchText, fetchRaw, parseSizeBytes, coerceSizeBytes, fmtOf, streamKey, cancelAll };

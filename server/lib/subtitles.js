// ── Flux subtitles: port of Helix's subtitle management system ───────────
// Helix (lib/services/subtitles/*) runs 5 subtitle providers in parallel and
// streams results per provider, then downloads + extracts (ZIP/GZIP) the
// chosen file and re-encodes it to UTF-8. Flux ports the same providers:
//   Wyzie          - sub.wyzie.io search API (direct srt/vtt links)
//   OpenSubtitles  - stremio-compatible endpoints (opensubtitles.strem.io…)
//   Subdl          - api3.subdl.com autocomplete + subdl.com HTML scraping
//   SubtitleCat    - subtitlecat.com scraping + on-the-fly Google translation
// (Helix's 5th provider, StremioAddon, needs an addon manager Flux doesn't
// have yet; OpenSubtitles already covers the same stremio API shape.)
//
// Searches stream back per provider via onBatch(); downloads return the
// subtitle TEXT decoded to UTF-8 (the renderer renders cues itself).

const zlib = require('zlib');
const { fetchPage, fetchText, fetchJson } = require('./http.js');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// iso3/iso2 → English language name (Helix: _iso3ToLangName)
const LANG_NAMES = {
  ara: 'Arabic', ar: 'Arabic', eng: 'English', en: 'English',
  spa: 'Spanish', es: 'Spanish', fre: 'French', fra: 'French', fr: 'French',
  ger: 'German', deu: 'German', de: 'German', ita: 'Italian', it: 'Italian',
  jpn: 'Japanese', ja: 'Japanese', kor: 'Korean', ko: 'Korean',
  rus: 'Russian', ru: 'Russian', por: 'Portuguese', pt: 'Portuguese',
  pob: 'Portuguese (BR)', pb: 'Portuguese (BR)',
  chi: 'Chinese', zho: 'Chinese', zh: 'Chinese', hin: 'Hindi', hi: 'Hindi',
  tur: 'Turkish', tr: 'Turkish', ind: 'Indonesian', id: 'Indonesian',
  vie: 'Vietnamese', vi: 'Vietnamese', tha: 'Thai', th: 'Thai',
  pol: 'Polish', pl: 'Polish', dut: 'Dutch', nld: 'Dutch', nl: 'Dutch',
  swe: 'Swedish', sv: 'Swedish', nor: 'Norwegian', no: 'Norwegian',
  dan: 'Danish', da: 'Danish', fin: 'Finnish', fi: 'Finnish',
  heb: 'Hebrew', he: 'Hebrew', ces: 'Czech', cze: 'Czech', cs: 'Czech',
  ell: 'Greek', gre: 'Greek', el: 'Greek', hun: 'Hungarian', hu: 'Hungarian',
  ron: 'Romanian', rum: 'Romanian', ro: 'Romanian', ukr: 'Ukrainian', uk: 'Ukrainian',
  per: 'Persian', fas: 'Persian', fa: 'Persian',
  hrv: 'Croatian', scr: 'Croatian', hr: 'Croatian',
  bul: 'Bulgarian', bg: 'Bulgarian', est: 'Estonian', et: 'Estonian',
  mac: 'Macedonian', mkd: 'Macedonian', mk: 'Macedonian',
  slv: 'Slovenian', sl: 'Slovenian', srp: 'Serbian', scc: 'Serbian', sr: 'Serbian',
  bos: 'Bosnian', bs: 'Bosnian', alb: 'Albanian', sqi: 'Albanian', sq: 'Albanian',
  slk: 'Slovak', slo: 'Slovak', sk: 'Slovak', lit: 'Lithuanian', lt: 'Lithuanian',
  lav: 'Latvian', lv: 'Latvian', ice: 'Icelandic', isl: 'Icelandic', is: 'Icelandic',
  tam: 'Tamil', ta: 'Tamil', tel: 'Telugu', te: 'Telugu',
  mal: 'Malayalam', ml: 'Malayalam', ben: 'Bengali', bn: 'Bengali',
  fil: 'Tagalog', tgl: 'Tagalog', tl: 'Tagalog',
  msa: 'Malay', may: 'Malay', ms: 'Malay', cat: 'Catalan', ca: 'Catalan'
};

function langName(raw) {
  const key = String(raw || 'en').toLowerCase();
  return LANG_NAMES[key] || (key.length <= 3 ? key.toUpperCase() : key);
}

// ── Subtitle language whitelist (user request) ─────────────────────────
// Only these languages are kept: English, French, Italian, Spanish, Arabic.
// Everything else (including regional variants like pt-BR) is filtered out
// before results reach the player menu.
const SUB_ALLOWED_CODES = new Set(['en', 'fr', 'it', 'es', 'ar']);

// language display name (lowercased) → shortest (iso2) code, e.g. 'english' → 'en'
const NAME_TO_CODE = {};
for (const [code, name] of Object.entries(LANG_NAMES)) {
  const key = name.toLowerCase();
  if (NAME_TO_CODE[key] == null || code.length < NAME_TO_CODE[key].length) {
    NAME_TO_CODE[key] = code;
  }
}

// Normalize a language given as a name or code to its base iso2 code:
// 'English'/'eng'/'en'/'en-US' → 'en', 'Portuguese (BR)' → 'pt',
// unknown names/codes → null. (Also used to canonicalize display names.)
function subLangCode(raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!s) return null;
  const noParen = s.replace(/\s*\([^)]*\)\s*$/, '').trim() || s;
  // base language first, so 'Portuguese (BR)' resolves to 'pt' not 'pb'
  for (const cand of [noParen, s]) {
    if (LANG_NAMES[cand]) return NAME_TO_CODE[LANG_NAMES[cand].toLowerCase()] || cand;
    if (NAME_TO_CODE[cand]) return NAME_TO_CODE[cand];
  }
  const m = /^([a-z]{2,3})(?:[-_][a-z0-9]{2,4})?$/.exec(noParen);
  if (m) {
    const base = m[1];
    if (LANG_NAMES[base]) return NAME_TO_CODE[LANG_NAMES[base]] || base;
    if (base.length === 2) return base;
  }
  return null;
}

// Keep only whitelisted languages; canonicalizes the display name so
// 'eng', 'en-US' and 'English' all collapse into one 'English' group.
function filterLangVariants(variants) {
  const out = [];
  for (const v of variants || []) {
    if (!v) continue;
    const code = subLangCode(v.language);
    if (!code || !SUB_ALLOWED_CODES.has(code)) continue;
    const canonical = LANG_NAMES[code];
    out.push(v.language === canonical ? v : Object.assign({}, v, { language: canonical }));
  }
  return out;
}

// ── SubtitleCat Google translation engine (Helix SubtitleCatService) ──────
const srtTranslateCache = new Map();   // "origUrl|lang" -> srt text
const srtTranslateInflight = new Map();

// SubtitleCat language label map (subset the site actually uses)
const CAT_LANG_LABELS = {
  af: 'Afrikaans', sq: 'Albanian', ar: 'Arabic', hy: 'Armenian',
  az: 'Azerbaijani', eu: 'Basque', bn: 'Bengali', bs: 'Bosnian',
  bg: 'Bulgarian', ca: 'Catalan', zh: 'Chinese', 'zh-cn': 'Chinese (S)',
  'zh-tw': 'Chinese (T)', hr: 'Croatian', cs: 'Czech', da: 'Danish',
  nl: 'Dutch', en: 'English', et: 'Estonian', fi: 'Finnish', fr: 'French',
  gl: 'Galician', ka: 'Georgian', de: 'German', el: 'Greek', gu: 'Gujarati',
  he: 'Hebrew', iw: 'Hebrew', hi: 'Hindi', hu: 'Hungarian', is: 'Icelandic',
  id: 'Indonesian', in: 'Indonesian', ga: 'Irish', it: 'Italian',
  ja: 'Japanese', jv: 'Javanese', jw: 'Javanese', kn: 'Kannada',
  kk: 'Kazakh', ko: 'Korean', ku: 'Kurdish', lv: 'Latvian', lt: 'Lithuanian',
  mk: 'Macedonian', ms: 'Malay', ml: 'Malayalam', mt: 'Maltese',
  mr: 'Marathi', mn: 'Mongolian', ne: 'Nepali', no: 'Norwegian',
  or: 'Oriya', ps: 'Pashto', fa: 'Persian', pl: 'Polish', pt: 'Portuguese',
  'pt-br': 'Portuguese (BR)', pa: 'Punjabi', ro: 'Romanian', ru: 'Russian',
  sr: 'Serbian', sd: 'Sindhi', si: 'Sinhalese', sk: 'Slovak', sl: 'Slovenian',
  so: 'Somali', es: 'Spanish', sw: 'Swahili', sv: 'Swedish', ta: 'Tamil',
  te: 'Telugu', th: 'Thai', tr: 'Turkish', uk: 'Ukrainian', ur: 'Urdu',
  uz: 'Uzbek', vi: 'Vietnamese', cy: 'Welsh', yi: 'Yiddish', zu: 'Zulu'
};

function catLangLabel(code) {
  const c = String(code || '').toLowerCase();
  return CAT_LANG_LABELS[c] || c.toUpperCase();
}

async function gtxTranslateBatch(text, tl) {
  const qs = new URLSearchParams({ client: 'gtx', sl: 'auto', tl, dt: 't', q: text });
  const res = await fetchPage('https://translate.googleapis.com/translate_a/single?' + qs, {
    headers: { 'User-Agent': UA, Accept: '*/*' },
    timeoutMs: 10000
  });
  if (!res.ok) throw new Error('gtx status ' + res.status);
  const body = await res.json();
  if (!Array.isArray(body) || !Array.isArray(body[0])) return '';
  let out = '';
  for (const seg of body[0]) {
    if (Array.isArray(seg) && typeof seg[0] === 'string') out += seg[0];
  }
  return out;
}

// Translate an SRT (Helix: _translateSrtInternal — batches ≤500 chars,
// 8 workers, number/timestamp lines pass through, failures keep the source)
async function translateSrt(origUrl, targetLang) {
  const key = origUrl + '|' + targetLang;
  if (srtTranslateCache.has(key)) return srtTranslateCache.get(key);
  if (srtTranslateInflight.has(key)) return srtTranslateInflight.get(key);

  const job = (async () => {
    const raw = await fetchText(origUrl, {
      headers: { 'User-Agent': UA, Accept: '*/*' },
      timeoutMs: 15000
    });
    if (raw == null) throw new Error('orig srt download failed');

    const srcLines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const translated = new Array(srcLines.length).fill('');
    const numRe = /^[0-9 \r]*$/;
    const tsRe = /^[0-9,: ]*-->[0-9,: \r]*$/;

    const batches = [];
    const batchIdx = [];
    let cur = '';
    let curChars = 0;
    let curLines = [];

    const flush = () => {
      if (curLines.length || cur.length) {
        batches.push(cur);
        batchIdx.push(curLines);
      }
      cur = '';
      curChars = 0;
      curLines = [];
    };

    for (let i = 0; i < srcLines.length; i++) {
      const line = srcLines[i];
      if (numRe.test(line) || tsRe.test(line)) {
        translated[i] = line;
        continue;
      }
      const cleaned = line
        .replace(/<font[^>]*>/gi, '')
        .replace(/<\/font>/gi, '')
        .replace(/&/g, 'and');
      if (curChars + cleaned.length + 1 < 500) {
        cur = cur ? cur + '\n' + cleaned : cleaned;
        curChars += cleaned.length + 1;
        curLines.push(i);
      } else {
        flush();
        cur = cleaned;
        curChars = cleaned.length + 1;
        curLines = [i];
      }
    }
    flush();

    let next = 0;
    async function worker() {
      while (next < batches.length) {
        const b = next++;
        const text = batches[b];
        const idxs = batchIdx[b];
        if (!idxs.length) continue;
        try {
          const outText = await gtxTranslateBatch(text, targetLang);
          const outLines = outText.split('\n');
          if (outLines.length === idxs.length) {
            for (let k = 0; k < idxs.length; k++) translated[idxs[k]] = outLines[k];
          } else {
            // line-count mismatch → translate line by line
            const pieces = text.split('\n');
            for (let k = 0; k < idxs.length; k++) {
              const src = k < pieces.length ? pieces[k] : '';
              if (!src.trim()) { translated[idxs[k]] = src; continue; }
              try {
                const one = await gtxTranslateBatch(src, targetLang);
                translated[idxs[k]] = one || src;
              } catch (_) {
                translated[idxs[k]] = src;
              }
            }
          }
        } catch (_) {
          const pieces = text.split('\n');
          for (let k = 0; k < idxs.length; k++) {
            translated[idxs[k]] = k < pieces.length ? pieces[k] : '';
          }
        }
      }
    }
    await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(worker));
    return translated.join('\n') + '\n';
  })();

  srtTranslateInflight.set(key, job);
  try {
    const res = await job;
    srtTranslateCache.set(key, res);
    return res;
  } finally {
    srtTranslateInflight.delete(key);
  }
}

// ── Provider: Wyzie (Helix wyzie_provider.dart) ───────────────────────────
const WYZIE_KEY = 'wyzie-2q1gc0ypd8mkisqcw0ijt1b9zjytj7ex';
const WYZIE_HEADERS = {
  'User-Agent': UA,
  Accept: 'application/json',
  'x-api-key': WYZIE_KEY,
  Authorization: 'Bearer ' + WYZIE_KEY
};

async function wyzieSearch({ name, imdbId, season, episode }) {
  const params = { source: 'all', key: WYZIE_KEY };
  if (imdbId) params.id = String(imdbId).startsWith('tt') ? String(imdbId) : 'tt' + imdbId;
  else params.query = name;
  if (season != null) params.season = String(season);
  if (episode != null) params.episode = String(episode);

  const qs = new URLSearchParams(params);
  const data = await fetchJson('https://sub.wyzie.io/search?' + qs, {
    headers: WYZIE_HEADERS,
    timeoutMs: 6000
  });
  if (!Array.isArray(data)) return [];

  const out = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const url = item.url ? String(item.url) : '';
    if (!url) continue;
    const display = item.display ? String(item.display) : '';
    const language = display || langName(item.language ?? item.lang ?? 'en');
    let title = item.release ? String(item.release) : 'Wyzie Subtitle';
    if (item.isHearingImpaired === true || item.hi === true) title += ' [CC]';
    out.push({
      providerName: 'Wyzie',
      language,
      title,
      downloadUrl: url,
      format: String(item.format || 'srt').toLowerCase(),
      extraData: { encoding: item.encoding, fps: item.fps }
    });
  }
  return out;
}

// ── Provider: OpenSubtitles via stremio endpoints (Helix) ─────────────────
const OS_ENDPOINTS = [
  'https://opensubtitles.stremio.homes',
  'https://opensubtitles-v3.strem.io',
  'https://opensubtitles.strem.io'
];

async function opensubtitlesSearch({ imdbId, season, episode }) {
  if (!imdbId) return [];
  const clean = String(imdbId).startsWith('tt') ? String(imdbId) : 'tt' + imdbId;
  const isEpisode = season != null && episode != null;
  const type = isEpisode ? 'series' : 'movie';
  const id = isEpisode ? clean + ':' + season + ':' + episode : clean;

  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  const seen = new Set();
  const out = [];

  for (const base of OS_ENDPOINTS) {
    const data = await fetchJson(base + '/subtitles/' + type + '/' + id + '.json', {
      headers, timeoutMs: 5000
    });
    const list = data && Array.isArray(data.subtitles) ? data.subtitles : null;
    if (!list || !list.length) continue;

    let idx = 0;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const url = item.url ? String(item.url) : '';
      if (!url || seen.has(url)) continue;
      seen.add(url);
      idx++;
      out.push({
        providerName: 'OpenSubtitles',
        language: langName(item.lang ?? 'en'),
        title: 'OpenSubtitles #' + idx,
        downloadUrl: url,
        format: String(item.SubFormat || 'srt').toLowerCase(),
        extraData: { id: item.id, fps: item.fps }
      });
    }
    if (out.length) break;   // first responding endpoint is enough (Helix)
  }
  return out;
}

// ── Provider: Subdl (Helix subdl_provider.dart, HTML via regex) ───────────
function subdlCleanTitle(input, explicitYear) {
  const raw = String(input || '').trim();
  let year = explicitYear || null;
  const normalized = raw.replace(/[._]/g, ' ');

  const yearMatch = /(?:\b|\()((?:19|20)\d{2})(?:\b|\))/.exec(normalized);
  let titlePart = normalized;
  if (yearMatch) {
    if (year == null) year = parseInt(yearMatch[1], 10);
    const before = normalized.slice(0, yearMatch.index).trim();
    if (before) titlePart = before;
  } else {
    const tagMatch = /\b(?:2160p|1080p|1080i|720p|576p|480p|4k|uhd|web-?dl|webrip|bluray|brrip|dvdrip|hdtv|s\d{1,2}e\d{1,2}|season\s*\d{1,2})\b/i.exec(normalized);
    if (tagMatch) {
      const before = normalized.slice(0, tagMatch.index).trim();
      if (before) titlePart = before;
    }
  }
  let clean = titlePart.replace(/[\[\](){}\-:+]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) clean = raw;
  return { cleanTitle: clean, year };
}

function subdlNormalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function subdlFindBestMatch(items, cleanTitle, targetYear, isTvShow) {
  const norm = subdlNormalize(cleanTitle);
  const typeFiltered = items.filter((it) => {
    const type = String(it.type || 'movie').toLowerCase();
    return isTvShow ? type === 'tv' : type === 'movie';
  });
  const candidates = typeFiltered.length ? typeFiltered : items;

  if (targetYear != null) {
    // pass 1: exact title + exact year
    for (const it of candidates) {
      const y = parseInt(it.year, 10);
      if ((subdlNormalize(it.name) === norm || subdlNormalize(it.original_name) === norm) && y === targetYear) return it;
    }
    // pass 2: contained title + exact year
    for (const it of candidates) {
      const n1 = subdlNormalize(it.name);
      const n2 = subdlNormalize(it.original_name);
      const y = parseInt(it.year, 10);
      if ((n1.includes(norm) || norm.includes(n1) || n2.includes(norm) || norm.includes(n2)) && y === targetYear) return it;
    }
    // pass 3: exact title + year ±1
    for (const it of candidates) {
      const n1 = subdlNormalize(it.name);
      const n2 = subdlNormalize(it.original_name);
      const y = parseInt(it.year, 10);
      if (!Number.isNaN(y) && (n1 === norm || n2 === norm) && Math.abs(y - targetYear) <= 1) return it;
    }
    return null;   // Helix: strict when a target year exists
  }

  for (const it of candidates) {
    if (subdlNormalize(it.name) === norm || subdlNormalize(it.original_name) === norm) return it;
  }
  for (const it of candidates) {
    const n1 = subdlNormalize(it.name);
    const n2 = subdlNormalize(it.original_name);
    if (n1.includes(norm) || norm.includes(n1) || n2.includes(norm) || norm.includes(n2)) return it;
  }
  return candidates.length ? candidates[0] : null;
}

const SEASON_WORDS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth',
  'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth',
  'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth',
  'nineteenth', 'twentieth'];

const SUBDL_HEADERS = { 'User-Agent': UA, Accept: 'application/json, text/html, */*' };

async function subdlSearch({ name, imdbId, season, episode, year }) {
  const isTvShow = season != null && episode != null;
  const parsed = subdlCleanTitle(name, year);
  const cleanTitle = parsed.cleanTitle;
  const targetYear = parsed.year;

  const queries = [];
  if (targetYear != null) queries.push(cleanTitle + ' ' + targetYear);
  queries.push(cleanTitle);
  if (imdbId) queries.push(String(imdbId));

  const queryApi = async (q) => {
    const data = await fetchJson('https://api3.subdl.com/auto?query=' + encodeURIComponent(q), {
      headers: SUBDL_HEADERS, timeoutMs: 5000
    });
    const list = data && Array.isArray(data.results) ? data.results : [];
    return list.filter((x) => x && typeof x === 'object');
  };

  const scrapeWeb = async (q) => {
    const html = await fetchText('https://subdl.com/search/' + encodeURIComponent(q), {
      headers: SUBDL_HEADERS, timeoutMs: 6000
    });
    if (html == null) return [];
    const out = [];
    const re = /<a\s+href="(\/subtitle\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html))) {
      const fullText = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!fullText) continue;
      const ym = /\((\d{4})\)/.exec(fullText);
      const isTv = / tv /.test(fullText.toLowerCase()) || fullText.toLowerCase().endsWith(' tv');
      let nm = fullText;
      if (ym) nm = fullText.slice(0, ym.index).trim();
      out.push({
        type: isTv ? 'tv' : 'movie',
        name: nm,
        year: ym ? parseInt(ym[1], 10) : null,
        link: m[1],
        original_name: nm
      });
    }
    return out;
  };

  let best = null;
  for (const q of queries) {
    if (best) break;
    const items = await queryApi(q).catch(() => []);
    if (items.length) best = subdlFindBestMatch(items, cleanTitle, targetYear, isTvShow);
  }
  if (!best) {
    for (const q of queries) {
      if (best) break;
      const web = await scrapeWeb(q).catch(() => []);
      if (web.length) best = subdlFindBestMatch(web, cleanTitle, targetYear, isTvShow);
    }
  }
  if (!best || !best.link) return [];

  let targetUrl = String(best.link).startsWith('http') ? String(best.link) : 'https://subdl.com' + best.link;

  // TV: find the season page on the show page (Helix)
  if (isTvShow) {
    const showHtml = await fetchText(targetUrl, { headers: SUBDL_HEADERS, timeoutMs: 5000 });
    if (showHtml != null) {
      const seasonWord = SEASON_WORDS[season] || String(season);
      const re = /<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = re.exec(showHtml))) {
        if (!/\/subtitle\//.test(m[1])) continue;
        const text = m[2].replace(/<[^>]+>/g, '').trim().toLowerCase();
        const href = m[1].toLowerCase();
        if (text.includes('season ' + season) ||
            text.includes(seasonWord + ' season') ||
            href.endsWith('/season-' + season) ||
            href.endsWith('/' + seasonWord + '-season')) {
          targetUrl = m[1].startsWith('http') ? m[1] : 'https://subdl.com' + m[1];
          break;
        }
      }
    }
  }

  // Scrape the final page (movie or season page)
  const html = await fetchText(targetUrl, { headers: SUBDL_HEADERS, timeoutMs: 6000 });
  if (html == null) return [];

  const out = [];
  const langSplit = /<div[^>]*data-language-name="([^"]*)"[^>]*>/gi;
  const marks = [];
  let lm;
  while ((lm = langSplit.exec(html))) marks.push({ lang: lm[1], start: langSplit.lastIndex });
  for (let i = 0; i < marks.length; i++) {
    // cut the section at the next data-language-name div (or end of page)
    const nextIdx = (() => {
      const reNext = /<div[^>]*data-language-name=/gi;
      reNext.lastIndex = marks[i].start;
      const nx = reNext.exec(html);
      return nx ? nx.index : html.length;
    })();
    const section = html.slice(marks[i].start, nextIdx);
    const language = marks[i].lang || 'Unknown';

    const liRe = /<li[^>]*data-row[^>]*>([\s\S]*?)<\/li>/gi;
    let li;
    while ((li = liRe.exec(section))) {
      const rowHtml = li[0];

      if (isTvShow) {
        const epFrom = (rowHtml.match(/data-episode-from="(\d+)"/) || [])[1];
        const epTo = (rowHtml.match(/data-episode-to="(\d+)"/) || [])[1];
        let match = false;
        if (epFrom) {
          const from = parseInt(epFrom, 10);
          const to = epTo ? parseInt(epTo, 10) : from;
          if (episode >= from && episode <= to) match = true;
        }
        if (!match) {
          const h4 = (rowHtml.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i) || [])[1] || '';
          const titleText = h4.replace(/<[^>]+>/g, '');
          const epRe = new RegExp('\\b(?:s\\d{1,2})?e0*' + episode + '(?:[^\\d]|$)', 'i');
          if (epRe.test(titleText)) match = true;
        }
        if (!match) continue;
      }

      const aMatch =
        rowHtml.match(/<a[^>]*href="(https?:\/\/dl\.subdl\.com[^"]+|[^"]*dl\.subdl\.com[^"]*)"/i) ||
        rowHtml.match(/<a[^>]*href="([^"]*\.zip[^"]*)"/i) ||
        rowHtml.match(/<a[^>]*href="(\/subtitle\/[^"]+)"[^>]*title="[^"]*Download[^"]*"/i) ||
        rowHtml.match(/<a[^>]*href="(\/subtitle\/[^"]+)"/i);
      const titleMatch = rowHtml.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i) || rowHtml.match(/<a[^>]*>([\s\S]*?)<\/a>/i);

      if (aMatch && titleMatch) {
        let dl = aMatch[1];
        if (!dl.startsWith('http')) dl = 'https://subdl.com' + dl;
        const title = titleMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || 'Subtitle';
        out.push({
          providerName: 'Subdl',
          language,
          title,
          downloadUrl: dl,
          format: 'zip',
          extraData: {}
        });
      }
    }
  }
  return out;
}

// ── Provider: SubtitleCat (Helix subtitlecat_service.dart) ────────────────
const CAT_HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

function catBuildQuery({ name, year, season, episode }) {
  const title = String(name || '').replace(/\s+/g, ' ').trim();
  if (season != null && episode != null) {
    const s = String(season).padStart(2, '0');
    const e = String(episode).padStart(2, '0');
    return title + ' S' + s + 'E' + e;
  }
  if (year != null && year > 0) return title + ' ' + year;
  return title;
}

const catSearchCache = new Map();
const catDetailCache = new Map();

async function catSearch({ name, year, season, episode }) {
  const query = catBuildQuery({ name, year, season, episode });
  if (catSearchCache.has(query)) return catSearchCache.get(query);

  const html = await fetchText('https://www.subtitlecat.com/index.php?search=' + encodeURIComponent(query), {
    headers: CAT_HEADERS, timeoutMs: 10000
  });
  if (html == null) return [];

  const hits = [];
  const seen = new Set();
  const re = /<a\s+href="(subs\/(\d+)\/([^"]+\.html))"[^>]*>([^<]*)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (!seen.add(m[1])) continue;
    hits.push({ detailUrl: 'https://www.subtitlecat.com/' + m[1], title: m[4].replace(/<[^>]+>/g, '').trim() });
  }
  catSearchCache.set(query, hits);
  return hits;
}

function catParseDetail(html) {
  const directs = [];
  const directCodes = new Set();
  const dlRe = /<a\s+id="download_([A-Za-z0-9-]+)"[^>]*href="\/subs\/\d+\/[^"]+\.srt"/gi;
  let m;
  while ((m = dlRe.exec(html))) {
    const code = m[1];
    const hrefMatch = /href="([^"]+\.srt)"/i.exec(html.slice(m.index, m.index + 300));
    if (!hrefMatch) continue;
    const norm = { iw: 'he', jw: 'jv', in: 'id' }[code.toLowerCase()] || code.toLowerCase();
    directs.push({
      code: norm,
      label: catLangLabel(code),
      url: 'https://www.subtitlecat.com' + hrefMatch[1]
    });
    directCodes.add(norm);
  }

  const translatables = [];
  let folder = '';
  let origFilename = '';
  const trRe = /translate_from_server_folder\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/gi;
  while ((m = trRe.exec(html))) {
    const code = m[1];
    origFilename = m[2];
    folder = m[3];
    const norm = { iw: 'he', jw: 'jv', in: 'id' }[code.toLowerCase()] || code.toLowerCase();
    if (directCodes.has(norm)) continue;
    translatables.push({ code: norm, label: catLangLabel(code) });
  }

  if (!folder && directs.length) {
    try {
      const href = new URL(directs[0].url).pathname;
      const lastSlash = href.lastIndexOf('/');
      folder = href.slice(0, lastSlash + 1);
      const fname = href.slice(lastSlash + 1);
      origFilename = fname.replace(/-([A-Za-z0-9-]+)\.srt$/i, '') + '-orig.srt';
    } catch (_) {}
  }

  const baseName = origFilename.replace(/-orig\.srt$/i, '');
  return { directs, translatables, folder, origFilename, baseName };
}

async function subtitlecatSearch({ name, year, season, episode }) {
  try {
    const hits = await catSearch({ name, year, season, episode });
    if (!hits.length) return [];
    const picks = hits.slice(0, 8);

    const details = await Promise.all(picks.map(async (h) => {
      if (catDetailCache.has(h.detailUrl)) return catDetailCache.get(h.detailUrl);
      const html = await fetchText(h.detailUrl, { headers: CAT_HEADERS, timeoutMs: 8000 });
      if (html == null) return null;
      const parsed = catParseDetail(html);
      catDetailCache.set(h.detailUrl, parsed);
      return parsed;
    }));

    const out = [];
    const seenDirect = new Set();
    const translatedLangs = new Set();
    const baseNameFallback = String(name || '');

    for (const detail of details) {
      if (!detail) continue;
      for (const ln of detail.directs) {
        if (!seenDirect.add(ln.url)) continue;
        const base = detail.baseName || baseNameFallback;
        out.push({
          providerName: 'SubtitleCat',
          language: ln.label,
          title: base + ' - ' + ln.label,
          downloadUrl: ln.url,
          format: 'srt',
          extraData: { isTranslate: false }
        });
      }
      for (const ln of detail.translatables) {
        if (translatedLangs.has(ln.code)) continue;
        if (detail.directs.some((d) => d.code === ln.code)) continue;
        translatedLangs.add(ln.code);
        const origUrl = 'https://www.subtitlecat.com' + detail.folder + detail.origFilename;
        const base = detail.baseName || baseNameFallback;
        out.push({
          providerName: 'SubtitleCat',
          language: ln.label,
          title: base + ' - ' + ln.label + ' (Auto Translated)',
          downloadUrl: origUrl,
          format: 'srt',
          extraData: { isTranslate: true, origUrl, targetLang: ln.code }
        });
      }
    }
    return out;
  } catch (_) {
    return [];
  }
}

// ── Search orchestration (Helix SubtitleService.streamSubtitles) ──────────
const activeControllers = new Set();

function timeoutWrap(promise, ms, providerName) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => {
      console.log('[SubtitleService] ' + providerName + ' search timed out (' + ms / 1000 + 's)');
      resolve([]);
    }, ms))
  ]);
}

// Search all providers concurrently; emit each provider's results as soon as
// they arrive (onBatch(variants, providerName)), then onDone(total).
async function searchSubtitles(params, { onBatch, onDone } = {}) {
  const providers = [
    { name: 'Wyzie', fn: wyzieSearch, timeout: 6000 },
    { name: 'SubtitleCat', fn: subtitlecatSearch, timeout: 12000 },
    { name: 'OpenSubtitles', fn: opensubtitlesSearch, timeout: 6000 },
    { name: 'Subdl', fn: subdlSearch, timeout: 9000 }
  ];

  let pending = providers.length;
  let total = 0;

  await Promise.all(providers.map(async (p) => {
    try {
      const found = await timeoutWrap(p.fn(params || {}), p.timeout, p.name);
      const variants = filterLangVariants(found);   // keep en/fr/it/es/ar only
      if (variants.length && onBatch) {
        total += variants.length;
        onBatch(variants, p.name);
      }
    } catch (e) {
      console.log('[SubtitleService] ' + p.name + ' search error: ' + (e && e.message));
    } finally {
      pending--;
      if (pending <= 0 && onDone) onDone(total);
    }
  }));

  return total;
}

// Helix SubtitleService.groupVariantsByLanguage: dedupe URLs, group + sort
function groupVariantsByLanguage(variants) {
  const grouped = new Map();
  const seen = new Set();
  for (const v of variants) {
    const key = String(v.downloadUrl).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const lang = String(v.language || 'Unknown');
    if (!grouped.has(lang)) grouped.set(lang, []);
    grouped.get(lang).push(v);
  }
  return [...grouped.keys()].sort().map((lang) => ({ language: lang, variants: grouped.get(lang) }));
}

// ── Extraction (Helix SubtitleExtractor) ──────────────────────────────────

// Minimal ZIP reader: pick the largest subtitle file (skip macOS junk).
function zipExtractSubtitle(buf) {
  let eocd = -1;
  const scanFrom = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= scanFrom; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;

  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  let best = null;

  for (let n = 0; n < count && ptr + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const name = buf.slice(ptr + 46, ptr + 46 + nameLen).toString('utf8');
    ptr += 46 + nameLen + extraLen + commentLen;

    const lower = name.toLowerCase();
    if (lower.includes('__macosx') || lower.split('/').pop().startsWith('._') || lower.endsWith('.ds_store')) continue;
    if (!/\.(srt|vtt|ass|sub)$/.test(lower)) continue;

    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const data = buf.slice(dataStart, dataStart + compSize);
    let content;
    if (method === 0) {
      content = Buffer.from(data);
    } else if (method === 8) {
      try { content = zlib.inflateRawSync(data); } catch (_) { continue; }
    } else {
      continue;
    }
    if (!best || content.length > best.content.length) best = { name, content };
  }
  return best;
}

// Helix SubtitleParser.decodeBytesWithFallback: UTF-8 BOM → UTF-8 →
// UTF-16 LE/BE BOM → Latin-1
function decodeSubtitleBytes(buf) {
  if (!buf || !buf.length) return '';
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString('utf8');
  }
  // strict UTF-8: replaced chars re-encode to different bytes than input
  const asUtf8 = buf.toString('utf8');
  if (Buffer.from(asUtf8, 'utf8').equals(buf)) return asUtf8;
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.slice(2).toString('utf16le');
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    let swap = Buffer.from(buf.slice(2));
    if (swap.length % 2) swap = swap.slice(0, swap.length - 1);
    try { swap.swap16(); return swap.toString('utf16le'); } catch (_) { return asUtf8; }
  }
  return buf.toString('latin1');
}

// Download a subtitle variant → returns { content, format } or null.
// Helix: provider-specific download (Wyzie / SubtitleCat translate) first,
// then the generic extractor (ZIP/GZIP/plain + encoding fallback).
async function downloadSubtitle(variant) {
  if (!variant || !variant.downloadUrl) return null;
  const url = String(variant.downloadUrl);
  const extra = variant.extraData || {};

  // SubtitleCat auto-translated variant → Google-translate the original SRT
  if (variant.providerName === 'SubtitleCat' && extra.isTranslate === true) {
    try {
      const content = await translateSrt(extra.origUrl || url, extra.targetLang || 'en');
      if (content) return { content, format: 'srt' };
    } catch (_) {
      return null;
    }
  }

  const headers = { 'User-Agent': UA, Accept: '*/*' };
  if (url.includes('subdl.com')) headers.Referer = 'https://subdl.com/';
  if (variant.providerName === 'Wyzie') Object.assign(headers, WYZIE_HEADERS);
  if (extra.headers && typeof extra.headers === 'object') {
    for (const [k, v] of Object.entries(extra.headers)) headers[k] = String(v);
  }

  let buf;
  try {
    const controller = new AbortController();
    activeControllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timer);
    activeControllers.delete(controller);
    if (!res.ok) {
      console.log('[SubtitleExtractor] Download failed for ' + url + ' (Status: ' + res.status + ')');
      return null;
    }
    buf = Buffer.from(await res.arrayBuffer());
  } catch (_) {
    activeControllers.clear();
    return null;
  }
  if (!buf.length) return null;

  let extracted = null;
  let format = 'srt';

  // ZIP magic: PK\x03\x04
  if (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b) {
    const inner = zipExtractSubtitle(buf);
    if (inner) {
      extracted = inner.content;
      const lower = inner.name.toLowerCase();
      if (lower.endsWith('.vtt')) format = 'vtt';
      else if (lower.endsWith('.ass')) format = 'ass';
    }
  } else if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    // GZIP magic
    try {
      extracted = zlib.gunzipSync(buf);
      format = /\.vtt/i.test(url) ? 'vtt' : 'srt';
    } catch (_) {}
  }

  if (!extracted) extracted = buf;   // plain body
  if (/\.vtt($|\?)/i.test(url)) format = 'vtt';
  else if (/\.ass($|\?)/i.test(url)) format = 'ass';

  return { content: decodeSubtitleBytes(extracted), format };
}

function cancelSubtitles() {
  const list = [...activeControllers];
  activeControllers.clear();
  for (const c of list) {
    try { c.abort(); } catch (_) {}
  }
}

module.exports = {
  searchSubtitles,
  groupVariantsByLanguage,
  downloadSubtitle,
  cancelSubtitles,
  translateSrt,
  zipExtractSubtitle,
  decodeSubtitleBytes,
  langName,
  subLangCode,
  filterLangVariants,
  SUB_ALLOWED_CODES
};

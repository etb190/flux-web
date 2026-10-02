/* ── Subtitle parsing — verbatim port of the Helix subtitle_parser.dart ──
 * Plus the language whitelist (en/fr/it/es/ar) used by both external
 * providers and embedded HLS WebVTT tracks.
 * Cues: {start, end, text} — seconds, text already cleaned.
 */

const SUB_LANG_CODES = {
  en: 'English', eng: 'English',
  fr: 'French', fra: 'French', fre: 'French',
  it: 'Italian', ita: 'Italian',
  es: 'Spanish', spa: 'Spanish', esp: 'Spanish',
  ar: 'Arabic', ara: 'Arabic'
};

const SUB_LANG_NAMES = {
  english: 'English', french: 'French',
  italian: 'Italian', spanish: 'Spanish', arabic: 'Arabic'
};

// Match a language name or code ('en', 'eng', 'es-419', 'English') against
// the whitelist; returns the canonical English name or null.
export function subLangLabel(raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!s) return null;
  const noParen = s.replace(/\s*\([^)]*\)\s*$/, '').trim() || s;
  for (const cand of [s, noParen]) {
    if (SUB_LANG_NAMES[cand]) return SUB_LANG_NAMES[cand];
    if (SUB_LANG_CODES[cand]) return SUB_LANG_CODES[cand];
  }
  const m = /^([a-z]{2,3})(?:[-_][a-z0-9]{2,4})?$/.exec(noParen);
  if (m && SUB_LANG_CODES[m[1]]) return SUB_LANG_CODES[m[1]];
  return null;
}

export function subDetectFormat(text) {
  const head = text.slice(0, 300).trim().toLowerCase();
  if (head.startsWith('webvtt')) return 'vtt';
  if (head.includes('[script info]') || head.includes('[v4+ styles]') ||
      text.toLowerCase().includes('[events]')) return 'ass';
  return 'srt';
}

function subCleanInline(s) {
  return s
    .replace(/<[^>]+>/g, '')            // HTML tags like <i>, <b>, <font>
    .replace(/\{[^}]*\}/g, '')          // ASS formatting
    .replace(/\\N/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function subToSec(h, m, s, ms) {
  const paddedMs = (ms + '000').substring(0, 3);
  return (parseInt(h, 10) || 0) * 3600 + (parseInt(m, 10) || 0) * 60 +
    (parseInt(s, 10) || 0) + (parseInt(paddedMs, 10) || 0) / 1000;
}

function subParseSrt(text) {
  const cues = [];
  const blocks = text.split(/\n{2,}/);
  const timingRe = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim());
    if (lines.length < 2) continue;
    let timingIdx = /^\d+$/.test(lines[0].trim()) ? 1 : 0;
    if (timingIdx >= lines.length) continue;
    const m = timingRe.exec(lines[timingIdx]);
    if (!m) continue;
    const start = subToSec(m[1], m[2], m[3], m[4]);
    const end = subToSec(m[5], m[6], m[7], m[8]);
    const cleanText = subCleanInline(lines.slice(timingIdx + 1).join('\n'));
    if (cleanText) cues.push({ start, end, text: cleanText });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

function subParseVtt(text) {
  const cues = [];
  const stripped = text.replace(/^WEBVTT[^\n]*\n+/i, '');
  const blocks = stripped.split(/\n{2,}/);
  const timingRe = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim());
    if (!lines.length) continue;
    let timingIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) { timingIdx = i; break; }
    }
    if (timingIdx === -1) continue;
    const m = timingRe.exec(lines[timingIdx]);
    if (!m) continue;
    const start = subToSec(m[1] || '0', m[2], m[3], m[4]);
    const end = subToSec(m[5] || '0', m[6], m[7], m[8]);
    const cleanText = subCleanInline(lines.slice(timingIdx + 1).join('\n'));
    if (cleanText) cues.push({ start, end, text: cleanText });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

function subParseAssTime(s) {
  const m = /(\d+):(\d{2}):(\d{2})\.(\d{1,3})/.exec(String(s).trim());
  if (!m) return NaN;
  return subToSec(m[1], m[2], m[3], (m[4] + '00').substring(0, 3));
}

function subParseAss(text) {
  const cues = [];
  const eventsIdx = text.toLowerCase().indexOf('[events]');
  if (eventsIdx === -1) return cues;
  const lines = text.slice(eventsIdx).split('\n');
  let format = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^format:/i.test(trimmed)) {
      format = trimmed.slice(7).split(',').map((s) => s.trim().toLowerCase());
      continue;
    }
    if (!/^dialogue:/i.test(trimmed) || !format) continue;
    const startIdx = format.indexOf('start');
    const endIdx = format.indexOf('end');
    const textIdx = format.indexOf('text');
    if (startIdx === -1 || endIdx === -1 || textIdx === -1) continue;

    // split respecting that text is the last field (may contain commas)
    const body = trimmed.slice(9);
    const parts = [];
    let buf = '';
    let count = 0;
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === ',' && count < format.length - 1) {
        parts.push(buf.trim());
        buf = '';
        count++;
      } else {
        buf += c;
      }
    }
    parts.push(buf);
    if (parts.length < format.length) continue;

    const start = subParseAssTime(parts[startIdx]);
    const end = subParseAssTime(parts[endIdx]);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    const cleanText = parts[textIdx]
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N/g, '\n')
      .replace(/\\n/g, ' ')
      .replace(/\\h/g, ' ')
      .trim();
    if (cleanText) cues.push({ start, end, text: cleanText });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

export function subParse(text, format) {
  const raw = String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const fmt = format || subDetectFormat(raw);
  if (fmt === 'vtt') return subParseVtt(raw);
  if (fmt === 'ass') return subParseAss(raw);
  return subParseSrt(raw);
}

// exported for the unit tests
export { subCleanInline, subParseAss, subParseSrt, subParseVtt };

// Binary search: index of the cue active at t, or -1 (Helix findActiveCueIndex)
export function findActiveCueIndex(cues, t) {
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = cues[mid];
    if (t < c.start) hi = mid - 1;
    else if (t >= c.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

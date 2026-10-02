/* ── Formatting helpers shared across components ───────────────────────── */

export const GB = 1024 * 1024 * 1024;

export function fmtSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes >= GB) return (bytes / GB).toFixed(2) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

export function fmtTime(t) {
  if (!Number.isFinite(t) || t < 0) return '0:00';
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) +
    ':' + String(s).padStart(2, '0');
}

export function fmtDelay(d) {
  const sign = d > 0 ? '+' : d < 0 ? '\u2212' : '';
  return sign + Math.abs(d).toFixed(1) + 's';
}

export function formatAirDate(released) {
  if (!released) return '';
  const d = new Date(released);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/* Helix pattern: one season with 50+ episodes → 50-episode tabs */
export const EP_BATCH_SIZE = 50;

export function buildSeasonTabs(videos) {
  const bySeason = new Map();
  for (const v of videos) {
    const s = v.season ?? 1;
    if (!bySeason.has(s)) bySeason.set(s, []);
    bySeason.get(s).push(v);
  }
  for (const list of bySeason.values()) {
    list.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
  }

  const numeric = [...bySeason.keys()].filter((s) => s > 0).sort((a, b) => a - b);
  const hasSpecials = bySeason.has(0);

  const tabs = [];
  if (numeric.length === 1 && !hasSpecials &&
      bySeason.get(numeric[0]).length >= EP_BATCH_SIZE) {
    const eps = bySeason.get(numeric[0]);
    for (let i = 0; i < eps.length; i += EP_BATCH_SIZE) {
      const batch = eps.slice(i, i + EP_BATCH_SIZE);
      tabs.push({
        label: 'Episodes ' + batch[0].episode + '\u2013' + batch[batch.length - 1].episode,
        episodes: batch
      });
    }
  } else {
    for (const s of numeric) {
      tabs.push({ label: 'Season ' + s, episodes: bySeason.get(s) });
    }
    if (hasSpecials) {
      tabs.push({ label: 'Specials', episodes: bySeason.get(0) });
    }
  }
  return tabs;
}

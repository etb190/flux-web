// ── Flux library: watch history + watched list (main process) ────────────
// Two collections persisted to userData/flux-library.json:
//
//   history  — "Continue watching". Written automatically every time a
//              source starts playing (openPlayer). One entry per title
//              (imdbId + type); re-watching updates the season/episode
//              and moves it to the front. Caps at HISTORY_CAP entries.
//              Entry: { imdbId, type, title, poster, season, episode,
//                       updatedAt }
//
//   watched  — the manual "Watched" list the user curates in the sidebar
//              (search → add). Drives the TMDB suggestion rows on the
//              home page. Entry: { imdbId, type, title, poster, genres,
//                       addedAt }
//
// Pure Node module: the server passes the file path, so
// it stays unit-testable from plain Node.

const fs = require('fs');
const path = require('path');

const HISTORY_CAP = 50;

// ── Validation / normalization ────────────────────────────────────────────

function normalizeType(t) {
  return t === 'series' ? 'series' : 'movie';
}

function normalizeInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const imdbId = String(raw.imdbId || '').trim();
  if (!/^tt\d{5,}$/.test(imdbId)) return null;   // Cinemeta ids are tt-ids
  const entry = {
    imdbId,
    type: normalizeType(raw.type),
    title: String(raw.title || '').slice(0, 300) || 'Unknown',
    poster: raw.poster ? String(raw.poster).slice(0, 600) : null
  };
  return entry;
}

// ── Disk layer ────────────────────────────────────────────────────────────

function loadLibrary(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const history = Array.isArray(parsed.history) ? parsed.history : [];
    const watched = Array.isArray(parsed.watched) ? parsed.watched : [];
    return { history, watched };
  } catch (_) {
    return { history: [], watched: [] };
  }
}

function saveLibrary(file, lib) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(lib, null, 2) + '\n', 'utf8');
  } catch (e) {
    throw new Error('Could not save library: ' + (e && e.message));
  }
}

// ── Watch history ("Continue watching") ───────────────────────────────────

function listHistory(file) {
  return loadLibrary(file).history;
}

// Upsert: one entry per imdbId (+type); a replay updates S/E + timestamp
// and moves the entry to the front (most recent first).
function addHistory(file, raw) {
  const entry = normalizeEntry(raw);
  if (!entry) throw new Error('Invalid history entry.');

  const lib = loadLibrary(file);
  const isSeries = entry.type === 'series';

  const rec = {
    ...entry,
    season: isSeries ? normalizeInt(raw.season) || 1 : null,
    episode: isSeries ? normalizeInt(raw.episode) || 1 : null,
    updatedAt: Date.now()
  };

  lib.history = lib.history.filter(
    (h) => !(h.imdbId === rec.imdbId && h.type === rec.type)
  );
  lib.history.unshift(rec);
  if (lib.history.length > HISTORY_CAP) {
    lib.history.length = HISTORY_CAP;
  }
  saveLibrary(file, lib);
  return listHistory(file);
}

function removeHistory(file, imdbId) {
  const id = String(imdbId || '').trim();
  const lib = loadLibrary(file);
  const before = lib.history.length;
  lib.history = lib.history.filter((h) => h.imdbId !== id);
  const removed = lib.history.length !== before;
  if (removed) saveLibrary(file, lib);
  return { removed, history: lib.history };
}

// ── Watched list (drives the home suggestions) ────────────────────────────

function listWatched(file) {
  return loadLibrary(file).watched;
}

function addWatched(file, raw) {
  const entry = normalizeEntry(raw);
  if (!entry) throw new Error('Invalid watched entry.');

  const lib = loadLibrary(file);
  if (lib.watched.some(
    (w) => w.imdbId === entry.imdbId && w.type === entry.type
  )) {
    return listWatched(file);           // already added — no duplicate
  }

  lib.watched.unshift({
    ...entry,
    genres: Array.isArray(raw.genres)
      ? raw.genres.map((g) => String(g).slice(0, 60)).filter(Boolean).slice(0, 6)
      : [],
    addedAt: Date.now()
  });
  saveLibrary(file, lib);
  return listWatched(file);
}

function removeWatched(file, imdbId) {
  const id = String(imdbId || '').trim();
  const lib = loadLibrary(file);
  const before = lib.watched.length;
  lib.watched = lib.watched.filter((w) => w.imdbId !== id);
  const removed = lib.watched.length !== before;
  if (removed) saveLibrary(file, lib);
  return { removed, watched: lib.watched };
}

module.exports = {
  HISTORY_CAP,
  loadLibrary, saveLibrary,
  listHistory, addHistory, removeHistory,
  listWatched, addWatched, removeWatched
};

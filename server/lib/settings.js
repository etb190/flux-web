// ── Flux settings: persisted app settings (JSON in data/) ────────────────
// Holds the home page credentials: the Streaming Availability API key +
// country and the TMDB v3 key. The web server passes the settings file
// path, which keeps this module unit-testable from plain Node.
//
// Pure module (no framework imports).

const fs = require('fs');
const path = require('path');

// saaApiKey:   Streaming Availability API key for the home page (a working
//              free-tier key ships built in so the home page works out of
//              the box; users can swap in their own via Settings). Keys
//              starting with "motn-key-" use the Movie of the Night gateway,
//              others the RapidAPI one.
// saaCountry:  2-letter country code for the home page catalogs (us, gb, ...).
// tmdbApiKey:  TMDB v3 key for the TMDB-powered home rows (trending + the
//              "Because you watched …" suggestions from the Watched list).
const DEFAULTS = {
  saaApiKey: 'motn-key-v4-dy95VsCjpM1RaqoZkgrvJjUYtPw3o598',
  saaCountry: 'us',
  tmdbApiKey: '19d475b19a2a345b560687918d8ee98b'
};

// settingsVersion 3: the Streaming Availability API key is built in
// (DEFAULTS above). Older files that saved an empty saaApiKey are upgraded
// to the built-in key; v3+ files with an explicitly cleared key (Settings →
// empty field → Save) keep it empty.
const SETTINGS_VERSION = 3;

function normalizeApiKey(value) {
  const v = String(value == null ? '' : value).trim();
  return /^[A-Za-z0-9_-]{10,200}$/.test(v) ? v : '';
}

function normalizeCountry(value) {
  const v = String(value || '').toLowerCase().trim();
  return /^[a-z]{2}$/.test(v) ? v : null;
}

// Apply a settings patch object (already sanitized) onto a settings object.
function applyPatch(settings, parsed) {
  if (!parsed || typeof parsed !== 'object') return;
  if ('saaApiKey' in parsed) {
    settings.saaApiKey = normalizeApiKey(parsed.saaApiKey);
  }
  const country = normalizeCountry(parsed.saaCountry);
  if (country) settings.saaCountry = country;
  if ('tmdbApiKey' in parsed) {
    settings.tmdbApiKey = normalizeApiKey(parsed.tmdbApiKey);
  }
}

// Load settings; missing/corrupt file → defaults.
function loadSettings(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    const settings = { ...DEFAULTS };
    let version = 3;
    if (parsed && typeof parsed === 'object') {
      const v = Number(parsed.settingsVersion);
      version = Number.isFinite(v) && v >= 1 ? Math.floor(v) : 3;
      applyPatch(settings, parsed);
    }

    // One-time migration (see SETTINGS_VERSION above): pre-v3 files with an
    // empty SA key get the new built-in key.
    const needsWrite = version < 3 && !settings.saaApiKey;
    if (needsWrite) {
      settings.saaApiKey = DEFAULTS.saaApiKey;
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(
          file,
          JSON.stringify({ ...settings, settingsVersion: SETTINGS_VERSION }, null, 2) + '\n',
          'utf8'
        );
      } catch (_) { /* non-fatal: still return the migrated settings */ }
    }
    return settings;
  } catch (_) {
    return { ...DEFAULTS };
  }
}

// Merge a patch into the stored settings (validated). Returns the full
// settings object that was written.
function saveSettings(file, patch) {
  const current = loadSettings(file);
  const next = { ...current };
  applyPatch(next, patch);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ ...next, settingsVersion: SETTINGS_VERSION }, null, 2) + '\n',
      'utf8'
    );
  } catch (e) {
    throw new Error('Could not save settings: ' + (e && e.message));
  }
  return next;
}

module.exports = {
  DEFAULTS, SETTINGS_VERSION,
  normalizeApiKey, normalizeCountry,
  loadSettings, saveSettings
};

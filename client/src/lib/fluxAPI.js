/* ── fluxAPI: browser implementation ──────────────────────────────────────
 * The Electron build exposed window.fluxAPI through a contextBridge that
 * talked IPC to the main process. In the web build the same interface is
 * implemented over HTTP: JSON REST for request/response calls, one shared
 * EventSource for the progress pushes (source scan + subtitle search).
 *
 * Every renderer component keeps using window.fluxAPI unchanged.
 */

function jsonFetch(url, body, method) {
  const opts = { method: method || (body === undefined ? 'GET' : 'POST') };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  return fetch(url, opts).then(async (res) => {
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error((data && data.error) || 'Request failed (HTTP ' + res.status + ')');
    }
    return data;
  });
}

// ── shared SSE multiplexer ────────────────────────────────────────────────
// Old IPC channels: 'flux:streams:progress' and 'flux:subs:progress'. The
// server broadcasts them as SSE events named 'streams' / 'subs'.
let es = null;
const listeners = { streams: new Set(), subs: new Set() };

function ensureEvents() {
  if (es || typeof window === 'undefined') return;
  es = new EventSource('/api/events');
  const wire = (channel) => (evt) => {
    let payload;
    try { payload = JSON.parse(evt.data); } catch (_err) { return; }
    for (const fn of listeners[channel]) {
      try { fn(payload); } catch (_err) { /* listener error */ }
    }
  };
  es.addEventListener('streams', wire('streams'));
  es.addEventListener('subs', wire('subs'));
}

const fluxAPI = {
  // Search + metadata (Cinemeta)
  search: (query) => jsonFetch('/api/search', { query }),
  getMeta: (type, id) => jsonFetch('/api/meta', { type, id }),

  // Source scan — progress via onStreamsProgress
  getStreams: (params) => jsonFetch('/api/streams', params || {}),
  cancelStreams: () => jsonFetch('/api/streams/cancel', {}),
  onStreamsProgress: (callback) => {
    ensureEvents();
    listeners.streams.add(callback);
  },

  // Subtitles — progress via onSubsProgress
  searchSubtitles: (params) => jsonFetch('/api/subtitles/search', params || {}),
  cancelSubtitles: () => jsonFetch('/api/subtitles/cancel', {}),
  downloadSubtitle: (variant) => jsonFetch('/api/subtitles/download', { variant }),
  onSubsProgress: (callback) => {
    ensureEvents();
    listeners.subs.add(callback);
  },

  // Player: header/CORS rules applied by the server-side media proxy
  setPlayerRules: (rules) => jsonFetch('/api/player-rules', rules || {}),
  clearPlayerRules: () => jsonFetch('/api/player-rules/clear', {}),

  // Settings
  getSettings: () => jsonFetch('/api/settings'),
  saveSettings: (patch) => jsonFetch('/api/settings', patch || {}),

  // "Relaunch" is just a page reload in the browser
  relaunchApp: () => {
    window.location.reload();
    return Promise.resolve(true);
  },

  // Home page (Streaming Availability API + TMDB)
  getHome: () => jsonFetch('/api/home'),

  // Watch history ("Continue watching" row)
  historyList: () => jsonFetch('/api/history'),
  historyAdd: (entry) => jsonFetch('/api/history', entry || {}),
  historyRemove: (imdbId) => jsonFetch('/api/history/remove', { imdbId }),

  // Watched list
  watchedList: () => jsonFetch('/api/watched'),
  watchedAdd: (entry) => jsonFetch('/api/watched', entry || {}),
  watchedRemove: (imdbId) => jsonFetch('/api/watched/remove', { imdbId }),

  // Suggestions ("Because you watched …") + TMDB→IMDb id lookup
  getSuggestions: () => jsonFetch('/api/suggestions'),
  tmdbToImdb: (tmdbId, type) =>
    jsonFetch(
      '/api/tmdb-to-imdb?tmdbId=' + encodeURIComponent(tmdbId)
      + '&type=' + encodeURIComponent(type || '')
    ),

  // Web-only helper: route a direct media link through the server proxy so
  // Referer/UA headers are applied and CORS cannot block hls.js/`<video>`.
  mediaUrl: (url) => '/api/media?u=' + encodeURIComponent(String(url || ''))
};

if (typeof window !== 'undefined') {
  window.fluxAPI = fluxAPI;
}

export default fluxAPI;

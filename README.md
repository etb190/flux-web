# Flux (web)

A lightweight streaming app for the browser, built with **React + Vite + Express** (plain JavaScript, no TypeScript), styled with **Tailwind CSS**.

Flux uses the same metadata source as [Helix](https://github.com/etb190/Helix) (the Stremio Cinemeta addon) to search movies & series, and a home page filled by the Streaming Availability API (daily Top 10s, popular per service, new & leaving soon) mixed with TMDB trending.

This is the web edition of Flux — the Electron desktop shell was removed. The former main-process modules (scrapers, subtitle engine, home orchestrator, library) now run in a small Express backend, and the renderer talks to it over REST + SSE instead of IPC.

## Status (v0.13.0-web)

- [x] Home page (Streaming Availability API + TMDB trending, poster rows, carousel arrows)
- [x] Left sidebar (Home / Watched) with watched-list search + add
- [x] "Because you watched …" TMDB suggestion rows
- [x] Continue watching row (S/E badge + per-card remove, recorded on playback)
- [x] Search bar (debounced as-you-type + Enter)
- [x] Poster results grid (movies + series, interleaved)
- [x] Details page with season tabs + episode lists (50-ep batches for long seasons)
- [x] Source scanning (multi-provider, live progress via SSE, text + size filters)
- [x] Player: HLS (hls.js) / MP4 direct playback + embed iframes, server-side header injection + CORS via the media proxy
- [x] Helix subtitle system (SRT/VTT/ASS, en/fr/it/es/ar whitelist, delay, embedded tracks)
- [x] Settings: Streaming Availability key + country, TMDB key (user-owned via Settings)

## Project structure

```
flux-web/
├── vite.config.mjs              # vite config (client root, /api proxy for dev)
├── server/                      # Express backend (replaces the Electron main process)
│   ├── index.js                 # REST + SSE endpoints, media proxy, static serving
│   └── lib/                     # backend modules (CommonJS, unbundled)
│       ├── search.js            # Cinemeta search/meta
│       ├── streams.js           # multi-provider source scraper
│       ├── providers2/3.js      # scrapers
│       ├── subtitles.js         # Helix SubtitleService port
│       ├── home.js              # home orchestrator (SA + TMDB)
│       ├── saa.js               # Streaming Availability API client
│       ├── tmdbhome.js          # TMDB trending + IMDb enrichment
│       ├── library.js           # watch history + watched list (data/)
│       └── settings.js          # persisted settings (v3)
├── client/                      # React app (Vite + Tailwind v4)
│   ├── index.html
│   ├── public/icon.png
│   └── src/
│       ├── main.jsx             # entry + error boundary
│       ├── App.jsx              # view routing + history recording
│       ├── lib/fluxAPI.js       # window.fluxAPI over HTTP + SSE (was: preload IPC bridge)
│       ├── lib/cinemeta.js      # search/meta (fluxAPI first, direct fetch fallback)
│       ├── components/          # Home/Results/Details/Sources/Player/Settings/…
│       └── hooks/               # useSearch, useHome, useStreams, useSubtitles
└── data/                        # created at runtime (gitignored)
    ├── settings.json            # API keys + country
    ├── library.json             # watch history + watched list
    └── cache/                   # home page disk cache
```

## Running

Requirements: Node 18+ (Node 20+ recommended).

```bash
npm install
```

Development (backend on :5175 + Vite dev server on :5173 with HMR, `/api` proxied):

```bash
npm run dev
```

Production (build the client, then serve everything from Express on :5175):

```bash
npm run build
npm start
```

Environment overrides: `PORT` (backend port, default 5175) and `FLUX_API_TARGET` (where the Vite dev proxy points, default `http://localhost:5175`).

## API overview

All endpoints live under `/api`. Progress-style operations (source scan, subtitle search) return a `requestId` immediately and stream events on the SSE channel `GET /api/events` (event names: `streams`, `subs`) — mirroring the old IPC pushes.

| Endpoint | Purpose |
|---|---|
| `POST /api/search` | Cinemeta search (movies + series in parallel) |
| `POST /api/meta` | Full metadata (episodes/seasons for series) |
| `POST /api/streams` / `POST /api/streams/cancel` | Multi-provider source scan |
| `POST /api/subtitles/search` / `cancel` / `download` | Helix subtitle system |
| `POST /api/player-rules` (+ `/clear`) | Per-host header rules for the media proxy |
| `GET /api/media?u=…` | Stream proxy: injects UA/Referer, answers with CORS |
| `GET/POST /api/settings` | Persisted settings |
| `GET /api/home` | Streaming Availability + TMDB home rows (disk cache) |
| `GET/POST /api/history` (+ `/remove`) | Continue-watching history |
| `GET/POST /api/watched` (+ `/remove`) | Watched list (drives suggestions) |
| `GET /api/suggestions` | TMDB "Because you watched …" rows |
| `GET /api/tmdb-to-imdb` | TMDB → IMDb id lookup |

## Notes vs the Electron build

- Direct stream links are played through `/api/media` (the browser can't set Referer/UA on `<video>`/hls.js requests or bypass CORS). Range requests are forwarded, so seeking works.
- Embed sources render in a sandboxed `<iframe>` instead of a `<webview>`.
- The ANGLE graphics-backend setting and GPU info panel were Electron-only and were removed; "relaunch" after saving settings is a page reload.
- Settings, watch history and the watched list live in `data/` (gitignored) instead of Electron's `userData`.

MIT licensed.

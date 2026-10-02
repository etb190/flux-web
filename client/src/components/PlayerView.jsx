/* ── Player (Helix PlayerScreen equivalent) ──────────────────────────────
 * Direct HLS via hls.js / native <video>, MP4 native, DASH → unsupported
 * notice, embed sources in a plain <iframe>. Direct links play through the
 * server media proxy (/api/media) so Referer/UA headers are applied and
 * CORS cannot block hls.js/`<video>`.
 * Subtitle overlay + menu come from the useSubtitles hook; the chrome
 * (top bar + controls) auto-hides in fullscreen after 2.6s of mouse idle.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { fmtTime } from '../lib/format.js';
import SubtitleMenu from './SubtitleMenu.jsx';
import {
  BackIcon, SwitchIcon, PlayIcon, PauseIcon,
  VolumeIcon, MuteIcon, CCIcon, FullscreenIcon
} from './icons.jsx';

const CHROME_IDLE_MS = 2600;

function hostOf(url) {
  try { return new URL(url).hostname; } catch (_err) { return ''; }
}

// Register Referer/UA injection + CORS passthrough for this playback.
// (Web build: the rules drive the server-side /api/media proxy.)
function applyPlayerRules(src, sources) {
  const api = window.fluxAPI;
  if (!(api && typeof api.setPlayerRules === 'function')) return;
  const rules = { headers: [], corsHosts: [] };
  const host = hostOf(src.url);
  if (host && src.headers) {
    rules.headers.push({ host, headers: src.headers });
  }
  // CORS: any host the other sources point at may serve segments after a
  // redirect; whitelisting them all is harmless (proxy-side traffic).
  const hosts = new Set();
  for (const s of sources || []) {
    try { hosts.add(new URL(s.url).hostname); } catch (_err) {}
  }
  if (host) hosts.add(host);
  rules.corsHosts = [...hosts];
  api.setPlayerRules(rules);
}

export default function PlayerView({ source, sources, meta, episode, subs, onBack, submenuOpen, onToggleSubmenu, onCloseSubmenu }) {
  const videoRef = useRef(null);
  const stageRef = useRef(null);
  const hlsRef = useRef(null);
  const webviewRef = useRef(null);
  const failTimerRef = useRef(null);
  const idleTimerRef = useRef(null);
  const playedOnceRef = useRef(false);

  const [buffering, setBuffering] = useState(true);
  const [failMsg, setFailMsg] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cur, setCur] = useState('0:00');
  const [dur, setDur] = useState('0:00');
  const [seekPct, setSeekPct] = useState(0);
  const [overlayText, setOverlayText] = useState('');
  const [idle, setIdle] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [videoVisible, setVideoVisible] = useState(false);

  const isEmbed = source.format === 'Embed';

  // refs mirroring state for use inside timers / event closures
  const submenuOpenRef = useRef(false);
  useEffect(() => { submenuOpenRef.current = submenuOpen; }, [submenuOpen]);
  const failMsgRef = useRef(null);
  const videoVisibleRef = useRef(false);
  const idleRef = useRef(false);
  useEffect(() => { failMsgRef.current = failMsg; }, [failMsg]);
  useEffect(() => { videoVisibleRef.current = videoVisible; }, [videoVisible]);
  useEffect(() => { idleRef.current = idle; }, [idle]);

  const showPlayerFail = useCallback((msg) => {
    clearTimeout(failTimerRef.current);
    failTimerRef.current = null;
    setBuffering(false);
    setFailMsg(msg || 'The stream may be offline or blocked. Try a different source below.');
  }, []);

  // ── chrome auto-hide ───────────────────────────────────────────────────
  const chromeCanHide = useCallback(() => {
    if (!document.fullscreenElement) return false;          // fullscreen only
    if (failMsgRef.current) return false;
    if (submenuOpenRef.current) return false;
    if (!videoVisibleRef.current) return false;
    const v = videoRef.current;
    if (!v || v.paused) return false;                       // paused keeps chrome
    return true;
  }, []);

  const scheduleChromeHide = useCallback(() => {
    clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      if (chromeCanHide()) setIdle(true);
    }, CHROME_IDLE_MS);
  }, [chromeCanHide]);

  const wakeChrome = useCallback(() => {
    setIdle(false);
    scheduleChromeHide();
  }, [scheduleChromeHide]);

  const stopChromeHide = useCallback(() => {
    clearTimeout(idleTimerRef.current);
    setIdle(false);
  }, []);

  // ── open one source ────────────────────────────────────────────────────
  useEffect(() => {
    // reset per-source state
    setBuffering(true);
    setFailMsg(null);
    setVideoVisible(false);
    setOverlayText('');
    setPlaying(false);
    setSeekPct(0);
    setCur('0:00');
    setDur('0:00');
    playedOnceRef.current = false;
    stopChromeHide();

    const ctx = meta
      ? {
          name: meta.name,
          imdbId: meta.id,
          isSeries: meta.type === 'series',
          season: episode ? episode.season : null,
          episode: episode ? episode.episode : null,
          year: meta.year,
          isEmbed: source.format === 'Embed'
        }
      : { name: source.title || '', imdbId: null, isEmbed: source.format === 'Embed' };
    subs.setContext(ctx);
    applyPlayerRules(source, sources);

    if (source.format === 'Embed') {
      // <iframe> is rendered below; it signals readiness via onLoad.
      return undefined;
    }

    // Web build: play direct links through the server proxy — the browser
    // itself can neither set Referer/UA on media requests nor bypass CORS.
    const api = window.fluxAPI;
    const url = api && typeof api.mediaUrl === 'function'
      ? api.mediaUrl(source.url)
      : source.url;
    const isHls = source.format === 'HLS' || /\.m3u8($|\?)/i.test(source.url);
    const isDash = source.format === 'DASH' || /\.mpd($|\?)/i.test(source.url);
    const video = videoRef.current;

    if (isDash) {
      showPlayerFail('DASH streams aren\u2019t supported by the basic player yet. Pick another source below.');
      return undefined;
    }

    // If nothing renders within 25s, treat the host as dead
    failTimerRef.current = setTimeout(() => {
      if (!playedOnceRef.current) {
        showPlayerFail('Timed out while contacting the stream host.');
      }
    }, 25000);

    if (isHls && Hls.isSupported()) {
      setVideoVisible(true);
      const hls = new Hls({
        enableWorker: true,
        backBufferLength: 90,
        maxBufferLength: 30,
        // Subtitles are rendered by our own overlay (Helix-style styling +
        // delay support) instead of native <track> elements.
        renderTextTracksNatively: false
      });
      hlsRef.current = hls;
      subs.attachHls(hls);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        // Embedded WebVTT subtitle tracks → menu (whitelisted languages only)
        subs.setEmbeddedTracks(hls);
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.CUES_PARSED, (_e, data) => subs.pushEmbeddedCues(data));
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data || !data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          try { hls.recoverMediaError(); return; } catch (_err) {}
        }
        showPlayerFail('The stream host refused the request \u2014 it may be offline, geo-blocked, or require special headers.');
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else if (isHls && video.canPlayType('application/vnd.apple.mpegurl')) {
      setVideoVisible(true);
      video.src = url;
      video.play().catch(() => {});
    } else if (!isHls) {
      setVideoVisible(true);
      video.src = url;
      video.play().catch(() => {});
    } else {
      showPlayerFail('HLS playback is not supported in this environment.');
    }

    // Auto-fetch subtitles for this episode/movie (Helix _fetchInitialSubtitles)
    subs.search(false);

    return () => {
      clearTimeout(failTimerRef.current);
      failTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // ── teardown on unmount (closePlayer) ─────────────────────────────────
  useEffect(() => {
    return () => {
      const hls = hlsRef.current;
      if (hls) { try { hls.destroy(); } catch (_err) {} hlsRef.current = null; }
      subs.detachHls();
      clearTimeout(failTimerRef.current);
      clearTimeout(idleTimerRef.current);

      const video = videoRef.current;
      if (video) {
        try { video.pause(); } catch (_err) {}
        video.removeAttribute('src');
        try { video.load(); } catch (_err) {}
      }
      subs.stopInFlight();

      const api = window.fluxAPI;
      if (api && typeof api.clearPlayerRules === 'function') api.clearPlayerRules();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── fullscreen change ──────────────────────────────────────────────────
  useEffect(() => {
    const onFsChange = () => {
      if (document.fullscreenElement) {
        setFullscreen(true);
        wakeChrome();
      } else {
        setFullscreen(false);
        stopChromeHide();           // leaving fullscreen always shows chrome
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [wakeChrome, stopChromeHide]);

  // ── overlay text recompute when subs state changes ─────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    setOverlayText((prev) => {
      const next = subs.getOverlayText(v.currentTime);
      return next === prev ? prev : next;
    });
  }, [subs.cuesVersion, subs.delay, subs.selectedUrl, subs.embeddedActive, subs]);

  // ── subtitle menu helpers (open state lifted to App for the Esc chain) ─
  const closeSubmenu = useCallback(() => {
    onCloseSubmenu();
    scheduleChromeHide();
  }, [onCloseSubmenu, scheduleChromeHide]);

  const toggleSubmenu = useCallback(() => {
    if (!submenuOpenRef.current) {
      wakeChrome();
      onToggleSubmenu();
    } else {
      closeSubmenu();
    }
  }, [wakeChrome, onToggleSubmenu, closeSubmenu]);

  // ── header text ────────────────────────────────────────────────────────
  const isSeries = meta && meta.type === 'series';
  const se = isSeries && episode
    ? 'S' + (episode.season ?? 1) + ' E' + (episode.episode ?? 1) + ' \u00b7 ' + (episode.title || '')
    : '';
  const titleText = meta
    ? meta.name + (isSeries ? ' \u2014 ' + se.split(' \u00b7 ')[0] : '')
    : (source.title || 'Now playing');
  const subText = [
    se.split(' \u00b7 ').slice(1).join(' \u00b7 '),
    source.title || source.provider || 'Source'
  ].filter(Boolean).join('  \u2014  ');

  // ── video events ───────────────────────────────────────────────────────
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    const text = fmtTime(video.currentTime);
    setCur((prev) => (prev === text ? prev : text));
    const d = video.duration;
    if (Number.isFinite(d) && d > 0) {
      const pct = (video.currentTime / d) * 100;
      setSeekPct((prev) => (Math.abs(prev - pct) > 0.05 ? pct : prev));
    }
    setOverlayText((prev) => {
      const next = subs.getOverlayText(video.currentTime);
      return next === prev ? prev : next;
    });
  };

  const handlePlaying = () => {
    playedOnceRef.current = true;
    clearTimeout(failTimerRef.current);
    failTimerRef.current = null;
    setBuffering(false);
    setFailMsg(null);
  };

  const handleWaiting = () => {
    if (!failMsgRef.current) setBuffering(true);
  };

  const handleError = () => {
    const video = videoRef.current;
    if (!video || !video.currentSrc) return;      // teardown clears src — ignore
    showPlayerFail('Playback failed \u2014 the file could not be decoded or reached. Try another source.');
  };

  const chromeHidden = idle && fullscreen;

  return (
    <div
      data-testid="player-view"
      className="fixed inset-0 z-40 bg-black flex flex-col"
      onMouseMove={() => {
        if (idleRef.current || document.fullscreenElement) wakeChrome();
      }}
      onClick={(e) => {
        if (!submenuOpenRef.current) return;
        // composedPath: selecting a row unmounts it before the event finishes
        // bubbling, so a plain closest() would misread it as "outside".
        const path = e.composedPath ? e.composedPath() : [];
        for (const node of path) {
          if (node && (node.id === 'player-submenu' || node.id === 'pc-cc')) return;
        }
        closeSubmenu();
      }}
    >
      {/* top bar */}
      <div
        className={
          'flex items-center gap-4 px-5 py-3 bg-black/60 backdrop-blur z-10 transition-opacity duration-500 ' +
          (chromeHidden ? 'opacity-0 pointer-events-none' : 'opacity-100')
        }
      >
        <button
          data-testid="player-back"
          title="Back to sources"
          aria-label="Back to sources"
          onClick={onBack}
          className="flex items-center gap-1.5 text-dim hover:text-ink"
        >
          <BackIcon />
          <span className="text-sm font-medium">Sources</span>
        </button>
        <div className="flex-1 min-w-0">
          <div data-testid="player-title" className="text-[15px] font-semibold truncate">{titleText}</div>
          <div data-testid="player-sub" className="text-xs text-dim truncate">{subText}</div>
        </div>
        <button
          data-testid="player-switch"
          title="Pick a different source"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-lg border border-edge bg-raised/80 px-3 py-1.5 text-sm text-ink hover:border-accent"
        >
          <SwitchIcon />
          <span>Change source</span>
        </button>
      </div>

      {/* stage */}
      <div ref={stageRef} data-testid="player-stage" className="relative flex-1 bg-black overflow-hidden">
        {!isEmbed ? (
          <video
            ref={videoRef}
            data-testid="player-video"
            playsInline
            onPlay={() => { setPlaying(true); scheduleChromeHide(); }}
            onPause={() => { setPlaying(false); wakeChrome(); }}
            onLoadedMetadata={() => {
              const v = videoRef.current;
              if (v) setDur(fmtTime(v.duration));
            }}
            onTimeUpdate={handleTimeUpdate}
            onPlaying={handlePlaying}
            onWaiting={handleWaiting}
            onError={handleError}
            className={
              'absolute inset-0 w-full h-full bg-black ' +
              (videoVisible ? '' : 'hidden')
            }
          />
        ) : (
          <iframe
            ref={webviewRef}
            title="Embed player"
            src={source.url}
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
            className="player-webview"
            onLoad={() => setBuffering(false)}
          />
        )}

        {/* subtitle overlay */}
        {overlayText ? (
          <div
            data-testid="player-sub-overlay"
            className="absolute bottom-[72px] left-0 right-0 flex justify-center px-10 pointer-events-none z-10"
          >
            <span className="max-w-3xl bg-black/70 rounded-lg px-4 py-1.5 text-center text-lg leading-snug text-white whitespace-pre-line">
              {overlayText}
            </span>
          </div>
        ) : null}

        {/* subtitle menu */}
        {submenuOpen ? (
          <SubtitleMenu
            subs={subs}
            onClose={closeSubmenu}
            onRefresh={() => { wakeChrome(); subs.search(true); }}
            onDelayMinus={() => { wakeChrome(); subs.setDelay(subs.delay - 0.1); }}
            onDelayPlus={() => { wakeChrome(); subs.setDelay(subs.delay + 0.1); }}
            onDelayReset={() => { wakeChrome(); subs.setDelay(0); }}
          />
        ) : null}

        {/* buffering */}
        {buffering && !failMsg ? (
          <div
            data-testid="player-buffering"
            className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-dim"
          >
            <div className="spinner spinner-lg" />
            <p>Loading stream&hellip;</p>
          </div>
        ) : null}

        {/* fail card */}
        {failMsg ? (
          <div
            data-testid="player-fail"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6"
          >
            <h3 className="text-xl font-semibold">This source couldn&rsquo;t be played</h3>
            <p data-testid="player-fail-msg" className="text-dim max-w-md">{failMsg}</p>
            <button
              data-testid="player-fail-back"
              onClick={onBack}
              className="mt-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white hover:brightness-110"
            >
              Pick another source
            </button>
          </div>
        ) : null}

        {/* controls */}
        {videoVisible ? (
          <div
            data-testid="player-controls"
            className={
              'absolute bottom-0 left-0 right-0 flex items-center gap-3 px-5 py-3 bg-gradient-to-t from-black/85 to-transparent z-10 transition-opacity duration-500 ' +
              (chromeHidden ? 'opacity-0 pointer-events-none' : 'opacity-100')
            }
          >
            <button
              id="pc-play"
              data-testid="pc-play"
              title="Play/Pause"
              aria-label="Play or pause"
              onClick={() => {
                const v = videoRef.current;
                if (!v) return;
                if (v.paused) v.play().catch(() => {});
                else v.pause();
              }}
              className="text-ink hover:text-accent"
            >
              {playing ? <PauseIcon /> : <PlayIcon size={22} />}
            </button>
            <span data-testid="pc-cur" className="text-xs text-dim tabular-nums">{cur}</span>
            <input
              id="pc-seek"
              data-testid="pc-seek"
              type="range"
              min="0"
              max="100"
              step="0.1"
              value={seekPct}
              aria-label="Seek"
              onChange={(e) => {
                const v = videoRef.current;
                const d = v ? v.duration : NaN;
                if (v && Number.isFinite(d) && d > 0) {
                  v.currentTime = (parseFloat(e.target.value) / 100) * d;
                }
                wakeChrome();
              }}
              className="seek flex-1"
            />
            <span data-testid="pc-dur" className="text-xs text-dim tabular-nums">{dur}</span>
            <button
              data-testid="pc-mute"
              title="Mute/Unmute"
              aria-label="Mute or unmute"
              onClick={() => {
                const v = videoRef.current;
                if (!v) return;
                v.muted = !v.muted;
                setMuted(v.muted);
              }}
              className="text-ink hover:text-accent"
            >
              {muted ? <MuteIcon /> : <VolumeIcon />}
            </button>
            <button
              id="pc-cc"
              data-testid="pc-cc"
              title="Subtitles"
              aria-label="Toggle subtitle menu"
              onClick={toggleSubmenu}
              className={(subs.hasActive ? 'text-accent' : 'text-ink') + ' hover:text-accent'}
            >
              <CCIcon />
            </button>
            <button
              data-testid="pc-fs"
              title="Fullscreen"
              aria-label="Toggle fullscreen"
              onClick={() => {
                if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
                else if (stageRef.current) stageRef.current.requestFullscreen().catch(() => {});
              }}
              className="text-ink hover:text-accent"
            >
              <FullscreenIcon />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

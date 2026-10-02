/* ── Subtitle system (port of the Helix PlayerSubtitleMenu block) ────────
 * External SRT/VTT/ASS variants (searched via main process) + embedded HLS
 * WebVTT tracks, rendered by our own overlay (styling + delay support).
 * Only en/fr/it/es/ar survive the whitelist (lib/subsParser.subLangLabel).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { subParse, findActiveCueIndex, subLangLabel } from '../lib/subsParser.js';

function fluxApi() {
  return typeof window !== 'undefined' ? window.fluxAPI : null;
}

function subtitleSupports() {
  const api = fluxApi();
  return api && typeof api.searchSubtitles === 'function';
}

export function useSubtitles() {
  const [groups, setGroups] = useState([]);
  const [pending, setPending] = useState(0);
  const [loadingUrl, setLoadingUrl] = useState(null);
  const [embedded, setEmbedded] = useState([]);       // [{id, name, lang}]
  const [embeddedActive, setEmbeddedActiveState] = useState(null);
  const [delay, setDelayState] = useState(0);
  const [menuNotice, setMenuNotice] = useState(null);
  const [selectedUrl, setSelectedUrl] = useState(null); // downloadUrl of selected variant
  const [cuesVersion, setCuesVersion] = useState(0);    // bump → overlay recompute

  const groupsRef = useRef([]);
  const selectedRef = useRef(null);
  const cuesRef = useRef([]);
  const delayRef = useRef(0);
  const embeddedActiveRef = useRef(null);
  const embeddedCuesRef = useRef(new Map());
  const episodeKeyRef = useRef('');
  const requestIdRef = useRef(null);
  const hlsRef = useRef(null);
  const ctxRef = useRef(null);        // {name, imdbId, season, episode, year, isEmbed}
  const eventHandlerRef = useRef(null);

  // ── context (which title/episode subs belong to) ──────────────────────
  const setContext = useCallback((ctx) => { ctxRef.current = ctx; }, []);

  const buildParams = useCallback(() => {
    const ctx = ctxRef.current || {};
    return {
      name: ctx.name || '',
      imdbId: ctx.imdbId || null,       // Cinemeta ids are imdb tt-ids
      season: ctx.isSeries ? ctx.season : null,
      episode: ctx.isSeries ? ctx.episode : null,
      year: ctx.year || null
    };
  }, []);

  // ── search (Helix _fetchInitialSubtitles / refresh) ────────────────────
  const search = useCallback((force) => {
    if (!subtitleSupports()) return;
    const ctx = ctxRef.current || {};
    if (ctx.isEmbed) return;            // embeds manage their own subs
    const params = buildParams();
    if (!params.name && !params.imdbId) return;

    const key = [params.imdbId || params.name, params.season ?? '', params.episode ?? ''].join(':');
    if (!force && key === episodeKeyRef.current && groupsRef.current.length) return;
    episodeKeyRef.current = key;
    groupsRef.current = [];
    setGroups([]);
    selectedRef.current = null;
    setSelectedUrl(null);
    cuesRef.current = [];
    setCuesVersion((v) => v + 1);
    setEmbedded([]);
    embeddedActiveRef.current = null;
    setEmbeddedActiveState(null);
    embeddedCuesRef.current = new Map();
    setMenuNotice(null);

    setPending(4);
    fluxApi().searchSubtitles(params).then((res) => {
      if (res && res.requestId != null) requestIdRef.current = res.requestId;
    }).catch(() => {
      setPending(0);
    });
  }, [buildParams]);

  // ── IPC progress events (batch merge — Helix _mergeSubtitleGroups) ─────
  useEffect(() => {
    eventHandlerRef.current = (payload) => {
      if (!payload || payload.kind === undefined) return;
      if (requestIdRef.current != null && payload.requestId !== requestIdRef.current) return;

      if (payload.kind === 'batch' && Array.isArray(payload.variants)) {
        const seen = new Set(
          groupsRef.current.flatMap((g) => g.variants.map((v) => String(v.downloadUrl).toLowerCase()))
        );
        let changed = false;
        const next = groupsRef.current.slice();
        for (const v of payload.variants) {
          if (!v || !v.downloadUrl) continue;
          const urlKey = String(v.downloadUrl).toLowerCase();
          if (seen.has(urlKey)) continue;
          seen.add(urlKey);
          changed = true;
          const lang = String(v.language || 'Unknown');
          let group = next.find((g) => g.language === lang);
          if (!group) {
            group = { language: lang, variants: [] };
            next.push(group);
          }
          group.variants.push(v);
        }
        if (changed) {
          next.sort((a, b) => a.language.localeCompare(b.language));
          groupsRef.current = next;
          setGroups(next);
        }
      } else if (payload.kind === 'done') {
        setPending(0);
      }
    };
  }, []);

  useEffect(() => {
    const api = fluxApi();
    if (api && typeof api.onSubsProgress === 'function') {
      api.onSubsProgress((payload) => {
        if (eventHandlerRef.current) eventHandlerRef.current(payload);
      });
    }
  }, []);

  // ── selection actions ──────────────────────────────────────────────────
  const off = useCallback(() => {
    selectedRef.current = null;
    setSelectedUrl(null);
    cuesRef.current = [];
    setCuesVersion((v) => v + 1);
    if (hlsRef.current) { try { hlsRef.current.subtitleTrack = -1; } catch (_) {} }
    embeddedActiveRef.current = null;
    setEmbeddedActiveState(null);
    setMenuNotice(null);
  }, []);

  const selectVariant = useCallback(async (variant) => {
    selectedRef.current = variant;
    setSelectedUrl(String(variant.downloadUrl));
    setLoadingUrl(String(variant.downloadUrl));
    setMenuNotice(null);
    try {
      const res = await fluxApi().downloadSubtitle(variant);
      if (selectedRef.current !== variant) return;   // user picked another meanwhile
      if (!res || !res.content) {
        setLoadingUrl(null);
        selectedRef.current = null;
        setSelectedUrl(null);
        setMenuNotice('Failed to download subtitle \u2014 try another one.');
        return;
      }
      cuesRef.current = subParse(res.content, res.format === 'vtt' || res.format === 'ass' ? res.format : null);
      if (hlsRef.current) { try { hlsRef.current.subtitleTrack = -1; } catch (_) {} }  // external replaces embedded
      embeddedActiveRef.current = null;
      setEmbeddedActiveState(null);
      setLoadingUrl(null);
      setCuesVersion((v) => v + 1);
    } catch (_err) {
      setLoadingUrl(null);
      selectedRef.current = null;
      setSelectedUrl(null);
    }
  }, []);

  const selectEmbedded = useCallback((id) => {
    embeddedActiveRef.current = id;
    setEmbeddedActiveState(id);
    selectedRef.current = null;
    setSelectedUrl(null);
    cuesRef.current = [];
    setCuesVersion((v) => v + 1);
    if (hlsRef.current) {
      try { hlsRef.current.subtitleTrack = id; } catch (_) {}
    }
    setMenuNotice(null);
  }, []);

  const setDelay = useCallback((d) => {
    const clamped = Math.max(-30, Math.min(30, Math.round(d * 10) / 10));
    delayRef.current = clamped;
    setDelayState(clamped);
    setCuesVersion((v) => v + 1);     // re-evaluate the visible cue immediately
  }, []);

  // ── embedded HLS tracks (MANIFEST_PARSED / CUES_PARSED) ────────────────
  const setEmbeddedTracks = useCallback((hls) => {
    try {
      const tracks = (hls.subtitleTracks || [])
        .map((t) => ({
          id: t.id,
          name: subLangLabel(t.lang) || subLangLabel(t.name) || null,
          lang: t.lang
        }))
        .filter((t) => t.name)
        .map((t) => ({ id: t.id, name: t.name, lang: t.lang }));
      setEmbedded(tracks);
    } catch (_err) {
      setEmbedded([]);
    }
  }, []);

  const pushEmbeddedCues = useCallback((data) => {
    if (!data) return;
    const cues = (data.cues || []).map((c) => ({
      start: c.start ?? c.startTime ?? 0,
      end: c.end ?? c.endTime ?? 0,
      text: c.text || c.content || ''
    })).filter((c) => c.text);
    cues.sort((a, b) => a.start - b.start);
    embeddedCuesRef.current.set(data.track, cues);
    if (embeddedActiveRef.current === data.track) setCuesVersion((v) => v + 1);
  }, []);

  const attachHls = useCallback((hls) => { hlsRef.current = hls; }, []);
  const detachHls = useCallback(() => { hlsRef.current = null; }, []);

  // ── lifecycle resets ───────────────────────────────────────────────────
  // New episode opened (openSources): everything from the previous one goes.
  const resetForEpisode = useCallback(() => {
    const api = fluxApi();
    if (api && typeof api.cancelSubtitles === 'function') {
      api.cancelSubtitles().catch(() => {});
    }
    requestIdRef.current = null;
    setPending(0);
    groupsRef.current = [];
    setGroups([]);
    selectedRef.current = null;
    setSelectedUrl(null);
    cuesRef.current = [];
    setCuesVersion((v) => v + 1);
    episodeKeyRef.current = '';
    setLoadingUrl(null);
    setEmbedded([]);
    embeddedActiveRef.current = null;
    setEmbeddedActiveState(null);
    embeddedCuesRef.current = new Map();
    setMenuNotice(null);
    delayRef.current = 0;
    setDelayState(0);
  }, []);

  // Player closed: cancel in-flight search, drop embedded state. External
  // groups/selection survive a source switch (Helix keeps the variant across
  // sources for the same episode; search() skips while the key matches).
  const stopInFlight = useCallback(() => {
    const api = fluxApi();
    if (api && typeof api.cancelSubtitles === 'function') {
      api.cancelSubtitles().catch(() => {});
    }
    requestIdRef.current = null;
    setPending(0);
    setLoadingUrl(null);
    setEmbedded([]);
    embeddedActiveRef.current = null;
    setEmbeddedActiveState(null);
    embeddedCuesRef.current = new Map();
    setMenuNotice(null);
  }, []);

  // ── overlay text lookup (ref-based, called on every timeupdate) ────────
  const getOverlayText = useCallback((t) => {
    let cues = null;
    const active = embeddedActiveRef.current;
    if (active != null && embeddedCuesRef.current.has(active)) {
      cues = embeddedCuesRef.current.get(active);
    } else if (selectedRef.current && cuesRef.current.length) {
      cues = cuesRef.current;
    }
    if (!cues || !cues.length) return '';
    const idx = findActiveCueIndex(cues, t - delayRef.current);
    return idx !== -1 ? (cues[idx].text || '') : '';
  }, []);

  const hasActive = selectedUrl != null || embeddedActive != null;

  return {
    // state
    groups, pending, loadingUrl, embedded, embeddedActive, delay, menuNotice,
    selectedUrl, cuesVersion, hasActive,
    // actions
    setContext, search, off, selectVariant, selectEmbedded, setDelay,
    setEmbeddedTracks, pushEmbeddedCues, attachHls, detachHls,
    resetForEpisode, stopInFlight, getOverlayText
  };
}

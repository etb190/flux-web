/* ── Flux app shell: view machine + orchestration ────────────────────────
 * Views: home | loading | error | empty | results | details-loading |
 *        details-error | details | sources        (+ player & settings overlays)
 * Esc chain (Helix pattern): settings → subtitle menu → player → sources →
 * details → clear search back to home.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import TopBar from './components/TopBar.jsx';
import HomeView from './components/HomeView.jsx';
import ResultsView from './components/ResultsView.jsx';
import DetailsView from './components/DetailsView.jsx';
import SourcesView from './components/SourcesView.jsx';
import PlayerView from './components/PlayerView.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import { LoadingPane, ErrorPane, EmptyPane } from './components/ui.jsx';
import { BackIcon } from './components/icons.jsx';
import { useHome } from './hooks/useHome.js';
import { useSearch } from './hooks/useSearch.js';
import { useStreams } from './hooks/useStreams.js';
import { useSubtitles } from './hooks/useSubtitles.js';
import { getMeta } from './lib/cinemeta.js';

export default function App() {
  const [view, setView] = useState('home');
  const [query, setQuery] = useState('');
  const [meta, setMeta] = useState(null);
  const [episode, setEpisode] = useState(null);
  const [activeSource, setActiveSource] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const [homeTab, setHomeTab] = useState('feed');   // home sidebar: feed|watched

  const home = useHome();
  const search = useSearch();
  const streams = useStreams();
  const subs = useSubtitles();

  const contentRef = useRef(null);
  const homeScrollRef = useRef(0);
  const resultsScrollRef = useRef(0);
  const detailsSeqRef = useRef(0);
  const detailsReturnRef = useRef('results');

  // mirrors for the stable Esc handler
  const viewRef = useRef(view);
  const settingsOpenRef = useRef(settingsOpen);
  const activeSourceRef = useRef(activeSource);
  const submenuOpenRef = useRef(submenuOpen);
  const homeTabRef = useRef(homeTab);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { settingsOpenRef.current = settingsOpen; }, [settingsOpen]);
  useEffect(() => { activeSourceRef.current = activeSource; }, [activeSource]);
  useEffect(() => { submenuOpenRef.current = submenuOpen; }, [submenuOpen]);
  useEffect(() => { homeTabRef.current = homeTab; }, [homeTab]);

  // ── view entry effects (scroll restore + home lazy load) ──────────────
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    if (view === 'home') {
      el.scrollTop = homeScrollRef.current;
      if (!home.loadedRef.current && !home.loadingRef.current) home.load();
    } else if (view === 'results') {
      el.scrollTop = resultsScrollRef.current;
    } else if (view === 'details') {
      el.scrollTop = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    if (view === 'home' && !home.loadedRef.current && !home.loadingRef.current) {
      home.load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── search orchestration ───────────────────────────────────────────────
  const beginSearchLoad = useCallback(() => {
    detailsSeqRef.current++;               // close/invalidate details view
    setActiveSource(null);
    streams.stopScan();
    setView('loading');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streams]);

  const finishSearch = useCallback((q, found, err) => {
    if (err) {
      search.setErrorMsg(err);
      setView('error');
      return;
    }
    if (!found.length) {
      setView('empty');
      return;
    }
    search.setItems(found);
    setView('results');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const goHome = useCallback(() => {
    setView('home');
  }, []);

  const handleQueryChange = useCallback((q) => {
    setQuery(q);
    search.scheduleSearch(q, {
      onLoading: beginSearchLoad,
      onDone: finishSearch,
      onEmpty: goHome
    });
  }, [search, beginSearchLoad, finishSearch, goHome]);

  const handleQueryEnter = useCallback(() => {
    search.cancelDebounce();
    const q = query.trim();
    if (q) search.runSearch(q, { onLoading: beginSearchLoad, onDone: finishSearch });
  }, [search, query, beginSearchLoad, finishSearch]);

  const handleQueryClear = useCallback(() => {
    search.cancelDebounce();
    setQuery('');
    goHome();
    const input = document.getElementById('search');
    if (input) input.focus();
  }, [search, goHome]);

  // ── details orchestration ──────────────────────────────────────────────
  const openDetails = useCallback(async (item, from) => {
    const seq = ++detailsSeqRef.current;
    setMeta(null);
    streams.stopScan();
    detailsReturnRef.current = from === 'home' ? 'home' : 'results';
    if (contentRef.current) {
      if (from === 'home') homeScrollRef.current = contentRef.current.scrollTop;
      else resultsScrollRef.current = contentRef.current.scrollTop;
      contentRef.current.scrollTop = 0;
    }
    setView('details-loading');
    try {
      const m = await getMeta(item.type, item.id);
      if (seq !== detailsSeqRef.current) return;   // another title opened meanwhile
      if (!m) throw new Error('no meta');
      setMeta(m);
      setView('details');
    } catch (_err) {
      if (seq !== detailsSeqRef.current) return;
      setView('details-error');
    }
  }, [streams]);

  const closeDetails = useCallback(() => {
    detailsSeqRef.current++;                 // invalidate in-flight loads
    setActiveSource(null);
    streams.stopScan();
    if (detailsReturnRef.current === 'home') setView('home');
    else setView('results');                 // scroll restored by view effect
  }, [streams]);

  // ── sources orchestration ──────────────────────────────────────────────
  const openSources = useCallback((ep) => {
    if (!meta) return;
    setEpisode(ep);
    streams.reset();
    // New episode → the previously loaded subtitles belong to the old one
    subs.resetForEpisode();
    setView('sources');
    streams.startScan({
      type: meta.type,
      imdbId: meta.id,
      title: meta.name,
      year: meta.year,
      season: ep.season ?? 1,
      episode: ep.episode ?? 1
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, streams, subs]);

  const closeSources = useCallback(() => {
    setActiveSource(null);                   // player can't be open here, stay safe
    streams.stopScan();
    setView('details');
  }, [streams]);

  const openPlayer = useCallback((src) => {
    setActiveSource(src);

    // Continue watching: record this playback in the history (one entry per
    // title; series entries carry the season/episode).
    const api = typeof window !== 'undefined' ? window.fluxAPI : null;
    if (meta && meta.id && /^tt\d+$/.test(meta.id) &&
        api && typeof api.historyAdd === 'function') {
      const isSeries = meta.type === 'series';
      Promise.resolve(api.historyAdd({
        imdbId: meta.id,
        type: meta.type,
        title: meta.name,
        poster: meta.poster || null,
        season: isSeries && episode ? (episode.season ?? 1) : null,
        episode: isSeries && episode ? (episode.episode ?? 1) : null
      })).catch(() => {});
    }
  }, [meta, episode]);

  const closePlayer = useCallback(() => {
    setSubmenuOpen(false);
    setActiveSource(null);                   // back to the source list
  }, []);

  // ── global Esc chain ───────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (settingsOpenRef.current) {
        setSettingsOpen(false);              // Esc in settings → close dialog
        return;
      }
      if (activeSourceRef.current) {
        if (submenuOpenRef.current) {
          setSubmenuOpen(false);             // Esc in subtitle menu → close it
          return;
        }
        setSubmenuOpen(false);
        setActiveSource(null);               // Esc in player → back to sources
        return;
      }
      if (viewRef.current === 'sources') {
        closeSources();                      // Esc in sources → back to episodes
        return;
      }
      if (viewRef.current.startsWith('details')) {
        closeDetails();                      // Esc in details → back to results/home
        return;
      }
      if (homeTabRef.current === 'watched') {
        setHomeTab('feed');                  // Esc in the Watched tab → Home feed
        return;
      }
      setQuery('');
      goHome();
      const input = document.getElementById('search');
      if (input) input.focus();
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeSources, closeDetails, goHome]);

  // ── settings saved → home refetches with the new key/country ──────────
  const handleSettingsSaved = useCallback(() => {
    home.invalidate();
    home.load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home]);

  const inDetailsFlow = view === 'details-loading' || view === 'details-error' ||
    view === 'details' || view === 'sources';

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-bg text-ink font-sans">
      <TopBar
        query={query}
        onQueryChange={handleQueryChange}
        onEnter={handleQueryEnter}
        onClear={handleQueryClear}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main ref={contentRef} className="flex-1 overflow-y-auto scroll-dark relative">
        {view === 'home' ? (
          <HomeView
            home={home}
            onOpen={(item) => openDetails(item, 'home')}
            onOpenSettings={() => setSettingsOpen(true)}
            tab={homeTab}
            onTab={setHomeTab}
          />
        ) : null}

        {view === 'loading' ? <LoadingPane label={'Searching\u2026'} testid="loading" /> : null}

        {view === 'error' ? (
          <ErrorPane
            title="Something went wrong"
            message={search.errorMsg || 'Couldn\u2019t reach the search service. Check your connection and try again.'}
            testid="error"
          />
        ) : null}

        {view === 'empty' ? <EmptyPane /> : null}

        {view === 'results' ? (
          <ResultsView query={query} items={search.items} onOpen={openDetails} />
        ) : null}

        {inDetailsFlow ? (
          <section data-testid="details">
            <div className="px-8 pt-4 pb-2">
              <button
                data-testid="back-btn"
                title="Back"
                aria-label="Back"
                onClick={() => {
                  if (view === 'sources') closeSources();
                  else closeDetails();
                }}
                className="flex items-center gap-1.5 text-dim hover:text-ink"
              >
                <BackIcon />
                <span className="text-sm font-medium">Back</span>
              </button>
            </div>

            {view === 'details-loading' ? (
              <LoadingPane label={'Loading details\u2026'} testid="details-loading" />
            ) : null}

            {view === 'details-error' ? (
              <ErrorPane
                title="Couldn't load details"
                message="Try going back and opening it again."
                testid="details-error"
              />
            ) : null}

            {view === 'details' && meta ? (
              <DetailsView meta={meta} onFindSources={openSources} />
            ) : null}

            {view === 'sources' && meta && episode ? (
              <SourcesView meta={meta} episode={episode} scan={streams} onPlay={openPlayer} />
            ) : null}
          </section>
        ) : null}
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={handleSettingsSaved}
      />

      {activeSource ? (
        <PlayerView
          key={activeSource.url || activeSource.title}
          source={activeSource}
          sources={streams.sources}
          meta={meta}
          episode={episode}
          subs={subs}
          onBack={closePlayer}
          submenuOpen={submenuOpen}
          onToggleSubmenu={() => setSubmenuOpen((v) => !v)}
          onCloseSubmenu={() => setSubmenuOpen(false)}
        />
      ) : null}
    </div>
  );
}

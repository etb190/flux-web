/* ── Source scan state (Helix ScraperManager pattern) ────────────────────
 * The main process returns a requestId immediately and streams progress
 * events back as 'flux:streams:progress'. Events can arrive before the
 * invoke() reply lands, so while "pending" we adopt the requestId of the
 * first init event (exactly what the vanilla renderer did).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

function fluxApi() {
  return typeof window !== 'undefined' ? window.fluxAPI : null;
}

function summaryFromDone(evt) {
  const direct = evt.directCount || 0;
  const embeds = evt.embedCount || 0;
  if (direct + embeds === 0) return 'Scan complete \u2014 no sources found';
  const parts = [];
  if (direct) parts.push(direct + (direct === 1 ? ' direct link' : ' direct links'));
  if (embeds) parts.push(embeds + (embeds === 1 ? ' embed player' : ' embed players'));
  return 'Scan complete \u2014 ' + parts.join(', ');
}

export function useStreams() {
  const [sources, setSources] = useState([]);
  const [providerCount, setProviderCount] = useState(0);
  const [summaryText, setSummaryText] = useState(null); // null while scanning
  const [scanError, setScanError] = useState(null);
  const requestIdRef = useRef(null);

  // Latest event handler, forwarded from the stable IPC subscription.
  const handlerRef = useRef(null);

  const stopScan = useCallback(() => {
    if (requestIdRef.current != null) {
      requestIdRef.current = null;
      const api = fluxApi();
      if (api && typeof api.cancelStreams === 'function') api.cancelStreams();
    }
  }, []);

  const startScan = useCallback((params) => {
    const api = fluxApi();
    stopScan();
    setSources([]);
    setProviderCount(0);
    setSummaryText(null);
    setScanError(null);
    if (!api || typeof api.getStreams !== 'function') {
      setScanError('Could not start the scan.');
      return;
    }
    requestIdRef.current = 'pending';
    api.getStreams(params).then((res) => {
      // fallback if the init event raced past us
      if (requestIdRef.current === 'pending' && res && res.requestId != null) {
        requestIdRef.current = res.requestId;
      }
    }).catch(() => {
      if (requestIdRef.current === 'pending') {
        requestIdRef.current = null;
        setScanError('Could not start the scan.');
      }
    });
  }, [stopScan]);

  const reset = useCallback(() => {
    stopScan();
    setSources([]);
    setProviderCount(0);
    setSummaryText(null);
    setScanError(null);
  }, [stopScan]);

  useEffect(() => {
    handlerRef.current = (evt) => {
      const current = requestIdRef.current;
      if (current === 'pending') {
        if (!evt || evt.kind !== 'init' || evt.requestId == null) return;
        requestIdRef.current = evt.requestId;
      } else if (current == null || !evt || evt.requestId !== current) {
        return;
      }

      if (evt.kind === 'init') {
        setProviderCount(evt.providers ? evt.providers.length : 0);
        setSummaryText(null);
        return;
      }

      if (evt.kind === 'provider') {
        const batch = evt.sources || [];
        if (batch.length) setSources((prev) => prev.concat(batch));
        return;
      }

      if (evt.kind === 'done') {
        requestIdRef.current = null;            // scan finished
        setSummaryText(summaryFromDone(evt));
      }
    };
  }, []);

  useEffect(() => {
    const api = fluxApi();
    if (api && typeof api.onStreamsProgress === 'function') {
      api.onStreamsProgress((evt) => {
        if (handlerRef.current) handlerRef.current(evt);
      });
    }
  }, []);

  const scanning = summaryText === null && scanError === null;

  return { sources, providerCount, summaryText, scanError, scanning, startScan, stopScan, reset };
}

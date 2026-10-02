/* ── Search orchestration (debounce + stale-response guard) ────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import { doSearch } from '../lib/cinemeta.js';

export function useSearch() {
  const [items, setItems] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');
  const seqRef = useRef(0);
  const debounceRef = useRef(null);

  const runSearch = useCallback(async (query, { onLoading, onDone } = {}) => {
    const seq = ++seqRef.current;
    if (onLoading) onLoading();
    try {
      const found = await doSearch(query);
      if (seq !== seqRef.current) return;
      if (onDone) onDone(query, found);
    } catch (_err) {
      if (seq !== seqRef.current) return;
      if (onDone) {
        onDone(query, null,
          'Couldn\u2019t reach the search service. Check your connection and try again.');
      }
    }
  }, []);

  const scheduleSearch = useCallback((query, { onLoading, onDone, onEmpty }) => {
    clearTimeout(debounceRef.current);
    if (!query) {
      seqRef.current++;                       // invalidate in-flight searches
      if (onEmpty) onEmpty();
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(query, { onLoading, onDone }), 400);
  }, [runSearch]);

  const cancelDebounce = useCallback(() => {
    clearTimeout(debounceRef.current);
  }, []);

  const invalidate = useCallback(() => {
    seqRef.current++;
  }, []);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  return { items, setItems, errorMsg, setErrorMsg, runSearch, scheduleSearch, cancelDebounce, invalidate, seqRef };
}

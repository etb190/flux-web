/* ── Settings overlay: home page API keys + country ─────────────────────── */

import { useEffect, useRef, useState } from 'react';
import { CloseIcon } from './icons.jsx';

export default function SettingsModal({ open, onClose, onSaved }) {
  const [saaKey, setSaaKey] = useState('');
  const [saaCountry, setSaaCountry] = useState('us');
  const [tmdbKey, setTmdbKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveLabel, setSaveLabel] = useState('Save');
  const savingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setSaving(false);
    savingRef.current = false;
    setSaveLabel('Save');

    const api = window.fluxAPI;
    (async () => {
      if (api && typeof api.getSettings === 'function') {
        try {
          const s = await api.getSettings();
          if (s) {
            setSaaKey(s.saaApiKey || '');
            setSaaCountry(s.saaCountry || 'us');
            setTmdbKey(s.tmdbApiKey || '');
          }
        } catch (_err) { /* leave the form as-is */ }
      }
    })();
  }, [open]);

  if (!open) return null;

  async function save() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const api = window.fluxAPI;
    try {
      if (api && typeof api.saveSettings === 'function') {
        await api.saveSettings({
          saaApiKey: saaKey.trim(),
          saaCountry: saaCountry.trim(),
          tmdbApiKey: tmdbKey.trim()
        });
      }
      savingRef.current = false;
      setSaving(false);
      setSaveLabel('Saved \u2713');
      if (onSaved) onSaved();
      setTimeout(() => {
        onClose();
        setSaveLabel('Save');
      }, 650);
    } catch (_err) {
      savingRef.current = false;
      setSaving(false);
      setSaveLabel('Save');
    }
  }

  return (
    <div
      data-testid="settings-view"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();   // click on backdrop
      }}
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6"
    >
      <div className="w-full max-w-xl max-h-[85vh] overflow-y-auto scroll-dark rounded-2xl bg-raised border border-edge shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-edge">
          <span className="text-lg font-semibold">Settings</span>
          <button
            data-testid="settings-close"
            title="Close"
            aria-label="Close settings"
            onClick={onClose}
            className="p-1.5 rounded-lg text-dim hover:text-ink hover:bg-hover"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="px-6 py-5">
          <label className="block text-sm font-medium mb-2" htmlFor="settings-saa-key">
            Streaming Availability API key
          </label>
          <input
            id="settings-saa-key"
            data-testid="settings-saa-key"
            type="password"
            value={saaKey}
            placeholder="motn-key-... or RapidAPI key"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setSaaKey(e.target.value)}
            className="w-full rounded-lg bg-bg border border-edge px-3 py-2 text-sm text-ink outline-none placeholder:text-dim focus:border-accent"
          />
          <p className="mt-2 text-xs leading-relaxed text-dim">
            Fills the home page service rows (daily Top&nbsp;10s, popular per
            service, new &amp; leaving soon). A working key ships built in —
            replace it with your own free key from{' '}
            <a className="text-accent hover:underline" href="https://developers.movieofthenight.com">
              developers.movieofthenight.com
            </a>{' '}
            if it runs out of quota. Clear the field to hide the service rows.
          </p>

          <label className="block text-sm font-medium mt-4 mb-2" htmlFor="settings-saa-country">
            Country (home catalogs)
          </label>
          <input
            id="settings-saa-country"
            data-testid="settings-saa-country"
            type="text"
            value={saaCountry}
            placeholder="us"
            maxLength={2}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setSaaCountry(e.target.value)}
            className="w-24 rounded-lg bg-bg border border-edge px-3 py-2 text-sm text-ink outline-none placeholder:text-dim focus:border-accent"
          />
          <p className="mt-2 text-xs text-dim">Two-letter code: us, gb, fr, es, it, ma&hellip;</p>

          <label className="block text-sm font-medium mt-4 mb-2" htmlFor="settings-tmdb-key">
            TMDB API key (v3)
          </label>
          <input
            id="settings-tmdb-key"
            data-testid="settings-tmdb-key"
            type="password"
            value={tmdbKey}
            placeholder="TMDB v3 API key"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setTmdbKey(e.target.value)}
            className="w-full rounded-lg bg-bg border border-edge px-3 py-2 text-sm text-ink outline-none placeholder:text-dim focus:border-accent"
          />
          <p className="mt-2 text-xs leading-relaxed text-dim">
            Powers the <strong className="text-ink">Trending This Week</strong> row
            and the &ldquo;Because you watched &hellip;&rdquo; suggestion rows.
            Get a free key at{' '}
            <a className="text-accent hover:underline" href="https://www.themoviedb.org/settings/api">
              themoviedb.org/settings/api
            </a>. Clear it to hide those rows.
          </p>
        </div>

        <div className="px-6 py-4 border-t border-edge flex justify-end">
          <button
            data-testid="settings-save"
            onClick={save}
            disabled={saving}
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-60"
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

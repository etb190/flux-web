/* ── Subtitle menu (Helix PlayerSubtitleMenu equivalent) ───────────────── */

import { fmtDelay } from '../lib/format.js';
import { CloseIcon, RefreshIcon } from './icons.jsx';

export default function SubtitleMenu({ subs, onClose, onRefresh, onDelayMinus, onDelayPlus, onDelayReset }) {
  const searching = subs.pending > 0;
  const showStatus =
    subs.menuNotice ||
    (searching
      ? subs.groups.length
        ? 'Searching additional subtitles online\u2026'
        : 'Searching subtitles\u2026'
      : !subs.groups.length && !subs.embedded.length
        ? 'No subtitles found for this title.'
        : null);

  return (
    <div
      data-testid="player-submenu"
      className="absolute right-4 top-16 w-[380px] max-h-[70%] flex flex-col rounded-xl bg-raised/95 backdrop-blur border border-edge shadow-2xl z-20 overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-edge shrink-0">
        <span className="font-semibold">Subtitles</span>
        <div className="flex items-center gap-1">
          <button
            data-testid="psm-refresh"
            title="Search subtitles again"
            aria-label="Search subtitles again"
            onClick={onRefresh}
            className="p-1.5 rounded-lg text-dim hover:text-ink hover:bg-hover"
          >
            <RefreshIcon />
          </button>
          <button
            data-testid="psm-close"
            title="Close"
            aria-label="Close subtitle menu"
            onClick={onClose}
            className="p-1.5 rounded-lg text-dim hover:text-ink hover:bg-hover"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {showStatus ? (
        <div data-testid="psm-status" className="px-4 py-2.5 text-sm text-dim border-b border-edge">
          {subs.menuNotice || showStatus}
        </div>
      ) : null}

      <div data-testid="psm-body" className="overflow-y-auto scroll-dark p-2 flex-1">
        {/* Off row (Helix: "Turn off subtitles") */}
        <div
          onClick={subs.off}
          className={
            'px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors hover:bg-hover ' +
            (!subs.selectedUrl && subs.embeddedActive == null
              ? 'text-accent font-medium bg-accent/10'
              : 'text-ink')
          }
        >
          Off
        </div>

        {/* Embedded tracks (HLS WebVTT tracks — Helix "Embedded" section) */}
        {subs.embedded.length ? (
          <>
            <div className="px-3 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-dim">
              Embedded
            </div>
            {subs.embedded.map((tr) => (
              <div
                key={tr.id}
                onClick={() => subs.selectEmbedded(tr.id)}
                className={
                  'flex items-center justify-between gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm hover:bg-hover ' +
                  (subs.embeddedActive === tr.id ? 'text-accent bg-accent/10' : 'text-ink')
                }
              >
                <span className="truncate">{tr.name || tr.lang || 'Subtitle track'}</span>
                <span className="rounded bg-hover px-1.5 py-0.5 text-[10px] font-semibold text-dim shrink-0">
                  Track
                </span>
              </div>
            ))}
          </>
        ) : null}

        {/* Language groups → variants */}
        {subs.groups.map((group) => (
          <div key={group.language}>
            <div className="px-3 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-dim">
              {group.language}
            </div>
            {group.variants.map((variant, vi) => {
              const isActive =
                subs.selectedUrl != null &&
                String(subs.selectedUrl) === String(variant.downloadUrl);
              const isLoading =
                subs.loadingUrl != null &&
                String(subs.loadingUrl) === String(variant.downloadUrl);
              return (
                <div
                  key={vi}
                  title={variant.title || ''}
                  onClick={() => {
                    if (!isActive && !isLoading) subs.selectVariant(variant);
                  }}
                  className={
                    'flex items-center justify-between gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm hover:bg-hover ' +
                    (isActive ? 'text-accent bg-accent/10' : 'text-ink')
                  }
                >
                  <span className="truncate">{variant.title || variant.language}</span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <span className="rounded bg-hover px-1.5 py-0.5 text-[10px] font-semibold text-dim">
                      {variant.providerName || 'Sub'}
                    </span>
                    {variant.format && variant.format !== 'srt' ? (
                      <span className="rounded bg-hover px-1.5 py-0.5 text-[10px] font-semibold text-gold">
                        {String(variant.format).toUpperCase()}
                      </span>
                    ) : null}
                    {isActive ? <span className="text-accent">✓</span> : null}
                    {isLoading ? <span className="psm-spinner" /> : null}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 px-4 py-3 border-t border-edge shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-dim mr-1">Timing</span>
        <button
          data-testid="psm-delay-minus"
          title="Subtitles 0.1s earlier"
          onClick={onDelayMinus}
          className="w-7 h-7 rounded-lg bg-hover border border-edge text-ink hover:border-accent"
        >
          &minus;
        </button>
        <span data-testid="psm-delay-value" className="text-sm text-ink min-w-[46px] text-center">
          {fmtDelay(subs.delay)}
        </span>
        <button
          data-testid="psm-delay-plus"
          title="Subtitles 0.1s later"
          onClick={onDelayPlus}
          className="w-7 h-7 rounded-lg bg-hover border border-edge text-ink hover:border-accent"
        >
          +
        </button>
        <button
          data-testid="psm-delay-reset"
          title="Reset timing"
          onClick={onDelayReset}
          className="ml-1 text-xs text-dim hover:text-ink underline"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

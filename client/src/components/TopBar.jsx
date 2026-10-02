/* ── Top bar: brand, global search, settings ───────────────────────────── */

import { SearchIcon, GearIcon } from './icons.jsx';

export default function TopBar({ query, onQueryChange, onEnter, onClear, onOpenSettings }) {
  return (
    <header className="app-drag flex items-center gap-6 bg-raised border-b border-edge px-6 py-3.5 shrink-0 z-10">
      <div className="flex items-center gap-2.5 select-none">
        <img src="./icon.png" alt="" className="w-[30px] h-[30px] rounded-lg" />
        <span className="text-[19px] font-bold tracking-wide bg-gradient-to-r from-[#8fb4ff] to-accent bg-clip-text text-transparent">
          Flux
        </span>
      </div>

      <div className="app-no-drag relative flex-1 max-w-[640px]">
        <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
        <input
          id="search"
          data-testid="search-input"
          type="text"
          value={query}
          placeholder="Search movies & series..."
          autoComplete="off"
          spellCheck={false}
          autoFocus
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onEnter();
          }}
          className="w-full rounded-full bg-bg border border-edge px-10 py-2.5 text-[15px] text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-dim focus:border-accent focus:shadow-[0_0_0_3px_rgba(91,140,255,0.35)]"
        />
        {query ? (
          <button
            data-testid="search-clear"
            title="Clear"
            aria-label="Clear search"
            onClick={onClear}
            className="app-no-drag absolute right-2 top-1/2 -translate-y-1/2 w-[26px] h-[26px] rounded-full text-dim text-lg leading-none hover:bg-hover hover:text-ink"
          >
            &times;
          </button>
        ) : null}
      </div>

      <button
        data-testid="settings-btn"
        title="Settings"
        aria-label="Settings"
        aria-haspopup="dialog"
        onClick={onOpenSettings}
        className="app-no-drag p-2 rounded-full text-dim hover:text-ink hover:bg-hover"
      >
        <GearIcon />
      </button>
    </header>
  );
}

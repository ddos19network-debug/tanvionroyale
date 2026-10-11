'use client';

/**
 * The STUDIO (provider) selector shared by Home, `/games` and the left menu.
 *
 * ONE control, ONE state, ONE list: the same component and the same public
 * provider data feed the Home page, the Games page and the sidebar, so the
 * studio the user picked on one surface is the studio the others show.
 *
 * THE LIST IS NEVER LITERAL. `providers` is whatever
 * `useCasinoProviders(product)` read from the public endpoint
 * `GET /casino/catalog/providers?product=…`; this file contains no provider
 * name, no provider id and no fallback studio. A provider added in Admin and
 * synced therefore appears on its own, and an empty API answer renders the
 * honest empty hint instead of an invented studio.
 *
 * "All Studios" is always the first chip and is the DEFAULT: it means every
 * active/visible provider of the product (no `provider` parameter at all),
 * never the first provider, never an empty id.
 *
 * RESPONSIVE (existing TANVIONROYALE patterns only):
 *   ≥ sm : horizontally scrollable / wrapping chip row, easy to browse.
 *   < sm : the compact `<select>` dropdown the catalog already had, so a phone
 *          never gets a giant overflowing row.
 *
 * Loading → skeleton (never a fake studio name).
 * Failure → inline error + Retry (never a silent wrong list).
 */
import type { CatalogProviderSummary } from '@tanvion-royale/types';
import {
  ALL_STUDIOS_LABEL,
  normalizeStudio,
  STUDIOS_HEADING,
  totalStudioGames,
} from '@/lib/casino/studio-query';

export interface StudioSelectorProps {
  /** Real active providers, straight from the public provider endpoint. */
  providers: readonly CatalogProviderSummary[];
  /** Selected studio id; `null` = All Studios. */
  selected: string | null;
  /** `null` = All Studios. */
  onSelect: (providerId: string | null) => void;
  /** First read in flight → skeleton. */
  loading?: boolean;
  /** Set only when NO list could be obtained at all. */
  error?: string | null;
  onRetry?: () => void;
  /** Overridable for pages that already own a heading. */
  heading?: string;
  /** Overridable hint rendered when the API reports zero active providers. */
  emptyHint?: string;
  className?: string;
}

const CHIP_BASE =
  'whitespace-nowrap rounded-full px-4 py-2 text-xs font-semibold transition sm:text-sm';
const CHIP_ACTIVE = 'bg-brand text-ink-950 shadow-[0_0_16px_rgba(20,184,166,0.35)]';
const CHIP_IDLE = 'bg-ink-800 text-slate-300 hover:bg-ink-700 hover:text-white';


export function StudioSelector({
  providers,
  selected,
  onSelect,
  loading = false,
  error = null,
  onRetry,
  heading = STUDIOS_HEADING,
  emptyHint = 'No studios are available right now. Studios appear here only after a provider catalog has been synced.',
  className = '',
}: StudioSelectorProps) {
  const active = normalizeStudio(selected);
  const total = totalStudioGames(providers);

  return (
    <div className={className} data-testid="studio-selector">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
          {heading}
        </p>
        {!loading && !error && total > 0 ? (
          <p className="text-[11px] text-slate-500">{total} games</p>
        ) : null}
      </div>

      {loading ? (
        <ul className="flex flex-wrap gap-2" aria-hidden>
          {Array.from({ length: 5 }).map((_, index) => (
            <li key={index} className="h-9 w-24 animate-pulse rounded-full bg-ink-800" />
          ))}
        </ul>
      ) : error && providers.length === 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-amber-200">{error}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="shrink-0 rounded-lg border border-brand/50 px-3 py-1.5 text-xs font-semibold text-brand transition hover:bg-brand hover:text-ink-950"
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : (
        <>
          {/* Desktop / tablet: browsable chips (scrolls instead of overflowing). */}
          <ul className="no-scrollbar -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
            <li className="shrink-0 snap-start">
              <button
                type="button"
                onClick={() => onSelect(null)}
                aria-pressed={active === null}
                className={`${CHIP_BASE} ${active === null ? CHIP_ACTIVE : CHIP_IDLE}`}
              >
                {ALL_STUDIOS_LABEL}
                {total > 0 ? ` (${total})` : ''}
              </button>
            </li>
            {providers.map((entry) => {
              const isActive = active === entry.id;
              return (
                <li key={entry.id} className="shrink-0 snap-start">
                  <button
                    type="button"
                    onClick={() => onSelect(entry.id)}
                    aria-pressed={isActive}
                    className={`${CHIP_BASE} ${isActive ? CHIP_ACTIVE : CHIP_IDLE}`}
                  >
                    {entry.name} ({entry.gameCount})
                  </button>
                </li>
              );
            })}
          </ul>

          {providers.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">{emptyHint}</p>
          ) : null}

          {/*
            Mobile: the compact dropdown the catalog already had, fed by the very
            same list. `aria-label` is unchanged so existing checks and screen
            readers keep working.
          */}
          <label className="mt-3 block sm:hidden">
            <span className="sr-only">Filter by studio</span>
            <select
              aria-label="Filter by studio"
              value={active ?? ''}
              onChange={(event) => onSelect(normalizeStudio(event.target.value))}
              className="w-full rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-sm text-slate-100 focus:border-brand/60 focus:outline-none"
            >
              <option value="">{ALL_STUDIOS_LABEL}</option>
              {providers.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} ({entry.gameCount})
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </div>
  );
}

'use client';

/**
 * STUDIOS block for the existing desktop left menu.
 *
 * SMALLEST COMPATIBLE CHANGE: `UserSidebar` keeps rendering exactly the same
 * sections (`userNavSections`) and simply appends this block underneath the
 * Games/Casino entry. The sidebar architecture itself is untouched — no new
 * navigation model, no nested-menu engine, no hard-coded items.
 *
 *   Games
 *     └── All Studios        → /games?product=casino
 *         ├── <studio A>     → /games?product=casino&provider=<REAL_ID>
 *         └── <studio B>     → /games?product=casino&provider=<REAL_ID>
 *
 * EVERY ROW IS DYNAMIC: the studios come from the public endpoint
 * `GET /casino/catalog/providers?product=…` (via `useCasinoProviders`), so a
 * provider added in Admin + synced shows up here with no frontend change, and a
 * deactivated provider disappears. No provider name/id appears in this file.
 *
 * PRODUCT SEPARATION: the caller passes the product of the page the user is on
 * (`?product=live` → live studios, otherwise casino), and each row links to
 * `/games?product=<same product>&provider=<id>`, so BIG LIVE CASINO never
 * shows a casino studio and vice versa.
 *
 * Loading → skeleton rows. Failure → inline retry. No active provider at all →
 * the block renders nothing rather than an invented studio.
 */
import Link from 'next/link';
import type { CatalogProviderSummary } from '@tanvion-royale/types';
import { useCasinoProviders } from '@/hooks/use-casino-providers';
import {
  allStudiosHref,
  ALL_STUDIOS_LABEL,
  isStudioRouteActive,
  normalizeStudio,
  STUDIOS_HEADING,
  studioHref,
  type StudioProduct,
} from '@/lib/casino/studio-query';

export interface StudioSidebarNavProps {
  /** Product whose studios are listed (casino | live). */
  product: StudioProduct;
  /** Current pathname, for the active-row highlight. */
  pathname: string;
  /** Studio currently selected in the URL (`null` = All Studios). */
  currentProvider: string | null;
}

export function StudioSidebarNav({
  product,
  pathname,
  currentProvider,
}: StudioSidebarNavProps) {
  const { providers, loading, error, reload } = useCasinoProviders(product);
  const selected = normalizeStudio(currentProvider);

  if (!loading && !error && providers.length === 0) return null;

  return (
    <div className="pt-2" data-testid="sidebar-studios">
      <p className="px-4 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
        {STUDIOS_HEADING}
      </p>
      <nav
        aria-label={`${STUDIOS_HEADING} navigation`}
        className="flex flex-col gap-0.5 px-2"
      >
        {loading ? (
          Array.from({ length: 3 }).map((_, index) => (
            <span
              key={index}
              className="h-8 animate-pulse rounded-md bg-ink-800"
              aria-hidden
            />
          ))
        ) : error && providers.length === 0 ? (
          <div className="px-3 py-1">
            <p className="text-[11px] text-amber-200">{error}</p>
            <button
              type="button"
              onClick={reload}
              className="mt-1 rounded border border-brand/50 px-2 py-1 text-[10px] font-semibold text-brand transition hover:bg-brand hover:text-ink-950"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <StudioRow
              href={allStudiosHref(product)}
              label={ALL_STUDIOS_LABEL}
              active={isStudioRouteActive({ pathname, product, selected, studioId: null })}
            />
            {providers.map((entry: CatalogProviderSummary) => (
              <StudioRow
                key={entry.id}
                href={studioHref(product, entry.id)}
                label={entry.name}
                count={entry.gameCount}
                active={isStudioRouteActive({
                  pathname,
                  product,
                  selected,
                  studioId: entry.id,
                })}
              />
            ))}
          </>
        )}
      </nav>
    </div>
  );
}

function StudioRow({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count?: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] transition ${
        active
          ? 'bg-teal-500/15 text-teal-300'
          : 'text-slate-400 hover:bg-ink-700 hover:text-slate-100'
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {typeof count === 'number' ? (
        <span className="shrink-0 text-[10px] text-slate-500">{count}</span>
      ) : null}
    </Link>
  );
}

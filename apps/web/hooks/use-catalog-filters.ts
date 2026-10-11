'use client';

/**
 * URL-canonical catalog selection (studio + category) for EVERY public catalog
 * surface — the Home page, `/games` and `/games?product=casino|live`.
 *
 * WHY THE URL IS THE STATE
 * -----------------------
 * The left menu, the Home selector, the provider cards, the Games selector, a
 * refresh, the back button and a pasted link all resolve to the same
 * `?product=&provider=&category=` contract, so they cannot disagree:
 *
 *   All Studios → /games?product=casino
 *   A studio    → /games?product=casino&provider=<REAL_PROVIDER_ID>
 *   + category  → /games?product=casino&provider=<id>&category=<slug>
 *
 * `null` is the only representation of "All Studios"; it is written by REMOVING
 * the parameter, so a blank `?provider=` can never reach the backend as a
 * provider named "".
 *
 * Selecting a studio never touches the category (and vice versa), so
 * "studio + category" and "studio + search" keep working together.
 */
import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  GAME_PARAM,
  readCategoryFromParams,
  readStudioFromParams,
  setQueryParam,
  STUDIO_PARAM,
  CATEGORY_PARAM,
} from '@/lib/casino/studio-query';

export interface UseCatalogFiltersOptions {
  /**
   * Legacy `?provider=` seed, used only when the URL carries no key at all
   * (e.g. a server-rendered `initialProvider` prop on the same page).
   */
  seedProvider?: string | null;
  /** Legacy `?category=` seed, used only when the URL carries no key at all. */
  seedCategory?: string | null;
  /**
   * Query keys dropped when the studio changes. The Games page passes
   * `['game']` so an open game from another studio is not kept selected.
   */
  clearOnStudioChange?: readonly string[];
}

export interface UseCatalogFiltersResult {
  /** Selected studio id, or null = ALL STUDIOS. */
  provider: string | null;
  /** Selected category slug, or null = every category. */
  category: string | null;
  setProvider: (providerId: string | null) => void;
  setCategory: (slug: string | null) => void;
  /** The href the current selection points at (same page, no reload). */
  currentHref: string;
}

export function useCatalogFilters(options: UseCatalogFiltersOptions): UseCatalogFiltersResult {
  const { seedProvider, seedCategory, clearOnStudioChange } = options;
  const router = useRouter();
  const pathname = usePathname() ?? '/games';
  const searchParams = useSearchParams();

  const query = searchParams?.toString() ?? '';
  const provider = readStudioFromParams(query, seedProvider);
  const category = readCategoryFromParams(query, seedCategory);
  const currentHref = query ? `${pathname}?${query}` : pathname;

  const commit = useCallback(
    (nextHref: string) => {
      // `replace` keeps the browser history free of one entry per chip click;
      // the back button therefore still returns to the PREVIOUS page instead of
      // walking through every intermediate studio.
      router.replace(nextHref, { scroll: false });
    },
    [router],
  );

  const setProvider = useCallback(
    (providerId: string | null) => {
      let href = setQueryParam(currentHref, STUDIO_PARAM, providerId);
      for (const key of clearOnStudioChange ?? []) href = setQueryParam(href, key, null);
      commit(href);
    },
    [clearOnStudioChange, commit, currentHref],
  );

  const setCategory = useCallback(
    (slug: string | null) => {
      // The studio is intentionally left untouched: a category change must
      // never reset the selected studio.
      commit(setQueryParam(currentHref, CATEGORY_PARAM, slug));
    },
    [commit, currentHref],
  );

  return useMemo(
    () => ({ provider, category, setProvider, setCategory, currentHref }),
    [provider, category, setProvider, setCategory, currentHref],
  );
}

/** Query keys a studio change must clear (the open game panel). */
export const GAME_DETAIL_PARAM = GAME_PARAM;

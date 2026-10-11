'use client';

/**
 * Shared PUBLIC partner-catalog data source.
 *
 * ONE hook for every public page that shows provider games (Home `/`, `/home`,
 * `/games`, `/games?product=…`). It is the single place that turns the existing
 * public catalog endpoint into renderable state, so a public page can never
 * silently fall back to placeholder data again.
 *
 * ENDPOINT (already public — `@Public()`, no admin token, no auth header):
 *   GET {NEXT_PUBLIC_API_URL}/casino/catalog?product=casino&page=1&pageSize=…
 * NEXT_PUBLIC_API_URL is already normalized to `…/api/v1` by
 * `lib/api/client.ts`. The backend wraps every response as `{success, data}`
 * and `apiFetch` unwraps it, so consumers read `response.games.items`.
 *
 * DEFAULT PROVIDER BEHAVIOUR (the regression this hook exists to prevent):
 *   `provider = null` (or "" / whitespace) means ALL active/visible providers —
 *   the request is sent WITHOUT a `provider` parameter. It never defaults to
 *   the first provider, a hard-coded provider, or an empty provider id.
 *
 * The pure helpers (`normalizeCatalogPage`, `matchesCatalogProvider`) are
 * exported separately so the data flow is testable on plain Node without a DOM
 * (see scripts/test-home-catalog-flow.cjs).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CatalogCategorySummary,
  CatalogGame,
  CatalogPage,
  CatalogProviderSummary,
  CatalogResponse,
} from '@tanvion-royale/types';
import { getCasinoCatalog, type CasinoProductParam } from '@/lib/api/casino';
import { describeApiError } from '@/lib/api/client';

/** One page of public catalog games, independent of the envelope it arrived in. */
export interface CatalogPageState {
  items: CatalogGame[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface UseCasinoCatalogOptions {
  product: CasinoProductParam;
  /** null/undefined/'' = ALL active/visible providers. */
  provider?: string | null;
  /** Category SLUG (not a display name). */
  category?: string | null;
  search?: string;
  pageSize?: number;
}

export interface UseCasinoCatalogResult extends CatalogPageState {
  /** Games on the current page that belong to the ACTIVE provider filter. */
  visibleGames: CatalogGame[];
  providers: CatalogProviderSummary[];
  categories: CatalogCategorySummary[];
  /** False when the provider integration is not configured server-side. */
  configured: boolean;
  available: boolean;
  /** Honest, secret-free reason when nothing can be shown. */
  message: string | null;
  lastSyncAt: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  /** Append the next page onto the current one. */
  loadMore: () => void;
  /** Re-run the current query from page 1. */
  reload: () => void;
}

const EMPTY_PAGE: CatalogPageState = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 0,
  hasMore: false,
};

/**
 * Maps a raw catalog payload to the page the UI renders.
 *
 * Deliberately tolerant: the documented shape is
 * `{ games: { items, total, page, pageSize, hasMore } }` inside the
 * `{success, data}` envelope, but a bare page is accepted too. A payload whose
 * page cannot be located yields an EMPTY page — never a crash, never a
 * fabricated list.
 */
export function normalizeCatalogPage(response: unknown): CatalogPageState {
  if (!response || typeof response !== 'object') return { ...EMPTY_PAGE };

  const envelope = response as Partial<CatalogResponse> & Record<string, unknown>;
  const candidate =
    (envelope.games as CatalogPage<CatalogGame> | undefined) ??
    (Array.isArray(envelope.items)
      ? ({
          items: envelope.items,
          total: envelope.total,
          page: envelope.page,
          pageSize: envelope.pageSize,
          hasMore: envelope.hasMore,
        } as CatalogPage<CatalogGame>)
      : undefined);

  const items = Array.isArray(candidate?.items) ? candidate.items : [];
  const total =
    typeof candidate?.total === 'number' && Number.isFinite(candidate.total)
      ? candidate.total
      : items.length;
  const page =
    typeof candidate?.page === 'number' && candidate.page >= 1 ? candidate.page : 1;

  return {
    items,
    total,
    page,
    pageSize:
      typeof candidate?.pageSize === 'number' && candidate.pageSize > 0
        ? candidate.pageSize
        : items.length,
    hasMore:
      typeof candidate?.hasMore === 'boolean'
        ? candidate.hasMore
        : items.length > 0 && items.length < total,
  };
}

/**
 * Punctuation/case-insensitive form of a studio key.
 *
 * Studio ids and studio names come from the PARTNER payload and routinely differ
 * only by case or separators ("pg-soft" vs "PG SOFT" vs "PgSoft"). The backend
 * matches `?provider=` against the exact `providerExternalId` / `providerName`
 * values it returned, so the client guard uses the same normalised comparison
 * and can never hide a game the server actually returned.
 */
function normalizeStudioKey(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Client-side guard for the provider (studio) filter.
 *
 * The backend already filters server-side, but matching here guarantees a
 * filtered view can never leak another studio's games if a studio value stops
 * being recognised upstream. It mirrors the backend's tolerant matching
 * (studio id, studio display name, `PartnerProvider` row id / row name and the
 * catalog-id prefix), so both the ids and the names the UI already hold keep
 * working.
 *
 * An EMPTY/absent filter matches EVERY game — "all studios", never "none".
 */
export function matchesCatalogProvider(
  game: CatalogGame,
  provider: string | null | undefined,
): boolean {
  const needle = provider?.trim().toLowerCase();
  if (!needle) return true;
  if (game.providerId?.toLowerCase() === needle) return true;
  if (game.provider?.toLowerCase() === needle) return true;
  // Catalog ids are `${providerId}:${externalId}`.
  if (game.id?.toLowerCase().startsWith(`${needle}:`) === true) return true;

  const target = normalizeStudioKey(needle);
  if (!target) return true;
  if (normalizeStudioKey(game.provider) === target) return true;
  return normalizeStudioKey(game.providerId) === target;
}


export function useCasinoCatalog(
  options: UseCasinoCatalogOptions,
): UseCasinoCatalogResult {
  const { product, provider, category, search, pageSize } = options;

  const [page, setPage] = useState<CatalogPageState>(EMPTY_PAGE);
  const [providers, setProviders] = useState<CatalogProviderSummary[]>([]);
  const [categories, setCategories] = useState<CatalogCategorySummary[]>([]);
  const [configured, setConfigured] = useState(true);
  const [available, setAvailable] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestRef = useRef<AbortController | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const load = useCallback(
    async (nextPage: number, append: boolean) => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;

      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      try {
        const response = await getCasinoCatalog(
          {
            product,
            // `null` → the parameter is omitted entirely (= all providers).
            provider: provider ?? undefined,
            category: category ?? undefined,
            search: search || undefined,
            page: nextPage,
            pageSize,
          },
          { signal: controller.signal },
        );

        const next = normalizeCatalogPage(response);
        setPage((previous) =>
          append ? { ...next, items: [...previous.items, ...next.items] } : next,
        );
        setProviders(Array.isArray(response?.providers) ? response.providers : []);
        setCategories(Array.isArray(response?.categories) ? response.categories : []);
        setConfigured(response?.configured !== false);
        setAvailable(response?.available === true);
        setMessage(response?.message ?? null);
        setLastSyncAt(response?.syncedAt ?? null);
      } catch (err) {
        if (controller.signal.aborted) return;
        if (!append) {
          setPage({ ...EMPTY_PAGE });
          setProviders([]);
          setCategories([]);
        }
        setError(describeApiError(err));
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [product, provider, category, search, pageSize],
  );

  /*
   * Every filter change re-runs the query from page 1. The dependency list IS
   * the query key (product + provider + category + search + pageSize), so a
   * page-1 response can never be reused for a different filter set.
   */
  useEffect(() => {
    void load(1, false);
    return () => requestRef.current?.abort();
  }, [load, reloadToken]);

  const visibleGames = useMemo(
    () => page.items.filter((game) => matchesCatalogProvider(game, provider)),
    [page.items, provider],
  );

  const loadMore = useCallback(() => {
    if (page.hasMore && !loading && !loadingMore) void load(page.page + 1, true);
  }, [load, page.hasMore, page.page, loading, loadingMore]);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  return {
    ...page,
    visibleGames,
    providers,
    categories,
    configured,
    available,
    message,
    lastSyncAt,
    loading,
    loadingMore,
    error,
    loadMore,
    reload,
  };
}


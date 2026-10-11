'use client';

/**
 * BIG CASINO / BIG LIVE CASINO catalog browser.
 *
 * ONE component serves both sections; the product is a required prop and is
 * sent to the backend on every request, so BIG CASINO can never render a
 * live-dealer table and BIG LIVE CASINO can never render a slot.
 *
 * DESIGN: this reuses the existing TANVIONROYALE visual language verbatim —
 * the same card shell (`CasinoGameCard`), the same category chips
 * (`CategoryNav`), the same ink/brand/slate tokens, the same
 * `rounded-xl border border-white/10 bg-ink-800` panels and the same
 * horizontal-scroll-on-mobile pattern. No new design system is introduced.
 *
 * DATA HONESTY: nothing is fabricated. When the provider is not configured,
 * unreachable or supplies no games for this product, the browser renders an
 * explicit "not configured / unavailable" state with a retry — never a fake
 * game list.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type {
  CatalogCategorySummary,
  CatalogGame,
  CatalogProviderSummary,
  CatalogResponse,
  CasinoCapabilityReport,
  CasinoLaunchMode,
} from '@tanvion-royale/types';
import { describeApiError } from '@/lib/api/client';
import {
  getCasinoCatalog,
  getCasinoRecentGames,
  getCasinoStatus,
  launchCasinoGame,
} from '@/lib/api/casino';
import { useCasinoProviders } from '@/hooks/use-casino-providers';
import { useCatalogFilters, GAME_DETAIL_PARAM } from '@/hooks/use-catalog-filters';
import { matchesCatalogProvider } from '@/hooks/use-casino-catalog';
import { useFavorites } from '@/hooks/use-favorites';
import { CategoryNav } from '@/components/home/CategoryNav';
import { buildGamesHref, pickStudioList } from '@/lib/casino/studio-query';
import { StudioSelector } from './studio-selector';
import { CasinoGameCard } from './casino-game-card';

const ALL_CATEGORIES = 'All';
const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 300;

export interface CasinoCatalogBrowserProps {
  /** `casino` → BIG CASINO, `live` → BIG LIVE CASINO. */
  product: 'casino' | 'live';
  heading: string;
  description: string;
}

export function CasinoCatalogBrowser({
  product,
  heading,
  description,
}: CasinoCatalogBrowserProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { favorites, toggleFavorite } = useFavorites();

  const selectedGameId = searchParams.get('game');

  const [status, setStatus] = useState<CasinoCapabilityReport | null>(null);
  const [categories, setCategories] = useState<CatalogCategorySummary[]>([]);
  const [providers, setProviders] = useState<CatalogProviderSummary[]>([]);
  const [games, setGames] = useState<CatalogGame[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [recent, setRecent] = useState<CatalogGame[]>([]);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [featuredOnly, setFeaturedOnly] = useState(false);

  /*
   * Studio / category are URL-canonical — the SAME contract the left menu, the
   * Home selector and the provider cards use. The URL is the only state, so a
   * refresh, a back/forward trip, a direct link and a sidebar click all restore
   * the same studio. Selecting a studio drops the open game panel (`?game=`)
   * because that game belongs to the previous studio.
   */
  const {
    provider: providerId,
    setProvider: setProviderId,
    category: categorySlug,
    setCategory: setCategorySlug,
  } = useCatalogFilters({ clearOnStudioChange: [GAME_DETAIL_PARAM] });

  /*
   * The studio chips come from the public provider endpoint (shared with the
   * sidebar and Home); the catalog response carries the same array and is only
   * a fallback for a failed provider request.
   */
  const studios = useCasinoProviders(product);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestRef = useRef<AbortController | null>(null);

  /* Debounced search — the stale request is aborted, so results can never
     arrive out of order. */
  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  /* Capability/health probe (secret-free). Failure is not fatal: the catalog
     request below reports its own honest state. */
  useEffect(() => {
    let cancelled = false;
    void getCasinoStatus()
      .then((report) => {
        if (!cancelled) setStatus(report);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [product]);

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
            category: categorySlug ?? undefined,
            provider: providerId ?? undefined,
            search: search || undefined,
            featured: featuredOnly || undefined,
            page: nextPage,
            pageSize: PAGE_SIZE,
          },
          { signal: controller.signal },
        );

        setGames((previous) =>
          append ? [...previous, ...response.games.items] : response.games.items,
        );
        setTotal(response.games.total);
        setHasMore(response.games.hasMore);
        setPage(response.games.page);
        setCategories(response.categories);
        setProviders(response.providers);
        setStatus((previous) => previous ?? toCapabilitySnapshot(response));
      } catch (err) {
        if (controller.signal.aborted) return;
        if (!append) {
          setGames([]);
          setTotal(0);
          setHasMore(false);
        }
        setError(describeApiError(err));
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [product, categorySlug, providerId, search, featuredOnly],
  );

  useEffect(() => {
    void load(1, false);
    return () => requestRef.current?.abort();
  }, [load]);

  /* "Recent" strip — only for a signed-in player and only when the backend
     reports real history; a failure simply hides the strip. */
  useEffect(() => {
    if (!selectedGameId) return;
    let cancelled = false;
    void getCasinoRecentGames(product)
      .then((items) => {
        if (!cancelled) setRecent(items);
      })
      .catch(() => {
        if (!cancelled) setRecent([]);
      });
    return () => {
      cancelled = true;
    };
  }, [product, selectedGameId]);

  /*
   * Client-side guard, identical to the one the shared catalog hook applies:
   * the backend already filters server-side, but a selected studio can never
   * leak another provider's titles even if a provider value stops being
   * recognised upstream. An EMPTY filter matches every game (All Studios).
   */
  const visibleGames = useMemo(
    () => games.filter((game) => matchesCatalogProvider(game, providerId)),
    [games, providerId],
  );

  const selectedGame = useMemo(
    () => visibleGames.find((game) => game.id === selectedGameId) ?? null,
    [visibleGames, selectedGameId],
  );

  const { list: studioList, error: studiosError } = useMemo(
    () =>
      pickStudioList({
        primary: studios.providers,
        fallback: providers,
        selected: providerId,
        product,
        error: studios.error,
      }),
    [studios.providers, studios.error, providers, providerId, product],
  );

  const categoryNames = useMemo(
    () => [ALL_CATEGORIES, ...categories.map((entry) => entry.name)],
    [categories],
  );
  const activeCategoryName = useMemo(() => {
    if (!categorySlug) return ALL_CATEGORIES;
    return categories.find((entry) => entry.slug === categorySlug)?.name ?? ALL_CATEGORIES;
  }, [categories, categorySlug]);

  const unavailableMessage =
    status && !status.configured
      ? status.message ??
        'The partner casino provider is not configured yet, so no games can be shown.'
      : null;

  /* Opening a game keeps the whole filter context in the URL. */
  function detailHref(gameId: string): string {
    return buildGamesHref({
      product,
      provider: providerId,
      category: categorySlug,
      game: gameId,
      path: pathname,
    });
  }

  function closeGame() {
    router.push(
      buildGamesHref({
        product,
        provider: providerId,
        category: categorySlug,
        path: pathname,
      }),
      { scroll: false },
    );
  }

  return (
    <section aria-label={heading} className="mt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white sm:text-3xl">{heading}</h1>
          <p className="mt-1 text-sm text-slate-400">{description}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              status?.environment === 'production'
                ? 'bg-brand/15 text-brand'
                : 'bg-amber-500/15 text-amber-300'
            }`}
          >
            {status?.environment === 'production' ? 'LIVE' : 'SANDBOX'}
          </span>
          <button
            type="button"
            onClick={() => setFeaturedOnly((value) => !value)}
            aria-pressed={featuredOnly}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              featuredOnly
                ? 'bg-brand text-ink-950'
                : 'bg-ink-800 text-slate-300 hover:bg-ink-700 hover:text-white'
            }`}
          >
            Featured
          </button>
        </div>
      </div>

      {/* Filters — the same control language used by the existing catalog. */}
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <label htmlFor={`${product}-game-search`} className="sr-only">
            Search {heading} games
          </label>
          <input
            id={`${product}-game-search`}
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={`Search ${heading} games`}
            autoComplete="off"
            className="w-full rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-brand/60 focus:outline-none"
          />
        </div>
      </div>

      {/*
        STUDIO SELECTOR — the same component, the same public provider list and
        the same `?provider=<id>` contract the left menu, Home and the provider
        cards use. The selection is written to the URL, so it survives a
        refresh, the back button and a shared link, and it is never reset by a
        category or search change.
      */}
      <div className="mt-4">
        <StudioSelector
          providers={studioList}
          selected={providerId}
          onSelect={setProviderId}
          loading={studios.loading}
          error={studiosError}
          onRetry={studios.reload}
        />
      </div>

      {categoryNames.length > 1 && (
        <div className="mt-4">
          <CategoryNav
            categories={categoryNames}
            active={activeCategoryName}
            onSelect={(name) => {
              setCategorySlug(
                name === ALL_CATEGORIES
                  ? null
                  : categories.find((entry) => entry.name === name)?.slug ?? null,
              );
            }}
          />
        </div>
      )}

      {unavailableMessage && (
        <p className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          {unavailableMessage}
        </p>
      )}

      {error && (
        <div className="mt-5 flex flex-col gap-3 rounded-lg border border-white/10 bg-ink-800/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-300">{error}</p>
          <button
            type="button"
            onClick={() => void load(1, false)}
            className="shrink-0 rounded-lg border border-brand/50 px-3 py-1.5 text-xs font-semibold text-brand transition hover:bg-brand hover:text-ink-950"
          >
            Retry
          </button>
        </div>
      )}

      {selectedGame && (
        <GameDetailPanel
          game={selectedGame}
          onClose={closeGame}
          demoSupported={status?.demoSupported ?? selectedGame.demoAvailable}
        />
      )}

      <div className="mt-5">
        {loading ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: 12 }).map((_, index) => (
              <li
                key={index}
                className="h-56 animate-pulse rounded-xl border border-white/10 bg-ink-800"
                aria-hidden
              />
            ))}
          </ul>
        ) : visibleGames.length === 0 ? (
          <p className="rounded-lg border border-white/10 bg-ink-800/60 p-4 text-sm text-slate-400">
            {providerId
              ? 'No games are available for this studio right now.'
              : featuredOnly
                ? 'No featured games are available for this product right now.'
                : 'No games are available for this product right now. Games appear here only after the partner catalog has been synced.'}
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs text-slate-500">
              {total} game{total === 1 ? '' : 's'}
              {search ? ` matching “${search}”` : ''}
            </p>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {visibleGames.map((game) => (
                <li key={game.id} className="min-w-0">
                  <CasinoGameCard
                    game={game}
                    product={product}
                    href={game.launchAvailable ? detailHref(game.id) : null}
                    favorite={favorites.has(game.id)}
                    onToggleFavorite={toggleFavorite}
                  />
                </li>
              ))}
            </ul>

            {hasMore && (
              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void load(page + 1, true)}
                  className="rounded-lg border border-brand/50 px-4 py-2 text-sm font-semibold text-brand transition hover:bg-brand hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingMore ? 'Loading…' : 'Load more games'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {recent.length > 0 && (
        <section aria-labelledby={`${product}-recent-heading`} className="mt-10">
          <h2
            id={`${product}-recent-heading`}
            className="mb-3 text-lg font-bold text-white sm:text-xl"
          >
            Recently played
          </h2>
          <ul className="no-scrollbar -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
            {recent.map((game) => (
              <li key={`recent-${game.id}`} className="w-36 shrink-0 snap-start sm:w-44">
                <CasinoGameCard
                  game={game}
                  product={product}
                  href={detailHref(game.id)}
                  favorite={favorites.has(game.id)}
                  onToggleFavorite={toggleFavorite}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

/**
 * Detail + launch panel.
 *
 * The browser only ever names a catalog id and a mode: the launch URL is
 * produced and structurally validated by the TANVIONROYALE backend, so no
 * client-supplied destination can be used (no open redirect).
 */
function GameDetailPanel({
  game,
  onClose,
  demoSupported,
}: {
  game: CatalogGame;
  onClose: () => void;
  demoSupported: boolean;
}) {
  const [busy, setBusy] = useState<CasinoLaunchMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);

  async function launch(mode: CasinoLaunchMode) {
    setBusy(mode);
    setError(null);
    setStatusText('Requesting a secure launch from TANVIONROYALE…');
    try {
      const response = await launchCasinoGame({ gameId: game.id, mode });
      setStatusText('Opening the game…');
      window.location.assign(response.url);
    } catch (err) {
      setError(describeApiError(err));
      setStatusText(null);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      aria-label={`${game.name} details`}
      className="mt-5 rounded-xl border border-white/10 bg-ink-800 p-4 sm:p-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row">
        {game.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote provider art; the image host allowlist must not be widened
          <img
            src={game.thumbnail}
            alt=""
            className="h-32 w-24 shrink-0 rounded-lg object-cover sm:h-40 sm:w-32"
          />
        ) : (
          <div className="flex h-32 w-24 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-teal-700/60 to-ink-900 p-2 text-center text-xs font-bold uppercase text-white/90 sm:h-40 sm:w-32">
            {game.name}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-white">{game.name}</h2>
              <p className="mt-0.5 text-sm text-slate-400">
                {game.provider} · {game.category ?? 'Casino'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-ink-700 hover:text-white"
            >
              Back to catalog
            </button>
          </div>

          {game.tags.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {game.tags.slice(0, 6).map((tag) => (
                <li
                  key={tag}
                  className="rounded-full bg-ink-700 px-2.5 py-1 text-[11px] font-semibold text-slate-300"
                >
                  {tag}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {game.launchAvailable ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void launch('REAL')}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === 'REAL' ? 'Launching…' : 'Play with real balance'}
              </button>
            ) : (
              <span className="rounded-lg bg-ink-700 px-4 py-2 text-sm font-semibold text-slate-400">
                Real-money launch unavailable
              </span>
            )}

            {game.demoAvailable && demoSupported && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void launch('DEMO')}
                className="rounded-lg border border-brand/50 px-4 py-2 text-sm font-semibold text-brand transition hover:bg-brand hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === 'DEMO' ? 'Launching…' : 'Try demo'}
              </button>
            )}
          </div>

          <p className="mt-3 text-xs text-slate-500">
            Played from your TANVIONROYALE wallet · provider status{' '}
            {game.status === 'ACTIVE' ? 'active' : 'inactive'}
          </p>

          {statusText && <p className="mt-2 text-xs text-slate-400">{statusText}</p>}
          {error && (
            <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              {error}
            </p>
          )}
        </div>
      </div>

      <p className="mt-4 text-xs text-slate-500">
        <Link
          href={
            game.productType === 'LIVE_CASINO' ? '/games?product=live' : '/games?product=casino'
          }
          className="text-brand hover:underline"
        >
          Back to the {game.productType === 'LIVE_CASINO' ? 'live casino' : 'casino'} catalog
        </Link>
      </p>
    </section>
  );
}

/** Fallback snapshot when /casino/status is unavailable but the catalog answered. */
function toCapabilitySnapshot(response: CatalogResponse): CasinoCapabilityReport {
  return {
    configured: response.configured,
    environment: response.environment,
    provider: response.provider,
    reachable: true,
    casino: response.productType === 'CASINO' && response.available,
    liveCasino: response.productType === 'LIVE_CASINO' && response.available,
    demoSupported: response.games.items.some((game) => game.demoAvailable),
    message: response.message,
    lastSyncAt: response.syncedAt,
    lastSyncError: null,
  };
}


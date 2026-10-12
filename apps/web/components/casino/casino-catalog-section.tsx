'use client';

/**
 * PUBLIC provider-game catalog section.
 *
 * Rendered by every public page that shows partner games — the Home page
 * (`/`, `/home`) and the Games page (`/games`, `/games?product=…`). All of them
 * read the SAME public endpoint through `useCasinoCatalog`, so every active /
 * visible provider's games show up everywhere instead of only on one route.
 *
 * ENDPOINT: GET {NEXT_PUBLIC_API_URL}/casino/catalog?product=<casino|live>
 * (public — no admin token, no auth header).
 *
 * DEFAULT = ALL STUDIOS. The studio selection is URL-canonical
 * (`?provider=<id>` via `useCatalogFilters`) and starts on `null`, which omits
 * the `provider` query parameter entirely. It never defaults to the first
 * provider and never sends an empty provider id.
 *
 * THE STUDIO LIST is the public `GET /casino/catalog/providers?product=…`
 * response (via `useCasinoProviders` + the shared `StudioSelector`), i.e. the
 * providers that are actually active for this product. No studio name or id is
 * written in this file, and the very same selector/list backs the left menu and
 * the Games page — one mechanism, not three.
 *
 * DESIGN: the existing TANVIONROYALE visual language verbatim — the same
 * `CasinoGameCard` shell, `CategoryNav` chips, `rounded-xl border
 * border-white/10 bg-ink-800` panels and the same dark ink/brand/slate tokens
 * used everywhere else. No new design system.
 *
 * DATA HONESTY: nothing is fabricated. When the catalog is not configured,
 * unreachable or genuinely empty, an explicit state with a retry is rendered —
 * never a fake game list and never a silent empty grid.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { CasinoProductParam } from '@/lib/api/casino';
import { useCasinoCatalog } from '@/hooks/use-casino-catalog';
import { useCasinoProviders } from '@/hooks/use-casino-providers';
import { useCatalogFilters } from '@/hooks/use-catalog-filters';
import { useFavorites } from '@/hooks/use-favorites';
import { CategoryNav } from '@/components/home/CategoryNav';
import { ProvidersSection } from '@/components/home/ProviderCard';
import { buildGamesHref, pickStudioList } from '@/lib/casino/studio-query';
import { StudioSelector } from './studio-selector';
import { CasinoGameCard } from './casino-game-card';

const ALL_CATEGORIES = 'All';
const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 300;

export interface CasinoCatalogSectionProps {
  product: CasinoProductParam;
  heading: string;
  description?: string;
  /** Pre-selected provider id from `?provider=` (null = all providers). */
  initialProvider?: string | null;
  /** Pre-selected category slug from `?category=`. */
  initialCategory?: string | null;
  /** Cap the rendered page (Home shows a teaser row, /games shows all). */
  limit?: number;
  /** Render the provider (studio) cards under the grid. */
  showProviders?: boolean;
}

export function CasinoCatalogSection({
  product,
  heading,
  description,
  initialProvider = null,
  initialCategory = null,
  limit,
  showProviders = false,
}: CasinoCatalogSectionProps) {
  const { favorites, toggleFavorite } = useFavorites();

  /*
   * The studio + category selection is URL-canonical, so the Home page, a
   * direct link, the back button and the Games page all agree. `null` (not ''
   * and not providers[0]) means "every active/visible provider"; a blank
   * `?provider=` is normalised to null so a blank link can never narrow the
   * catalog to nothing.
   */
  const {
    provider,
    setProvider,
    category: categorySlug,
    setCategory,
  } = useCatalogFilters({
    seedProvider: initialProvider,
    seedCategory: initialCategory,
  });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  /*
   * The studio list is the PUBLIC provider endpoint (one request shared with
   * the sidebar / other surfaces). The catalog response carries the very same
   * array and is only a fallback for when that request fails.
   */
  const studios = useCasinoProviders(product);

  // Debounced search — the stale request is aborted, so results never arrive
  // out of order.
  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const catalog = useCasinoCatalog({
    product,
    provider,
    category: categorySlug,
    search,
    pageSize: PAGE_SIZE,
  });

  const { visibleGames, providers, categories, loading, error } = catalog;

  const rendered = useMemo(
    () => (typeof limit === 'number' ? visibleGames.slice(0, limit) : visibleGames),
    [visibleGames, limit],
  );

  const categoryNames = useMemo(
    () => [ALL_CATEGORIES, ...categories.map((entry) => entry.name)],
    [categories],
  );
  const activeCategoryName = useMemo(() => {
    if (!categorySlug) return ALL_CATEGORIES;
    return categories.find((entry) => entry.slug === categorySlug)?.name ?? ALL_CATEGORIES;
  }, [categories, categorySlug]);

  // A selected provider is always listed, so a valid selection can be cleared.
  const { list: knownProviders, error: studiosError } = useMemo(
    () =>
      pickStudioList({
        primary: studios.providers,
        fallback: providers,
        selected: provider,
        product,
        error: studios.error,
      }),
    [studios.providers, studios.error, providers, provider, product],
  );

  /** Provider games always launch through the real catalog route. */
  function gameHref(gameId: string): string {
    return buildGamesHref({ product, provider, category: categorySlug, game: gameId });
  }

  const unavailableMessage =
    !catalog.configured
      ? catalog.message ??
        'The partner casino provider is not configured yet, so no games can be shown.'
      : null;

  return (
    <section aria-labelledby={`${product}-catalog-heading`}>
      <div className="flex flex-col gap-1">
        <h2
          id={`${product}-catalog-heading`}
          className="text-lg font-bold text-white sm:text-xl"
        >
          {heading}
        </h2>
        {description ? (
          <p className="text-xs text-slate-400 sm:text-sm">{description}</p>
        ) : null}
      </div>


      {/* Filters — the same control language as the rest of the catalog. */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <label htmlFor={`${product}-catalog-search`} className="sr-only">
            Search {heading} games
          </label>
          <input
            id={`${product}-catalog-search`}
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
        THE STUDIO SELECTOR — the same component, the same public provider list
        and the same URL contract the Games page and the left menu use. Selecting
        a studio here writes `?provider=<id>` (and back to All Studios removes
        it), so the choice survives a refresh, a back/forward trip and a shared
        link. The category below is untouched by a studio change.
      */}
      <div className="mt-4">
        <StudioSelector
          providers={knownProviders}
          selected={provider}
          onSelect={setProvider}
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
            onSelect={(name) =>
              setCategory(
                name === ALL_CATEGORIES
                  ? null
                  : categories.find((entry) => entry.name === name)?.slug ?? null,
              )
            }
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
            onClick={catalog.reload}
            className="shrink-0 rounded-lg border border-brand/50 px-3 py-1.5 text-xs font-semibold text-brand transition hover:border-brand hover:bg-brand hover:text-ink-950"
          >
            Retry
          </button>
        </div>
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
        ) : rendered.length === 0 ? (
          <p className="rounded-lg border border-white/10 bg-ink-800/60 p-4 text-sm text-slate-400">
            {provider
              ? 'No games are available for this provider right now.'
              : search
                ? `No games match “${search}” right now.`
                : error
                  ? 'The partner game catalog could not be loaded right now — use Retry above to try again.'
                  : 'No partner games are available yet. Games appear here only after the provider catalog has been synced.'}
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs text-slate-500">
              {catalog.total} game{catalog.total === 1 ? '' : 's'} from{' '}
              {providers.length} active provider{providers.length === 1 ? '' : 's'}
            </p>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {rendered.map((game) => (
                <li key={game.id} className="min-w-0">
                  <CasinoGameCard
                    game={game}
                    product={product}
                    href={game.launchAvailable ? gameHref(game.id) : null}
                    favorite={favorites.has(game.id)}
                    onToggleFavorite={toggleFavorite}
                  />
                </li>
              ))}
            </ul>

            {/*
              `hasMore` stays server-driven, and a teaser row (`limit`) links to
              the full catalog instead of offering a load-more it cannot use.
            */}
            {catalog.hasMore && typeof limit !== 'number' && (
              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  disabled={catalog.loadingMore}
                  onClick={catalog.loadMore}
                  className="rounded-lg border border-brand/50 px-4 py-2 text-sm font-semibold text-brand transition hover:border-brand hover:bg-brand hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {catalog.loadingMore ? 'Loading…' : 'Load more games'}
                </button>
              </div>
            )}

            {typeof limit === 'number' && catalog.hasMore && (
              <p className="mt-4 text-center text-xs text-slate-500">
                {/*
                  The teaser row hands over to the full Games page WITH the
                  studio the user picked here, so the selection made on Home is
                  never lost on the way to the full catalog.
                */}
                <Link
                  href={buildGamesHref({ product, provider, category: categorySlug })}
                  className="font-semibold text-brand hover:underline"
                >
                  View all {catalog.total} games
                </Link>
              </p>
            )}
          </>
        )}
      </div>

      {showProviders && knownProviders.length > 0 && (
        <div className="mt-10">
          <ProvidersSection items={knownProviders} product={product} />
        </div>
      )}
    </section>
  );
}


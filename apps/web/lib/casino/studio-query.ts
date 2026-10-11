/**
 * Canonical STUDIO (= backend "provider") selection contract.
 *
 * ONE module owns the studio vocabulary of the public UI, so the left menu, the
 * Home page and the Games page can never drift apart:
 *
 *   All Studios → /games?product=casino
 *   JILI        → /games?product=casino&provider=<REAL PROVIDER ROW ID>
 *
 * DESIGN RULES (all enforced here, not in the components):
 *   - NOTHING is hard-coded. There is no provider list, no provider id and no
 *     provider NAME in this file. The list always comes from the public
 *     catalog endpoint `GET /casino/catalog/providers?product=…`
 *     (see `lib/api/casino.ts` → `getCasinoProviders`), which returns
 *     `{ id, name, gameCount, productType }` per ACTIVE provider that actually
 *     holds ACTIVE games for that product.
 *   - "All Studios" is `null` (the absence of the parameter) — never the first
 *     provider, never an empty id, never a hard-coded fallback. A blank /
 *     whitespace `?provider=` is normalised to `null` for the same reason.
 *   - Filtering always uses the real provider identity (`id`) the endpoint
 *     returned, never a display name.
 *   - Casino and live stay separated: every href carries `product`, and the
 *     studio list is always the one of that product.
 *
 * PURE MODULE (no React, no DOM): every function here is directly testable on
 * plain Node, which is how the studio-selection regression tests drive the real
 * production code path.
 */
import type { CatalogProviderSummary } from '@tanvion-royale/types';

/** Products that own a provider (studio) list. Mirrors `CasinoProductParam`. */
export type StudioProduct = 'casino' | 'live';

/** The existing game page. Studio selections always land here. */
export const GAMES_PATH = '/games';

export const PRODUCT_PARAM = 'product';
export const STUDIO_PARAM = 'provider';
export const CATEGORY_PARAM = 'category';
export const GAME_PARAM = 'game';

/** UI wording. The backend keeps calling the same thing "provider". */
export const ALL_STUDIOS_LABEL = 'All Studios';
export const STUDIOS_HEADING = 'Studios';

export function studioProductType(product: StudioProduct): 'CASINO' | 'LIVE_CASINO' {
  return product === 'live' ? 'LIVE_CASINO' : 'CASINO';
}

/**
 * Normalises a `?provider=` value to the real provider id, or `null`.
 *
 * `null`/`undefined`/blank/whitespace all mean ALL STUDIOS. A repeated
 * parameter takes the first value, like the backend DTO does.
 */
export function normalizeStudio(value: string | string[] | null | undefined): string | null {
  const single = Array.isArray(value) ? value[0] : value;
  if (typeof single !== 'string') return null;
  const trimmed = single.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Same normalisation for a category slug (`?category=`). */
export function normalizeCategory(value: string | string[] | null | undefined): string | null {
  return normalizeStudio(value);
}

/** Which product a query string asks for. Unknown/missing ⇒ casino. */
export function studioProductFromQuery(value: string | string[] | null | undefined): StudioProduct {
  const single = Array.isArray(value) ? value[0] : value;
  return single === 'live' ? 'live' : 'casino';
}

/** Accepts `URLSearchParams`, `?a=1` or `a=1` and returns a real params object. */
export function toSearchParams(input: URLSearchParams | string | null | undefined): URLSearchParams {
  if (input instanceof URLSearchParams) return input;
  if (typeof input !== 'string') return new URLSearchParams();
  const query = input.startsWith('?') ? input.slice(1) : input;
  return new URLSearchParams(query);
}

function splitHref(href: string): { path: string; params: URLSearchParams } {
  const [rawPath, rawQuery = ''] = href.split('?');
  const hashAt = rawQuery.indexOf('#');
  const query = hashAt >= 0 ? rawQuery.slice(0, hashAt) : rawQuery;
  return { path: rawPath && rawPath.length > 0 ? rawPath : '/', params: new URLSearchParams(query) };
}

/**
 * Sets or removes ONE query parameter, preserving every other parameter and
 * their order. An empty/blank value DELETES the parameter — this is what makes
 * "All Studios" (`/games?product=casino`) the honest absence of a provider
 * instead of `?provider=`.
 */
export function setQueryParam(href: string, key: string, value: string | null | undefined): string {
  const { path, params } = splitHref(href);
  const cleaned = typeof value === 'string' ? value.trim() : '';
  if (cleaned.length > 0) params.set(key, cleaned);
  else params.delete(key);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}


/**
 * The studio the URL currently selects.
 *
 * `seedProvider` is only consulted when the URL carries NO `provider` key at
 * all (legacy links / SSR seeds). A present-but-blank value resolves to `null`
 * (All Studios) and is never replaced by the seed.
 */
export function readStudioFromParams(
  input: URLSearchParams | string | null | undefined,
  seedProvider?: string | null,
): string | null {
  const params = toSearchParams(input);
  if (params.has(STUDIO_PARAM)) return normalizeStudio(params.get(STUDIO_PARAM));
  return normalizeStudio(seedProvider);
}

/** The category slug the URL currently selects (same rules as the studio). */
export function readCategoryFromParams(
  input: URLSearchParams | string | null | undefined,
  seedCategory?: string | null,
): string | null {
  const params = toSearchParams(input);
  if (params.has(CATEGORY_PARAM)) return normalizeCategory(params.get(CATEGORY_PARAM));
  return normalizeCategory(seedCategory);
}

/** The full selection state of a games href — the "refresh / direct link" path. */
export function parseCatalogQuery(href: string): {
  product: StudioProduct;
  provider: string | null;
  category: string | null;
  game: string | null;
} {
  const { params } = splitHref(href);
  return {
    product: studioProductFromQuery(params.get(PRODUCT_PARAM)),
    provider: normalizeStudio(params.get(STUDIO_PARAM)),
    category: normalizeCategory(params.get(CATEGORY_PARAM)),
    game: normalizeStudio(params.get(GAME_PARAM)),
  };
}

export interface GamesHrefOptions {
  product: StudioProduct;
  /** null / omitted = All Studios. */
  provider?: string | null;
  category?: string | null;
  game?: string | null;
  /** Defaults to the existing games page — no parallel route is introduced. */
  path?: string;
}

/** Builds the canonical games href, e.g. `/games?product=casino&provider=<id>`. */
export function buildGamesHref(options: GamesHrefOptions): string {
  const { product, provider, category, game, path = GAMES_PATH } = options;
  let href = setQueryParam(path, PRODUCT_PARAM, product);
  href = setQueryParam(href, STUDIO_PARAM, provider ?? null);
  href = setQueryParam(href, CATEGORY_PARAM, category ?? null);
  href = setQueryParam(href, GAME_PARAM, game ?? null);
  return href;
}

/** `/games?product=<product>` — the "All Studios" destination. */
export function allStudiosHref(product: StudioProduct): string {
  return buildGamesHref({ product });
}

/** `/games?product=<product>&provider=<REAL_PROVIDER_ID>`. */

export interface PickStudioListOptions {
  /** The public provider list (canonical source). */
  primary: readonly CatalogProviderSummary[];
  /** Provider list carried by the catalog response, used when the fetch failed. */
  fallback?: readonly CatalogProviderSummary[];
  selected?: string | null;
  product?: StudioProduct;
  error?: string | null;
}

/**
 * Chooses the list the UI renders.
 *
 * The public provider endpoint wins. The catalog response — which carries the
 * very same public provider array — is only a safety net so a single failing
 * request cannot hide the selector. The error is surfaced ONLY when no list at
 * all could be obtained, so a failure can never be mistaken for "no studios".
 */
export function pickStudioList(options: PickStudioListOptions): {
  list: CatalogProviderSummary[];
  error: string | null;
} {
  const product = options.product ?? 'casino';
  const base = options.primary.length > 0 ? options.primary : (options.fallback ?? []);
  return {
    list: mergeSelectedStudio(base, options.selected ?? null, product),
    error: base.length > 0 ? null : (options.error ?? null),
  };
}

/** Real total across the returned providers (never derived from a page). */
export function totalStudioGames(providers: readonly CatalogProviderSummary[]): number {
  return providers.reduce((sum, entry) => sum + (Number(entry.gameCount) || 0), 0);
}

export interface StudioActiveOptions {
  pathname: string;
  /** Product the current URL is showing. */
  product: StudioProduct;
  /** Studio currently selected (`null` = All Studios). */
  selected: string | null;
  /** Studio of the rendered row (`null` for the All Studios row). */
  studioId: string | null;
}

/** True when a sidebar row is the destination the user is currently on. */
export function isStudioRouteActive(options: StudioActiveOptions): boolean {
  const { pathname, product, selected, studioId } = options;
  if (pathname !== GAMES_PATH && !pathname.startsWith(`${GAMES_PATH}/`)) return false;
  return normalizeStudio(selected) === normalizeStudio(studioId) && product === options.product;
}

export function studioHref(product: StudioProduct, providerId: string | null): string {
  return buildGamesHref({ product, provider: providerId });
}

/** Keeps a selected-but-unlisted studio visible so the filter stays clearable. */
export function mergeSelectedStudio(
  providers: readonly CatalogProviderSummary[],
  selected: string | null | undefined,
  product: StudioProduct = 'casino',
): CatalogProviderSummary[] {
  const id = normalizeStudio(selected);
  if (!id || providers.some((entry) => entry.id === id)) return [...providers];
  return [
    { id, name: id, gameCount: 0, productType: studioProductType(product) },
    ...providers,
  ];
}

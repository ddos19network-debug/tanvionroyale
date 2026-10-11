import { Logger } from '@nestjs/common';
import type { CasinoEnvironment, ProductType } from '@tanvion-royale/types';
import {
  BIGBANG_CATALOG_LIMIT_MAX,
  BIGBANG_DEFAULT_BASE_URL,
  BIGBANG_DEFAULT_CATALOG_CACHE_TTL_MS,
  BIGBANG_DEFAULT_CATALOG_PAGE_SIZE,
  isBigBangBaseUrl,
} from './bigbang.config';
import type {
  BigBangCategoriesResponse,
  BigBangGamesResponse,
  BigBangLaunchResponse,
  BigBangPagination,
} from './bigbang.interface';
import {
  CasinoProviderError,
  type CasinoCatalogProviderContract,
  type CasinoLaunchInput,
  type CasinoLaunchResult,
  type CasinoProviderCapabilities,
  type CasinoProviderHealth,
  type CasinoRemoteCategory,
  type CasinoRemoteGame,
  type CasinoRemoteGamePage,
  type CasinoRemoteGameQuery,
  type CasinoRemoteProvider,
} from '../casino/casino-provider.interface';

type CasinoProduct = Extract<ProductType, 'CASINO' | 'LIVE_CASINO'>;

/**
 * One normalized `GET /categories` entry.
 *
 * Named for the path it arrives on. NOTE: the provider documents this endpoint
 * as its PROVIDER list — its values are the provider slugs that a game reports
 * as its `category` / `provider_id` — so it is stored under the catalog's
 * category dimension unchanged. It is not evidence that N separate
 * `PartnerProvider` rows exist.
 */
interface BigBangCategoryEntry {
  externalId: string;
  name: string;
  slug: string;
  premium?: boolean;
}

export interface BigBangProviderOptions {
  name: string;
  environment: CasinoEnvironment;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  /**
   * Rows requested per `GET /games` call while walking the catalog.
   *
   * WHY THIS EXISTS: the walk used to ask for the documented MAXIMUM
   * (`BIGBANG_CATALOG_LIMIT_MAX` = 5000) in a single request. For the real
   * catalog (~1,860 games) that asks the provider to build and serialize the
   * ENTIRE catalog in one response, which does not fit the 10s budget and
   * aborted every sync with `TIMEOUT: BigBang request timed out after
   * 10000ms` — while `health()` (which probes `limit=1`) still reported the
   * provider as reachable. The maximum is a ceiling, not a page size. The walk
   * now takes bounded pages and the same `pagination.total` termination, so
   * the whole catalog is still read — just in several cheap calls.
   */
  catalogPageSize?: number;
  /**
   * Per-request budget for catalog reads. Defaults to `timeoutMs`; set a larger
   * value when the operator needs a bigger ceiling for a very large catalog.
   *
   * This covers EVERY catalog read performed by a sync — the paged games walk
   * AND the `GET /categories` provider list. `fetchCategories()` used to fall
   * back to the interactive `timeoutMs`, so a slow `/categories` aborted the
   * whole sync with `TIMEOUT: BigBang request timed out after 10000ms` even
   * though the games walk itself had a much larger budget.
   */
  catalogTimeoutMs?: number;
  /**
   * Budget for the cheap reachability probe (`GET /games?limit=1`).
   *
   * Defaults to `timeoutMs`. Kept separate from the catalog budget so raising
   * the catalog ceiling for a large inventory can never make the health check
   * hang the admin page for a minute.
   */
  healthTimeoutMs?: number;
  /**
   * Budget for an interactive launch/player call. Defaults to `timeoutMs`.
   *
   * The provider gives the operator 10s per seamless-wallet call, so this
   * stays the tight budget: a player that cannot be created or a game that
   * cannot be launched must fail fast, not hold a request open.
   */
  launchTimeoutMs?: number;
  /**
   * How long a completed catalog walk may be reused by the NEXT caller
   * (default 30s). This is what makes one sync read the catalog once instead of
   * once per consumer. Keep it short: the DB catalog remains the cache of
   * record, this only de-duplicates calls inside a single sync.
   */
  catalogCacheTtlMs?: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function text(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}
function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}
function booleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return null;
}
function first(source: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = text(source[key]);
    if (value) return value;
  }
  return null;
}
function firstFlag(source: Record<string, unknown>, keys: readonly string[]): boolean | null {
  for (const key of keys) {
    const value = booleanValue(source[key]);
    if (value !== null) return value;
  }
  return null;
}
function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
/** Case/punctuation-insensitive key for matching a game to a category. */
function categoryKey(value: string | null | undefined): string | null {
  const normalized = (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return normalized || null;
}
/** The documented ISO 639-1 primary subtag (`pt-BR` → `pt`). */
function language(value: string | undefined): string | null {
  const primary = (value ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return /^[a-z]{2}$/.test(primary) ? primary : null;
}

/**
 * A short, secret-free description of a TRANSPORT failure.
 *
 * `fetch` collapses DNS, TCP, TLS and connection-reset into a generic
 * "fetch failed" and hides the real reason on `cause.code` (e.g. ENOTFOUND,
 * ECONNREFUSED, ETIMEDOUT, CERT_HAS_EXPIRED). Surfacing that code is what lets
 * an operator tell a wrong hostname from a provider outage — the difference
 * between "fix the base URL" and "wait for the provider".
 */
function describeTransportError(error: unknown): string {
  const outer = error instanceof Error ? error.message : 'unknown error';
  const cause = (error as { cause?: { code?: string; message?: string } } | null)?.cause;
  const code = typeof cause?.code === 'string' ? cause.code : null;
  if (code) return `${outer} (${code})`;
  return outer.slice(0, 120);
}

/**
 * BigBang adapter for the documented server-to-server endpoints only.
 *
 * The catalog is read with the documented `limit`/`offset` pagination (max
 * limit 5000) and terminated by the provider's OWN `pagination.total` — never
 * by the obsolete `page`/`per_page`/`last_page` fields and never by an arbitrary
 * page count. A response without pagination metadata is refused as a broken
 * contract instead of being guessed, so a catalog can never be silently
 * truncated.
 */
export class BigBangCasinoProvider implements CasinoCatalogProviderContract {
  private readonly logger = new Logger(BigBangCasinoProvider.name);
  /**
   * In-flight catalog walk, shared by every caller in the current sync cycle.
   *
   * `capabilities()`, `listCategories()` (called once per product) and
   * `listGames()` all need the whole inventory, and a sync AWAITS them one after
   * another — so simply deduplicating an in-flight promise is not enough: the
   * next caller would start the walk again the moment the previous one settled.
   * The completed result is therefore held for a short `catalogCacheTtlMs`
   * window, which collapses one sync into a single catalog read while never
   * serving a stale catalog to a later request. Failures are never cached, so a
   * retry always re-contacts the provider.
   */
  private catalogWalk: Promise<CasinoRemoteGame[]> | null = null;
  private catalogCache: { games: CasinoRemoteGame[]; expiresAt: number } | null = null;
  /** Same per-sync snapshot discipline for the `GET /categories` provider list. */
  private categorySnapshot:
    | { categories: BigBangCategoryEntry[]; expiresAt: number }
    | null = null;
  private categoryRead: Promise<BigBangCategoryEntry[]> | null = null;
  constructor(private readonly options: BigBangProviderOptions) {}
  get name(): string {
    return this.options.name;
  }
  get environment(): CasinoEnvironment {
    return this.options.environment;
  }
  isConfigured(): boolean {
    return Boolean(
      this.options.apiKey &&
        this.options.baseUrl === BIGBANG_DEFAULT_BASE_URL &&
        isBigBangBaseUrl(this.options.baseUrl),
    );
  }

  async health(): Promise<CasinoProviderHealth> {
    const started = Date.now();
    if (!this.isConfigured()) {
      return {
        reachable: false,
        latencyMs: null,
        providersUp: null,
        message: 'BigBang provider is not configured.',
      };
    }
    try {
      const body = await this.request<BigBangGamesResponse>(
        'GET',
        '/games',
        { query: { limit: '1', offset: '0' } },
        { timeoutMs: this.options.healthTimeoutMs },
      );
      // A catalog answer without the documented pagination block is a broken
      // contract (the integration could not sync), so the provider is honestly
      // reported as not usable rather than "reachable".
      this.readPagination(body);
      return {
        reachable: true,
        latencyMs: Date.now() - started,
        providersUp: null,
        message: null,
      };
    } catch (error) {
      return {
        reachable: false,
        latencyMs: null,
        providersUp: null,
        message: error instanceof Error ? error.message : 'BigBang provider unreachable.',
      };
    }
  }

  async capabilities(): Promise<CasinoProviderCapabilities> {
    if (!this.isConfigured()) {
      return { casino: false, liveCasino: false, demoSupported: false, source: 'unavailable' };
    }
    try {
      // Derived from the provider's own inventory, never assumed.
      const games = await this.fetchAllGames();
      return {
        casino: games.some((game) => game.productType === 'CASINO'),
        liveCasino: games.some((game) => game.productType === 'LIVE_CASINO'),
        demoSupported: games.some((game) => game.demoAvailable),
        source: 'catalog',
      };
    } catch (error) {
      this.logger.warn(
        `BigBang capability probe failed: ${error instanceof Error ? error.message : 'error'}`,
      );
      return { casino: false, liveCasino: false, demoSupported: false, source: 'unavailable' };
    }
  }

  /**
   * The provider's own category list (`GET /categories`: id, name, slug,
   * premium) — NOT re-derived from the games endpoint. Each entry keeps the
   * slug as its external id, because that is the value BigBang also reports as
   * a game's `category` / `provider_id`, which is what the catalog needs to
   * link a game to its category.
   *
   * `gameCount` is the number of catalogued games of the requested product in
   * that category. The product type is whatever the caller asked for (the
   * provider does not declare one per category), so the pre-existing safe
   * fallback is preserved instead of inventing a product type.
   */
  async listCategories(productType?: CasinoProduct): Promise<CasinoRemoteCategory[]> {
    const [categories, games] = await Promise.all([
      this.fetchCategories(),
      this.fetchAllGames(),
    ]);

    const counts = new Map<string, number>();
    for (const game of games) {
      if (productType && game.productType !== productType) continue;
      const keys = new Set<string>();
      for (const raw of [game.categoryExternalId, game.categoryName]) {
        const key = categoryKey(raw);
        if (key) keys.add(key);
      }
      for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const resolvedProduct: CasinoProduct = productType ?? 'CASINO';
    return categories.map((category) => {
      const byId = categoryKey(category.externalId) ?? '';
      const byName = categoryKey(category.name) ?? '';
      return {
        externalId: category.externalId,
        name: category.name,
        slug: category.slug,
        productType: resolvedProduct,
        gameCount: Math.max(counts.get(byId) ?? 0, counts.get(byName) ?? 0),
        ...(category.premium === undefined ? {} : { premium: category.premium }),
      };
    });
  }

  async listProviders(): Promise<CasinoRemoteProvider[]> {
    const games = await this.fetchAllGames();
    const providers = new Map<string, { count: number; live: boolean }>();
    for (const game of games) {
      const current = providers.get(game.providerExternalId) ?? { count: 0, live: false };
      current.count += 1;
      current.live ||= game.productType === 'LIVE_CASINO';
      providers.set(game.providerExternalId, current);
    }
    return [...providers.entries()].map(([externalId, value]) => ({
      externalId,
      name: externalId,
      gameCount: value.count,
      liveCapable: value.live,
    }));
  }

  async listGames(query: CasinoRemoteGameQuery): Promise<CasinoRemoteGamePage> {
    const all = await this.fetchAllGames();
    const search = (query.search ?? '').trim().toLowerCase();
    const filtered = all.filter(
      (game) =>
        (!query.productType || game.productType === query.productType) &&
        (!query.providerExternalId || game.providerExternalId === query.providerExternalId) &&
        (!query.categoryExternalId || game.categoryExternalId === query.categoryExternalId) &&
        (!search ||
          `${game.name} ${game.providerName} ${game.categoryName ?? ''}`
            .toLowerCase()
            .includes(search)),
    );
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.max(query.pageSize ?? 48, 1);
    const start = (page - 1) * pageSize;
    return {
      items: filtered.slice(start, start + pageSize),
      total: filtered.length,
      page,
      pageSize,
      hasMore: start + pageSize < filtered.length,
    };
  }

  async getGame(externalId: string): Promise<CasinoRemoteGame | null> {
    return (await this.fetchAllGames()).find((game) => game.externalId === externalId) ?? null;
  }

  /**
   * `POST /games/launch` with the DOCUMENTED payload.
   *
   * Real money identifies the player with the `user_token` TANVION issued (the
   * stable, non-identifying player id) — the seamless `user_data` endpoint
   * provisions the player from it, so no player is ever created here and the
   * old, undocumented `POST /users/create { username, currency }` call (which
   * does not match the provider's create-player contract, whose payload is
   * `{ user_token, username?, country? }` and which carries no currency) is
   * gone. DEMO mode sends `demo: true` and no player identity at all.
   */
  async launch(input: CasinoLaunchInput): Promise<CasinoLaunchResult> {
    const gameId = this.parseGameId(input.externalGameId);
    const locale = language(input.locale);

    const body = await this.request<BigBangLaunchResponse>(
      'POST',
      '/games/launch',
      {
        body: {
          game_id: gameId,
          ...(input.mode === 'DEMO' ? { demo: true } : { user_token: input.playerId }),
          ...(locale ? { language: locale } : {}),
        },
      },
      { timeoutMs: this.options.launchTimeoutMs },
    );

    if (!body.game_url) {
      throw new CasinoProviderError(
        'BigBang launch response did not contain game_url',
        'INVALID_RESPONSE',
      );
    }
    return {
      url: body.game_url,
      // Present for Standard games; Premium launches answer without a session.
      providerSessionId: text(body.session_id),
      providerRoundId: null,
    };
  }

  async launchDemo(input: Omit<CasinoLaunchInput, 'playerId'>): Promise<CasinoLaunchResult> {
    return this.launch({ ...input, playerId: '', mode: 'DEMO' });
  }

  async closeSession(_providerSessionId: string): Promise<void> {
    /* No documented BigBang close endpoint. */
  }

  private parseGameId(value: string): number {
    if (!/^\d+$/.test(value)) {
      throw new CasinoProviderError('BigBang game id is not numeric', 'INVALID_RESPONSE');
    }
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new CasinoProviderError('BigBang game id is invalid', 'INVALID_RESPONSE');
    }
    return id;
  }

  // --------------------------------------------------------------------------
  // Catalog (documented limit/offset pagination only)
  // --------------------------------------------------------------------------

  /**
   * Walks the WHOLE catalog with the documented `limit`/`offset` paging.
   *
   * The loop ends when the provider's own `pagination.total` has been reached
   * (`offset >= total`) — never on an arbitrary page count — so a 6,000+ game
   * catalog is read completely. It always progresses (offset grows by the rows
   * actually returned) and stops on an empty page, so it terminates for any
   * truthful or empty response. A response WITHOUT pagination metadata is
   * refused loudly: the obsolete `page`/`per_page`/`last_page` fields are never
   * guessed, and no catalog is silently truncated.
   *
   * Pages are deliberately BOUNDED (`catalogPageSize`, never the 5000 maximum)
   * and the result is memoized, so a sync reads the catalog once in several
   * cheap calls instead of once per caller in a single oversized request.
   */
  private fetchAllGames(): Promise<CasinoRemoteGame[]> {
    const cached = this.catalogCache;
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.games);
    if (this.catalogWalk) return this.catalogWalk;

    const walk = this.walkCatalog()
      .then((games) => {
        const ttl = this.options.catalogCacheTtlMs ?? BIGBANG_DEFAULT_CATALOG_CACHE_TTL_MS;
        this.catalogCache = { games, expiresAt: Date.now() + Math.max(ttl, 0) };
        return games;
      })
      .finally(() => {
        this.catalogWalk = null;
      });
    this.catalogWalk = walk;
    return walk;
  }

  /** The bounded page size, clamped to the provider's documented maximum. */
  private catalogPageSize(): number {
    const configured = this.options.catalogPageSize ?? 0;
    const size = Number.isFinite(configured) && configured > 0 ? Math.trunc(configured) : 0;
    return Math.min(size || BIGBANG_DEFAULT_CATALOG_PAGE_SIZE, BIGBANG_CATALOG_LIMIT_MAX);
  }

  private async walkCatalog(): Promise<CasinoRemoteGame[]> {
    const games: CasinoRemoteGame[] = [];
    const pageSize = this.catalogPageSize();
    let offset = 0;

    try {
      for (;;) {
        const body = await this.request<BigBangGamesResponse>(
          'GET',
          '/games',
          { query: { limit: String(pageSize), offset: String(offset) } },
          { timeoutMs: this.options.catalogTimeoutMs },
        );
        const pagination = this.readPagination(body);
        const rows = Array.isArray(body.data) ? body.data : [];

        for (const raw of rows) {
          const game = this.normalizeGame(raw);
          if (game) games.push(game);
        }

        if (rows.length === 0) break;
        offset += rows.length;
        if (offset >= pagination.total) break;
      }

      return games;
    } catch (error) {
      // A failed walk must never be remembered, and a partially-read catalog
      // must never be cached: discard it so a retry re-reads the provider.
      this.catalogCache = null;
      throw error;
    }
  }

  /** The documented pagination block, or a hard failure — never a guess. */
  private readPagination(body: BigBangGamesResponse): BigBangPagination {
    const source = record(body.pagination);
    const total = numberValue(source?.['total']);
    const limit = numberValue(source?.['limit']);
    const offset = numberValue(source?.['offset']);
    if (
      total === null ||
      limit === null ||
      offset === null ||
      total < 0 ||
      limit < 0 ||
      offset < 0
    ) {
      throw new CasinoProviderError(
        'BigBang catalog response is missing the documented pagination metadata',
        'INVALID_RESPONSE',
      );
    }
    return { total, limit, offset };
  }

  /** `GET /categories` → the provider's own category (studio) list. */
  /**
   * The provider's own `GET /categories` list, already normalized.
   *
   * Named `BigBangCategoryEntry` because that is the path it arrives on; note
   * the provider documents this endpoint as its PROVIDER list (its values are
   * the provider slugs a game reports as its `category`/`provider_id`), so it
   * is stored under the catalog's category dimension unchanged.
   */
  private async fetchCategories(): Promise<BigBangCategoryEntry[]> {
    const cached = this.categorySnapshot;
    if (cached && cached.expiresAt > Date.now()) return cached.categories;
    if (this.categoryRead) return this.categoryRead;

    const read = this.request<BigBangCategoriesResponse>(
      'GET',
      '/categories',
      {},
      { timeoutMs: this.options.catalogTimeoutMs },
    )
      .then((body) => {
        const rows = Array.isArray(body.data) ? body.data : [];
        const categories = new Map<string, BigBangCategoryEntry>();

        for (const raw of rows) {
          const source = record(raw);
          if (!source) continue;
          const slugValue = first(source, ['slug']);
          const name = first(source, ['name']) ?? slugValue;
          // The slug (or the name) is what games report as their `category`, so it
          // is the link key; the numeric id is only a last resort.
          const externalId = slugValue ?? name ?? first(source, ['id']);
          if (!externalId) continue;
          const premium = firstFlag(source, ['premium']);
          categories.set(externalId, {
            externalId,
            name: name ?? externalId,
            slug: slug(slugValue ?? name ?? externalId) || slug(externalId),
            ...(premium === null ? {} : { premium }),
          });
        }

        const list = [...categories.values()];
        const ttl = this.options.catalogCacheTtlMs ?? BIGBANG_DEFAULT_CATALOG_CACHE_TTL_MS;
        // Same bounded reuse window as the games walk: one sync reads it once.
        this.categorySnapshot = { categories: list, expiresAt: Date.now() + Math.max(ttl, 0) };
        return list;
      })
      .finally(() => {
        this.categoryRead = null;
      });

    this.categoryRead = read;
    return read;
  }

  /**
   * Normalizes a catalog row using the DOCUMENTED fields first:
   *   id, name, title, provider, category, category_title, thumbnail, mode,
   *   is_premium, game_type, is_demo
   * The legacy aliases (game_id, game_name, provider_id, game_type) remain
   * accepted as a fallback, but never take priority.
   *
   * `name` is the provider's launch slug and `title` the human-readable game
   * title, so the display name is the title when the provider supplies one.
   * `game_type` decides the product: only the provider's own `live` value maps
   * to LIVE_CASINO — a CRASH game is a CASINO game (the ProductType enum has no
   * CRASH value) and the word "crash" alone never reclassifies anything.
   */
  private normalizeGame(raw: unknown): CasinoRemoteGame | null {
    const source = record(raw);
    if (!source) return null;

    const externalId = first(source, ['id', 'game_id']);
    const launchSlug = first(source, ['name', 'game_name']);
    const title = first(source, ['title']);
    const displayName = title ?? launchSlug;
    if (!externalId || !displayName) return null;

    const provider = first(source, ['provider', 'provider_id']);
    const category = first(source, ['category']);
    const categoryTitle = first(source, ['category_title']);
    const gameType = first(source, ['game_type'])?.toLowerCase() ?? null;
    const mode = first(source, ['mode'])?.toLowerCase() ?? null;
    const isPremium = firstFlag(source, ['is_premium', 'premium_available']);
    const isDemo = firstFlag(source, ['is_demo', 'demo_available']);
    const standardAvailable = firstFlag(source, ['standard_available']);
    const premiumAvailable = firstFlag(source, ['premium_available']);

    const providerSlug = provider ?? category ?? categoryTitle ?? gameType ?? 'unknown';
    const productType: CasinoProduct = gameType === 'live' ? 'LIVE_CASINO' : 'CASINO';

    return {
      externalId,
      name: displayName,
      slug: slug(launchSlug ?? displayName) || `game-${externalId}`,
      providerExternalId: providerSlug,
      providerName: provider ?? providerSlug,
      categoryExternalId: category ?? categoryTitle ?? provider ?? gameType ?? null,
      categoryName: categoryTitle ?? category ?? provider ?? gameType ?? null,
      thumbnail: first(source, ['thumbnail']),
      banner: null,
      // Provider metadata that has no column of its own is kept as tags so the
      // mode/premium/demo facts are not lost in the sync.
      tags: [
        gameType,
        mode,
        isPremium === true ? 'premium' : '',
        isPremium === false ? 'standard' : '',
        isDemo === true ? 'demo' : '',
      ].filter((tag): tag is string => Boolean(tag)),
      productType,
      isFeatured: false,
      launchAvailable: standardAvailable !== false || premiumAvailable !== false,
      demoAvailable: isDemo === true,
      active: firstFlag(source, ['active', 'is_active', 'enabled']) !== false,
    };
  }

  // --------------------------------------------------------------------------
  // HTTP client (server-to-server only; the key never leaves this process)
  // --------------------------------------------------------------------------

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: { query?: Record<string, string>; body?: unknown } = {},
    timeout: { timeoutMs?: number } = {},
  ): Promise<T> {
    if (!this.isConfigured()) {
      throw new CasinoProviderError('BigBang provider is not configured', 'NOT_CONFIGURED');
    }
    const query = options.query ? `?${new URLSearchParams(options.query).toString()}` : '';
    const body = options.body === undefined ? '' : JSON.stringify(options.body);
    const budget = timeout.timeoutMs ?? this.options.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budget);
    try {
      const response = await fetch(`${this.options.baseUrl}${path}${query}`, {
        method,
        headers: {
          Accept: 'application/json',
          'X-API-Key': this.options.apiKey,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body } : {}),
        signal: controller.signal,
      });
      if (!response.ok) {
        // Classify the provider's refusal instead of collapsing every non-2xx
        // into one opaque message: a rejected credential and a wrong path need
        // completely different operator action. The provider's own text (e.g.
        // "Invalid API key") is read from the body when present.
        const detail = await this.readErrorBody(response);
        const reason = detail ? `: ${detail}` : '';
        if (response.status === 401 || response.status === 403) {
          throw new CasinoProviderError(
            `BigBang rejected the API key (HTTP ${response.status})${reason}`,
            'UNAUTHORIZED',
            response.status,
          );
        }
        if (response.status === 404 || response.status === 405) {
          throw new CasinoProviderError(
            `BigBang does not serve ${path} (HTTP ${response.status})${reason}`,
            'INVALID_ENDPOINT',
            response.status,
          );
        }
        throw new CasinoProviderError(
          `BigBang request failed with status ${response.status}${reason}`,
          'PROVIDER_ERROR',
          response.status,
        );
      }
      const text = await response.text();
      if (!text.trim()) return {} as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new CasinoProviderError('BigBang returned malformed JSON', 'INVALID_RESPONSE');
      }
    } catch (error) {
      if (error instanceof CasinoProviderError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new CasinoProviderError(
          `BigBang request timed out after ${budget}ms`,
          'TIMEOUT',
        );
      }
      // Transport failure: DNS, TCP or TLS. Node reports the real cause on
      // `cause.code`, so the admin can tell "host not found" from
      // "connection refused" instead of only seeing "unreachable".
      throw new CasinoProviderError(
        `BigBang provider is unreachable (${describeTransportError(error)})`,
        'UNAVAILABLE',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Best-effort read of a provider error body.
   *
   * BigBang answers a refusal as `{ success:false, error:{ message } }`. The
   * message is provider-authored, contains no credential, and is the single
   * most useful thing to show an operator — so it is surfaced instead of being
   * dropped. Any parse/read failure yields null and the caller omits the
   * detail rather than failing the request.
   */
  private async readErrorBody(response: {
    text?: () => Promise<string>;
  }): Promise<string | null> {
    if (typeof response.text !== 'function') return null;
    try {
      const raw = await response.text();
      if (!raw.trim()) return null;
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const error = record(parsed)?.error;
        const message =
          typeof error === 'object' && error !== null
            ? text((error as Record<string, unknown>).message)
            : text(parsed.message);
        return message ? message.slice(0, 200) : null;
      } catch {
        return raw.trim().slice(0, 200);
      }
    } catch {
      return null;
    }
  }
}

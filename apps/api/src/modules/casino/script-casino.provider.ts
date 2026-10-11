import { Logger } from '@nestjs/common';
import type { CasinoEnvironment, ProductType } from '@tanvion-royale/types';
import { buildCasinoSignatureHeaders } from './casino-signature';
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
} from './casino-provider.interface';

type CasinoProduct = Extract<ProductType, 'CASINO' | 'LIVE_CASINO'>;

export interface ScriptCasinoProviderOptions {
  name: string;
  environment: CasinoEnvironment;
  /** Allowlisted provider origin (e.g. https://api.script.casino). */
  baseUrl: string;
  merchantId: string | null;
  secret: string | null;
  apiVersion: string;
  timeoutMs: number;
}

/** Record/unknown helpers — provider payloads are validated, never trusted. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function bool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstString(source: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = str(source[key]);
    if (value) return value;
  }
  return null;
}

function firstBool(source: Record<string, unknown>, keys: readonly string[]): boolean | null {
  for (const key of keys) {
    const value = bool(source[key]);
    if (value !== null) return value;
  }
  return null;
}

export function slugifyCasinoName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Implicit live-dealer signal when the provider omits an explicit type. */
const LIVE_SIGNAL = /(live|croupier|dealer|studio)/i;

/**
 * Script.Casino-style partner casino adapter (server-side ONLY).
 *
 * The browser never talks to this adapter: the backend calls the provider,
 * normalizes the payload and exposes it through the TANVION catalog API.
 * Credentials stay in the backend process — no header/secret ever reaches the
 * frontend, and the secret is never logged.
 *
 * Endpoints consumed (per the supplied API specification):
 *   GET /catalog/games, /catalog/categories, /catalog/providers,
 *       /catalog/games/{uuid}, /health/status
 *   POST /sessions/launch, /sessions/launch/demo, /sessions/{id}/close
 */
export class ScriptCasinoProvider implements CasinoCatalogProviderContract {
  private readonly logger = new Logger(ScriptCasinoProvider.name);

  constructor(private readonly options: ScriptCasinoProviderOptions) {}

  get name(): string {
    return this.options.name;
  }

  get environment(): CasinoEnvironment {
    return this.options.environment;
  }

  isConfigured(): boolean {
    return Boolean(this.options.baseUrl && this.options.merchantId && this.options.secret);
  }

  /** Allowlisted provider origin (launch destinations must match this). */
  get allowlistedOrigin(): string | null {
    try {
      return new URL(this.options.baseUrl).origin;
    } catch {
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // Monitoring
  // --------------------------------------------------------------------------

  async health(): Promise<CasinoProviderHealth> {
    const started = Date.now();
    try {
      const body = await this.request<unknown>('GET', '/health/status');
      const record = asRecord(body) ?? {};
      return {
        reachable: true,
        latencyMs: Date.now() - started,
        providersUp: num(record.providers_up) ?? num(record.providersUp) ?? null,
        message: firstString(record, ['status', 'message']),
      };
    } catch (error) {
      return {
        reachable: false,
        latencyMs: null,
        providersUp: null,
        message: error instanceof Error ? error.message : 'Provider unreachable',
      };
    }
  }

  // --------------------------------------------------------------------------
  // Catalog
  // --------------------------------------------------------------------------

  /**
   * Capabilities are verified against the provider's OWN inventory with two
   * minimal probe queries. When the provider cannot be reached the answer is
   * explicitly `false` + source 'unavailable' — never assumed.
   */
  async capabilities(): Promise<CasinoProviderCapabilities> {
    if (!this.isConfigured()) {
      return { casino: false, liveCasino: false, demoSupported: false, source: 'unavailable' };
    }
    try {
      const [casino, live] = await Promise.all([
        this.listGames({ productType: 'CASINO', page: 1, pageSize: 1 }),
        this.listGames({ productType: 'LIVE_CASINO', page: 1, pageSize: 1 }),
      ]);
      return {
        casino: casino.total > 0,
        liveCasino: live.total > 0,
        demoSupported:
          casino.items.some((g) => g.demoAvailable) || live.items.some((g) => g.demoAvailable),
        source: 'catalog',
      };
    } catch (error) {
      this.logger.warn(
        `Casino capability probe failed (provider=${this.options.name}, env=${
          this.options.environment
        }): ${error instanceof Error ? error.message : 'error'}`,
      );
      return { casino: false, liveCasino: false, demoSupported: false, source: 'unavailable' };
    }
  }

  async listCategories(productType?: CasinoProduct): Promise<CasinoRemoteCategory[]> {
    const body = await this.request<unknown>('GET', '/catalog/categories', {
      query: productType ? { type: this.providerTypeParam(productType) } : undefined,
    });
    const rows = this.extractList(body, ['categories', 'items', 'data']);
    const categories: CasinoRemoteCategory[] = [];
    const seen = new Set<string>();
    for (const raw of rows) {
      const record = asRecord(raw);
      if (!record) continue;
      const externalId = firstString(record, ['uuid', 'id', 'external_id', 'slug']);
      const name = firstString(record, ['name', 'title']);
      if (!externalId || !name) continue;
      if (seen.has(externalId)) continue;
      seen.add(externalId);
      categories.push({
        externalId,
        name,
        slug: firstString(record, ['slug']) ?? slugifyCasinoName(name),
        productType: this.resolveProductType(
          record,
          firstString(record, ['type', 'product', 'product_type']),
        ),
        gameCount: num(record.games_count) ?? num(record.gameCount) ?? num(record.games) ?? 0,
      });
    }
    return categories;
  }

  async listProviders(): Promise<CasinoRemoteProvider[]> {
    const body = await this.request<unknown>('GET', '/catalog/providers');
    const rows = this.extractList(body, ['providers', 'items', 'data']);
    const providers: CasinoRemoteProvider[] = [];
    const seen = new Set<string>();
    for (const raw of rows) {
      const record = asRecord(raw);
      if (!record) continue;
      const externalId = firstString(record, ['uuid', 'id', 'external_id', 'slug']);
      const name = firstString(record, ['name', 'title']);
      if (!externalId || !name) continue;
      if (seen.has(externalId)) continue;
      seen.add(externalId);
      providers.push({
        externalId,
        name,
        gameCount: num(record.games_count) ?? num(record.gameCount) ?? num(record.games) ?? 0,
        liveCapable: firstBool(record, ['live', 'live_casino', 'has_live']) ?? false,
      });
    }
    return providers;
  }

  async listGames(query: CasinoRemoteGameQuery = {}): Promise<CasinoRemoteGamePage> {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.max(query.pageSize ?? 48, 1);
    const params: Record<string, string> = { page: String(page), limit: String(pageSize) };
    if (query.productType) params.type = this.providerTypeParam(query.productType);
    if (query.providerExternalId) params.provider = query.providerExternalId;
    if (query.categoryExternalId) params.category = query.categoryExternalId;
    if (query.search) params.search = query.search;

    const body = await this.request<unknown>('GET', '/catalog/games', { query: params });
    const rows = this.extractList(body, ['games', 'items', 'data']);

    const items: CasinoRemoteGame[] = [];
    const seen = new Set<string>();
    for (const raw of rows) {
      const game = this.normalizeGame(raw);
      if (!game) continue;
      if (seen.has(game.externalId)) continue;
      seen.add(game.externalId);
      items.push(game);
    }

    const record = asRecord(body);
    const total =
      num(record?.total) ??
      num(asRecord(record?.meta)?.total) ??
      num(record?.count) ??
      items.length;
    const hasMore =
      firstBool(record ?? {}, ['has_more', 'hasMore']) ??
      (items.length > 0 && items.length >= pageSize);

    return { items, total, page, pageSize, hasMore };
  }

  async getGame(externalId: string): Promise<CasinoRemoteGame | null> {
    const body = await this.request<unknown>(
      'GET',
      `/catalog/games/${encodeURIComponent(externalId)}`,
    );
    const record = asRecord(body);
    const payload = asRecord(record?.game) ?? record;
    if (!payload) return null;
    return this.normalizeGame(payload);
  }

  // --------------------------------------------------------------------------
  // Sessions
  // --------------------------------------------------------------------------

  async launch(input: CasinoLaunchInput): Promise<CasinoLaunchResult> {
    const body = await this.request<unknown>(
      'POST',
      input.mode === 'DEMO' ? '/sessions/launch/demo' : '/sessions/launch',
      {
        body: {
          game: input.externalGameId,
          player: input.mode === 'DEMO' ? undefined : input.playerId,
          currency: input.currency,
          locale: input.locale,
          session: input.providerSessionId ?? undefined,
        },
      },
    );
    return this.readLaunchResult(body);
  }

  async launchDemo(input: Omit<CasinoLaunchInput, 'playerId'>): Promise<CasinoLaunchResult> {
    return this.launch({ ...input, playerId: '', mode: 'DEMO' });
  }

  async closeSession(providerSessionId: string): Promise<void> {
    await this.request<unknown>(
      'POST',
      `/sessions/${encodeURIComponent(providerSessionId)}/close`,
    );
  }

  // --------------------------------------------------------------------------
  // Normalization
  // --------------------------------------------------------------------------

  private providerTypeParam(productType: CasinoProduct): string {
    return productType === 'LIVE_CASINO' ? 'live' : 'casino';
  }

  /** Resolves CASINO vs LIVE_CASINO from explicit + implicit provider signals. */
  private resolveProductType(
    record: Record<string, unknown>,
    declared?: string | null,
  ): CasinoProduct {
    const explicit = (declared ?? '').toLowerCase();
    if (explicit.includes('live')) return 'LIVE_CASINO';
    if (explicit.includes('casino') || explicit.includes('slot')) return 'CASINO';
    if (firstBool(record, ['live', 'is_live', 'live_casino']) === true) return 'LIVE_CASINO';
    const haystack = [
      firstString(record, ['category', 'category_name', 'game_type', 'type', 'product']),
      firstString(record, ['provider', 'provider_name', 'studio']),
    ]
      .filter(Boolean)
      .join(' ');
    return LIVE_SIGNAL.test(haystack) ? 'LIVE_CASINO' : 'CASINO';
  }

  /**
   * Maps a provider payload onto the internal normalized shape.
   * Returns null for a payload without a provider id or a name — such an entry
   * cannot be represented honestly, so it is skipped (never invented).
   */
  private normalizeGame(raw: unknown): CasinoRemoteGame | null {
    const record = asRecord(raw);
    if (!record) return null;

    const externalId = firstString(record, ['uuid', 'id', 'external_id', 'game_id', 'code']);
    const name = firstString(record, ['name', 'title', 'game_name']);
    if (!externalId || !name) return null;

    const providerObj = asRecord(record.provider);
    const providerName =
      str(record.provider) ??
      firstString(providerObj ?? {}, ['name', 'title']) ??
      firstString(record, ['provider_name', 'studio', 'vendor']) ??
      'Partner';
    const providerExternalId =
      firstString(providerObj ?? {}, ['uuid', 'id', 'external_id', 'slug']) ??
      firstString(record, ['provider_id', 'provider_uuid']) ??
      slugifyCasinoName(providerName);

    const categoryObj = asRecord(record.category);
    const categoryName =
      str(record.category) ??
      firstString(categoryObj ?? {}, ['name', 'title']) ??
      firstString(record, ['category_name', 'game_type']);
    const categoryExternalId =
      firstString(categoryObj ?? {}, ['uuid', 'id', 'external_id', 'slug']) ??
      firstString(record, ['category_id', 'category_uuid']) ??
      (categoryName ? slugifyCasinoName(categoryName) : null);

    const tags: string[] = [];
    const rawTags = record.tags ?? record.labels;
    if (Array.isArray(rawTags)) {
      for (const tag of rawTags) {
        const value = typeof tag === 'string' ? tag : firstString(asRecord(tag) ?? {}, ['name']);
        if (value && !tags.includes(value)) tags.push(value);
      }
    }

    const status = (firstString(record, ['status', 'state']) ?? '').toLowerCase();
    const disabled = ['inactive', 'disabled', 'archived', 'removed', 'blocked'].includes(status);
    const maintenance = status === 'maintenance';
    const slug = firstString(record, ['slug']) ?? (slugifyCasinoName(name) || `game-${externalId}`);

    return {
      externalId,
      name,
      slug,
      providerExternalId,
      providerName,
      categoryExternalId,
      categoryName,
      thumbnail: firstString(record, [
        'thumbnail',
        'thumbnail_url',
        'image',
        'image_url',
        'cover',
        'icon',
      ]),
      banner: firstString(record, ['banner', 'banner_url', 'cover', 'cover_url']),
      tags,
      productType: this.resolveProductType(record),
      isFeatured: firstBool(record, ['is_featured', 'featured', 'hot']) ?? false,
      launchAvailable:
        firstBool(record, ['launch_available', 'launchAvailable', 'enabled']) ?? !disabled,
      // Demo is only ever advertised when the provider states it explicitly.
      demoAvailable: firstBool(record, ['demo', 'demo_available', 'has_demo', 'fun_mode']) ?? false,
      active: !disabled && !maintenance,
    };
  }

  private extractList(body: unknown, keys: readonly string[]): unknown[] {
    if (Array.isArray(body)) return body;
    const record = asRecord(body);
    if (!record) return [];
    for (const key of keys) {
      const value = record[key];
      if (Array.isArray(value)) return value;
      const nested = asRecord(value);
      if (nested) {
        for (const innerKey of ['items', 'data', 'results']) {
          if (Array.isArray(nested[innerKey])) return nested[innerKey] as unknown[];
        }
      }
    }
    return [];
  }

  private readLaunchResult(body: unknown): CasinoLaunchResult {
    const record = asRecord(body) ?? {};
    const nested = asRecord(record.data) ?? record;
    const url =
      firstString(nested, ['url', 'launch_url', 'game_url', 'redirect_url']) ??
      firstString(record, ['url', 'launch_url', 'game_url', 'redirect_url']);
    if (!url) {
      throw new CasinoProviderError(
        'Provider launch response did not contain a game URL',
        'INVALID_RESPONSE',
      );
    }
    return {
      url,
      providerSessionId: firstString(nested, ['session_id', 'sessionId', 'session']) ?? null,
      providerRoundId: firstString(nested, ['round_id', 'roundId', 'round']) ?? null,
    };
  }

  // --------------------------------------------------------------------------
  // HTTP (signed, timed out, secret never logged)
  // --------------------------------------------------------------------------

  private apiPath(path: string): string {
    const base = this.options.baseUrl.replace(/\/+$/, '');
    const versioned = /\/v\d+$/i.test(base) ? base : `${base}/${this.options.apiVersion}`;
    return `${versioned}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: { query?: Record<string, string>; body?: unknown } = {},
  ): Promise<T> {
    if (!this.isConfigured()) {
      throw new CasinoProviderError('Casino provider is not configured', 'NOT_CONFIGURED');
    }

    const query = options.query ? `?${new URLSearchParams(options.query).toString()}` : '';
    const url = `${this.apiPath(path)}${query}`;
    const rawBody = options.body === undefined ? '' : JSON.stringify(options.body);
    // Signing happens server-side only; the headers never leave this process
    // and the secret is never logged.
    const headers = buildCasinoSignatureHeaders(
      this.options.merchantId as string,
      this.options.secret as string,
      { method, path: `${path}${query}`, rawBody },
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          Accept: 'application/json',
          ...(rawBody ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        ...(rawBody ? { body: rawBody } : {}),
        signal: controller.signal,
      });

      const text = await response.text();
      if (!response.ok) {
        // The provider's error body is deliberately NOT logged: it can echo
        // request metadata. A safe structured message is enough.
        throw new CasinoProviderError(
          `Provider request failed with status ${response.status}`,
          'PROVIDER_ERROR',
          response.status,
        );
      }
      if (!text.trim()) return {} as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new CasinoProviderError('Provider returned malformed JSON', 'INVALID_RESPONSE');
      }
    } catch (error) {
      if (error instanceof CasinoProviderError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new CasinoProviderError(
          `Provider request timed out after ${this.options.timeoutMs}ms`,
          'TIMEOUT',
        );
      }
      throw new CasinoProviderError('Provider is unreachable', 'UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  }
}

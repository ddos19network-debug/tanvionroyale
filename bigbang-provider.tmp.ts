import { Logger } from '@nestjs/common';
import type { CasinoEnvironment, ProductType } from '@tanvion-royale/types';
import { BIGBANG_DEFAULT_BASE_URL, isBigBangBaseUrl } from './bigbang.config';
import type { BigBangGamesResponse, BigBangLaunchResponse } from './bigbang.interface';
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
export interface BigBangProviderOptions { name: string; environment: CasinoEnvironment; baseUrl: string; apiKey: string; timeoutMs: number; }
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function text(value: unknown): string | null { if (typeof value === 'string' && value.trim()) return value.trim(); if (typeof value === 'number' && Number.isFinite(value)) return String(value); return null; }
function numberValue(value: unknown): number | null { if (typeof value === 'number' && Number.isFinite(value)) return value; if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value); return null; }
function booleanValue(value: unknown): boolean | null { if (typeof value === 'boolean') return value; if (value === 1 || value === '1' || value === 'true') return true; if (value === 0 || value === '0' || value === 'false') return false; return null; }
function first(source: Record<string, unknown>, keys: readonly string[]): string | null { for (const key of keys) { const value = text(source[key]); if (value) return value; } return null; }
function firstFlag(source: Record<string, unknown>, keys: readonly string[]): boolean | null { for (const key of keys) { const value = booleanValue(source[key]); if (value !== null) return value; } return null; }
function slug(value: string): string { return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }

/** BigBang adapter for the documented server-to-server endpoints only. */
export class BigBangCasinoProvider implements CasinoCatalogProviderContract {
  private readonly logger = new Logger(BigBangCasinoProvider.name);
  constructor(private readonly options: BigBangProviderOptions) {}
  get name(): string { return this.options.name; }
  get environment(): CasinoEnvironment { return this.options.environment; }
  isConfigured(): boolean { return Boolean(this.options.apiKey && this.options.baseUrl === BIGBANG_DEFAULT_BASE_URL && isBigBangBaseUrl(this.options.baseUrl)); }

  async health(): Promise<CasinoProviderHealth> {
    const started = Date.now();
    if (!this.isConfigured()) return { reachable: false, latencyMs: null, providersUp: null, message: 'BigBang provider is not configured.' };
    try { await this.request<unknown>('GET', '/games', { query: { page: '1', per_page: '1' } }); return { reachable: true, latencyMs: Date.now() - started, providersUp: null, message: null }; }
    catch (error) { return { reachable: false, latencyMs: null, providersUp: null, message: error instanceof Error ? error.message : 'BigBang provider unreachable.' }; }
  }

  async capabilities(): Promise<CasinoProviderCapabilities> {
    if (!this.isConfigured()) return { casino: false, liveCasino: false, demoSupported: false, source: 'unavailable' };
    try {
      const [casino, live] = await Promise.all([this.listGames({ productType: 'CASINO', page: 1, pageSize: 1 }), this.listGames({ productType: 'LIVE_CASINO', page: 1, pageSize: 1 })]);
      return { casino: casino.total > 0, liveCasino: live.total > 0, demoSupported: false, source: 'catalog' };
    } catch (error) {
      this.logger.warn(`BigBang capability probe failed: ${error instanceof Error ? error.message : 'error'}`);
      return { casino: false, liveCasino: false, demoSupported: false, source: 'unavailable' };
    }
  }

  async listCategories(productType?: CasinoProduct): Promise<CasinoRemoteCategory[]> {
    const games = await this.fetchAllGames(); const counts = new Map<string, number>();
    for (const game of games) { if (productType && game.productType !== productType) continue; const key = game.categoryName ?? game.categoryExternalId; if (key) counts.set(key, (counts.get(key) ?? 0) + 1); }
    return [...counts.entries()].map(([name, gameCount]) => ({ externalId: slug(name), name, slug: slug(name), productType: productType ?? 'CASINO', gameCount }));
  }
  async listProviders(): Promise<CasinoRemoteProvider[]> {
    const games = await this.fetchAllGames(); const providers = new Map<string, { count: number; live: boolean }>();
    for (const game of games) { const current = providers.get(game.providerExternalId) ?? { count: 0, live: false }; current.count += 1; current.live ||= game.productType === 'LIVE_CASINO'; providers.set(game.providerExternalId, current); }
    return [...providers.entries()].map(([externalId, value]) => ({ externalId, name: externalId, gameCount: value.count, liveCapable: value.live }));
  }
  async listGames(query: CasinoRemoteGameQuery): Promise<CasinoRemoteGamePage> {
    const all = await this.fetchAllGames(); const search = (query.search ?? '').trim().toLowerCase();
    const filtered = all.filter((game) => (!query.productType || game.productType === query.productType) && (!query.providerExternalId || game.providerExternalId === query.providerExternalId) && (!query.categoryExternalId || game.categoryExternalId === query.categoryExternalId) && (!search || `${game.name} ${game.providerName} ${game.categoryName ?? ''}`.toLowerCase().includes(search)));
    const page = Math.max(query.page ?? 1, 1); const pageSize = Math.max(query.pageSize ?? 48, 1); const start = (page - 1) * pageSize;
    return { items: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize, hasMore: start + pageSize < filtered.length };
  }
  async getGame(externalId: string): Promise<CasinoRemoteGame | null> { return (await this.fetchAllGames()).find((game) => game.externalId === externalId) ?? null; }


  async launch(input: CasinoLaunchInput): Promise<CasinoLaunchResult> {
    const gameId = this.parseGameId(input.externalGameId);
    if (input.mode === 'REAL') await this.request('POST', '/users/create', { body: { username: input.playerId, currency: input.currency } });
    const body = await this.request<BigBangLaunchResponse>('POST', '/games/launch', { body: { game_id: gameId, ...(input.mode === 'REAL' ? { user_token: input.playerId } : { demo: true }), ...(input.locale ? { language: input.locale } : {}) } });
    if (!body.game_url) throw new CasinoProviderError('BigBang launch response did not contain game_url', 'INVALID_RESPONSE');
    return { url: body.game_url, providerSessionId: null, providerRoundId: null };
  }
  async launchDemo(input: Omit<CasinoLaunchInput, 'playerId'>): Promise<CasinoLaunchResult> { return this.launch({ ...input, playerId: '', mode: 'DEMO' }); }
  async closeSession(_providerSessionId: string): Promise<void> { /* No documented BigBang close endpoint. */ }
  private parseGameId(value: string): number { if (!/^\d+$/.test(value)) throw new CasinoProviderError('BigBang game id is not numeric', 'INVALID_RESPONSE'); const id = Number(value); if (!Number.isSafeInteger(id) || id <= 0) throw new CasinoProviderError('BigBang game id is invalid', 'INVALID_RESPONSE'); return id; }


  private async fetchAllGames(): Promise<CasinoRemoteGame[]> {
    const games: CasinoRemoteGame[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const body = await this.request<BigBangGamesResponse>('GET', '/games', { query: { page: String(page), per_page: '100' } });
      const rows = body.data ?? [];
      for (const raw of rows) { const game = this.normalizeGame(raw); if (game) games.push(game); }
      if (body.last_page !== undefined ? page >= body.last_page : rows.length < 100) break;
    }
    return games;
  }
  private normalizeGame(raw: unknown): CasinoRemoteGame | null {
    const source = record(raw); if (!source) return null;
    const externalId = first(source, ['game_id']); const name = first(source, ['game_name']); const providerId = first(source, ['provider_id']); const gameType = first(source, ['game_type']);
    if (!externalId || !name || !providerId || !gameType) return null;
    const standard = firstFlag(source, ['standard_available']); const premium = firstFlag(source, ['premium_available']);
    return { externalId, name, slug: slug(name) || `game-${externalId}`, providerExternalId: providerId, providerName: providerId, categoryExternalId: gameType, categoryName: gameType, thumbnail: null, banner: null, tags: [gameType, standard ? 'standard' : '', premium ? 'premium' : ''].filter(Boolean), productType: gameType.toLowerCase() === 'live' ? 'LIVE_CASINO' : 'CASINO', isFeatured: false, launchAvailable: standard !== false || premium !== false, demoAvailable: false, active: true };
  }


  private async request<T>(method: 'GET' | 'POST', path: string, options: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
    if (!this.isConfigured()) throw new CasinoProviderError('BigBang provider is not configured', 'NOT_CONFIGURED');
    const query = options.query ? `?${new URLSearchParams(options.query).toString()}` : '';
    const body = options.body === undefined ? '' : JSON.stringify(options.body);
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(`${this.options.baseUrl}${path}${query}`, { method, headers: { Accept: 'application/json', 'X-API-Key': this.options.apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body } : {}), signal: controller.signal });
      if (!response.ok) throw new CasinoProviderError(`BigBang request failed with status ${response.status}`, 'PROVIDER_ERROR', response.status);
      const text = await response.text(); if (!text.trim()) return {} as T;
      try { return JSON.parse(text) as T; } catch { throw new CasinoProviderError('BigBang returned malformed JSON', 'INVALID_RESPONSE'); }
    } catch (error) {
      if (error instanceof CasinoProviderError) throw error;
      if (error instanceof Error && error.name === 'AbortError') throw new CasinoProviderError(`BigBang request timed out after ${this.options.timeoutMs}ms`, 'TIMEOUT');
      throw new CasinoProviderError('BigBang provider is unreachable', 'UNAVAILABLE');
    } finally { clearTimeout(timer); }
  }
}



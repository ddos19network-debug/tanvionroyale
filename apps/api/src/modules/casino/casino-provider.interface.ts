import type { CasinoEnvironment, ProductType } from '@tanvion-royale/types';

/**
 * Partner casino provider contract (catalog + launch).
 *
 * EVERY implementation of this interface answers with REAL provider data or
 * fails explicitly. No implementation may invent games, providers, categories
 * or launch URLs — `UnconfiguredCasinoProvider` returns "not configured"
 * instead of fabricating a catalog.
 *
 * Product separation is part of the contract: a game is either `CASINO`
 * (BIG CASINO) or `LIVE_CASINO` (BIG LIVE CASINO), derived from what the
 * provider actually supplies.
 */

/** A provider remote game, normalized from the provider payload. */
export interface CasinoRemoteGame {
  externalId: string;
  name: string;
  slug: string;
  providerExternalId: string;
  providerName: string;
  categoryExternalId: string | null;
  categoryName: string | null;
  thumbnail: string | null;
  banner: string | null;
  tags: string[];
  productType: Extract<ProductType, 'CASINO' | 'LIVE_CASINO'>;
  isFeatured: boolean;
  launchAvailable: boolean;
  demoAvailable: boolean;
  active: boolean;
}

export interface CasinoRemoteCategory {
  externalId: string;
  name: string;
  slug: string;
  productType: Extract<ProductType, 'CASINO' | 'LIVE_CASINO'>;
  gameCount: number;
  /**
   * True when the provider itself marks the category premium (BigBang
   * `/categories` → `premium`). Optional: a provider that does not declare it
   * leaves it undefined instead of guessing.
   */
  premium?: boolean;
}

export interface CasinoRemoteProvider {
  externalId: string;
  name: string;
  gameCount: number;
  /** True when the provider supplies live-dealer titles (when declared). */
  liveCapable: boolean;
}

export interface CasinoRemoteGameQuery {
  productType?: Extract<ProductType, 'CASINO' | 'LIVE_CASINO'>;
  providerExternalId?: string;
  categoryExternalId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface CasinoRemoteGamePage {
  items: CasinoRemoteGame[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Provider capability detection. `source` states HOW the verdict was obtained
 * so the UI/admin can be honest about it:
 *   'catalog'     — derived from the synced provider inventory
 *   'health'      — derived from the provider health endpoint
 *   'unavailable' — the provider could not be reached / is not configured
 */
export interface CasinoProviderCapabilities {
  casino: boolean;
  liveCasino: boolean;
  demoSupported: boolean;
  /**
   * HOW the verdict was obtained, so the UI/admin can be honest about it:
   *   'catalog'     — verified against the provider's own catalog inventory
   *   'unavailable' — the provider is not configured or could not be reached
   *                   (capabilities are then reported as `false`, never assumed)
   */
  source: 'catalog' | 'unavailable';
}

export interface CasinoProviderHealth {
  reachable: boolean;
  latencyMs: number | null;
  providersUp: number | null;
  message: string | null;
}

export interface CasinoLaunchInput {
  /** Stable TANVION-mapped partner player id (see casino-player-identity). */
  playerId: string;
  externalGameId: string;
  currency: string;
  mode: 'REAL' | 'DEMO';
  locale?: string;
  /** Optional provider session to resume. */
  providerSessionId?: string | null;
}

/** Raw provider launch answer — the URL is validated before it is returned. */
export interface CasinoLaunchResult {
  url: string;
  providerSessionId: string | null;
  providerRoundId: string | null;
}

export interface CasinoCatalogProviderContract {
  readonly name: string;
  readonly environment: CasinoEnvironment;
  /** True only when base URL + merchant id + secret are all present. */
  isConfigured(): boolean;
  health(): Promise<CasinoProviderHealth>;
  capabilities(): Promise<CasinoProviderCapabilities>;
  listCategories(productType?: Extract<ProductType, 'CASINO' | 'LIVE_CASINO'>): Promise<CasinoRemoteCategory[]>;
  listProviders(): Promise<CasinoRemoteProvider[]>;
  listGames(query: CasinoRemoteGameQuery): Promise<CasinoRemoteGamePage>;
  getGame(externalId: string): Promise<CasinoRemoteGame | null>;
  launch(input: CasinoLaunchInput): Promise<CasinoLaunchResult>;
  launchDemo(input: Omit<CasinoLaunchInput, 'playerId'>): Promise<CasinoLaunchResult>;
  closeSession(providerSessionId: string): Promise<void>;
}

/**
 * Structured provider error. `message` is always safe to expose to an
 * authenticated admin/log — it never contains the merchant secret.
 *
 * The `code` distinguishes the FOUR failure modes an operator must be able to
 * tell apart, instead of collapsing them all into "the casino is broken":
 *
 *   NOT_CONFIGURED   — no base URL / credentials for this environment
 *   UNAUTHORIZED     — the provider rejected the credential (HTTP 401/403)
 *   INVALID_ENDPOINT — the provider does not serve this path (HTTP 404/405)
 *   TIMEOUT          — the provider did not answer inside the configured budget
 *   UNAVAILABLE      — DNS / TCP / TLS failure, i.e. the provider host is down
 *   PROVIDER_ERROR   — any other non-2xx answer
 *   INVALID_RESPONSE — a 2xx body that is not the documented shape
 *   INVALID_DESTINATION — a launch URL that failed the https/allowlist checks
 */
export class CasinoProviderError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NOT_CONFIGURED'
      | 'UNAUTHORIZED'
      | 'INVALID_ENDPOINT'
      | 'UNAVAILABLE'
      | 'TIMEOUT'
      | 'PROVIDER_ERROR'
      | 'INVALID_RESPONSE'
      | 'INVALID_DESTINATION',
    /** HTTP status from the provider, when there was one. */
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'CasinoProviderError';
  }
}

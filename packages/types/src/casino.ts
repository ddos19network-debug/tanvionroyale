// ---------------------------------------------------------------------------
// TANVIONROYALE product taxonomy + partner casino domain (BIG CASINO /
// BIG LIVE CASINO).
//
// The user-facing platform has exactly FOUR primary gaming/business sections:
//
//   CASINO       -> BIG CASINO       (partner casino games)
//   SPORT        -> BIG SPORT        (sportsbook / partner sports integration)
//   LIVE_CASINO  -> BIG LIVE CASINO  (partner live-dealer games)
//   ROYALE_PLAY  -> ROYALE PLAY      (ONLY internally developed TANVION games)
//
// These are the API-safe, frontend-facing shapes. Provider secrets, signing
// secrets and merchant credentials are NEVER part of any type here.
//
// Money is expressed in integer MINOR UNITS (never floats), exactly like the
// wallet/betting domains.
// ---------------------------------------------------------------------------

/** The four product sections. Every catalog entity belongs to exactly one. */
export type ProductType = 'CASINO' | 'SPORT' | 'LIVE_CASINO' | 'ROYALE_PLAY';

/** Who supplies the game: a partner integration or TANVIONROYALE itself. */
export type GameSource = 'PARTNER' | 'INTERNAL';

/**
 * Partner provider environment. Sandbox and production must NEVER be mixed —
 * a session/transaction is only ever created in the environment the API
 * process is configured for.
 */
export type CasinoEnvironment = 'sandbox' | 'production';

export type CatalogGameStatus = 'ACTIVE' | 'INACTIVE';

/** Launch mode: real-money (wallet-backed) or provider demo (no wallet). */
export type CasinoLaunchMode = 'REAL' | 'DEMO';

/**
 * Normalized catalog game — the single internal shape every catalog source
 * (partner casino, partner live casino, internal Royale Play) is normalized
 * into before it reaches the frontend.
 */
export interface CatalogGame {
  /** Stable TANVION id: `${providerId}:${externalId}` (never changes on sync). */
  id: string;
  /** Display name of the supplying provider (never a credential/URL). */
  provider: string;
  providerId: string;
  externalId: string;
  name: string;
  slug: string;
  thumbnail: string | null;
  banner: string | null;
  category: string | null;
  categorySlug: string | null;
  tags: string[];
  productType: ProductType;
  source: GameSource;
  status: CatalogGameStatus;
  isFeatured: boolean;
  launchAvailable: boolean;
  demoAvailable: boolean;
}

/** Catalog provider summary (e.g. a studio inside BIG CASINO). */
export interface CatalogProviderSummary {
  id: string;
  name: string;
  gameCount: number;
  productType: ProductType;
}

/** Catalog category summary (e.g. Slots, Live Roulette). */
export interface CatalogCategorySummary {
  id: string;
  name: string;
  slug: string;
  gameCount: number;
  productType: ProductType;
}

/** One page of catalog results. */
export interface CatalogPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Product-scoped catalog response. `available` is false when no provider is
 * configured OR the provider supplies nothing for the requested product — the
 * UI must show an honest unavailable/maintenance state, never fake games.
 */
export interface CatalogResponse {
  productType: ProductType;
  /** True when at least one real (provider-supplied or internal) game exists. */
  available: boolean;
  /** True when the partner provider integration is configured server-side. */
  configured: boolean;
  environment: CasinoEnvironment;
  provider: string | null;
  /** Honest, secret-free reason when nothing can be shown. */
  message: string | null;
  games: CatalogPage<CatalogGame>;
  categories: CatalogCategorySummary[];
  providers: CatalogProviderSummary[];
  /** Latest catalog sync timestamp (ISO), null when never synced. */
  syncedAt: string | null;
}

/** Result of a server-side game launch (never a client-supplied URL). */
export interface CasinoLaunchResponse {
  /** Allowlisted provider launch URL (server-verified origin). */
  url: string;
  provider: string;
  gameId: string;
  externalGameId: string;
  mode: CasinoLaunchMode;
  environment: CasinoEnvironment;
  /** TANVION session mapping id (null for anonymous demo launches). */
  sessionId: string | null;
}

export type CasinoProductType = Extract<ProductType, 'CASINO' | 'LIVE_CASINO'>;

/**
 * Admin patch for one synced game.
 *
 * Mirrors `CasinoGameAdminDto` in the API exactly (the field is `featured`,
 * not `isFeatured`) so the admin UI can never drift from the endpoint.
 */
export interface AdminCasinoGamePatch {
  status?: CatalogGameStatus;
  featured?: boolean;
  launchAvailable?: boolean;
  demoAvailable?: boolean;
  sortOrder?: number;
}

/** Provider capability/health report (never contains credentials). */
export interface CasinoCapabilityReport {
  configured: boolean;
  environment: CasinoEnvironment;
  provider: string | null;
  reachable: boolean;
  /** True when the provider actually supplies casino (non-live) games. */
  casino: boolean;
  /** True when the provider actually supplies live-dealer games. */
  liveCasino: boolean;
  demoSupported: boolean;
  message: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

/** Admin-facing casino catalog/status snapshot (secrets masked as booleans). */
export interface AdminCasinoStatus extends CasinoCapabilityReport {
  credentials: {
    merchantConfigured: boolean;
    secretConfigured: boolean;
    /** Where the active credentials come from: environment or encrypted DB row. */
    source: 'environment' | 'database' | 'none';
  };
  counts: {
    games: number;
    casinoGames: number;
    liveCasinoGames: number;
    featured: number;
    inactive: number;
    categories: number;
    providers: number;
    sessions: number;
    transactions: number;
  };
  apiVersion: string;
  providerRow: {
    id: string;
    name: string;
    baseUrl: string;
    status: 'ACTIVE' | 'INACTIVE';
    environment: CasinoEnvironment | null;
  } | null;
  /**
   * EVERY casino-capable provider row for the current environment (not just the
   * primary one), so an admin can see all configured providers and their game
   * counts. Optional so an older/host payload cannot break the client.
   */
  providerRows?: CasinoProviderRowSummary[];
}

/**
 * One PartnerProvider row as reported to the admin surface (never a secret).
 * `status` is the EXISTING provider status rule (ACTIVE/INACTIVE) that decides
 * whether its games are public.
 */
export interface CasinoProviderRowSummary {
  id: string;
  name: string;
  providerCode: string | null;
  status: CatalogGameStatus;
  environment: CasinoEnvironment | null;
  /** Games of this product currently held for the provider. */
  gameCount: number;
  /** ACTIVE games of this product (the ones the public catalog may expose). */
  activeGameCount: number;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

/** Per-provider outcome of one catalog sync run (real counts). */
export interface CasinoProviderSyncResult {
  providerId: string;
  provider: string;
  status: 'SYNCED' | 'FAILED' | 'SKIPPED';
  /** Games the provider actually returned for the walked pages. */
  fetched: number;
  created: number;
  updated: number;
  /** Games marked INACTIVE because the provider no longer lists them. */
  deactivated: number;
  categories: number;
  /** True when the walk stopped before the provider's reported total. */
  truncated: boolean;
  error: string | null;
}

/**
 * Result of a partner catalog sync (real counts, never fabricated).
 *
 * A sync walks EVERY eligible provider (all ACTIVE, casino-capable,
 * environment-matched PartnerProvider rows), so one provider failing can never
 * discard another provider's successful sync — the failure is reported in
 * `providerResults`/`errors` instead.
 */
export interface CasinoSyncSummary {
  provider: string | null;
  environment: CasinoEnvironment;
  /** Providers discovered in the database for this environment/product. */
  providersDiscovered: number;
  providersSynced: number;
  providersFailed: number;
  categories: number;
  /** Studio count reported by the providers (provider-side suppliers). */
  providers: number;
  /** Games fetched from every provider in this run. */
  fetched: number;
  created: number;
  updated: number;
  /** Games fetched in total (kept for backwards compatibility = `fetched`). */
  games: number;
  casinoGames: number;
  liveCasinoGames: number;
  featured: number;
  deactivated: number;
  /** Per-provider breakdown — one entry per discovered provider. */
  providerResults: CasinoProviderSyncResult[];
  errors: string[];
}

/** Wallet callback kinds the partner may call back with. */
export type CasinoTransactionKind = 'BET' | 'WIN' | 'REFUND' | 'ROLLBACK';

/** Applied = money moved; REVERSED = the referenced movement was rolled back. */
export type CasinoTransactionStatus = 'APPLIED' | 'REVERSED';

/** Provider → TANVION wallet callback result. */
export interface CasinoCallbackResponse {
  /** TANVION mapping id for the provider transaction (null when rejected). */
  transactionId: string | null;
  externalTransactionId: string;
  kind: CasinoTransactionKind;
  /** True when this exact provider transaction was already applied. */
  duplicate: boolean;
  status: 'APPLIED' | 'REJECTED';
  /** Resulting TANVION wallet balance (minor units) after the movement. */
  balance: number | null;
  currency: string;
  /** Secret-free reason for a rejection. */
  message: string | null;
}

// ---------------------------------------------------------------------------
// ROYALE PLAY (internally developed games only)
// ---------------------------------------------------------------------------

/** An internally developed TANVIONROYALE game (ROYALE PLAY). */
export interface RoyalePlayGame {
  slug: string;
  title: string;
  description: string;
  category: string;
  featured: boolean;
  sortOrder: number;
  productType: 'ROYALE_PLAY';
  source: 'INTERNAL';
  kind: 'FREE_PLAY';
}

/** One of the signed-in player's recently played ROYALE PLAY games. */
export interface RoyalePlayMyGame {
  slug: string;
  title: string;
  plays: number;
  lastPlayedAt: string;
  lastOutcome: string | null;
  lastScore: number | null;
}

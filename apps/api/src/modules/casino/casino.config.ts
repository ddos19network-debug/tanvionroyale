import type { CasinoEnvironment } from '@tanvion-royale/types';

/**
 * Partner casino (Script.Casino-style) configuration.
 *
 * TWO ENVIRONMENTS, NEVER MIXED: `sandbox` and `production`. The API process
 * declares which one it operates through PARTNER_CASINO_ENV; the resolver only
 * ever uses the PartnerProvider row whose `environment` matches, so a sandbox
 * session/credential can never leak into production and vice versa.
 *
 * SECRETS: the merchant secret is read from the environment (preferred for
 * deployed secrets) OR from the AES-256-GCM encrypted PartnerProvider row.
 * It is NEVER logged, NEVER returned by any endpoint and NEVER sent to the
 * browser. `loadCasinoEnvConfig` only reads configuration — it never exposes
 * the values through any response type.
 */
export interface CasinoEnvConfig {
  /** Environment this API process is allowed to operate in. */
  environment: CasinoEnvironment;
  /** True when PARTNER_CASINO_ENV was explicitly and validly configured. */
  environmentExplicit: boolean;
  /** PartnerProvider.name to use (null = auto-select by productTypes+environment). */
  providerRowName: string | null;
  /** Merchant id override (env wins over the encrypted DB value when present). */
  merchantId: string | null;
  /** Merchant/HMAC secret override (env wins over the encrypted DB value). */
  secret: string | null;
  /** Provider API version path segment (default "v1"). */
  apiVersion: string;
  /** Outbound HTTP timeout for every provider call. */
  timeoutMs: number;
  /**
   * Per-request budget for CATALOG reads.
   *
   * A catalog walk is many bounded page calls over a multi-thousand-row
   * inventory, so it gets its own, larger budget rather than forcing the
   * operator to inflate the interactive timeout used for launch/balance calls.
   * Always >= `timeoutMs`.
   */
  catalogTimeoutMs: number;
  /**
   * Rows requested per provider page while walking the catalog. Clamped by the
   * adapter to that provider's documented maximum.
   */
  catalogPageSize: number;
  /** Catalog read-cache TTL (the DB cache is authoritative for the frontend). */
  cacheTtlMs: number;
  /** Default page size for catalog reads. */
  pageSizeDefault: number;
  /** Hard upper bound for a single catalog page (performance guard). */
  pageSizeMax: number;
  /** Max provider pages consumed by one sync run (performance guard). */
  maxSyncPages: number;
  /**
   * Page size used by a catalog SYNC walk. Deliberately larger than the
   * public `pageSizeMax` (which guards what can be loaded into a browser):
   * a sync must reach the provider's whole catalog, and providers clamp the
   * value server-side, so a bigger page only means fewer round trips.
   */
  syncPageSize: number;
  /** Currencies the TANVION wallet supports (mirrors the wallet config). */
  supportedCurrencies: string[];
  /** Per-transaction bounds in minor units (server-enforced). */
  minBetMinor: number;
  maxBetMinor: number;
  /**
   * Optional hostname allowlist for provider game-launch destinations.
   * Empty = the provider's own launch URL is accepted after the structural
   * https/private-host checks. The browser NEVER supplies a launch URL, so
   * this is defence in depth against a compromised/misconfigured provider.
   */
  launchHostAllowlist: string[];
}

/** The wallet's supported currencies — the ONE wallet serves every product. */
export const CASINO_SUPPORTED_CURRENCIES: readonly string[] = ['BDT', 'USD', 'EUR'];

export const CASINO_DEFAULT_CURRENCY = 'BDT';

/** Parses the configured environment; anything unknown/absent = sandbox. */
export function parseCasinoEnvironment(raw: string | undefined): {
  environment: CasinoEnvironment;
  explicit: boolean;
} {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === 'production' || value === 'live' || value === 'prod') {
    return { environment: 'production', explicit: true };
  }
  if (value === 'sandbox' || value === 'test' || value === 'stage') {
    return { environment: 'sandbox', explicit: true };
  }
  return { environment: 'sandbox', explicit: false };
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt((raw ?? '').trim(), 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function loadCasinoEnvConfig(env: NodeJS.ProcessEnv = process.env): CasinoEnvConfig {
  const { environment, explicit } = parseCasinoEnvironment(env.PARTNER_CASINO_ENV);

  const pageSizeMax = positiveInt(env.PARTNER_CASINO_PAGE_SIZE_MAX, 60);
  const pageSizeDefault = Math.min(
    positiveInt(env.PARTNER_CASINO_PAGE_SIZE, 48),
    pageSizeMax,
  );
  const timeoutMs = positiveInt(env.PARTNER_CASINO_TIMEOUT_MS, 10_000);

  return {
    environment,
    environmentExplicit: explicit,
    providerRowName: (env.PARTNER_CASINO_PROVIDER ?? '').trim() || null,
    merchantId: (env.PARTNER_CASINO_MERCHANT_ID ?? '').trim() || null,
    secret: (env.PARTNER_CASINO_SECRET ?? '').trim() || null,
    apiVersion: (env.PARTNER_CASINO_API_VERSION ?? '').trim() || 'v1',
    timeoutMs,
    // A catalog page is a bounded slice of a large inventory, so it gets its
    // own budget (default 60s) instead of being forced to share the 10s
    // interactive one. It can never be SMALLER than the interactive budget.
    catalogTimeoutMs: Math.max(timeoutMs, positiveInt(env.PARTNER_CASINO_CATALOG_TIMEOUT_MS, 60_000)),
    catalogPageSize: positiveInt(env.PARTNER_CASINO_CATALOG_PAGE_SIZE, 500),
    cacheTtlMs: positiveInt(env.PARTNER_CASINO_CACHE_TTL_MS, 60_000),
    pageSizeDefault,
    pageSizeMax,
    maxSyncPages: positiveInt(env.PARTNER_CASINO_MAX_SYNC_PAGES, 40),
    syncPageSize: positiveInt(env.PARTNER_CASINO_SYNC_PAGE_SIZE, 500),
    supportedCurrencies: [...CASINO_SUPPORTED_CURRENCIES],
    minBetMinor: positiveInt(env.PARTNER_CASINO_MIN_BET_MINOR, 1),
    maxBetMinor: positiveInt(env.PARTNER_CASINO_MAX_BET_MINOR, 50_000_000),
    launchHostAllowlist: (env.PARTNER_CASINO_LAUNCH_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host.length > 0),
  };
}

/**
 * BigBang casino-aggregator constants and row-backed runtime options.
 *
 * The API key is never read from an environment variable. It is decrypted from
 * the selected, environment-matched PartnerProvider row by the adapter factory.
 */
export const BIGBANG_PROVIDER_CODE = 'BIGBANG';
export const BIGBANG_DEFAULT_BASE_URL = 'https://api.bigbangcasino.bet/api/v1';

/**
 * The documented BigBang credential header. It carries the SAME key BigBang
 * uses to sign its seamless callbacks, so it is read only from the request
 * headers, compared in constant time against the decrypted PartnerProvider key
 * and never logged, stored or returned.
 */
export const BIGBANG_API_KEY_HEADER = 'x-api-key';

/**
 * The documented maximum `limit` for `GET /games` (and the page size the
 * catalog sync uses, so the whole catalog is walked in as few calls as
 * possible).
 */
export const BIGBANG_CATALOG_LIMIT_MAX = 5000;

/**
 * The page size the catalog walk ACTUALLY asks for, per `GET /games` call.
 *
 * WHY NOT THE MAXIMUM: `BIGBANG_CATALOG_LIMIT_MAX` is a ceiling the provider
 * accepts, not a size it can serve quickly. Requesting the whole ~1,860-game
 * catalog in one response made every production sync abort with
 * `TIMEOUT: BigBang request timed out after 10000ms`, even though the very same
 * host answers a `limit=1` health probe in well under a second (and answers an
 * unauthenticated request immediately with 401 — so DNS, TLS and routing were
 * never the problem). The walk now takes bounded pages and still terminates on
 * the provider's own `pagination.total`, so the catalog is read completely,
 * just in several cheap calls.
 */
export const BIGBANG_DEFAULT_CATALOG_PAGE_SIZE = 500;

/**
 * How long a completed catalog walk may be reused by the next caller (30s).
 *
 * A single sync consumes the catalog four times in a row (capabilities, one
 * `listCategories` per product, then the paged `listGames` walk). Without a
 * short reuse window each of those re-downloaded the whole inventory. 30s is
 * long enough to collapse one sync into one read and far too short to ever
 * serve a stale catalog to a later request.
 */
export const BIGBANG_DEFAULT_CATALOG_CACHE_TTL_MS = 30_000;

export type BigBangEnvironment = 'sandbox' | 'production';

export interface BigBangEnvConfig {
  environment: BigBangEnvironment;
  environmentExplicit: boolean;
  /** Interactive budget (health probe, launch, player calls). */
  timeoutMs: number;
  /** Budget for a cheap reachability probe; defaults to {@link timeoutMs}. */
  healthTimeoutMs: number;
  /**
   * Budget for ONE catalog read (a `GET /games` page or `GET /categories`).
   * Never smaller than {@link timeoutMs}: raising the interactive budget must
   * never shrink the catalog budget.
   */
  catalogTimeoutMs: number;
  /** Budget for a launch/player call; defaults to {@link timeoutMs}. */
  launchTimeoutMs: number;
}

export function parseBigBangEnvironment(raw: string | undefined): {
  environment: BigBangEnvironment;
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

/**
 * Resolves the BigBang timeout trio.
 *
 * `BIGBANG_HEALTH_TIMEOUT_MS`, `BIGBANG_CATALOG_TIMEOUT_MS` and
 * `BIGBANG_LAUNCH_TIMEOUT_MS` are honoured when present; otherwise the
 * generic `PARTNER_CASINO_*` values apply, and finally the 10s default. The
 * catalog budget can only ever be RAISED relative to the interactive one, so a
 * typo cannot silently make a catalog walk abort faster than a launch.
 */
export function loadBigBangEnvConfig(env: NodeJS.ProcessEnv = process.env): BigBangEnvConfig {
  const rawEnvironment = env.BIGBANG_ENV ?? env.PARTNER_CASINO_ENV;
  const { environment, explicit } = parseBigBangEnvironment(rawEnvironment);
  const timeoutMs = positiveInt(env.BIGBANG_TIMEOUT_MS ?? env.PARTNER_CASINO_TIMEOUT_MS, 10_000);
  const catalogTimeoutMs = Math.max(
    timeoutMs,
    positiveInt(env.BIGBANG_CATALOG_TIMEOUT_MS ?? env.PARTNER_CASINO_CATALOG_TIMEOUT_MS, 60_000),
  );
  return {
    environment,
    environmentExplicit: explicit,
    timeoutMs,
    healthTimeoutMs: positiveInt(env.BIGBANG_HEALTH_TIMEOUT_MS, timeoutMs),
    catalogTimeoutMs,
    launchTimeoutMs: positiveInt(env.BIGBANG_LAUNCH_TIMEOUT_MS, timeoutMs),
  };
}

export function isBigBangBaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      parsed.origin === 'https://api.bigbangcasino.bet' &&
      parsed.pathname.replace(/\/+$/, '') === '/api/v1' &&
      !parsed.search &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}


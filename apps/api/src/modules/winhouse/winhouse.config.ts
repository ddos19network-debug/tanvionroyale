import type { WinHouseEnvironment } from '@tanvion-royale/types';

/**
 * Embedded sportsbook (SPORTS_IFRAME) configuration — WinHouse, Model B.
 *
 * TWO ENVIRONMENTS, NEVER MIXED (`sandbox` / `production`), exactly like the
 * partner-casino module: the process declares ONE environment through
 * WINHOUSE_ENV and only ever uses the partner row whose `environment` matches,
 * so sandbox credentials can never be used against production or vice versa.
 *
 * TWO DIFFERENT SECRETS (mixing them up is the provider's #1 integration
 * failure — see its agent brief §1):
 *
 *   WINHOUSE_WALLET_API_KEY  never travels. It is the HMAC key for the
 *                            balance-change signature and for launch tokens.
 *   WINHOUSE_CALLBACK_TOKEN  travels in `?token=` on calls TO US and proves the
 *                            call came from the provider.
 *
 * WINHOUSE_EMBED_KEY (`ifr_…`) is PUBLIC by provider design: it selects the
 * skin and grants nothing. It is NOT a secret and NOT the wallet API key.
 *
 * Secrets are read from the environment (preferred for deployed secrets) OR
 * from the AES-256-GCM encrypted PartnerProvider row. They are NEVER logged,
 * NEVER returned by an endpoint and NEVER sent to the browser.
 */
export interface WinHouseEnvConfig {
  /** Environment this API process is allowed to operate in. */
  environment: WinHouseEnvironment;
  /** True when WINHOUSE_ENV was explicitly and validly configured. */
  environmentExplicit: boolean;
  /** PartnerProvider.name to use (null = auto-select by product+environment). */
  providerRowName: string | null;
  /** Public embed key override (env wins over the stored value). */
  embedKey: string | null;
  /** Book origin override (env wins over the stored value). */
  embedBaseUrl: string | null;
  /** Wallet API key override (env wins over the encrypted DB value). */
  walletApiKey: string | null;
  /** Callback token override (env wins over the encrypted DB value). */
  callbackToken: string | null;
  /** Launch-token lifetime (ms). Minted per page load; clamped to the max. */
  launchTtlMs: number;
  /** Hard provider maximum for a launch token's lifetime (10 minutes). */
  maxLaunchTtlMs: number;
  /** Outbound HTTP timeout for provider calls (e.g. /tenant/config). */
  timeoutMs: number;
  /** Wallet currencies — mirrors the ONE TANVION wallet (never a new one). */
  supportedCurrencies: string[];
  /** UI language handed to the loader (data-lang). */
  language: string;
  /** Theme handed to the loader (data-theme). */
  theme: 'dark' | 'light';
  /**
   * Fixed height of our own mobile bottom navigation in px, handed to the
   * loader as data-bottom-gap so the book's own tab bar/betslip are not covered
   * on phones.
   */
  bottomGapPx: number;
  /** Desktop frame height (any CSS length) handed to the loader. */
  frameHeight: string;
}


/** The wallet's supported currencies — the ONE wallet serves every product. */
export const WINHOUSE_SUPPORTED_CURRENCIES: readonly string[] = ['BDT', 'USD', 'EUR'];

/** The provider's documented default book origin (never a secret). */
export const WINHOUSE_DEFAULT_EMBED_BASE_URL = 'https://iframe.winhouse.bet';

/** Exact production frontend origin registered with the provider (public). */
export const WINHOUSE_TANVION_PRODUCTION_ORIGIN = 'https://tanvionroyale.vercel.app';

/** Exact production wallet base; WinHouse appends its two callback paths. */
export const WINHOUSE_TANVION_WALLET_BASE_URL =
  'https://tanvionroyale.onrender.com/api/v1/winhouse';

/**
 * The provider's documented MAXIMUM launch-token lifetime: the token must be
 * "in the future and no more than 10 minutes ahead", otherwise the hand-off is
 * refused with 401 and the book silently loads signed out.
 */
export const WINHOUSE_MAX_LAUNCH_TTL_MS = 10 * 60 * 1000;

/** Minted per page load, comfortably inside the provider's 10-minute maximum. */
export const WINHOUSE_DEFAULT_LAUNCH_TTL_MS = 5 * 60 * 1000;

/** Parses the configured environment; missing/unknown is a non-explicit sandbox sentinel. */
export function parseWinHouseEnvironment(raw: string | undefined): {
  environment: WinHouseEnvironment;
  explicit: boolean;
} {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === 'production') {
    return { environment: 'production', explicit: true };
  }
  if (value === 'sandbox') {
    return { environment: 'sandbox', explicit: true };
  }
  return { environment: 'sandbox', explicit: false };
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt((raw ?? '').trim(), 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** An exact HTTPS origin (no path, query, fragment, credentials, or wildcard). */
export function normalizeHttpsOrigin(raw: string | null | undefined): string | null {
  const candidate = (raw ?? '').trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.hostname.includes('*') ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    const pathname = parsed.pathname.replace(/\/+$/, '');
    if (pathname) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/** A provider embed key looks like `ifr_` + 40 hex chars (public, validated). */
export function isValidEmbedKey(value: string | null | undefined): boolean {
  return /^ifr_[0-9a-f]{40}$/i.test((value ?? '').trim());
}

/**
 * Display-only mask for a credential-looking value.
 *
 * The embed key is PUBLIC by the provider's design (it selects the skin and
 * grants nothing), but the admin UI must never print a full credential-shaped
 * string, so the only key that is ever displayed is masked to its prefix and
 * last four characters (`ifr_****************3f9a`). The still-showed tail lets
 * an operator confirm the value matches the provider portal without exposing
 * the value itself.
 */
export function maskSecretValue(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  if (raw.length <= 8) return '*'.repeat(raw.length);
  const prefix = raw.toLowerCase().startsWith('ifr_') ? raw.slice(0, 4) : '';
  const tail = raw.slice(-4);
  const masked = Math.min(16, Math.max(1, raw.length - prefix.length - tail.length));
  return `${prefix}${'*'.repeat(masked)}${tail}`;
}

export function loadWinHouseEnvConfig(env: NodeJS.ProcessEnv = process.env): WinHouseEnvConfig {
  const { environment, explicit } = parseWinHouseEnvironment(env.WINHOUSE_ENV);

  const maxLaunchTtlMs = WINHOUSE_MAX_LAUNCH_TTL_MS;
  const requestedTtl = positiveInt(env.WINHOUSE_LAUNCH_TTL_MS, WINHOUSE_DEFAULT_LAUNCH_TTL_MS);

  const theme = (env.WINHOUSE_THEME ?? '').trim().toLowerCase();

  return {
    environment,
    environmentExplicit: explicit,
    providerRowName: (env.WINHOUSE_PROVIDER ?? '').trim() || null,
    embedKey: (env.WINHOUSE_EMBED_KEY ?? '').trim() || null,
    embedBaseUrl: normalizeHttpsOrigin(env.WINHOUSE_EMBED_BASE_URL),
    walletApiKey: (env.WINHOUSE_WALLET_API_KEY ?? '').trim() || null,
    callbackToken: (env.WINHOUSE_CALLBACK_TOKEN ?? '').trim() || null,
    // The provider refuses a token dated more than 10 minutes ahead, so the
    // configured TTL is clamped: a misconfiguration can never break the SSO.
    launchTtlMs: Math.min(requestedTtl, maxLaunchTtlMs),
    maxLaunchTtlMs,
    timeoutMs: positiveInt(env.WINHOUSE_TIMEOUT_MS, 10_000),
    supportedCurrencies: [...WINHOUSE_SUPPORTED_CURRENCIES],
    language: (env.WINHOUSE_LANG ?? '').trim() || 'en',
    theme: theme === 'light' ? 'light' : 'dark',
    bottomGapPx: positiveInt(env.WINHOUSE_BOTTOM_GAP_PX, 56),
    frameHeight: (env.WINHOUSE_FRAME_HEIGHT ?? '').trim() || '900px',
  };
}

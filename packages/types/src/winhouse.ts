// ---------------------------------------------------------------------------
// EMBEDDED SPORTSBOOK (SPORTS_IFRAME) — WinHouse, Model B (seamless wallet).
//
// These are the API-safe, frontend-facing shapes ONLY. The two provider
// SECRETS — the wallet API key (HMAC signing key) and the callback token —
// never appear in any type here and are never returned by any endpoint or sent
// to the browser. The embed key IS public by provider design (it selects the
// customer's skin and grants nothing), which is why it is part of the launch
// response.
//
// Money crosses this boundary as EXACT 2-decimal strings in the wallet
// currency (the provider's documented wire format); internally TANVION keeps
// integer minor units.
// ---------------------------------------------------------------------------

/** sandbox and production are NEVER mixed (one process, one environment). */
export type WinHouseEnvironment = 'sandbox' | 'production';

/** The product section the embedded book belongs to. */
export type WinHouseProduct = 'SPORT';

/** The integration mode of an embedded-sportsbook provider row. */
export type WinHouseIntegration = 'SPORTS_IFRAME';

/** Big Sport section state — drives the honest unavailable UI (never a fake book). */
export interface WinHousePublicConfig {
  /** Display name of the configured provider row (never a URL/credential). */
  provider: string;
  integration: WinHouseIntegration;
  product: WinHouseProduct;
  environment: WinHouseEnvironment;
  /** Public embed key (`ifr_…`) passed to the loader as data-key. */
  embedKey: string;
  /** Book origin the loader/iframe is served from, e.g. https://iframe.winhouse.bet. */
  embedBaseUrl: string;
}

/**
 * Result of `GET /winhouse/launch` for a signed-in TANVION user.
 *
 * `launch` is the provider's signed, short-lived launch token
 * (`player_id.expiry.session.signature`, minted server-side, ≤ 10 minutes).
 * The browser NEVER receives the wallet API key or the callback token.
 */
export interface WinHouseLaunchResponse extends WinHousePublicConfig {
  /** Signed launch token — hand to the loader as `data-launch`. */
  launch: string;
  /** Token expiry (ISO 8601) — the book loads signed out once it passes. */
  expiresAt: string;
  /** Stable, non-identifying provider player id for the signed-in user. */
  playerId: string;
  /** UI language passed to the loader (`data-lang`). */
  language: string;
  /** Theme passed to the loader (`data-theme`) — the TANVION site is dark. */
  theme: 'dark' | 'light';
  /** Desktop frame height passed to the loader (`data-height`). */
  frameHeight: string;
  /**
   * Height of TANVION's own fixed mobile bottom navigation in px, passed to the
   * loader as `data-bottom-gap` so the book's tab bar/betslip are not covered
   * on phones.
   */
  bottomGapPx: number;
}

/**
 * `GET <wallet base>/user-data` response — the provider's documented shape.
 * `balance` is a 2-decimal string; the provider treats an unreadable value as
 * "balance unknown" and never assumes zero.
 */
export interface WinHouseUserDataResponse {
  username: string;
  balance: string;
  currency: string;
}

/**
 * `POST <wallet base>/balance-change` success response — the provider's
 * documented shape. Any 2xx without `status: "ok"` is retried by the provider,
 * so a refusal is answered with 401/403/404/409/422 and never a fake ok.
 */
export interface WinHouseBalanceChangeResponse {
  status: 'ok';
  /** Resulting TANVION wallet balance, 2-decimal string. */
  balance: string;
}

/** Provider movement actions (as documented; sent lower-case on the wire). */
export type WinHouseAction = 'bet' | 'win';

/**
 * One provider callback outcome as recorded in memory by the wallet service.
 *
 * This is the diagnostic that answers "is the seamless wallet actually being
 * called, and if not, why?" — refusal CODES only, never a token, a key, a
 * signature or a payload dump.
 */
export interface WinHouseCallbackDiagnosticView {
  /** Which of the two provider routes was called. */
  kind: 'user-data' | 'balance-change';
  /** `ok` = the provider received the documented 2xx success body. */
  outcome: 'ok' | 'rejected';
  /** Stable refusal code (`WINHOUSE_BAD_SIGNATURE`, …) or null when ok. */
  code: string | null;
  /** HTTP status the provider received. */
  status: number;
  /** ISO 8601 timestamp of the callback. */
  at: string;
}

/** The most recent provider movement that reached the ONE TANVION wallet. */
export interface WinHouseLastMovementView {
  /** Provider transaction id (idempotency key). */
  transactionId: string;
  /** Provider ticket id, when it sent one. */
  ticketId: string | null;
  /** Provider action exactly as it arrived ("bet" | "win"). */
  action: string;
  /** Signed amount as the provider sent it (negative = stake). */
  amount: string;
  currency: string;
  /** Resulting TANVION wallet balance, 2-decimal string. */
  balanceAfter: string;
  /** ISO 8601 timestamp of the movement. */
  at: string;
}

/** Admin-facing status of the embedded sportsbook (secrets masked to booleans). */
export interface WinHouseStatusView {
  configured: boolean;
  environment: WinHouseEnvironment;
  provider: string | null;
  /** Exact origin registered under the provider's Domain field. */
  domain: string | null;
  /** Exact base URL the provider appends /user-data and /balance-change to. */
  walletBaseUrl: string | null;
  /** Optional exact public outbound IP registered in the provider portal. */
  serverIp: string | null;
  /** Public embed key — shown because it is public by provider design. */
  embedKey: string | null;
  /** Book origin the loader/iframe is served from. */
  embedBaseUrl: string | null;
  product: WinHouseProduct;
  /** Wallet API key / callback token are NEVER returned — only whether they exist. */
  walletApiKeyConfigured: boolean;
  callbackTokenConfigured: boolean;
  credentialsSource: 'environment' | 'database' | 'none';
  /** Safe, secret-free reason when `configured` is false. */
  message: string | null;
  launchTtlMs: number;
  maxLaunchTtlMs: number;
  lastLaunchAt: string | null;
  sessions: number;
  transactions: number;
  /** Exact endpoint the provider calls for a balance (public, never a secret). */
  userDataEndpoint: string | null;
  /** Exact endpoint the provider posts bet/win movements to (never a secret). */
  balanceChangeEndpoint: string | null;
  /**
   * The PUBLIC `ifr_…` embed key, masked for display (`ifr_****************3f9a`).
   * The unmasked value is never printed by the admin UI.
   */
  embedKeyMasked: string | null;
  /** Last callback of either kind — in-memory, since the process started. */
  lastCallback: WinHouseCallbackDiagnosticView | null;
  /** Last balance-change (bet/win) callback — in-memory, since process start. */
  lastBalanceChange: WinHouseCallbackDiagnosticView | null;
  /** Last REFUSED callback with its refusal code — in-memory, since process start. */
  lastError: WinHouseCallbackDiagnosticView | null;
  /** Most recent movement actually applied to the TANVION ledger. */
  lastSuccessfulTransaction: WinHouseLastMovementView | null;
  /**
   * Honest operator warning (sandbox still in use, callback never seen, …) or
   * null. Never a credential, never a false "all good".
   */
  warning: string | null;
}

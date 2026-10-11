/** Admin-safe partner provider view (secrets only as boolean flags). */
export interface PartnerProviderView {
  id: string;
  name: string;
  providerCode: string | null;
  baseUrl: string;
  deepLinkTemplate: string;
  status: 'ACTIVE' | 'INACTIVE';
  /**
   * HOW TANVION integrates with this provider. `SPORTS_API` is the default for
   * legacy/API rows (a NULL column), so existing sports providers are
   * unchanged; `SPORTS_IFRAME` is an EMBEDDED sportsbook (WinHouse);
   * `CASINO_AGGREGATOR` is a B2B casino aggregator (BigBang).
   */
  integrationType: 'SPORTS_API' | 'SPORTS_IFRAME' | 'CASINO_API' | 'LIVE_CASINO_API' | 'CASINO_AGGREGATOR';
  /** sandbox | production (never mixed) — null when the row does not declare one. */
  environment: 'sandbox' | 'production' | null;
  /** Exact origin registered under WinHouse → Domain (public, no wildcard). */
  domain: string | null;
  /** Exact base registered under Seamless wallet (public). */
  walletBaseUrl: string | null;
  /** Optional exact public outbound IP (never guessed). */
  serverIp: string | null;
  /** PUBLIC embed key (`ifr_…`) for an embedded sportsbook — not a secret. */
  embedKey: string | null;
  /** Book origin the loader/iframe is served from — not a secret. */
  embedBaseUrl: string | null;
  /** True when a wallet API key is stored (the key itself is NEVER returned). */
  walletApiKeySet: boolean;
  /** True when a callback token is stored (the token itself is NEVER returned). */
  callbackTokenSet: boolean;
  apiKeySet: boolean;
  apiSecretSet: boolean;
  authMode: string | null;
  apiVersion: string | null;
  syncStatus: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
}
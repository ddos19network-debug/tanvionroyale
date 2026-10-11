/**
 * Frontend partner-casino API (BIG CASINO + BIG LIVE CASINO).
 *
 * Every call goes through the TANVIONROYALE backend — the browser never talks
 * to a provider and never receives a credential, provider URL or raw provider
 * payload. Product separation is explicit: `product=casino` serves BIG CASINO
 * (partner slots/table games) and `product=live` serves BIG LIVE CASINO
 * (partner live-dealer tables). One section can never return the other's games.
 */
import { apiFetch, authFetch } from './client';
import type {
  AdminCasinoGamePatch,
  AdminCasinoStatus,
  CatalogCategorySummary,
  CatalogGame,
  CatalogProviderSummary,
  CatalogResponse,
  CasinoCapabilityReport,
  CasinoLaunchMode,
  CasinoLaunchResponse,
  CasinoProductType,
  CasinoSyncSummary,
} from '@tanvion-royale/types';

export type CasinoProductParam = 'casino' | 'live';

export interface CasinoCatalogParams {
  product: CasinoProductParam;
  provider?: string;
  category?: string;
  search?: string;
  featured?: boolean;
  page?: number;
  pageSize?: number;
}

export interface CasinoAdminCatalogParams extends CasinoCatalogParams {
  includeInactive?: boolean;
}

export function buildCatalogQuery(params: CasinoCatalogParams): string {
  const query = new URLSearchParams({ product: params.product });
  /*
   * A provider filter is sent ONLY when one is actually selected. No selected
   * provider must mean "every active/visible provider" — the backend treats a
   * missing `provider` as no filter, while an unknown value narrows to nothing.
   * An empty/whitespace value is therefore dropped instead of being sent as
   * `provider=` (which would narrow the catalog to a provider named "").
   */
  const provider = params.provider?.trim();
  if (provider) query.set('provider', provider);
  if (params.category) query.set('category', params.category);
  if (params.search) query.set('search', params.search);
  if (params.featured) query.set('featured', 'true');
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  return query.toString();
}

function productTypeOf(product: CasinoProductParam): CasinoProductType {
  return product === 'live' ? 'LIVE_CASINO' : 'CASINO';
}

export async function getCasinoStatus(init?: RequestInit): Promise<CasinoCapabilityReport> {
  return apiFetch<CasinoCapabilityReport>('/casino/status', init);
}

export async function getCasinoCatalog(
  params: CasinoCatalogParams,
  init?: RequestInit,
): Promise<CatalogResponse> {
  return apiFetch<CatalogResponse>(`/casino/catalog?${buildCatalogQuery(params)}`, init);
}

export async function getCasinoFeatured(
  params: CasinoCatalogParams,
  init?: RequestInit,
): Promise<CatalogResponse> {
  return apiFetch<CatalogResponse>(`/casino/catalog/featured?${buildCatalogQuery(params)}`, init);
}

export async function getCasinoCategories(
  product: CasinoProductParam,
  init?: RequestInit,
): Promise<CatalogCategorySummary[]> {
  return apiFetch<CatalogCategorySummary[]>(
    `/casino/catalog/categories?product=${product}`,
    init,
  );
}

export async function getCasinoProviders(
  product: CasinoProductParam,
  init?: RequestInit,
): Promise<CatalogProviderSummary[]> {
  return apiFetch<CatalogProviderSummary[]>(
    `/casino/catalog/providers?product=${product}`,
    init,
  );
}

export async function getCasinoRecentGames(
  product: CasinoProductParam,
): Promise<CatalogGame[]> {
  return authFetch<CatalogGame[]>(`/casino/catalog/recent?product=${product}`);
}

export async function getCasinoGame(gameId: string): Promise<CatalogGame> {
  return apiFetch<CatalogGame>(`/casino/games/${encodeURIComponent(gameId)}`);
}

export async function launchCasinoGame(input: {
  gameId: string;
  mode: CasinoLaunchMode;
  currency?: string;
  locale?: string;
}): Promise<CasinoLaunchResponse> {
  return authFetch<CasinoLaunchResponse>('/casino/launch', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function closeCasinoSession(sessionId: string): Promise<{ closed: boolean }> {
  return authFetch<{ closed: boolean }>(`/casino/sessions/${encodeURIComponent(sessionId)}/close`, {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Admin casino API — AdminCasinoController (JWT + admin role enforced backend)
// ---------------------------------------------------------------------------

export async function getAdminCasinoStatus(): Promise<AdminCasinoStatus> {
  return authFetch<AdminCasinoStatus>('/admin/casino/status');
}

export async function getAdminCasinoCatalog(
  params: CasinoAdminCatalogParams,
): Promise<CatalogResponse> {
  // REAL route: GET /admin/casino/games (includes INACTIVE rows).
  return authFetch<CatalogResponse>(`/admin/casino/games?${buildCatalogQuery(params)}`);
}

export async function patchAdminCasinoGame(
  id: string,
  patch: AdminCasinoGamePatch,
): Promise<CatalogGame> {
  return authFetch<CatalogGame>(`/admin/casino/games/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/**
 * Runs a provider catalog sync and returns the REAL `CasinoSyncSummary` the
 * backend sends.
 *
 * The previous local type (`{ synced, productType }`) matched no field the
 * endpoint returns, so the admin toast reported "undefined game(s)" — including
 * when the sync had actually FAILED, and the per-provider `errors` and
 * `providerResults` were discarded. Typing it as the shared contract makes the
 * UI report the real counts and the real per-provider failures.
 */
export async function syncAdminCasinoCatalog(
  full = false,
): Promise<CasinoSyncSummary> {
  return authFetch<CasinoSyncSummary>(`/admin/casino/sync`, {
    method: 'POST',
    body: JSON.stringify({ full }),
  });
}

/** One recently launched partner session (reconciliation view, no secrets). */
export interface AdminCasinoSessionRow {
  id: string;
  userId: string;
  externalGameId: string;
  providerPlayerId: string;
  providerSessionId: string | null;
  currency: string;
  environment: string;
  demo: boolean;
  status: string;
  launchedAt: string;
  closedAt: string | null;
}

/** One provider wallet movement mapped to a TANVION ledger transaction. */
export interface AdminCasinoTransactionRow {
  id: string;
  userId: string;
  externalTransactionId: string;
  externalRoundId: string | null;
  kind: string;
  status: string;
  amount: number;
  currency: string;
  walletTransactionId: string | null;
  referenceTransactionId: string | null;
  createdAt: string;
}

export async function getAdminCasinoSessions(
  limit = 50,
): Promise<AdminCasinoSessionRow[]> {
  return authFetch<AdminCasinoSessionRow[]>(`/admin/casino/sessions?limit=${limit}`);
}

export async function getAdminCasinoTransactions(
  limit = 50,
): Promise<AdminCasinoTransactionRow[]> {
  return authFetch<AdminCasinoTransactionRow[]>(`/admin/casino/transactions?limit=${limit}`);
}

/**
 * Labels an EXISTING PartnerProvider row for the casino product (environment,
 * API version, base URL, enabled state). Credentials stay on
 * /admin/partner-providers — this endpoint never accepts or returns a secret.
 */
export async function configureAdminCasinoProvider(
  providerRowId: string,
  input: {
    environment?: 'sandbox' | 'production';
    apiVersion?: string;
    baseUrl?: string;
    status?: 'ACTIVE' | 'INACTIVE';
  },
): Promise<{
  id: string;
  name: string;
  baseUrl: string;
  status: string;
  environment: string | null;
  apiVersion: string | null;
  productTypes: string[];
  credentialsConfigured: boolean;
}> {
  return authFetch(
    `/admin/casino/providers/${encodeURIComponent(providerRowId)}/config`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export type { CasinoProductType };
export { productTypeOf };

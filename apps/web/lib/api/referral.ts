import { authFetch } from './client';
import type {
  MyReferralSummary,
  MyReferredUser,
  ReferralAdminStats,
  ReferralRewardStatus,
  ReferralRewardView,
  ReferralSettingsView,
  ReferralTopReferrer,
} from '@tanvion-royale/types';

/**
 * REFERRAL API client.
 *
 * Every call is scoped to the authenticated caller (`/me/referral/...`) or to
 * an admin route (`/admin/referral/...`). There is deliberately no endpoint that
 * takes another user's id from the browser, so a user can never read somebody
 * else's referral data from the client.
 *
 * EVERY route here is BEARER-AUTHENTICATED, so every one of them must go
 * through `authFetch` and NOT the anonymous `apiFetch`. These routes are
 * protected by the backend's global JwtAuthGuard, which rejects a request that
 * carries no `Authorization: Bearer` header with 401 "Missing access token".
 * Calling them anonymously is what made a perfectly valid admin session look
 * expired, because the API client maps every 401 to "Your session has
 * expired." `authFetch` also supplies the shared single-flight refresh + one
 * retry, so a genuinely expired access token no longer needs a page reload.
 *
 * Amounts arrive as integer MINOR UNITS and are formatted for display with
 * `formatMinor`, never re-parsed from a formatted string.
 */

export interface MyReferralResponse {
  settings: ReferralSettingsView;
  summary: MyReferralSummary;
}

export interface MyReferredUsersResponse {
  items: MyReferredUser[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MyRewardsResponse {
  items: ReferralRewardView[];
  total: number;
  page: number;
  pageSize: number;
}

export function getMyReferral(init?: RequestInit): Promise<MyReferralResponse> {
  return authFetch<MyReferralResponse>('/me/referral', init);
}

export function getMyReferredUsers(
  init?: RequestInit,
): Promise<MyReferredUsersResponse> {
  return authFetch<MyReferredUsersResponse>('/me/referral/users', init);
}

export function getMyReferralRewards(init?: RequestInit): Promise<MyRewardsResponse> {
  return authFetch<MyRewardsResponse>('/me/referral/rewards', init);
}

/** Re-evaluates my pending qualifications. Idempotent - never pays twice. */
export function syncMyReferral(init?: RequestInit): Promise<{ evaluated: number; qualified: number }> {
  return authFetch<{ evaluated: number; qualified: number }>('/me/referral/sync', {
    method: 'POST',
    ...init,
  });
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export function getReferralSettings(init?: RequestInit): Promise<ReferralSettingsView> {
  return authFetch<ReferralSettingsView>('/admin/referral/settings', init);
}

export function updateReferralSettings(
  patch: Partial<ReferralSettingsView>,
  init?: RequestInit,
): Promise<ReferralSettingsView> {
  return authFetch<ReferralSettingsView>('/admin/referral/settings', {
    method: 'PATCH',
    body: JSON.stringify(patch),
    ...init,
  });
}

export function getReferralStats(init?: RequestInit): Promise<ReferralAdminStats> {
  return authFetch<ReferralAdminStats>('/admin/referral/stats', init);
}

export function getTopReferrers(
  init?: RequestInit,
): Promise<{ items: ReferralTopReferrer[] }> {
  return authFetch<{ items: ReferralTopReferrer[] }>('/admin/referral/top-referrers', init);
}

export function searchReferrers(
  search: string,
  init?: RequestInit,
): Promise<{ items: ReferralTopReferrer[]; total: number }> {
  const q = new URLSearchParams({ search });
  return authFetch(`/admin/referral/referrers?${q.toString()}`, init);
}

export interface AdminRewardRow extends ReferralRewardView {
  userId: string;
  referralCode: string;
}

export function searchReferralRewards(
  params: { search?: string; status?: ReferralRewardStatus },
  init?: RequestInit,
): Promise<{ items: AdminRewardRow[]; total: number; page: number; pageSize: number }> {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.status) q.set('status', params.status);
  return authFetch(`/admin/referral/rewards?${q.toString()}`, init);
}

/** A manual, audited correction. The server recomputes everything. */
export function adjustReferralReward(
  id: string,
  amount: number,
  reason: string,
  init?: RequestInit,
): Promise<{ rewardId: string; amount: number; beforeBalance: number; afterBalance: number }> {
  return authFetch(`/admin/referral/rewards/${id}/adjust`, {
    method: 'POST',
    body: JSON.stringify({ amount, reason }),
    ...init,
  });
}

/**
 * Currency symbol for a supported currency code.
 *
 * EXACTLY ONE symbol per currency. The symbol map is the single place a symbol
 * may come from, so a formatted amount can never be built from two symbols at
 * once (the `৳$0.00` regression: a currency symbol was formatted and then a
 * hard-coded `$` was appended on top of it).
 *
 * The symbol is never derived from the runtime's locale data: `BDT` is written
 * out explicitly as `৳` so the output cannot depend on which ICU data the
 * runtime happens to ship.
 */
const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = Object.freeze({
  BDT: '৳',
  USD: '$',
  EUR: '€',
});

const FALLBACK_CURRENCY = 'BDT';

function normalizeCurrencyCode(currency: string | null | undefined): string {
  const code = (currency ?? '').trim().toUpperCase();
  return code.length > 0 ? code : FALLBACK_CURRENCY;
}

/**
 * Formats integer MINOR UNITS for display — the only place referral money
 * becomes a string.
 *
 *   formatMinor(0, 'BDT')    -> '৳0.00'
 *   formatMinor(25000, 'BDT') -> '৳250.00'
 *   formatMinor(0, 'USD')    -> '$0.00'
 *   formatMinor(25000, 'EUR') -> '€250.00'
 *
 * The database keeps the existing minor-unit representation; nothing here
 * changes what is stored, only how it is displayed. An unknown currency falls
 * back to the default symbol rather than emitting two of them.
 */
export function formatMinor(amount: number, currency: string = FALLBACK_CURRENCY): string {
  const code = normalizeCurrencyCode(currency);
  const symbol = CURRENCY_SYMBOLS[code] ?? CURRENCY_SYMBOLS[FALLBACK_CURRENCY];
  const value = Number.isFinite(amount) ? Math.trunc(amount) : 0;
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  return `${sign}${symbol}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

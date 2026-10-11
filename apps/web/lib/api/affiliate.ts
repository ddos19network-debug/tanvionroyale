/**
 * AFFILIATE API client.
 *
 * Every call is either caller-scoped (`/me/affiliate/*`) or admin-scoped
 * (`/admin/affiliate/*`). There is deliberately no endpoint that takes another
 * user's id from the browser, so a user can never read somebody else's
 * affiliate data from the client â€” the server derives ownership from the JWT.
 *
 * EVERY route here is BEARER-AUTHENTICATED and must go through `authFetch`
 * (never the anonymous `apiFetch`): the backend's global JwtAuthGuard rejects a
 * request with no `Authorization` header, and `authFetch` also supplies the
 * shared single-flight refresh + one retry.
 *
 * The one exception is the click beacon, which is deliberately anonymous (a
 * visitor is not signed in yet); it is owned by lib/referral-capture.ts.
 *
 * Amounts arrive as integer MINOR UNITS and are displayed with `formatMinor`
 * from lib/api/referral.ts. They are never re-parsed from a formatted string.
 */
import { authFetch } from './client';
import { formatMinor } from './referral';

export type AffiliateTargetType = 'QUALIFIED_REFERRALS' | 'SIGNUPS';
export type AffiliateStatus = 'ACTIVE' | 'INACTIVE';
export type AffiliatePromotionMethod =
  | 'SOCIAL_MEDIA'
  | 'FACEBOOK'
  | 'YOUTUBE'
  | 'TIKTOK'
  | 'TELEGRAM'
  | 'WEBSITE'
  | 'COMMUNITY'
  | 'OTHER';
export type AffiliateContentType =
  | 'TEXT'
  | 'IMAGE'
  | 'BANNER'
  | 'FAQ'
  | 'CTA'
  | 'STATS'
  | 'HOW_IT_WORKS';

/** Human labels for the closed promotion-method set. */
export const AFFILIATE_PROMOTION_METHODS: ReadonlyArray<{
  value: AffiliatePromotionMethod;
  label: string;
}> = [
  { value: 'SOCIAL_MEDIA', label: 'Social Media' },
  { value: 'FACEBOOK', label: 'Facebook' },
  { value: 'YOUTUBE', label: 'YouTube' },
  { value: 'TIKTOK', label: 'TikTok' },
  { value: 'TELEGRAM', label: 'Telegram' },
  { value: 'WEBSITE', label: 'Website / Blog' },
  { value: 'COMMUNITY', label: 'Community' },
  { value: 'OTHER', label: 'Other' },
];

/** Headline counters. Every value is server-aggregated. */
export interface AffiliateStats {
  totalReferredUsers: number;
  activeReferredUsers: number;
  pendingReferredUsers: number;
  qualifiedReferrals: number;
  totalClicks: number;
  currentMonthClicks: number;
  signups: number;
  conversions: number;
  /** Signups per click, 0-100. NULL when there were no clicks. */
  conversionRate: number | null;
  totalIncome: number;
  pendingIncome: number;
  paidIncome: number;
  rejectedIncome: number;
  currentMonthIncome: number;
  previousMonthIncome: number;
}

export interface AffiliateTargetProgress {
  targetType: AffiliateTargetType;
  year: number;
  month: number;
  /** NULL when no admin has set a target â€” never 0-as-a-real-target. */
  targetValue: number | null;
  actual: number;
  percentage: number | null;
  remaining: number | null;
  reached: boolean;
}

/**
 * A content block, in BOTH scopes.
 *
 * `affiliateUserId` is the server-stored discriminator: `null` = GLOBAL (shown
 * on every active affiliate's page), a user id = INDIVIDUAL (shown on that one
 * affiliate's page only). `scope` is the same fact pre-computed for the admin
 * list, so a row can always be labelled without the admin guessing.
 */
export interface AffiliateContentBlock {
  id: string;
  key: string;
  /** null => GLOBAL. An affiliate user id => INDIVIDUAL. */
  affiliateUserId: string | null;
  scope: 'GLOBAL' | 'INDIVIDUAL';
  type: AffiliateContentType;
  title: string | null;
  subtitle: string | null;
  body: string | null;
  items: string[] | null;
  imageUrl: string | null;
  ctaText: string | null;
  ctaUrl: string | null;
  sortOrder: number;
  isEnabled: boolean;
}

/** The affiliate enrollment record as returned by the API. */
export interface AffiliateProfile {
  id: string;
  userId: string;
  status: AffiliateStatus;
  promotionMethod: string | null;
  promotionUrl: string | null;
  description: string | null;
  termsAcceptedAt: string;
  activatedAt: string;
  deactivatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * What the page needs BEFORE activation.
 *
 * `prefill` comes from the account the user already has, so the form never asks
 * for the same information twice. It deliberately contains no code, no link and
 * no figure.
 */
export interface AffiliateActivation {
  status: AffiliateStatus;
  isActive: boolean;
  programEnabled: boolean;
  canActivate: boolean;
  prefill: { fullName: string | null; email: string | null; phone: string | null };
  profile: AffiliateProfile | null;
  activatedAt: string | null;
  deactivatedAt: string | null;
}

/**
 * The /affiliate page payload.
 *
 * `referralCode` / `referralLink` / `stats` / `target` are NULL and `content`
 * is EMPTY unless `affiliateStatus === 'ACTIVE'`, so the "Become an Affiliate"
 * state has nothing to leak even if the UI asked for it. The user's own
 * referral code is unaffected and still served by the referral API.
 */
export interface AffiliateDashboard {
  affiliateStatus: AffiliateStatus;
  activation: AffiliateActivation;
  programEnabled: boolean;
  currency: string;
  referralCode: string | null;
  /** Server-built from the configured frontend origin — never constructed here. */
  referralLink: string | null;
  settings: {
    qualificationRule: string;
    minDepositAmount: number;
    minWagerAmount: number;
    referrerBonusType: 'FIXED_AMOUNT' | 'PERCENTAGE';
    referrerBonusAmount: number;
    referrerBonusPercent: number;
  };
  stats: AffiliateStats | null;
  target: AffiliateTargetProgress | null;
  content: AffiliateContentBlock[];
}

export function getAffiliateDashboard(init?: RequestInit): Promise<AffiliateDashboard> {
  return authFetch<AffiliateDashboard>('/me/affiliate/dashboard', init);
}

/** Activation state + form prefill, for the "Become an Affiliate" card. */
export function getAffiliateStatus(init?: RequestInit): Promise<AffiliateActivation> {
  return authFetch<AffiliateActivation>('/me/affiliate/status', init);
}

export interface ActivateAffiliateInput {
  fullName: string;
  email?: string;
  phone?: string;
  promotionMethod: AffiliatePromotionMethod;
  promotionUrl?: string;
  description?: string;
  acceptTerms: boolean;
}

/**
 * Explicit activation. Idempotent server-side, and it never carries a userId,
 * a referral code, an amount or a status — identity comes from the JWT and
 * every reported figure is derived.
 */
export function activateAffiliate(
  input: ActivateAffiliateInput,
  init?: RequestInit,
): Promise<AffiliateActivation> {
  return authFetch<AffiliateActivation>('/me/affiliate/activate', {
    method: 'POST',
    body: JSON.stringify(input),
    ...init,
  });
}

/** Self-service opt-out. Referral code, referrals and rewards are kept. */
export function deactivateAffiliate(init?: RequestInit): Promise<AffiliateActivation> {
  return authFetch<AffiliateActivation>('/me/affiliate/deactivate', {
    method: 'POST',
    ...init,
  });
}

export function getAffiliateStats(init?: RequestInit): Promise<AffiliateStats> {
  return authFetch<AffiliateStats>('/me/affiliate/stats', init);
}

export function getAffiliateTarget(init?: RequestInit): Promise<AffiliateTargetProgress> {
  return authFetch<AffiliateTargetProgress>('/me/affiliate/target', init);
}

export interface AffiliatePage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AffiliateReferredUser {
  referralId: string;
  username: string;
  maskedEmail: string | null;
  joinedAt: string;
  status: string;
  bonusEarned: number;
}

export interface AffiliateTransaction {
  id: string;
  username: string | null;
  recipient: 'REFERRER' | 'REFERRED';
  status: 'PENDING' | 'QUALIFIED' | 'PAID' | 'REJECTED' | 'CANCELLED';
  amount: number;
  currency: string;
  createdAt: string;
  paidAt: string | null;
  statusReason: string | null;
}

export function getAffiliateReferrals(
  page = 1,
  pageSize = 10,
  init?: RequestInit,
): Promise<AffiliatePage<AffiliateReferredUser>> {
  const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  return authFetch<AffiliatePage<AffiliateReferredUser>>(`/me/affiliate/referrals?${q}`, init);
}

export function getAffiliateTransactions(
  page = 1,
  pageSize = 10,
  init?: RequestInit,
): Promise<AffiliatePage<AffiliateTransaction>> {
  const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  return authFetch<AffiliatePage<AffiliateTransaction>>(`/me/affiliate/transactions?${q}`, init);
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export interface AffiliateAdminOverview {
  programEnabled: boolean;
  currency: string;
  /** ACTIVE AffiliateProfile count. NEVER the referral-code user count. */
  totalAffiliates: number;
  /** Enrolled profiles currently switched off. */
  inactiveAffiliates: number;
  totalReferredUsers: number;
  totalClicks: number;
  currentMonthClicks: number;
  signups: number;
  conversions: number;
  conversionRate: number | null;
  pendingRewardAmount: number;
  paidRewardAmount: number;
  rejectedRewardAmount: number;
  targetsSetThisMonth: number;
}

export function getAffiliateAdminOverview(init?: RequestInit): Promise<AffiliateAdminOverview> {
  return authFetch<AffiliateAdminOverview>('/admin/affiliate', init);
}

export interface AffiliateAdminDetail {
  user: {
    id: string;
    username: string;
    referralCode: string | null;
    status: string;
    accountType: string;
    createdAt: string;
  };
  /** Null when this account is a referral user but never activated. */
  profile: AffiliateProfile | null;
  isAffiliate: boolean;
  /** Null for a non-affiliate: no figure is ever presented as affiliate income. */
  stats: AffiliateStats | null;
  target: AffiliateTargetProgress | null;
  targets: Array<{
    id: string;
    year: number;
    month: number;
    targetType: AffiliateTargetType;
    targetValue: number;
    updatedAt: string;
  }>;
  /** Blocks every ACTIVE affiliate sees. Null/empty for a non-affiliate. */
  globalContent: AffiliateContentBlock[];
  /** Blocks ONLY the selected affiliate sees. Empty for a non-affiliate. */
  individualContent: AffiliateContentBlock[];
}

export function getAffiliateAdminDetail(
  userId: string,
  init?: RequestInit,
): Promise<AffiliateAdminDetail> {
  return authFetch<AffiliateAdminDetail>(`/admin/affiliate/${encodeURIComponent(userId)}`, init);
}

export interface AffiliateAdminRow {
  userId: string;
  username: string;
  referralCode: string | null;
  affiliateStatus: AffiliateStatus;
  promotionMethod: string | null;
  activatedAt: string;
  deactivatedAt: string | null;
}

/**
 * The ACTIVE affiliate list.
 *
 * The server filters on `AffiliateProfile.status = 'ACTIVE'`, so a plain
 * referral user never appears here — they remain visible in the separate
 * referral admin list. Paginated, so the browser never loads every affiliate.
 */
export function searchAffiliateAdmins(
  search: string,
  page = 1,
  pageSize = 20,
  init?: RequestInit,
): Promise<AffiliatePage<AffiliateAdminRow>> {
  const q = new URLSearchParams({ search, page: String(page), pageSize: String(pageSize) });
  return authFetch<AffiliatePage<AffiliateAdminRow>>(`/admin/affiliate/affiliates?${q}`, init);
}

/**
 * Admin activate/deactivate. Submits only a boolean intent and an optional
 * reason — never an amount, a status value the client invented, or a reward.
 * The referral code, rewards, wallet and click history are untouched.
 */
export function setAffiliateStatus(
  userId: string,
  isActive: boolean,
  reason?: string,
  init?: RequestInit,
): Promise<AffiliateActivation> {
  return authFetch<AffiliateActivation>(`/admin/affiliate/${encodeURIComponent(userId)}/status`, {
    method: 'POST',
    body: JSON.stringify({ isActive, reason }),
    ...init,
  });
}

/**
 * Sets ONE monthly target. Only CONFIGURATION is submitted â€” never a reward
 * amount, an income figure or a paid/approved status. The server recomputes
 * progress and audits the change.
 */
export function setAffiliateTarget(
  userId: string,
  input: { year: number; month: number; targetType: AffiliateTargetType; targetValue: number },
  init?: RequestInit,
): Promise<AffiliateTargetProgress> {
  return authFetch<AffiliateTargetProgress>(
    `/admin/affiliate/${encodeURIComponent(userId)}/target`,
    { method: 'PUT', body: JSON.stringify(input), ...init },
  );
}

/**
 * Removes ONE target of the selected affiliate.
 *
 * A target is CONFIGURATION, not a financial transaction: this removes the one
 * `AffiliateMonthlyTarget` row and nothing else. Referrals, rewards, clicks, the
 * wallet, the ledger and every other affiliate's targets are untouched, and the
 * deletion is audited server-side. Ownership is verified server-side too, so a
 * stale UI cannot delete another affiliate's target.
 */
export function deleteAffiliateTarget(
  userId: string,
  targetId: string,
  init?: RequestInit,
): Promise<{ id: string; deleted: true }> {
  return authFetch<{ id: string; deleted: true }>(
    `/admin/affiliate/${encodeURIComponent(userId)}/target/${encodeURIComponent(targetId)}`,
    { method: 'DELETE', ...init },
  );
}

/**
 * The shape the ADMIN form submits for a content block.
 *
 * `items` is a NEWLINE-SEPARATED STRING on the way in (what a textarea
 * produces) and a `string[]` on the way out (what the renderer consumes). The
 * conversion happens server-side, so neither side has to guess the other's
 * format — and there is deliberately no field for raw HTML or a script.
 */
export interface AffiliateContentInput {
  type: AffiliateContentType;
  title?: string;
  subtitle?: string;
  body?: string;
  items?: string;
  imageUrl?: string;
  ctaText?: string;
  ctaUrl?: string;
  sortOrder?: number;
  isEnabled?: boolean;
}

export function getAffiliateContentBlocks(
  init?: RequestInit,
): Promise<{ items: AffiliateContentBlock[] }> {
  return authFetch<{ items: AffiliateContentBlock[] }>('/admin/affiliate/content/blocks', init);
}

export function createAffiliateContentBlock(
  input: AffiliateContentInput,
  init?: RequestInit,
): Promise<AffiliateContentBlock> {
  return authFetch<AffiliateContentBlock>('/admin/affiliate/content/blocks', {
    method: 'POST',
    body: JSON.stringify(input),
    ...init,
  });
}

export function updateAffiliateContentBlock(
  id: string,
  input: AffiliateContentInput,
  init?: RequestInit,
): Promise<AffiliateContentBlock> {
  return authFetch<AffiliateContentBlock>(
    `/admin/affiliate/content/blocks/${encodeURIComponent(id)}`,
    { method: 'POST', body: JSON.stringify(input), ...init },
  );
}

export function deleteAffiliateContentBlock(
  id: string,
  init?: RequestInit,
): Promise<{ id: string }> {
  return authFetch<{ id: string }>(`/admin/affiliate/content/blocks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    ...init,
  });
}

export function reorderAffiliateContentBlocks(
  ids: string[],
  init?: RequestInit,
): Promise<{ items: AffiliateContentBlock[] }> {
  return authFetch<{ items: AffiliateContentBlock[] }>('/admin/affiliate/content/blocks/reorder', {
    method: 'POST',
    body: JSON.stringify({ ids }),
    ...init,
  });
}

// ---------------------------------------------------------------------------
// INDIVIDUAL (per-affiliate) content - the same editor, a different SCOPE.
//
// The `userId` in the URL is the only place the scope exists. `AffiliateContentInput`
// deliberately carries no `affiliateUserId`, so a caller cannot put a block in
// the wrong scope; the server derives it from the path and re-verifies that the
// account is an ACTIVE affiliate before writing anything.
// ---------------------------------------------------------------------------

/** What the per-affiliate content endpoint returns for the selected account. */
export interface AffiliateIndividualContentView {
  user: { id: string; username: string; referralCode: string | null; status: string };
  profile: AffiliateProfile | null;
  isAffiliate: boolean;
  /** False for an INACTIVE affiliate: stored content is kept, new writes refused. */
  isActive: boolean;
  blocks: AffiliateContentBlock[];
}

export function getAffiliateIndividualContent(
  userId: string,
  init?: RequestInit,
): Promise<AffiliateIndividualContentView> {
  return authFetch<AffiliateIndividualContentView>(
    `/admin/affiliate/${encodeURIComponent(userId)}/content`,
    init,
  );
}

export function createAffiliateIndividualContent(
  userId: string,
  input: AffiliateContentInput,
  init?: RequestInit,
): Promise<AffiliateContentBlock> {
  return authFetch<AffiliateContentBlock>(
    `/admin/affiliate/${encodeURIComponent(userId)}/content`,
    { method: 'POST', body: JSON.stringify(input), ...init },
  );
}

/** 404s if the block belongs to another affiliate or to the global scope. */
export function updateAffiliateIndividualContent(
  userId: string,
  contentId: string,
  input: AffiliateContentInput,
  init?: RequestInit,
): Promise<AffiliateContentBlock> {
  return authFetch<AffiliateContentBlock>(
    `/admin/affiliate/${encodeURIComponent(userId)}/content/${encodeURIComponent(contentId)}`,
    { method: 'PATCH', body: JSON.stringify(input), ...init },
  );
}

export function deleteAffiliateIndividualContent(
  userId: string,
  contentId: string,
  init?: RequestInit,
): Promise<{ id: string }> {
  return authFetch<{ id: string }>(
    `/admin/affiliate/${encodeURIComponent(userId)}/content/${encodeURIComponent(contentId)}`,
    { method: 'DELETE', ...init },
  );
}

/** Renumbers ONLY this affiliate's blocks; global and others are untouched. */
export function reorderAffiliateIndividualContent(
  userId: string,
  ids: string[],
  init?: RequestInit,
): Promise<{ items: AffiliateContentBlock[] }> {
  return authFetch<{ items: AffiliateContentBlock[] }>(
    `/admin/affiliate/${encodeURIComponent(userId)}/content/reorder`,
    { method: 'POST', body: JSON.stringify({ ids }), ...init },
  );
}

export { formatMinor };

// ---------------------------------------------------------------------------
// BigBang portal configuration (admin)
// ---------------------------------------------------------------------------

export interface BigBangWebhookConfigView {
  providerId: string;
  providerName: string;
  /** Built server-side from the canonical API origin — never hard-coded here. */
  urls: { userData: string; balanceChange: string; webhook: string };
  /** True once a secret exists. The stored value is NEVER returned by the GET. */
  webhookSecretConfigured: boolean;
  /** Present ONLY on the generate/rotate response. Never re-displayable. */
  webhookSecret?: string;
}

export function getBigBangWebhookConfig(init?: RequestInit): Promise<BigBangWebhookConfigView> {
  return authFetch<BigBangWebhookConfigView>('/admin/partner-providers/bigbang/webhook', init);
}

/** Generates (first call) or rotates (later calls) the webhook secret. */
export function rotateBigBangWebhookSecret(init?: RequestInit): Promise<BigBangWebhookConfigView> {
  return authFetch<BigBangWebhookConfigView>('/admin/partner-providers/bigbang/webhook/secret', {
    method: 'POST',
    ...init,
  });
}


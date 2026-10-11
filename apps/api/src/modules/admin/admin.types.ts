import type { Paginated } from '@tanvion-royale/validation';
import type { PartnerProviderView } from '../sportsbook/partner-providers.types';

/**
 * Admin panel response shapes. These are API-safe projections only — never
 * password hashes, never raw provider secrets, never raw biometric data.
 * Every number is computed from the real database/provider state; there is
 * deliberately no placeholder/demo statistic anywhere in this module.
 */

export interface AdminAccessView {
  ok: true;
  roles: string[];
  /** Effective, server-authoritative capabilities for this staff session. */
  permissions: string[];
  isMasterAdmin: boolean;
}

export interface AdminCounts {
  total: number;
  active: number;
  pending: number;
  suspended: number;
  /** Permanent/severe moderation state (ToS violation, fraud). */
  banned: number;
  locked: number;
  closed: number;
}

export interface AdminEventCounts {
  total: number;
  live: number;
  scheduled: number;
  finished: number;
  cancelled: number;
  suspended: number;
}

export interface AdminBetCounts {
  total: number;
  pending: number;
  accepted: number;
  settled: number;
  void: number;
}

export interface AdminCatalogCounts {
  total: number;
  active: number;
  inactive: number;
}

export interface AdminWalletTotals {
  wallets: number;
  /** Sum of available balances in minor units, grouped by currency. */
  byCurrency: Array<{ currency: string; availableMinor: number; lockedMinor: number; wallets: number }>;
}

export interface AdminSummary {
  users: AdminCounts;
  events: AdminEventCounts;
  bets: AdminBetCounts;
  sports: AdminCatalogCounts;
  competitions: AdminCatalogCounts;
  wallets: AdminWalletTotals;
  providers: PartnerProviderView[];
  system: {
    /** Named non-mock betting provider when one is configured; null otherwise. */
    bettingProvider: string | null;
    /** Database reachable (real connectivity probe via Prisma). */
    database: 'up' | 'down';
    generatedAt: string;
  };
}

export interface AdminSettingsView {
  system: AdminSummary['system'];
  providers: PartnerProviderView[];
}

export interface AdminUserListItem {
  id: string;
  email: string;
  username: string;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  country: string | null;
  status: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  kycStatus: string;
  /**
   * Account domain classification. CUSTOMER rows are the only population of
   * GET /admin/users; STAFF rows are the only population of GET /admin/admins.
   * The server enforces this — the frontend never filters on this field to
   * build a directory (it renders whatever the API returned).
   */
  accountType: 'CUSTOMER' | 'STAFF';
  roles: string[];
  /** Effective role + direct grants - direct denies, calculated server-side. */
  effectivePermissions: string[];
  directPermissionNames: string[];
  deniedPermissionNames: string[];
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AdminUserVerificationItem {
  type: 'PHONE' | 'EMAIL' | 'FACE';
  status: string;
  verifiedAt: string | null;
}

export interface AdminUserWalletSummary {
  id: string;
  currency: string;
  availableBalance: number;
  lockedBalance: number;
  status: string;
}

export interface AdminUserDetail extends AdminUserListItem {
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  verifications: AdminUserVerificationItem[];
  wallets: AdminUserWalletSummary[];
  activeSessions: number;
  totalBets: number;
}

export interface AdminBetSelectionItem {
  id: string;
  selectionId: string;
  eventName: string;
  marketName: string;
  selectionName: string;
  priceAtPlacement: string;
  result: string | null;
  settledAt: string | null;
}

export interface AdminBetListItem {
  id: string;
  userId: string;
  username: string;
  type: string;
  status: string;
  stake: number;
  potentialPayout: number;
  currency: string;
  result: string | null;
  settledAt: string | null;
  payout: number | null;
  createdAt: string;
  selections: AdminBetSelectionItem[];
}

export interface AdminEventListItem {
  id: string;
  gameId: string;
  name: string;
  homeName: string | null;
  awayName: string | null;
  startTime: string;
  status: string;
  live: boolean;
  bettingMode: string;
  competition: { id: string; name: string; slug: string } | null;
  sport: { id: string; name: string; slug: string } | null;
  partnerProvider: { id: string; name: string; status: string } | null;
  createdAt: string;
}

export interface AdminWalletTransactionItem {
  id: string;
  walletId: string;
  type: string;
  status: string;
  amount: number;
  currency: string;
  reference: string | null;
  failureReason: string | null;
  createdAt: string;
}

export interface AdminWalletDetail {
  user: { id: string; username: string; email: string; status: string };
  wallets: AdminUserWalletSummary[];
  transactions: Paginated<AdminWalletTransactionItem>;
}

export interface AdminAuditLogItem {
  id: string;
  actorId: string | null;
  actorType: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
  createdAt: string;
}

export interface AdminCompetitionItem {
  id: string;
  sportId: string;
  sport: { id: string; name: string; slug: string } | null;
  name: string;
  slug: string;
  country: string | null;
  status: string;
  eventsCount: number;
}

export interface AdminSportItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  sortOrder: number;
  competitionsCount: number;
  gamesCount: number;
}

export interface AdminSportDetail extends AdminSportItem {
  competitions: AdminCompetitionItem[];
  games: Array<{
    id: string;
    name: string;
    slug: string;
    status: string;
    gamblingEnabled: boolean;
    providerMapping: { providerName: string; status: string } | null;
  }>;
}

export type AdminUserPage = Paginated<AdminUserListItem>;
export type AdminBetPage = Paginated<AdminBetListItem>;
export type AdminEventPage = Paginated<AdminEventListItem>;
export type AdminAuditLogPage = Paginated<AdminAuditLogItem>;

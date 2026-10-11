/**
 * Admin API layer (typed 1:1 against the backend controllers/services).
 *
 * Every function maps to a REAL backend route:
 *   admin.controller.ts            → /admin/access | /admin/summary | /admin/audit-logs
 *   admin-users.controller.ts      → /admin/users, /admin/users/roles|permissions (list)
 *   admin-user-moderation.controller.ts → PATCH /admin/users/:id/profile,
 *     POST .../reset-password|suspend|unsuspend|ban|unban, DELETE /admin/users/:id
 *   admin-users.controller.ts (AdminStaffController) → PATCH .../admin-profile,
 *     POST .../admin-password-reset, DELETE /admin/admins/:id
 *   admin-bets.controller.ts       → /admin/bets
 *   admin-catalog.controller.ts    → /admin/sports, /admin/events, PATCH /admin/events/:id/status
 *   admin-wallets.controller.ts    → GET /admin/wallets/:userId
 *   admin-betting.controller.ts    → POST /admin/betting/bets/:id/settle
 *   partner-providers.controller.ts→ /admin/partner-providers (+ /sync)
 *   AdminSportsController (sports) → POST/PATCH /admin/sports
 *   admin-wallet.controller.ts     → POST /admin/wallets/:userId/adjustments
 *
 * All calls use the shared authenticated client (JWT bearer + refresh rotation
 * inside authFetch). Success responses are unwrapped from the standard
 * { success, data } envelope by apiFetch. Authorization is ALWAYS enforced
 * server-side (JwtAuthGuard + RolesGuard + @Roles) — errors surface as
 * ApiClientError and are never swallowed here.
 */
import { authFetch } from './client';

import type { Paginated } from '@tanvion-royale/validation';

// ---------------------------------------------------------------------------
// Shared admin types — mirror apps/api/src/modules/admin/admin.types.ts
// ---------------------------------------------------------------------------

/** Supported wallet currencies (BDT/USD/EUR — matches the backend enums). */
export type AdminWalletCurrency = 'BDT' | 'USD' | 'EUR';

export type AdminEventStatus = 'SCHEDULED' | 'LIVE' | 'SUSPENDED' | 'FINISHED' | 'CANCELLED';
export type AdminBetStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'SETTLED' | 'VOID';

/** Per-selection settlement verdicts accepted by the settlement service. */
export type SettleResult = 'WIN' | 'LOSS' | 'VOID' | 'PUSH';

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
   * Account-domain classification. The server already returns only the right
   * population per endpoint (CUSTOMER for GET /admin/users, STAFF for
   * GET /admin/admins) — this field is display metadata, never a client-side
   * filter used to build a directory.
   */
  accountType: 'CUSTOMER' | 'STAFF';
  roles: string[];
  effectivePermissions?: string[];
  directPermissionNames?: string[];
  deniedPermissionNames?: string[];
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

/** Same shape as the backend AdminUserWalletSummary (wallet views). */
export type AdminWallet = AdminUserWalletSummary;

export interface AdminUserDetail extends AdminUserListItem {
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  verifications: AdminUserVerificationItem[];
  wallets: AdminUserWalletSummary[];
  activeSessions: number;
  totalBets: number;
}

/** Role row as returned by GET /admin/users/roles/list (permissions nested). */
export interface AdminRoleItem {
  id: string;
  name: string;
  description?: string | null;
  permissions: Array<{
    id: string;
    roleId: string;
    permissionId: string;
    permission: AdminPermissionItem;
  }>;
}

/** Permission row as returned by GET /admin/users/permissions/list. */
export interface AdminPermissionItem {
  id: string;
  name: string;
  description: string | null;
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

/** Create/update sport payload — mirrors backend CreateSportDto/UpdateSportDto. */
export interface AdminSportPayload {
  name: string;
  slug: string;
  description?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  sortOrder?: number;
}

/** Create/update response — the sports module returns its public sport view. */
export interface AdminSportMutationResult {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  status: string;
  sortOrder: number;
}

// ---------------------------------------------------------------------------
// Partner providers — mirror apps/api/src/modules/sportsbook/partner-providers.types.ts
// (secrets are NEVER returned raw; only *Set boolean flags)
// ---------------------------------------------------------------------------

/**
 * How TANVION integrates with the provider.
 *   SPORTS_API     — server-side sports API + per-event deep links (legacy form)
 *   SPORTS_IFRAME  — the provider's own book EMBEDDED in BIG SPORT (WinHouse)
 *   CASINO_API / LIVE_CASINO_API — product taxonomy for the casino integrations
 *   CASINO_AGGREGATOR — B2B casino/game aggregator (Admin label:
 *                       "Casino Aggregator (BigBang)"), server-to-server
 *                       catalog + launch + seamless wallet
 */
export type AdminPartnerIntegrationType =
  | 'SPORTS_API'
  | 'SPORTS_IFRAME'
  | 'CASINO_API'
  | 'LIVE_CASINO_API'
  | 'CASINO_AGGREGATOR';

export type AdminPartnerEnvironment = 'sandbox' | 'production';

export interface AdminPartnerProvider {
  id: string;
  name: string;
  providerCode: string | null;
  baseUrl: string;
  deepLinkTemplate: string;
  status: 'ACTIVE' | 'INACTIVE';
  integrationType: AdminPartnerIntegrationType;
  /** sandbox | production — null when the row does not declare one. */
  environment: AdminPartnerEnvironment | null;
  /**
   * PUBLIC embed key (`ifr_…`) for an EMBEDDED sportsbook. Public by provider
   * design — it is NOT the wallet API key and is never a signing credential.
   */
  embedKey: string | null;
  /** Exact frontend origin registered in the provider portal (public, no path). */
  domain: string | null;
  /** Exact callback base; the provider appends both documented paths. */
  walletBaseUrl: string | null;
  /** Optional exact public outbound IP (never guessed). */
  serverIp: string | null;
  /** Book origin the loader/iframe is served from (not a secret). */
  embedBaseUrl: string | null;
  /** Wallet API key stored? The key itself is NEVER returned by the API. */
  walletApiKeySet: boolean;
  /** Callback token stored? The token itself is NEVER returned by the API. */
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

/** Mirrors SyncSummary in sports-sync.service.ts. */
export interface AdminSyncSummary {
  sports: number;
  competitions: number;
  events: number;
  markets: number;
  selections: number;
  odds: number;
  errors: string[];
}

export interface AdminPartnerProviderCreatePayload {
  name: string;
  providerCode?: string;
  baseUrl: string;
  /**
   * Required for SPORTS_API (server-resolved event deep link). OMITTED for an
   * EMBEDDED sportsbook (SPORTS_IFRAME) — the book has no per-event deep link
   * and the backend stores the column empty rather than a made-up template.
   */
  deepLinkTemplate?: string;
  integrationType?: AdminPartnerIntegrationType;
  /** sandbox | production — required for SPORTS_IFRAME, never mixed. */
  environment?: AdminPartnerEnvironment;
  /** PUBLIC ifr_… key — never the wallet API key. */
  embedKey?: string;
  /** Book origin, e.g. https://iframe.winhouse.bet. */
  embedBaseUrl?: string;
  /** Exact frontend origin registered in the provider portal. */
  domain?: string;
  /** Exact callback base; WinHouse appends /user-data and /balance-change. */
  walletBaseUrl?: string;
  /** Optional exact public outbound IP (never guessed). */
  serverIp?: string;
  /** Server-only HMAC signing key — encrypted at rest, never returned. */
  walletApiKey?: string;
  /** Server-only callback token — encrypted at rest, never returned. */
  callbackToken?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  apiKey?: string;
  apiSecret?: string;
  authMode?: string;
  apiVersion?: string;
}

/**
 * Update payload semantics (backend partner-providers.service.ts):
 *   apiKey/apiSecret/walletApiKey/callbackToken ''    → clears the stored secret
 *   apiKey/apiSecret/walletApiKey/callbackToken value → re-encrypts with the new value
 *   omitted                                           → keeps the stored secret
 *   authMode/apiVersion ''                            → clears the field (stored as null)
 *   embedKey/embedBaseUrl ''                          → clears the field
 */
export interface AdminPartnerProviderUpdatePayload {
  name?: string;
  providerCode?: string;
  baseUrl?: string;
  deepLinkTemplate?: string;
  integrationType?: AdminPartnerIntegrationType;
  environment?: AdminPartnerEnvironment;
  embedKey?: string;
  embedBaseUrl?: string;
  domain?: string;
  walletBaseUrl?: string;
  serverIp?: string;
  walletApiKey?: string;
  callbackToken?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  apiKey?: string;
  apiSecret?: string;
  authMode?: string | null;
  apiVersion?: string | null;
}

// ---------------------------------------------------------------------------
// Summary — mirrors AdminSummary in admin.types.ts (real aggregates only)
// ---------------------------------------------------------------------------

export interface AdminSummary {
  users: {
    total: number;
    active: number;
    pending: number;
    suspended: number;
    /** Permanent/severe moderation state (ToS violation, fraud) — Part B. */
    banned: number;
    locked: number;
    closed: number;
  };
  events: {
    total: number;
    live: number;
    scheduled: number;
    finished: number;
    cancelled: number;
    suspended: number;
  };
  bets: {
    total: number;
    pending: number;
    accepted: number;
    settled: number;
    void: number;
  };
  sports: { total: number; active: number; inactive: number };
  competitions: { total: number; active: number; inactive: number };
  wallets: {
    wallets: number;
    byCurrency: Array<{
      currency: string;
      availableMinor: number;
      lockedMinor: number;
      wallets: number;
    }>;
  };
  providers: AdminPartnerProvider[];
  system: {
    bettingProvider: string | null;
    database: 'up' | 'down';
    generatedAt: string;
  };
}

/** GET /admin/access — the authoritative admin role probe. */
export interface AdminAccess {
  ok: true;
  roles: string[];
  permissions: string[];
  isMasterAdmin: boolean;
}

// ---------------------------------------------------------------------------
// Access + dashboard + audit
// ---------------------------------------------------------------------------

/** Authoritative admin check (backend 403s any non-admin). Never faked. */
export function checkAdminAccess(): Promise<AdminAccess> {
  return authFetch<AdminAccess>('/admin/access');
}

/** Dashboard aggregates — all values computed server-side from the database. */
export function getAdminSummary(): Promise<AdminSummary> {
  return authFetch<AdminSummary>('/admin/summary');
}

export type AdminSettingsView = Pick<AdminSummary, 'providers' | 'system'>;

/** Read-only platform configuration status — excludes dashboard business metrics. */
export function getAdminSettings(): Promise<AdminSettingsView> {
  return authFetch<AdminSettingsView>('/admin/settings');
}

/**
 * SMS PROVIDER CONFIGURATION (Admin → Settings).
 *
 * The server returns the provider SELECTION plus a boolean `configured` flag per
 * provider and nothing else: no API secret, no auth token, no Account SID, no
 * API key. Those live only in the server/Render environment, so the browser
 * physically cannot read or leak one from this endpoint.
 */
export type SmsProviderName = 'twilio' | 'vonage';
export type SmsProviderMode = SmsProviderName | 'auto';

export interface AdminSmsProviderSettings {
  smsProvider: SmsProviderMode;
  primarySmsProvider: SmsProviderName;
  fallbackSmsProvider: SmsProviderName;
  /** `database` once an admin saved a preference, `environment` before that. */
  source: 'database' | 'environment';
  twilio: { configured: boolean };
  vonage: { configured: boolean };
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface UpdateAdminSmsProviderSettings {
  smsProvider?: SmsProviderMode;
  primarySmsProvider?: SmsProviderName;
  fallbackSmsProvider?: SmsProviderName;
}

/** GET /admin/settings/sms-provider — requires `settings.read`. */
export function getAdminSmsProviderSettings(): Promise<AdminSmsProviderSettings> {
  return authFetch<AdminSmsProviderSettings>('/admin/settings/sms-provider');
}

/**
 * PUT /admin/settings/sms-provider — requires `settings.write`.
 *
 * A staff session signed in without that capability is refused by the API with
 * 403; the Save button is hidden in that case, but the backend is the authority.
 */
export function updateAdminSmsProviderSettings(
  patch: UpdateAdminSmsProviderSettings,
  init?: RequestInit,
): Promise<AdminSmsProviderSettings> {
  return authFetch<AdminSmsProviderSettings>('/admin/settings/sms-provider', {
    method: 'PUT',
    body: JSON.stringify(patch),
    ...init,
  });
}

export interface ListAdminAuditLogsParams {
  action?: string;
  actorId?: string;
  entityType?: string;
  page?: number;
  limit?: number;
}

export function listAdminAuditLogs(
  params?: ListAdminAuditLogsParams,
): Promise<Paginated<AdminAuditLogItem>> {
  return authFetch<Paginated<AdminAuditLogItem>>(
    `/admin/audit-logs${buildQuery(params)}`,
  );
}

// ---------------------------------------------------------------------------
// Users + roles/permissions (admin management)
// ---------------------------------------------------------------------------

export interface ListAdminUsersParams {
  q?: string;
  status?: string;
  page?: number;
  limit?: number;
}

/** GET /admin/users — paginated user directory. */
export function listAdminUsers(
  params?: ListAdminUsersParams,
): Promise<Paginated<AdminUserListItem>> {
  return authFetch<Paginated<AdminUserListItem>>(
    `/admin/users${buildQuery(params)}`,
  );
}

/** GET /admin/admins - paginated STAFF directory (master admins + ordinary staff, never customers). */
export function listAdminStaff(
  params?: ListAdminUsersParams,
): Promise<Paginated<AdminUserListItem>> {
  return authFetch<Paginated<AdminUserListItem>>(
    `/admin/admins${buildQuery(params)}`,
  );
}

/** GET /admin/users/:userId — status/verification/roles/wallet summary. */
export function getAdminUser(userId: string): Promise<AdminUserDetail> {
  return authFetch<AdminUserDetail>(
    `/admin/users/${encodeURIComponent(userId)}`,
  );
}

/** POST /admin/users — SUPER_ADMIN only (body mirrors CreateAdminUserDto). */
export interface CreateAdminUserPayload {
  email: string;
  username: string;
  password: string;
  firstName?: string;
  lastName?: string;
  /** Full replacement set of role names; SUPER_ADMIN is rejected server-side. */
  roleNames: string[];
}

export function createAdminUser(
  payload: CreateAdminUserPayload,
): Promise<AdminUserDetail> {
  return authFetch<AdminUserDetail>('/admin/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** PUT /admin/users/:userId/roles — full role replacement (SUPER_ADMIN only). */
export function updateAdminUserRoles(
  userId: string,
  roleNames: string[],
): Promise<AdminUserDetail> {
  return authFetch<AdminUserDetail>(
    `/admin/users/${encodeURIComponent(userId)}/roles`,
    {
      method: 'PUT',
      body: JSON.stringify({ roleNames }),
    },
  );
}

/** GET /admin/users/roles/list — roles with permissions (SUPER_ADMIN only). */
export function listAdminRoles(): Promise<AdminRoleItem[]> {
  return authFetch<AdminRoleItem[]>('/admin/users/roles/list');
}

/** GET /admin/users/permissions/list — permission catalog (SUPER_ADMIN only). */
export function listAdminPermissions(): Promise<AdminPermissionItem[]> {
  return authFetch<AdminPermissionItem[]>('/admin/users/permissions/list');
}

/** PUT /admin/users/roles/:roleId/permissions — full replacement set. */
export function updateAdminRolePermissions(
  roleId: string,
  permissionNames: string[],
): Promise<AdminRoleItem[]> {
  return authFetch<AdminRoleItem[]>(
    `/admin/users/roles/${encodeURIComponent(roleId)}/permissions`,
    {
      method: 'PUT',
      body: JSON.stringify({ permissionNames }),
    },
  );
}

export interface CreateAdminRolePayload {
  name: string;
  description?: string;
  permissionNames: string[];
}

export function createAdminRole(payload: CreateAdminRolePayload): Promise<AdminRoleItem> {
  return authFetch<AdminRoleItem>('/admin/users/roles', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface UpdateAdminRolePayload {
  name?: string;
  description?: string;
  permissionNames?: string[];
}

export function updateAdminRole(
  roleId: string,
  payload: UpdateAdminRolePayload,
): Promise<AdminRoleItem> {
  return authFetch<AdminRoleItem>(`/admin/users/roles/${encodeURIComponent(roleId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteAdminRole(roleId: string): Promise<{ deleted: true; roleId: string }> {
  return authFetch<{ deleted: true; roleId: string }>(
    `/admin/users/roles/${encodeURIComponent(roleId)}`,
    { method: 'DELETE' },
  );
}

export interface UpdateAdminPermissionsPayload {
  grantPermissionNames: string[];
  denyPermissionNames: string[];
}

export function updateAdminUserPermissions(
  userId: string,
  payload: UpdateAdminPermissionsPayload,
): Promise<AdminUserDetail> {
  return authFetch<AdminUserDetail>(`/admin/users/${encodeURIComponent(userId)}/permissions`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// User moderation (ADMIN + SUPER_ADMIN) — AdminUserModerationController
// Every action is reason-required, audited and revokes the target's sessions.
// DELETE is a soft delete (CLOSED + anonymized, SUPER_ADMIN only).
// ---------------------------------------------------------------------------

export interface AdminModerationReasonInput {
  reason: string;
}

export interface AdminUpdateUserProfileInput extends AdminModerationReasonInput {
  email?: string;
  phone?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

/** Result of POST .../reset-password — plaintext appears ONCE, never stored. */
export interface AdminPasswordResetResult {
  userId: string;
  temporaryPassword: string | null;
  sessionsRevoked: number;
  passwordSetAt: string;
}

/** PATCH /admin/users/:userId/profile — edit identity fields (audited). */
export function updateAdminUserProfile(
  userId: string,
  input: AdminUpdateUserProfileInput,
): Promise<AdminUserDetail> {
  return authFetch<AdminUserDetail>(
    `/admin/users/${encodeURIComponent(userId)}/profile`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
}

/** POST /admin/users/:userId/reset-password — set/generated password + revoke sessions. */
export function resetAdminUserPassword(
  userId: string,
  input: AdminModerationReasonInput & { newPassword?: string },
): Promise<AdminPasswordResetResult> {
  return authFetch<AdminPasswordResetResult>(
    `/admin/users/${encodeURIComponent(userId)}/reset-password`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

/** POST /admin/users/:userId/suspend — SUSPENDED (temporary/reversible). */
export function suspendAdminUser(
  userId: string,
  reason: string,
): Promise<AdminUserDetail> {
  return authFetch<AdminUserDetail>(
    `/admin/users/${encodeURIComponent(userId)}/suspend`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
  );
}

/** POST /admin/users/:userId/unsuspend — ACTIVE (only from SUSPENDED). */
export function unsuspendAdminUser(
  userId: string,
  reason: string,
): Promise<AdminUserDetail> {
  return authFetch<AdminUserDetail>(
    `/admin/users/${encodeURIComponent(userId)}/unsuspend`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
  );
}

/** POST /admin/users/:userId/ban — BANNED (permanent/severe). */
export function banAdminUser(userId: string, reason: string): Promise<AdminUserDetail> {
  return authFetch<AdminUserDetail>(
    `/admin/users/${encodeURIComponent(userId)}/ban`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
  );
}

/** POST /admin/users/:userId/unban — ACTIVE (only from BANNED). */
export function unbanAdminUser(userId: string, reason: string): Promise<AdminUserDetail> {
  return authFetch<AdminUserDetail>(
    `/admin/users/${encodeURIComponent(userId)}/unban`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
  );
}

/** DELETE /admin/users/:userId — soft delete (SUPER_ADMIN only, reason required). */
export function softDeleteAdminUser(
  userId: string,
  reason: string,
): Promise<{ deleted: true; userId: string; sessionsRevoked: number; anonymizedAt: string }> {
  return authFetch<{ deleted: true; userId: string; sessionsRevoked: number; anonymizedAt: string }>(
    `/admin/users/${encodeURIComponent(userId)}`,
    {
      method: 'DELETE',
      body: JSON.stringify({ reason }),
    },
  );
}

// ---------------------------------------------------------------------------
// Staff account lifecycle (SUPER_ADMIN only) — AdminUsersController + AdminStaffController
// ---------------------------------------------------------------------------

/** PATCH /admin/users/:userId/admin-profile — edit a staff account (audited). */
export function updateStaffProfile(
  userId: string,
  input: AdminUpdateUserProfileInput,
): Promise<AdminUserDetail> {
  return authFetch<AdminUserDetail>(
    `/admin/users/${encodeURIComponent(userId)}/admin-profile`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
}

/** POST /admin/users/:userId/admin-password-reset — staff password reset (audited). */
export function resetStaffPassword(
  userId: string,
  input: AdminModerationReasonInput & { newPassword?: string },
): Promise<AdminPasswordResetResult> {
  return authFetch<AdminPasswordResetResult>(
    `/admin/users/${encodeURIComponent(userId)}/admin-password-reset`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

/** DELETE /admin/admins/:userId — deactivate a staff account (roles stripped + soft delete). */
export function deactivateStaff(
  userId: string,
  reason: string,
): Promise<{ deactivated: true; userId: string; rolesRemoved: string[]; sessionsRevoked: number }> {
  return authFetch<{
    deactivated: true;
    userId: string;
    rolesRemoved: string[];
    sessionsRevoked: number;
  }>(`/admin/admins/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ reason }),
  });
}

// ---------------------------------------------------------------------------
// Betting (bets list + events list + settlement + event status)
// ---------------------------------------------------------------------------

export interface ListAdminBetsParams {
  q?: string;
  status?: AdminBetStatus | string;
  userId?: string;
  eventId?: string;
  page?: number;
  limit?: number;
}

/** GET /admin/bets — read-only bet search. */
export function listAdminBets(
  params?: ListAdminBetsParams,
): Promise<Paginated<AdminBetListItem>> {
  return authFetch<Paginated<AdminBetListItem>>(
    `/admin/bets${buildQuery(params)}`,
  );
}

export interface ListAdminEventsParams {
  status?: AdminEventStatus | string;
  sport?: string;
  competitionId?: string;
  q?: string;
  page?: number;
  limit?: number;
}

/** GET /admin/events — read-only event search. */
export function listAdminEvents(
  params?: ListAdminEventsParams,
): Promise<Paginated<AdminEventListItem>> {
  return authFetch<Paginated<AdminEventListItem>>(
    `/admin/events${buildQuery(params)}`,
  );
}

/** Settlement outcome as returned by POST /admin/betting/bets/:id/settle. */
export interface SettleAdminBetResult {
  betId: string;
  status: 'SETTLED';
  result: 'WIN' | 'LOSS' | 'VOID';
  payout: number;
  /** true when the bet was already settled — never paid twice. */
  alreadySettled: boolean;
}

/** POST /admin/betting/bets/:id/settle — idempotent settlement (real backend). */
export function settleAdminBet(
  betId: string,
  results: Array<{ selectionId: string; result: SettleResult }>,
): Promise<SettleAdminBetResult> {
  return authFetch<SettleAdminBetResult>(
    `/admin/betting/bets/${encodeURIComponent(betId)}/settle`,
    {
      method: 'POST',
      body: JSON.stringify({ results }),
    },
  );
}

/** PATCH /admin/events/:eventId/status — audited, reason-backed status change. */
export function updateAdminEventStatus(
  eventId: string,
  status: AdminEventStatus,
  reason: string,
): Promise<AdminEventListItem> {
  return authFetch<AdminEventListItem>(
    `/admin/events/${encodeURIComponent(eventId)}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status, reason }),
    },
  );
}

// ---------------------------------------------------------------------------
// Sports catalog (admin)
// ---------------------------------------------------------------------------

/** GET /admin/sports — full list including INACTIVE, with counts. */
export function listAdminSports(): Promise<AdminSportItem[]> {
  return authFetch<AdminSportItem[]>('/admin/sports');
}

/** GET /admin/sports/:sportId — competitions + games (all statuses). */
export function getAdminSport(sportId: string): Promise<AdminSportDetail> {
  return authFetch<AdminSportDetail>(
    `/admin/sports/${encodeURIComponent(sportId)}`,
  );
}

/** POST /admin/sports — create a sport (audited in the sports module). */
export function createAdminSport(
  payload: AdminSportPayload,
): Promise<AdminSportMutationResult> {
  return authFetch<AdminSportMutationResult>('/admin/sports', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** PATCH /admin/sports/:id — partial update (audited in the sports module). */
export function updateAdminSport(
  sportId: string,
  payload: Partial<AdminSportPayload>,
): Promise<AdminSportMutationResult> {
  return authFetch<AdminSportMutationResult>(
    `/admin/sports/${encodeURIComponent(sportId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );
}

// ---------------------------------------------------------------------------
// Sky Rocket — crash-point sequence configuration
// ---------------------------------------------------------------------------

/** Mirrors CrashSequenceAdminView (crash-sequence.service.ts). */
export interface AdminCrashSequenceState {
  active: boolean;
  mode: 'PROVABLY_FAIR' | 'ORIGINAL' | 'REPEAT' | 'REPEAT_EXTENDED' | 'NEW_SEQUENCE';
  lastIndex: number | null;
  label: string | null;
  originalPoints: number[];
  originalConsumed: number;
  remainingOriginal: number;
  repeatPosition: number;
  repeatEnd: number | null;
  nextPoints: number[] | null;
  newConsumed: number;
  version: number;
  updatedAt: string | null;
}

/** GET /admin/crash/sequence — full runtime view (admin-only). */
export function getCrashSequence(): Promise<AdminCrashSequenceState> {
  return authFetch<{ state: AdminCrashSequenceState }>('/admin/crash/sequence').then(
    (res) => res.state,
  );
}

/** POST /admin/crash/sequence/points — set/replace the original list. */
export function setCrashSequencePoints(
  points: number[],
  reason?: string,
): Promise<{ state: AdminCrashSequenceState; message: string }> {
  return authFetch<{ state: AdminCrashSequenceState; message: string }>(
    '/admin/crash/sequence/points',
    { method: 'POST', body: JSON.stringify({ points, reason }) },
  );
}

/** POST /admin/crash/sequence/next-points — queue NEW points after the repeat. */
export function setCrashSequenceNextPoints(
  points: number[],
  reason?: string,
): Promise<{ state: AdminCrashSequenceState; message: string }> {
  return authFetch<{ state: AdminCrashSequenceState; message: string }>(
    '/admin/crash/sequence/next-points',
    { method: 'POST', body: JSON.stringify({ points, reason }) },
  );
}

/** POST /admin/crash/sequence/extension — extend the CURRENT repeat (no reset). */
export function setCrashRepeatExtension(
  extension: number,
  reason?: string,
): Promise<{ state: AdminCrashSequenceState; message: string }> {
  return authFetch<{ state: AdminCrashSequenceState; message: string }>(
    '/admin/crash/sequence/extension',
    { method: 'POST', body: JSON.stringify({ extension, reason }) },
  );
}

// ---------------------------------------------------------------------------
// Partner providers
// ---------------------------------------------------------------------------

/** GET /admin/partner-providers — secrets masked to *Set booleans. */
export function listPartnerProviders(): Promise<AdminPartnerProvider[]> {
  return authFetch<AdminPartnerProvider[]>('/admin/partner-providers');
}

/** POST /admin/partner-providers — credentials encrypted at rest server-side. */
export function createPartnerProvider(
  payload: AdminPartnerProviderCreatePayload,
): Promise<AdminPartnerProvider> {
  return authFetch<AdminPartnerProvider>('/admin/partner-providers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** PATCH /admin/partner-providers/:id — '' clears a secret, omission keeps it. */
export function updatePartnerProvider(
  providerId: string,
  payload: AdminPartnerProviderUpdatePayload,
): Promise<AdminPartnerProvider> {
  return authFetch<AdminPartnerProvider>(
    `/admin/partner-providers/${encodeURIComponent(providerId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );
}

/** DELETE /admin/partner-providers/:id — audited removal. */
export function deletePartnerProvider(providerId: string): Promise<void> {
  return authFetch<void>(
    `/admin/partner-providers/${encodeURIComponent(providerId)}`,
    { method: 'DELETE' },
  );
}

/** POST /admin/partner-providers/sync — optional ?providerId= for one provider. */
export function triggerPartnerSync(
  providerId?: string,
): Promise<{ message: string; summary: AdminSyncSummary }> {
  const query = providerId
    ? `?providerId=${encodeURIComponent(providerId)}`
    : '';
  return authFetch<{ message: string; summary: AdminSyncSummary }>(
    `/admin/partner-providers/sync${query}`,
    { method: 'POST' },
  );
}

// ---------------------------------------------------------------------------
// Embedded sportsbook (BIG SPORT) — AdminWinHouseController
// GET /admin/winhouse/status, POST /admin/winhouse/self-test
//
// The provider's two SECRETS (wallet API key + callback token) are reported as
// booleans only — the values are never returned by any admin endpoint.
// ---------------------------------------------------------------------------

/** One provider callback outcome (in-memory on the API, since process start). */
export interface AdminWinHouseCallbackDiagnostic {
  kind: 'user-data' | 'balance-change';
  outcome: 'ok' | 'rejected';
  /** Stable refusal code (`WINHOUSE_BAD_SIGNATURE`, …) or null. */
  code: string | null;
  /** HTTP status the provider received. */
  status: number;
  at: string;
}

/** The most recent provider movement that reached the ONE TANVION wallet. */
export interface AdminWinHouseLastMovement {
  transactionId: string;
  ticketId: string | null;
  action: string;
  /** Signed amount exactly as the provider sent it (negative = stake). */
  amount: string;
  currency: string;
  balanceAfter: string;
  at: string;
}

/** Mirrors WinHouseStatusView in packages/types (secrets only as flags). */
export interface AdminWinHouseStatus {
  configured: boolean;
  environment: 'sandbox' | 'production';
  provider: string | null;
  domain: string | null;
  walletBaseUrl: string | null;
  serverIp: string | null;
  /** PUBLIC embed key — not a credential, but never displayed unmasked. */
  embedKey: string | null;
  embedBaseUrl: string | null;
  product: 'SPORT';
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
  /** Exact endpoint the provider calls for a balance. */
  userDataEndpoint: string | null;
  /** Exact endpoint the provider posts bet/win movements to. */
  balanceChangeEndpoint: string | null;
  /** Masked `ifr_…` key — the only form the admin UI ever prints. */
  embedKeyMasked: string | null;
  lastCallback: AdminWinHouseCallbackDiagnostic | null;
  lastBalanceChange: AdminWinHouseCallbackDiagnostic | null;
  lastError: AdminWinHouseCallbackDiagnostic | null;
  lastSuccessfulTransaction: AdminWinHouseLastMovement | null;
  /** Honest operator warning, or null. */
  warning: string | null;
}

export interface AdminWinHouseSelfTestCheck {
  check: string;
  ok: boolean;
  /** Secret-free detail (never a key, token or signature). */
  detail: string | null;
}

export interface AdminWinHouseSelfTest {
  ok: boolean;
  provider: string | null;
  environment: string;
  checks: AdminWinHouseSelfTestCheck[];
  /** Non-fatal operator warnings (sandbox mode, …). */
  warnings: string[];
}

/** GET /admin/winhouse/status — masked status of the embedded sportsbook. */
export function getWinHouseStatus(): Promise<AdminWinHouseStatus> {
  return authFetch<AdminWinHouseStatus>('/admin/winhouse/status');
}

/**
 * POST /admin/winhouse/self-test — reproduces the provider's own acceptance
 * criteria locally and, with `network=true`, checks the provider's public
 * config endpoint and non-monetary POST /tenant/sso launch redemption.
 * It never sends a wallet secret and never mutates a TANVION wallet.
 *
 * POST (not GET) so the endpoint is never prefetched/cached by an intermediary;
 * it is admin-authenticated and mutation-free.
 */
export function runWinHouseSelfTest(network = false): Promise<AdminWinHouseSelfTest> {
  const query = network ? '?network=true' : '';
  return authFetch<AdminWinHouseSelfTest>(`/admin/winhouse/self-test${query}`, {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Wallets (admin view + the ONLY balance-changing path: signed adjustments)
// ---------------------------------------------------------------------------

export interface ListAdminWalletDetailParams {
  page?: number;
  limit?: number;
  type?: string;
  status?: string;
  /** Free-form currency; normalized to BDT/USD/EUR before sending. */
  currency?: AdminWalletCurrency | string;
}

/**
 * GET /admin/wallets/:userId — wallets + paginated transaction history for
 * one user (read-only).
 */
export function getAdminWalletDetail(
  userId: string,
  params?: ListAdminWalletDetailParams,
): Promise<AdminWalletDetail> {
  const { currency, ...rest } = params ?? {};

  return authFetch<AdminWalletDetail>(
    `/admin/wallets/${encodeURIComponent(userId)}${buildQuery({
      ...rest,
      currency: normalizeCurrency(currency),
    })}`,
  );
}

export interface AdminWalletAdjustmentInput {
  /** Signed amount in minor units. Positive = credit, negative = debit. */
  amount: number;
  currency?: AdminWalletCurrency;
  reason: string;
  /** Unique key — reusing it never applies a second balance change. */
  idempotencyKey: string;
}

/** Result of POST /admin/wallets/:userId/adjustments (backend WalletService). */
export interface AdminWalletAdjustmentResult {
  transaction: AdminWalletTransactionItem & { userId: string; updatedAt: string };
  wallet: AdminUserWalletSummary;
  duplicate: boolean;
}

/**
 * POST /admin/wallets/:userId/adjustments — ledger-backed, reason-required,
 * idempotent and audited. Default currency BDT matches the backend.
 */
export async function adjustAdminWallet(
  userId: string,
  input: AdminWalletAdjustmentInput,
): Promise<AdminWalletAdjustmentResult> {
  const currency = normalizeCurrency(input.currency) ?? 'BDT';

  if (!input.reason.trim()) {
    throw new Error('Adjustment reason is required.');
  }

  if (!input.idempotencyKey.trim()) {
    throw new Error('Idempotency key is required.');
  }

  if (!Number.isFinite(input.amount) || input.amount === 0) {
    throw new Error(
      'Adjustment amount must be a non-zero integer in minor units.',
    );
  }

  return authFetch<AdminWalletAdjustmentResult>(
    `/admin/wallets/${encodeURIComponent(userId)}/adjustments`,
    {
      method: 'POST',
      body: JSON.stringify({
        amount: input.amount,
        currency,
        reason: input.reason.trim(),
        idempotencyKey: input.idempotencyKey.trim(),
      }),
    },
  );
}

/**
 * Search users for Admin wallet management (same GET /admin/users route).
 * Retained for callers that only need the compact id/name projection.
 */
export async function searchAdminUsers(query: string) {
  const params = new URLSearchParams();

  if (query.trim()) {
    params.set('q', query.trim());
  }

  const page = await authFetch<Paginated<AdminUserListItem>>(
    `/admin/users?${params.toString()}`,
  );

  return {
    items: page.items.map((user) => ({
      id: user.id,
      name:
        [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
      username: user.username,
      email: user.email,
    })),
    total: page.total,
  };
}

// ---------------------------------------------------------------------------
// Small local helpers
// ---------------------------------------------------------------------------

const ADMIN_WALLET_CURRENCIES: AdminWalletCurrency[] = [
  'BDT',
  'USD',
  'EUR',
];

function normalizeCurrency(
  currency?: string | null,
): AdminWalletCurrency | undefined {
  if (!currency) return undefined;

  const normalized = currency.toUpperCase() as AdminWalletCurrency;

  return ADMIN_WALLET_CURRENCIES.includes(normalized)
    ? normalized
    : undefined;
}

/** Builds a `?a=1&b=2` query string, dropping undefined/empty values. */
function buildQuery(
  params?:
    | ListAdminUsersParams
    | ListAdminBetsParams
    | ListAdminEventsParams
    | ListAdminAuditLogsParams
    | ListAdminWalletDetailParams,
): string {
  if (!params) return '';

  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }

  const query = search.toString();

  return query ? `?${query}` : '';
}
// ---------------------------------------------------------------------------
// Payment methods (admin) — AdminPaymentMethodsController
// GET/POST /admin/payment-methods, PATCH /admin/payment-methods/:id,
// POST /admin/payment-methods/:id/archive
// ---------------------------------------------------------------------------

/**
 * Payment method as returned by the admin endpoints. Mirrors the backend
 * serializer 1:1 — amounts are integer minor units. Provider secrets are
 * NEVER part of this shape; only public instructions (account numbers,
 * names, branches, routing numbers, limits) are stored/returned.
 */
export interface AdminPaymentMethod {
  id: string;
  code: string;
  displayName: string;
  type: string;
  status: string;
  supportedCurrencies: AdminWalletCurrency[];
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  gatewayConfigId?: string | null;
  gatewayName?: string | null;
  accountNumber: string | null;
  accountName: string | null;
  bankName: string | null;
  branch: string | null;
  routingNumber: string | null;
  instructions: string | null;
  minDeposit: number;
  maxDeposit: number;
  minWithdrawal: number;
  maxWithdrawal: number;
  requireTransactionId: boolean;
  requireProof: boolean;
  sortOrder: number;
}

/** Payload accepted by POST /admin/payment-methods (matches the backend DTO). */
export interface CreateAdminPaymentMethodInput {
  code: string;
  displayName: string;
  type?: 'MANUAL' | 'GATEWAY';
  gatewayConfigId?: string | null;
  supportedCurrencies: string[];
  depositEnabled?: boolean;
  withdrawalEnabled?: boolean;
  accountNumber?: string;
  accountName?: string;
  bankName?: string;
  branch?: string;
  routingNumber?: string;
  instructions?: string;
  minDeposit?: number;
  maxDeposit?: number;
  minWithdrawal?: number;
  maxWithdrawal?: number;
  requireTransactionId?: boolean;
  requireProof?: boolean;
  sortOrder?: number;
}

/** Partial payload accepted by PATCH /admin/payment-methods/:id. */
export type UpdateAdminPaymentMethodInput = Partial<CreateAdminPaymentMethodInput> & {
  status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
};

/** GET /admin/payment-methods — includes INACTIVE/ARCHIVED rows. */
export async function listAdminPaymentMethods(): Promise<AdminPaymentMethod[]> {
  return authFetch<AdminPaymentMethod[]>('/admin/payment-methods');
}

/** POST /admin/payment-methods — create a new manual payment method. */
export async function createAdminPaymentMethod(
  input: CreateAdminPaymentMethodInput,
): Promise<AdminPaymentMethod> {
  return authFetch<AdminPaymentMethod>('/admin/payment-methods', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** PATCH /admin/payment-methods/:id — update fields/limits/status. */
export async function updateAdminPaymentMethod(
  id: string,
  input: UpdateAdminPaymentMethodInput,
): Promise<AdminPaymentMethod> {
  return authFetch<AdminPaymentMethod>(
    `/admin/payment-methods/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
}

/**
 * POST /admin/payment-methods/:id/archive — archives the method (removed from
 * every user-facing list; deposit/withdrawal disabled).
 */
export async function archiveAdminPaymentMethod(id: string): Promise<AdminPaymentMethod> {
  return authFetch<AdminPaymentMethod>(
    `/admin/payment-methods/${encodeURIComponent(id)}/archive`,
    { method: 'POST' },
  );
}

// ---------------------------------------------------------------------------
// Manual deposits (admin) — AdminManualDepositsController
// GET /admin/manual-deposits, GET /admin/manual-deposits/:id,
// POST /admin/manual-deposits/:id/review
// ---------------------------------------------------------------------------

/** Manual deposit as returned by the admin endpoints (backend serializer). */
export interface AdminManualDepositListItem {
  id: string;
  userId: string;
  methodId: string;
  method: AdminPaymentMethod | null;
  amount: number;
  currency: string;
  referenceId: string | null;
  proofPath: string | null;
  status: string;
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  transactionId: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

/** GET /admin/manual-deposits/:id — deposit plus the requesting user. */
export interface AdminManualDepositDetail {
  deposit: AdminManualDepositListItem;
  user: {
    id: string;
    username: string;
    email: string | null;
    phone: string | null;
  };
}

export interface ListAdminManualDepositsParams {
  status?: 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  limit?: number;
}

/** GET /admin/manual-deposits — newest first, optional status filter. */
export async function listAdminManualDeposits(
  params?: ListAdminManualDepositsParams,
): Promise<AdminManualDepositListItem[]> {
  const search = new URLSearchParams();
  if (params?.status) search.set('status', params.status);
  if (params?.limit) search.set('limit', String(Math.min(Math.max(params.limit, 1), 200)));
  const qs = search.toString();
  return authFetch<AdminManualDepositListItem[]>(
    `/admin/manual-deposits${qs ? `?${qs}` : ''}`,
  );
}

/** GET /admin/manual-deposits/:id — full detail with the requesting user. */
export async function getAdminManualDeposit(id: string): Promise<AdminManualDepositDetail> {
  return authFetch<AdminManualDepositDetail>(
    `/admin/manual-deposits/${encodeURIComponent(id)}`,
  );
}

// ---------------------------------------------------------------------------
// Payment gateways (admin) — AdminPaymentGatewaysController
// GET /admin/payment-gateways, GET|POST /admin/payment-gateways,
// PATCH /admin/payment-gateways/:id, DELETE /admin/payment-gateways/:id,
// POST /admin/payment-gateways/:id/enable|disable|test
// ---------------------------------------------------------------------------

/** Gateway config as returned by the admin API (secrets only as flags). */
export interface AdminPaymentGateway {
  id: string;
  name: string;
  code: string;
  providerType: string;
  baseUrl: string;
  status: string;
  apiKeySet: boolean;
  apiSecretSet: boolean;
  webhookSecretSet: boolean;
  authMode: string | null;
  apiVersion: string | null;
  timeoutMs: number;
  supportedCurrencies: string[];
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Payload accepted by POST /admin/payment-gateways. */
export interface CreateAdminPaymentGatewayInput {
  name: string;
  code: string;
  providerType?: string;
  baseUrl: string;
  supportedCurrencies?: string[];
  depositEnabled?: boolean;
  withdrawalEnabled?: boolean;
  apiKey?: string;
  apiSecret?: string;
  webhookSecret?: string;
  authMode?: string;
  apiVersion?: string;
  timeoutMs?: number;
}

/** Partial payload accepted by PATCH /admin/payment-gateways/:id. */
export type UpdateAdminPaymentGatewayInput = Partial<CreateAdminPaymentGatewayInput> & {
  status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
};

/** Result of POST /admin/payment-gateways/:id/test (safe, no secrets). */
export interface AdminGatewayTestResult {
  ok: boolean;
  message: string;
}

export async function listAdminPaymentGateways(): Promise<AdminPaymentGateway[]> {
  return authFetch<AdminPaymentGateway[]>('/admin/payment-gateways');
}

export async function getAdminPaymentGateway(id: string): Promise<AdminPaymentGateway> {
  return authFetch<AdminPaymentGateway>(`/admin/payment-gateways/${encodeURIComponent(id)}`);
}

export async function createAdminPaymentGateway(
  input: CreateAdminPaymentGatewayInput,
): Promise<AdminPaymentGateway> {
  return authFetch<AdminPaymentGateway>('/admin/payment-gateways', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateAdminPaymentGateway(
  id: string,
  input: UpdateAdminPaymentGatewayInput,
): Promise<AdminPaymentGateway> {
  return authFetch<AdminPaymentGateway>(
    `/admin/payment-gateways/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
}

export async function archiveAdminPaymentGateway(id: string): Promise<AdminPaymentGateway> {
  return authFetch<AdminPaymentGateway>(
    `/admin/payment-gateways/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
}

export async function enableAdminPaymentGateway(id: string): Promise<AdminPaymentGateway> {
  return authFetch<AdminPaymentGateway>(
    `/admin/payment-gateways/${encodeURIComponent(id)}/enable`,
    { method: 'POST' },
  );
}

export async function disableAdminPaymentGateway(id: string): Promise<AdminPaymentGateway> {
  return authFetch<AdminPaymentGateway>(
    `/admin/payment-gateways/${encodeURIComponent(id)}/disable`,
    { method: 'POST' },
  );
}

export async function testAdminPaymentGateway(id: string): Promise<AdminGatewayTestResult> {
  return authFetch<AdminGatewayTestResult>(
    `/admin/payment-gateways/${encodeURIComponent(id)}/test`,
    { method: 'POST' },
  );
}

// ---------------------------------------------------------------------------
// Manual deposits (admin) — review action
// ---------------------------------------------------------------------------

/**
 * POST /admin/manual-deposits/:id/review — approve/reject a pending deposit.
 * Idempotent: the backend never credits a wallet twice for the same deposit.
 */
export async function reviewAdminManualDeposit(
  id: string,
  action: 'APPROVE' | 'REJECT',
  reason?: string,
): Promise<AdminManualDepositListItem> {
  return authFetch<AdminManualDepositListItem>(
    `/admin/manual-deposits/${encodeURIComponent(id)}/review`,
    {
      method: 'POST',
      body: JSON.stringify({ action, reason: reason?.trim() || undefined }),
    },
  );
}

// ---------------------------------------------------------------------------
// Manual withdrawals (admin) — AdminManualWithdrawalsController
// ---------------------------------------------------------------------------

/** Withdrawal request row (user + admin share the backend serializer shape). */
export interface AdminManualWithdrawal {
  id: string;
  userId: string;
  methodId: string;
  methodCode: string;
  methodName: string;
  methodType: string;
  amount: number;
  currency: string;
  destinationAccount: string | null;
  destinationName: string | null;
  bankName: string | null;
  branch: string | null;
  routingNumber: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'CANCELLED' | string;
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  walletTransactionId: string | null;
  providerReference: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListAdminManualWithdrawalsParams {
  status?: string;
  limit?: number;
}

export async function listAdminManualWithdrawals(
  params?: ListAdminManualWithdrawalsParams,
): Promise<AdminManualWithdrawal[]> {
  const search = new URLSearchParams();
  if (params?.status) search.set('status', params.status);
  if (params?.limit) search.set('limit', String(Math.min(Math.max(params.limit, 1), 200)));
  const qs = search.toString();
  return authFetch<AdminManualWithdrawal[]>(`/admin/manual-withdrawals${qs ? `?${qs}` : ''}`);
}

export async function getAdminManualWithdrawal(id: string): Promise<AdminManualWithdrawal> {
  return authFetch<AdminManualWithdrawal>(`/admin/manual-withdrawals/${encodeURIComponent(id)}`);
}

export async function reviewAdminManualWithdrawal(
  id: string,
  action: 'APPROVE' | 'REJECT',
  reason?: string,
): Promise<AdminManualWithdrawal> {
  return authFetch<AdminManualWithdrawal>(
    `/admin/manual-withdrawals/${encodeURIComponent(id)}/review`,
    { method: 'POST', body: JSON.stringify({ action, reason: reason?.trim() || undefined }) },
  );
}

export async function completeAdminManualWithdrawal(
  id: string,
  providerReference?: string,
): Promise<AdminManualWithdrawal> {
  return authFetch<AdminManualWithdrawal>(
    `/admin/manual-withdrawals/${encodeURIComponent(id)}/complete`,
    { method: 'POST', body: JSON.stringify({ providerReference: providerReference?.trim() || undefined }) },
  );

// ---------------------------------------------------------------------------
// Royale Ace (admin) — RoyaleAceAdminController (admin/royale-ace)
// ---------------------------------------------------------------------------

/** A Royale Ace config version as returned by the admin API. */
export interface AdminAceConfigVersion {
  id: string;
  version: number;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  name: string;
  configName: string;
  targetRtpBp: number;
  changeReason: string;
  createdById: string;
  activatedById: string | null;
  createdAt: string;
  activatedAt: string | null;
  validationErrors: Array<{ path: string; message: string }>;
  simulationPassed: boolean | null;
  config: Record<string, unknown>;
}

/** A stored simulation report for a Royale Ace config version. */
export interface AdminAceSimulationReport {
  id: string;
  configVersion: number;
  spins: number;
  rtpBp: number;
  rtpCiLowBp: number;
  rtpCiHighBp: number;
  targetRtpBp: number;
  toleranceBp: number;
  hitFrequencyBp: number;
  triggerRateBp: number;
  retriggerRateBp: number;
  baseGameRtpBp: number;
  cascadeRtpBp: number;
  freeSpinRtpBp: number;
  volatilityBp: number;
  maxWinObservedBp: number;
  maxWinCapBp: number;
  passed: boolean;
  notes: string | null;
  createdById: string;
  createdAt: string;
}

/** A Royale Ace round row for the admin viewer (never includes a seed). */
export interface AdminAceRound {
  id: string;
  userId: string;
  mode: string;
  status: string;
  stake: number;
  currency: string;
  payout: number | null;
  maxMultiplierBp: number;
  capped: boolean;
  configVersion: number;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  transactionId: string | null;
  createdAt: string;
  settledAt: string | null;
}

/** GET /admin/royale-ace/config/versions — every config version, newest first. */
export function listAceConfigVersions(): Promise<{ versions: AdminAceConfigVersion[] }> {
  return authFetch<{ versions: AdminAceConfigVersion[] }>('/admin/royale-ace/config/versions');
}

/** GET /admin/royale-ace/config/versions/:version — one version by number. */
export function getAceConfigVersion(version: number): Promise<AdminAceConfigVersion> {
  return authFetch<AdminAceConfigVersion>(`/admin/royale-ace/config/versions/${version}`);
}

/** GET /admin/royale-ace/config/default — the built-in launch configuration. */
export function getAceDefaultConfig(): Promise<{ config: Record<string, unknown> }> {
  return authFetch<{ config: Record<string, unknown> }>('/admin/royale-ace/config/default');
}

/** POST /admin/royale-ace/config/versions — create a new DRAFT version. */
export function createAceConfigVersion(
  config: Record<string, unknown>,
  reason: string,
): Promise<AdminAceConfigVersion> {
  return authFetch<AdminAceConfigVersion>('/admin/royale-ace/config/versions', {
    method: 'POST',
    body: JSON.stringify({ config, reason }),
  });
}

/** GET /admin/royale-ace/config/versions/:version/reports — sim reports. */
export function listAceSimulationReports(
  version: number,
): Promise<{ reports: AdminAceSimulationReport[] }> {
  return authFetch<{ reports: AdminAceSimulationReport[] }>(
    `/admin/royale-ace/config/versions/${version}/reports`,
  );
}

/** POST /admin/royale-ace/config/versions/:version/simulate — run a sim report. */
export function runAceSimulation(
  version: number,
  options: { spins?: number; seed?: string } = {},
): Promise<AdminAceSimulationReport> {
  return authFetch<AdminAceSimulationReport>(
    `/admin/royale-ace/config/versions/${version}/simulate`,
    { method: 'POST', body: JSON.stringify(options) },
  );
}

/** POST /admin/royale-ace/config/versions/:version/activate — activate. */
export function activateAceConfigVersion(
  version: number,
  reason: string,
): Promise<AdminAceConfigVersion> {
  return authFetch<AdminAceConfigVersion>(
    `/admin/royale-ace/config/versions/${version}/activate`,
    { method: 'POST', body: JSON.stringify({ reason }) },
  );
}

/** POST /admin/royale-ace/config/enabled — game on/off switch. */
export function setAceEnabled(
  enabled: boolean,
  reason: string,
): Promise<AdminAceConfigVersion> {
  return authFetch<AdminAceConfigVersion>('/admin/royale-ace/config/enabled', {
    method: 'POST',
    body: JSON.stringify({ enabled, reason }),
  });
}

/** GET /admin/royale-ace/rounds — recent rounds (operational viewer). */
export function listAceRounds(
  filters: { userId?: string; status?: string; limit?: number } = {},
): Promise<AdminAceRound[]> {
  const search = new URLSearchParams();
  if (filters.userId) search.set('userId', filters.userId);
  if (filters.status) search.set('status', filters.status);
  if (filters.limit) search.set('limit', String(filters.limit));
  const qs = search.toString();
  return authFetch<AdminAceRound[]>(`/admin/royale-ace/rounds${qs ? `?${qs}` : ''}`).then(
    (rows) => rows ?? [],
  );
}

/** GET /admin/royale-ace/rounds/:roundId — one round with its full outcome. */
export function getAceRoundForReplay(roundId: string): Promise<Record<string, unknown>> {
  return authFetch<Record<string, unknown>>(
    `/admin/royale-ace/rounds/${encodeURIComponent(roundId)}`,
  );
}

/** POST /admin/royale-ace/rounds/:roundId/void — void an unpaid round. */
export function voidAceRound(roundId: string, reason: string): Promise<{ voided: boolean }> {
  return authFetch<{ voided: boolean }>(
    `/admin/royale-ace/rounds/${encodeURIComponent(roundId)}/void`,
    { method: 'POST', body: JSON.stringify({ reason }) },
  );
}

/** POST /admin/royale-ace/reconcile — trigger the stuck-round reconciler. */
export function reconcileAceRounds(): Promise<{ completed: number; voided: number }> {
  return authFetch<{ completed: number; voided: number }>('/admin/royale-ace/reconcile', {
    method: 'POST',
  });
}

}

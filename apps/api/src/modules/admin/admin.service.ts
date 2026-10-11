import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import { generateTemporaryPassword } from '../../common/utils/crypto';
import { calculateEffectivePermissions } from '../../common/auth/effective-permissions';
import { isMasterAdminEmail } from '../../config/master-admins';
import { configuredBettingProviderName } from '../betting/betting-provider.factory';
import { PartnerProvidersService } from '../sportsbook/partner-providers.service';
import type {
  AdminAuditLogItem,
  AdminAuditLogPage,
  AdminBetListItem,
  AdminBetPage,
  AdminEventListItem,
  AdminEventPage,
  AdminSportDetail,
  AdminSportItem,
  AdminSummary,
  AdminSettingsView,
  AdminUserDetail,
  AdminUserListItem,
  AdminUserPage,
  AdminWalletDetail,
  AdminCompetitionItem,
} from './admin.types';
import type {
  ListAdminAuditLogsQueryDto,
  ListAdminBetsQueryDto,
  ListAdminEventsQueryDto,
  ListAdminUsersQueryDto,
  ListAdminWalletTransactionsQueryDto,
} from './dto/admin-queries.dto';
import {
  CreateAdminUserDto,
  CreateRoleDto,
  UpdateRoleDto,
  UpdateUserPermissionsDto,
} from './dto/admin-management.dto';
import {
  AdminModerationReasonDto,
  AdminResetPasswordDto,
  AdminUpdateUserProfileDto,
} from './dto/admin-moderation.dto';

/**
 * Hard rule for every staff-management endpoint: SUPER_ADMIN accounts can
 * never be granted, edited, deactivated or demoted through the admin panel.
 * The only supported path is database/scripts/promote-admin.ts.
 */
const SUPER_ADMIN_PROTECTED_MESSAGE =
  'SUPER_ADMIN cannot be modified through this endpoint — use the promote-admin script.';

/**
 * Master-admin accounts (the fixed addresses in MASTER_ADMIN_EMAILS) are
 * permanent platform owners: unlike an ordinary staff account they can never be
 * deactivated — not by another SUPER_ADMIN, and regardless of how many other
 * active SUPER_ADMINs exist (the "last SUPER_ADMIN" floor alone would let one
 * master admin deactivate the other). Deliberately a distinct message so the
 * operator sees exactly why.
 */
const MASTER_ADMIN_PROTECTED_MESSAGE =
  'This account is a permanent master admin and cannot be deactivated.';

/** The account must have changed by at least one field to be written. */
const EMPTY_PROFILE_UPDATE_MESSAGE = 'No profile fields were provided — nothing to update.';

/** Prisma select shared by every moderation action. */
const moderationTargetSelect = {
  id: true,
  status: true,
  username: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  accountType: true,
  userRoles: { select: { role: { select: { name: true } } } },
} satisfies Prisma.UserSelect;

type ModerationTarget = Prisma.UserGetPayload<{ select: typeof moderationTargetSelect }> & {
  /** Role names of the target account. */
  roles: string[];
};

/** Options accepted by the shared status-transition implementation. */
interface SetUserStatusOptions {
  newStatus: 'ACTIVE' | 'SUSPENDED' | 'BANNED';
  /** Transition table: the statuses this action may be applied FROM. */
  allowedFrom: readonly string[];
  /** Raised when the account already is in the requested state. */
  alreadyMessage: string;
  /** Raised when the current status does not allow this transition. */
  invalidMessage: (currentStatus: string) => string;
  auditAction: string;
  reason: string;
  actorId: string;
  ip?: string;
  userAgent?: string;
}

/** Maps an admin profile write to a Prisma update payload ('' clears names). */
function buildProfileUpdate(dto: AdminUpdateUserProfileDto): Prisma.UserUpdateInput {
  const data: Prisma.UserUpdateInput = {};
  // Emails are stored lower-cased everywhere else (see AuthService.register).
  if (dto.email !== undefined) data.email = dto.email.trim().toLowerCase();
  if (dto.phone !== undefined) data.phone = dto.phone.trim();
  if (dto.username !== undefined) data.username = dto.username.trim();
  if (dto.firstName !== undefined) data.firstName = dto.firstName.trim() || null;
  if (dto.lastName !== undefined) data.lastName = dto.lastName.trim() || null;
  return data;
}

/**
 * Turns a unique-constraint violation on an identity column into the same 409
 * the rest of the admin panel reports (never a raw 500).
 */
function mapUniqueWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new ConflictException('A user with this email, username or phone already exists.');
  }
  throw error;
}

/** Event statuses an admin may set (mirrors the EventStatus enum). */
export type AdminEventStatus = 'SCHEDULED' | 'LIVE' | 'SUSPENDED' | 'FINISHED' | 'CANCELLED';

const eventInclude = {
  competition: { include: { sport: { select: { id: true, name: true, slug: true } } } },
  partnerProvider: { select: { id: true, name: true, status: true } },
} satisfies Prisma.EventInclude;

/**
 * Admin panel read model (Phases 2/4/5/9/10/11).
 *
 * Every statistic and row is computed from the authoritative database —
 * there is NO demo/placeholder data anywhere in this module. Where a metric
 * has no rows, the endpoint reports real zeros; it never fabricates numbers.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partnerProviders: PartnerProvidersService,
  ) {}

  // --------------------------------------------------------------------------
  // Access check (cheap authoritative role probe used by the frontend guard)
  // --------------------------------------------------------------------------

  checkAccess(auth: { roles: string[]; permissions?: string[]; isMasterAdmin?: boolean }): {
    ok: true;
    roles: string[];
    permissions: string[];
    isMasterAdmin: boolean;
  } {
    return {
      ok: true,
      roles: auth.roles,
      permissions: auth.permissions ?? [],
      isMasterAdmin: auth.isMasterAdmin === true,
    };
  }

  // --------------------------------------------------------------------------
  // Dashboard summary — real aggregates only
  // --------------------------------------------------------------------------

  async getSummary(): Promise<AdminSummary> {
    // Account-domain separation: every customer statistic on this dashboard
    // (user counts, betting totals, wallet totals) is filtered to CUSTOMER
    // accounts at the query level — staff rows never inflate customer numbers.
    const CUSTOMER_ONLY = { accountType: 'CUSTOMER' } as const;
    const customerBetsOnly = { user: CUSTOMER_ONLY } as const;
    const [userGroups, eventStatusGroups, eventScheduled, betGroups, sportCounts, competitionCounts, walletGroups, dbUp] =
      await Promise.all([
        this.prisma.user.groupBy({
          by: ['status'],
          where: CUSTOMER_ONLY,
          _count: { _all: true },
        }),
        this.prisma.event.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.event.count({ where: { status: 'SCHEDULED', startTime: { gt: new Date() } } }),
        this.prisma.bet.groupBy({
          by: ['status'],
          where: customerBetsOnly,
          _count: { _all: true },
        }),
        this.prisma.sport.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.competition.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.wallet.groupBy({
          by: ['currency'],
          where: { user: CUSTOMER_ONLY },
          _count: { _all: true },
          _sum: { availableBalance: true, lockedBalance: true },
        }),
        this.prisma.isHealthy(),
      ]);

    const byStatus = (rows: Array<{ status: string; _count: { _all: number } }>): Map<string, number> => {
      const map = new Map<string, number>();
      for (const row of rows) map.set(row.status, row._count._all);
      return map;
    };

    const userMap = byStatus(userGroups);
    const eventMap = byStatus(eventStatusGroups);
    const betMap = byStatus(betGroups);
    const sportMap = byStatus(sportCounts);
    const competitionMap = byStatus(competitionCounts);

    const wallets = {
      wallets: walletGroups.reduce((acc, row) => acc + row._count._all, 0),
      byCurrency: walletGroups.map((row) => ({
        currency: row.currency,
        availableMinor: row._sum.availableBalance ?? 0,
        lockedMinor: row._sum.lockedBalance ?? 0,
        wallets: row._count._all,
      })),
    };

    const providers = await this.partnerProviders.list();

    return {
      users: {
        total: sumCounts(userMap),
        active: userMap.get('ACTIVE') ?? 0,
        pending: userMap.get('PENDING') ?? 0,
        suspended: userMap.get('SUSPENDED') ?? 0,
        banned: userMap.get('BANNED') ?? 0,
        locked: userMap.get('LOCKED') ?? 0,
        closed: userMap.get('CLOSED') ?? 0,
      },
      events: {
        total: eventStatusGroups.reduce((acc, r) => acc + r._count._all, 0),
        live: eventMap.get('LIVE') ?? 0,
        scheduled: eventScheduled,
        finished: eventMap.get('FINISHED') ?? 0,
        cancelled: eventMap.get('CANCELLED') ?? 0,
        suspended: eventMap.get('SUSPENDED') ?? 0,
      },
      bets: {
        total: sumCounts(betMap),
        pending: betMap.get('PENDING') ?? 0,
        accepted: betMap.get('ACCEPTED') ?? 0,
        settled: betMap.get('SETTLED') ?? 0,
        void: betMap.get('VOID') ?? 0,
      },
      sports: catalogCounts(sportMap),
      competitions: catalogCounts(competitionMap),
      wallets,
      providers,
      system: {
        bettingProvider: configuredBettingProviderName(),
        database: dbUp ? 'up' : 'down',
        generatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Read-only platform configuration view for /admin/settings. This is kept
   * separate from the dashboard aggregates so SETTINGS_READ does not grant
   * access to user, wallet, bet, or transaction metrics.
   */
  async getSettingsView(): Promise<AdminSettingsView> {
    const [databaseUp, providers] = await Promise.all([
      this.prisma.isHealthy(),
      this.partnerProviders.list(),
    ]);
    return {
      providers,
      system: {
        bettingProvider: configuredBettingProviderName(),
        database: databaseUp ? 'up' : 'down',
        generatedAt: new Date().toISOString(),
      },
    };
  }

  // --------------------------------------------------------------------------
  // Users
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Users — CUSTOMER accounts only (account-domain separation)
  //
  // GET /admin/users is the CUSTOMER directory. STAFF accounts (admins and
  // the master admins) are filtered OUT AT THE QUERY LEVEL here — not in the
  // frontend — so no caller of this API can ever enumerate staff rows through
  // the customer surface. Staff live exclusively behind listStaffAccounts
  // (GET /admin/admins).
  // --------------------------------------------------------------------------

  async listUsers(query: ListAdminUsersQueryDto): Promise<AdminUserPage> {
    return this.listAccountsByType(query, 'CUSTOMER');
  }

  /**
   * STAFF accounts only — the Admin -> Admins directory (master admins +
   * ordinary staff). Never returns customer rows; enforced in the WHERE clause
   * so the population split survives any query the client sends.
   */
  async listStaffAccounts(query: ListAdminUsersQueryDto): Promise<AdminUserPage> {
    return this.listAccountsByType(query, 'STAFF');
  }

  /** Shared directory query; `accountType` is always ANDed into the filter. */
  private async listAccountsByType(
    query: ListAdminUsersQueryDto,
    accountType: 'CUSTOMER' | 'STAFF',
  ): Promise<AdminUserPage> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.UserWhereInput = { accountType };
    if (query.status) where.status = query.status;
    const q = query.q?.trim();
    if (q) {
      where.OR = [
        { email: { contains: q, mode: 'insensitive' } },
        { username: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        include: {
          userRoles: {
            include: {
              role: {
                select: {
                  name: true,
                  permissions: { select: { permission: { select: { name: true } } } },
                },
              },
            },
          },
          directPermissions: {
            select: {
              effect: true,
              permission: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items: rows.map(
        (row): AdminUserListItem => ({
          id: row.id,
          email: row.email ?? '',
          username: row.username,
          phone: row.phone,
          firstName: row.firstName,
          lastName: row.lastName,
          country: row.country,
          status: row.status,
          emailVerified: row.emailVerified,
          phoneVerified: row.phoneVerified,
          kycStatus: row.kycStatus,
          accountType: row.accountType,
          roles: row.userRoles.map((ur) => ur.role.name),
          effectivePermissions: calculateEffectivePermissions(
            row.userRoles.map((ur) => ({
              name: ur.role.name,
              permissions: ur.role.permissions,
            })),
            row.directPermissions ?? [],
          ),
          directPermissionNames: (row.directPermissions ?? [])
            .filter((entry) => entry.effect === 'GRANT')
            .map((entry) => entry.permission.name),
          deniedPermissionNames: (row.directPermissions ?? [])
            .filter((entry) => entry.effect === 'DENY')
            .map((entry) => entry.permission.name),
          lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
          createdAt: row.createdAt.toISOString(),
        }),
      ),
      total,
      page,
      limit,
    };
  }

  /**
   * Customer detail for GET /admin/users/:userId. STAFF ids are NotFound so
   * the customer directory cannot be used to probe staff rows — staff detail
   * is only reachable through the staff endpoints (which return AdminUserDetail
   * from their own mutations) and the staff list above.
   */
  async getCustomerUser(userId: string): Promise<AdminUserDetail> {
    const probe = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accountType: true },
    });
    if (!probe || probe.accountType !== 'CUSTOMER') {
      throw new NotFoundException('User not found');
    }
    return this.getUser(userId);
  }

  async getUser(userId: string): Promise<AdminUserDetail> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
          include: {
            role: {
              select: {
                name: true,
                permissions: { select: { permission: { select: { name: true } } } },
              },
            },
          },
        },
        directPermissions: {
          select: {
            effect: true,
            permission: { select: { name: true } },
          },
        },
        verifications: {
          select: { type: true, status: true, verifiedAt: true },
          orderBy: { type: 'asc' },
        },
        wallets: {
          select: { id: true, currency: true, availableBalance: true, lockedBalance: true, status: true },
        },
        _count: { select: { bets: true, sessions: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    // Sessions/security info: counts only. Full session listing remains a
    // self-service endpoint — the admin view stays least-privilege.
    const activeSessions = await this.prisma.session.count({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    });

    return {
      id: user.id,
      email: user.email ?? '',
      username: user.username,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      country: user.country,
      status: user.status,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
      phoneVerifiedAt: user.phoneVerifiedAt ? user.phoneVerifiedAt.toISOString() : null,
      kycStatus: user.kycStatus,
      accountType: user.accountType,
      roles: user.userRoles.map((ur) => ur.role.name),
      effectivePermissions: calculateEffectivePermissions(
        user.userRoles.map((ur) => ({
          name: ur.role.name,
          permissions: ur.role.permissions,
        })),
        user.directPermissions ?? [],
      ),
      directPermissionNames: (user.directPermissions ?? [])
        .filter((entry) => entry.effect === 'GRANT')
        .map((entry) => entry.permission.name),
      deniedPermissionNames: (user.directPermissions ?? [])
        .filter((entry) => entry.effect === 'DENY')
        .map((entry) => entry.permission.name),
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      createdAt: user.createdAt.toISOString(),
      // Verification STATUS only — never metadata, provider refs or biometrics.
      verifications: user.verifications.map((v) => ({
        type: v.type,
        status: v.status,
        verifiedAt: v.verifiedAt ? v.verifiedAt.toISOString() : null,
      })),
      wallets: user.wallets.map((w) => ({
        id: w.id,
        currency: w.currency,
        availableBalance: w.availableBalance,
        lockedBalance: w.lockedBalance,
        status: w.status,
      })),
      activeSessions,
      totalBets: user._count.bets,
    };
  }

  // --------------------------------------------------------------------------
  // User moderation (ADMIN + SUPER_ADMIN)
  //
  // Every operation below is reason-required, audited and destructive by
  // nature, so the same guardrails apply to all of them:
  //   * nobody can moderate their OWN account (self-lockout);
  //   * SUPER_ADMIN accounts are untouchable here — the only supported path is
  //     the promote-admin script;
  //   * suspend/ban/password-reset/delete revoke EVERY active session, so a
  //     previously authenticated device loses access immediately;
  //   * "delete" is a SOFT delete (CLOSED + anonymized + unusable password), so
  //     bets, wallets, withdrawals and audit history survive for compliance.
  // --------------------------------------------------------------------------

  /** Edits the identity fields of an account (email / phone / username / name). */
  async updateUserProfile(
    userId: string,
    dto: AdminUpdateUserProfileDto,
    actor: { id: string },
    ip?: string,
    userAgent?: string,
  ): Promise<AdminUserDetail> {
    // Own-profile edits are allowed (name/email corrections); every other
    // moderation action rejects the admin's own account.
    const target = await this.loadModerationTarget(userId, actor.id, { allowSelf: true });
    const data = buildProfileUpdate(dto);
    if (Object.keys(data).length === 0) {
      throw new BadRequestException(EMPTY_PROFILE_UPDATE_MESSAGE);
    }

    await this.prisma.user
      .update({ where: { id: userId }, data })
      .catch((error: unknown) => mapUniqueWriteError(error));

    await this.safeAudit(actor.id, 'USER_PROFILE_UPDATE', 'User', userId, ip, userAgent, {
      reason: dto.reason,
      before: {
        email: target.email,
        phone: target.phone,
        username: target.username,
        firstName: target.firstName,
        lastName: target.lastName,
      },
      after: data,
    });
    return this.getUser(userId);
  }

  /**
   * Admin-initiated password reset. The new password is either supplied by the
   * admin or generated by the backend (returned ONCE); only the argon2id hash
   * is stored and every active session of the target is revoked.
   */
  async resetUserPassword(
    userId: string,
    dto: AdminResetPasswordDto,
    actor: { id: string },
    ip?: string,
    userAgent?: string,
  ) {
    const target = await this.loadModerationTarget(userId, actor.id, {});
    return this.resetPasswordFor(target, dto, 'USER_PASSWORD_RESET', actor, ip, userAgent);
  }

  /** SUSPENDED — temporary/reviewable state, reversible via unsuspend. */
  async suspendUser(
    userId: string,
    dto: AdminModerationReasonDto,
    actor: { id: string },
    ip?: string,
    userAgent?: string,
  ): Promise<AdminUserDetail> {
    return this.setUserStatus(userId, {
      newStatus: 'SUSPENDED',
      allowedFrom: ['ACTIVE', 'PENDING', 'LOCKED'],
      alreadyMessage: 'User is already suspended.',
      invalidMessage: (current) =>
        `A ${current} account cannot be suspended — a closed account stays closed and a banned account must be unbanned first.`,
      auditAction: 'USER_SUSPENDED',
      reason: dto.reason,
      actorId: actor.id,
      ip,
      userAgent,
    });
  }

  /** ACTIVE — only from SUSPENDED. */
  async unsuspendUser(
    userId: string,
    dto: AdminModerationReasonDto,
    actor: { id: string },
    ip?: string,
    userAgent?: string,
  ): Promise<AdminUserDetail> {
    return this.setUserStatus(userId, {
      newStatus: 'ACTIVE',
      allowedFrom: ['SUSPENDED'],
      alreadyMessage: 'User is already active.',
      invalidMessage: (current) => `User is not currently suspended (current status: ${current}).`,
      auditAction: 'USER_UNSUSPENDED',
      reason: dto.reason,
      actorId: actor.id,
      ip,
      userAgent,
    });
  }

  /** BANNED — permanent/severe state (ToS violation, fraud). */
  async banUser(
    userId: string,
    dto: AdminModerationReasonDto,
    actor: { id: string },
    ip?: string,
    userAgent?: string,
  ): Promise<AdminUserDetail> {
    return this.setUserStatus(userId, {
      newStatus: 'BANNED',
      allowedFrom: ['ACTIVE', 'PENDING', 'SUSPENDED', 'LOCKED'],
      alreadyMessage: 'User is already banned.',
      invalidMessage: (current) =>
        `A ${current} account cannot be banned — a closed account stays closed.`,
      auditAction: 'USER_BANNED',
      reason: dto.reason,
      actorId: actor.id,
      ip,
      userAgent,
    });
  }

  /** ACTIVE — only from BANNED. */
  async unbanUser(
    userId: string,
    dto: AdminModerationReasonDto,
    actor: { id: string },
    ip?: string,
    userAgent?: string,
  ): Promise<AdminUserDetail> {
    return this.setUserStatus(userId, {
      newStatus: 'ACTIVE',
      allowedFrom: ['BANNED'],
      alreadyMessage: 'User is already active.',
      invalidMessage: (current) => `User is not currently banned (current status: ${current}).`,
      auditAction: 'USER_UNBANNED',
      reason: dto.reason,
      actorId: actor.id,
      ip,
      userAgent,
    });
  }

  /**
   * SOFT delete (SUPER_ADMIN only).
   *
   * The row is deliberately NOT removed: Bet, Wallet, WithdrawalRequest,
   * AuditLog and SupportTicket all reference it, and a sportsbook must keep its
   * financial/regulatory history. Instead the account is made permanently
   * unusable and de-identified:
   *   1. status → CLOSED,
   *   2. email/phone/username anonymized so the same identity can sign up again,
   *   3. name/date-of-birth cleared and the 2FA secret dropped,
   *   4. passwordHash overwritten with the hash of unguessable random bytes,
   *   5. every active session revoked.
   *
   * A true GDPR-style erase of the retained financial records must stay a
   * separate, legal-reviewed, out-of-band script — never a panel button.
   */
  async softDeleteUser(
    userId: string,
    dto: AdminModerationReasonDto,
    actor: { id: string },
    ip?: string,
    userAgent?: string,
  ): Promise<{ deleted: true; userId: string; sessionsRevoked: number; anonymizedAt: string }> {
    const target = await this.loadModerationTarget(userId, actor.id, {});
    await this.assertSuperAdminFloor(target);

    // Shared with the staff deactivation path (applySoftDelete) so the two
    // anonymization routines can never drift apart.
    const { sessionsRevoked } = await this.applySoftDelete(userId);

    // The audit entry KEEPS the previous identity on purpose: it is admin-only
    // and it is the only remaining link between the anonymized row and the
    // moderation decision (compliance/AML investigations need that link).
    await this.safeAudit(actor.id, 'USER_SOFT_DELETE', 'User', userId, ip, userAgent, {
      reason: dto.reason,
      previousStatus: target.status,
      previousUsername: target.username,
      previousEmail: target.email,
      previousPhone: target.phone,
      sessionsRevoked,
    });

    return {
      deleted: true,
      userId,
      sessionsRevoked,
      anonymizedAt: new Date().toISOString(),
    };
  }

  // --------------------------------------------------------------------------
  // Admin management (SUPER_ADMIN only)
  // --------------------------------------------------------------------------

  /**
   * Creates a new staff/admin account. SUPER_ADMIN is never grantable here —
   * the only supported path to SUPER_ADMIN is the promote-admin script
   * (database/scripts/promote-admin.ts) run directly against the database.
   */
  async createAdminUser(
    dto: CreateAdminUserDto,
    actor?: { id: string },
    ip?: string,
    userAgent?: string,
  ) {
    if (dto.roleNames.includes('SUPER_ADMIN')) {
      throw new ForbiddenException(
        'SUPER_ADMIN cannot be granted through this endpoint — use the promote-admin script.',
      );
    }
    // USER is the CUSTOMER role: a staff account must never also be a customer
    // (STAFF + ADMIN, never USER + ADMIN). Reject it here so the whole
    // USER + <staff role> hybrid architecture can never be recreated through
    // the Admin -> Admins creation form or any direct API call.
    if (dto.roleNames.includes('USER')) {
      throw new BadRequestException(
        'USER is the customer account role and cannot be assigned to staff accounts.',
      );
    }
    // Same hashing scheme as the signup flow — see AuthService.signup in
    // ../auth/auth.service.ts (argon2id). No new scheme is invented here.
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const user = await this.prisma.user
      .create({
        data: {
          email: dto.email,
          username: dto.username,
          passwordHash,
          passwordSetAt: new Date(),
          firstName: dto.firstName,
          lastName: dto.lastName,
          status: 'ACTIVE',
          // Account-domain classification: everything created from the
          // Admin -> Admins surface is STAFF — never a customer account.
          accountType: 'STAFF',
        },
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('A user with this email or username already exists.');
        }
        throw error;
      });
    await this.assignRolesToUser(user.id, dto.roleNames);
    const grants = dto.directPermissionNames ?? [];
    const denies = dto.deniedPermissionNames ?? [];
    if (grants.some((permission) => denies.includes(permission))) {
      throw new BadRequestException('A permission cannot be both granted and denied.');
    }
    if (grants.length || denies.length) {
      const permissions = await this.resolvePermissions([...grants, ...denies]);
      const byName = new Map(permissions.map((permission) => [permission.name, permission.id]));
      await this.prisma.userPermission.createMany({
        data: [
          ...grants.map((name) => ({ userId: user.id, permissionId: byName.get(name)!, effect: 'GRANT' as const })),
          ...denies.map((name) => ({ userId: user.id, permissionId: byName.get(name)!, effect: 'DENY' as const })),
        ],
        skipDuplicates: true,
      });
    }
    if (actor) {
      await this.safeAudit(actor.id, 'ADMIN_CREATED', 'User', user.id, ip, userAgent, {
        username: user.username,
        roleNames: dto.roleNames,
        granted: grants,
        denied: denies,
      });
    }
    return this.getUser(user.id); // reuse the existing read shape for the response
  }

  /**
   * Replaces a user's roles with the given set (full replacement). Any existing
   * SUPER_ADMIN assignment is always preserved — only non-SUPER_ADMIN roles
   * are ever managed through this endpoint.
   */
  async assignRolesToUser(
    userId: string,
    roleNames: string[],
    actor?: { id: string },
    ip?: string,
    userAgent?: string,
  ) {
    if (roleNames.includes('SUPER_ADMIN')) {
      throw new ForbiddenException(
        'SUPER_ADMIN cannot be assigned through this endpoint — use the promote-admin script.',
      );
    }
    // USER is the customer role: staff roles and the customer role are mutually
    // exclusive domains (STAFF + ADMIN, never USER + ADMIN).
    if (roleNames.includes('USER')) {
      throw new BadRequestException(
        'USER is the customer account role and cannot be assigned to staff accounts.',
      );
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, accountType: true },
    });
    if (!user) throw new NotFoundException('User not found');
    // Role management is STAFF-domain management: assigning staff roles onto a
    // customer account (a CUSTOMER + ADMIN hybrid) must go through staff
    // creation or the promote-admin script instead — never silently here.
    if (user.accountType !== 'STAFF') {
      throw new BadRequestException(
        'Staff roles can only be assigned to staff accounts — create the account under Admin -> Admins.',
      );
    }

    const requested = [...new Set(roleNames)];
    const roles = await this.prisma.role.findMany({ where: { name: { in: requested } } });
    if (roles.length !== requested.length) {
      throw new BadRequestException('One or more role names do not exist.');
    }

    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId, role: { name: { not: 'SUPER_ADMIN' } } } }),
      this.prisma.userRole.createMany({
        data: roles.map((r) => ({ userId, roleId: r.id })),
        skipDuplicates: true,
      }),
    ]);
    if (actor) {
      await this.safeAudit(actor.id, 'ROLES_ASSIGNED', 'User', userId, ip, userAgent, {
        roleNames: requested,
      });
    }
    return this.getUser(userId);
  }

  /** All roles with their effective permissions (SUPER_ADMIN only). */
  async listRoles() {
    return this.prisma.role.findMany({
      include: { permissions: { include: { permission: true } } },
      orderBy: { name: 'asc' },
    });
  }

  /** All available permission names (SUPER_ADMIN only). */
  async listPermissions() {
    return this.prisma.permission.findMany({ orderBy: { name: 'asc' } });
  }

  /**
   * Replaces a role's permission set (full replacement). SUPER_ADMIN's
   * fixed full permission set is never editable here.
   */
  async updateRolePermissions(
    roleId: string,
    permissionNames: string[],
    actor?: { id: string },
    ip?: string,
    userAgent?: string,
  ) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found.');
    if (role.name === 'SUPER_ADMIN') {
      throw new ForbiddenException('SUPER_ADMIN permissions are fixed and cannot be edited.');
    }

    const requested = [...new Set(permissionNames)];
    const permissions = await this.prisma.permission.findMany({ where: { name: { in: requested } } });
    if (permissions.length !== requested.length) {
      throw new BadRequestException('One or more permission names do not exist.');
    }

    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId } }),
      this.prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId, permissionId: p.id })),
        skipDuplicates: true,
      }),
    ]);
    await this.auditRoleChange(
      actor,
      'ROLE_PERMISSIONS_UPDATED',
      roleId,
      { permissionNames: requested },
      ip,
      userAgent,
    );
    return this.listRoles();
  }

  /** Creates a dynamic staff role and its initial permission set. */
  async createRole(
    dto: CreateRoleDto,
    actor?: { id: string },
    ip?: string,
    userAgent?: string,
  ) {
    const name = dto.name.trim();
    if (name === 'SUPER_ADMIN' || name === 'USER') {
      throw new ForbiddenException('This role name is reserved and cannot be created here.');
    }
    const duplicate = await this.prisma.role.findUnique({ where: { name } });
    if (duplicate) throw new ConflictException('A role with this name already exists.');
    const permissions = await this.resolvePermissions(dto.permissionNames);
    const role = await this.prisma.role.create({
      data: { name, description: dto.description?.trim() || null },
    });
    await this.prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
      skipDuplicates: true,
    });
    await this.auditRoleChange(
      actor,
      'ROLE_CREATED',
      role.id,
      { name, permissionNames: permissions.map((permission) => permission.name) },
      ip,
      userAgent,
    );
    const roles = await this.listRoles();
    return roles.find((item) => item.id === role.id);
  }

  /** Updates a dynamic role. SUPER_ADMIN remains immutable. */
  async updateRole(
    roleId: string,
    dto: UpdateRoleDto,
    actor?: { id: string },
    ip?: string,
    userAgent?: string,
  ) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found.');
    if (role.name === 'SUPER_ADMIN') {
      throw new ForbiddenException('SUPER_ADMIN is fixed and cannot be edited.');
    }
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (name === 'SUPER_ADMIN' || name === 'USER') {
        throw new ForbiddenException('This role name is reserved.');
      }
      const duplicate = await this.prisma.role.findUnique({ where: { name } });
      if (duplicate && duplicate.id !== roleId) {
        throw new ConflictException('A role with this name already exists.');
      }
    }
    const permissions =
      dto.permissionNames === undefined ? undefined : await this.resolvePermissions(dto.permissionNames);
    await this.prisma.$transaction(async (tx) => {
      await tx.role.update({
        where: { id: roleId },
        data: {
          ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
          ...(dto.description === undefined ? {} : { description: dto.description.trim() || null }),
        },
      });
      if (permissions) {
        await tx.rolePermission.deleteMany({ where: { roleId } });
        await tx.rolePermission.createMany({
          data: permissions.map((permission) => ({ roleId, permissionId: permission.id })),
          skipDuplicates: true,
        });
      }
    });
    await this.auditRoleChange(
      actor,
      'ROLE_UPDATED',
      roleId,
      { before: { name: role.name, description: role.description }, after: dto },
      ip,
      userAgent,
    );
    const roles = await this.listRoles();
    return roles.find((item) => item.id === roleId);
  }


  /** Deletes an unassigned dynamic role; role history is never silently orphaned. */
  async deleteRole(
    roleId: string,
    actor?: { id: string },
    ip?: string,
    userAgent?: string,
  ) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found.');
    if (role.name === 'SUPER_ADMIN' || role.name === 'USER') {
      throw new ForbiddenException('This protected role cannot be deleted.');
    }
    const assigned = await this.prisma.userRole.count({ where: { roleId } });
    if (assigned > 0) {
      throw new BadRequestException('Remove this role from all staff accounts before deleting it.');
    }
    await this.prisma.role.delete({ where: { id: roleId } });
    await this.auditRoleChange(actor, 'ROLE_DELETED', roleId, { name: role.name }, ip, userAgent);
    return { deleted: true, roleId };
  }

  /** Replaces direct grants/denies for one ordinary staff account. */
  async setUserPermissions(
    userId: string,
    dto: UpdateUserPermissionsDto,
    actor: { id: string },
    ip?: string,
    userAgent?: string,
  ) {
    await this.loadAdminTarget(userId, actor.id, {});
    const grants = [...new Set(dto.grantPermissionNames)];
    const denies = [...new Set(dto.denyPermissionNames)];
    const overlap = grants.filter((permission) => denies.includes(permission));
    if (overlap.length > 0) {
      throw new BadRequestException(`A permission cannot be both granted and denied: ${overlap.join(', ')}`);
    }
    const permissions = await this.resolvePermissions([...grants, ...denies]);
    const byName = new Map(permissions.map((permission) => [permission.name, permission.id]));
    await this.prisma.$transaction([
      this.prisma.userPermission.deleteMany({ where: { userId } }),
      this.prisma.userPermission.createMany({
        data: [
          ...grants.map((name) => ({ userId, permissionId: byName.get(name)!, effect: 'GRANT' as const })),
          ...denies.map((name) => ({ userId, permissionId: byName.get(name)!, effect: 'DENY' as const })),
        ],
        skipDuplicates: true,
      }),
    ]);
    await this.safeAudit(actor.id, 'ADMIN_PERMISSIONS_SET', 'User', userId, ip, userAgent, {
      granted: grants,
      denied: denies,
    });
    return this.getUser(userId);
  }

  private async resolvePermissions(names: string[]) {
    const requested = [...new Set(names)];
    const permissions = await this.prisma.permission.findMany({ where: { name: { in: requested } } });
    if (permissions.length !== requested.length) {
      throw new BadRequestException('One or more permission names do not exist.');
    }
    return permissions;
  }

  private async auditRoleChange(
    actor: { id: string } | undefined,
    action: string,
    roleId: string,
    metadata: Record<string, unknown>,
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
    if (!actor) return;
    await this.safeAudit(actor.id, action, 'Role', roleId, ip, userAgent, metadata);
  }


  /**
   * Edits a staff account's identity fields (SUPER_ADMIN only).
   * SUPER_ADMIN accounts are untouchable — see loadAdminTarget.
   */
  async updateAdminProfile(
    userId: string,
    dto: AdminUpdateUserProfileDto,
    actor: { id: string },
    ip?: string,
    userAgent?: string,
  ): Promise<AdminUserDetail> {
    const target = await this.loadAdminTarget(userId, actor.id, { allowSelf: true });
    const data = buildProfileUpdate(dto);
    if (Object.keys(data).length === 0) {
      throw new BadRequestException(EMPTY_PROFILE_UPDATE_MESSAGE);
    }

    await this.prisma.user
      .update({ where: { id: userId }, data })
      .catch((error: unknown) => mapUniqueWriteError(error));

    await this.safeAudit(actor.id, 'ADMIN_PROFILE_UPDATE', 'User', userId, ip, userAgent, {
      reason: dto.reason,
      before: {
        email: target.email,
        username: target.username,
        firstName: target.firstName,
        lastName: target.lastName,
      },
      after: data,
    });
    return this.getUser(userId);
  }

  /**
   * Password reset for a staff account (SUPER_ADMIN only). Identical machinery
   * to the user variant — reason required, every session revoked, hash-only
   * storage — with its own audit action so the two histories stay separable.
   */
  async resetAdminPassword(
    userId: string,
    dto: AdminResetPasswordDto,
    actor: { id: string },
    ip?: string,
    userAgent?: string,
  ) {
    const target = await this.loadAdminTarget(userId, actor.id, {});
    return this.resetPasswordFor(target, dto, 'ADMIN_PASSWORD_RESET', actor, ip, userAgent);
  }

  /**
   * Deactivates a staff account (SUPER_ADMIN only): every role — ADMIN
   * included — is stripped and the same soft-delete routine used for users is
   * applied, so the account can neither open an /admin route (RolesGuard no
   * longer matches) nor sign in as a normal customer.
   *
   * Master-admin addresses are refused before anything else (Feature: two fixed
   * master admins) — see assertNotMasterAdminTarget.
   */
  async deactivateAdmin(
    userId: string,
    dto: AdminModerationReasonDto,
    actor: { id: string },
    ip?: string,
    userAgent?: string,
  ): Promise<{
    deactivated: true;
    userId: string;
    rolesRemoved: string[];
    sessionsRevoked: number;
  }> {
    await this.assertNotMasterAdminTarget(userId);
    const target = await this.loadAdminTarget(userId, actor.id, {});
    await this.assertSuperAdminFloor(target);

    const { sessionsRevoked } = await this.applySoftDelete(userId, { stripRoles: true });

    await this.safeAudit(actor.id, 'ADMIN_DEACTIVATE', 'User', userId, ip, userAgent, {
      reason: dto.reason,
      previousStatus: target.status,
      previousUsername: target.username,
      previousEmail: target.email,
      rolesRemoved: target.roles,
      sessionsRevoked,
    });

    return { deactivated: true, userId, rolesRemoved: target.roles, sessionsRevoked };
  }

  // --------------------------------------------------------------------------
  // Betting
  // --------------------------------------------------------------------------

  async listBets(query: ListAdminBetsQueryDto): Promise<AdminBetPage> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    // Customer betting population only — staff-owned bet rows (e.g. history of
    // accounts later reclassified as STAFF) never appear on this surface.
    const where: Prisma.BetWhereInput = { user: { accountType: 'CUSTOMER' } };
    if (query.status) where.status = query.status;
    if (query.userId) where.userId = query.userId;
    if (query.eventId) {
      // BetSelection does not denormalize eventId — resolve through the
      // selection → market → event chain so filtering by event is exact.
      where.selections = { some: { selection: { market: { eventId: query.eventId } } } };
    }
    const q = query.q?.trim();
    if (q) {
      where.OR = [
        { id: { equals: q } },
        { user: { is: { username: { contains: q, mode: 'insensitive' } } } },
        { selections: { some: { eventName: { contains: q, mode: 'insensitive' } } } },
      ];
    }

    const [total, rows] = await Promise.all([
      this.prisma.bet.count({ where }),
      this.prisma.bet.findMany({
        where,
        include: {
          user: { select: { username: true } },
          selections: { orderBy: { id: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { items: rows.map(toBetListItem), total, page, limit };
  }

  async listEvents(query: ListAdminEventsQueryDto): Promise<AdminEventPage> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.EventWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.competitionId) where.competitionId = query.competitionId;
    if (query.sport) where.competition = { sport: { slug: query.sport } };
    const q = query.q?.trim();
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { homeName: { contains: q, mode: 'insensitive' } },
        { awayName: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await Promise.all([
      this.prisma.event.count({ where }),
      this.prisma.event.findMany({
        where,
        include: eventInclude,
        orderBy: { startTime: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { items: rows.map(toEventItem), total, page, limit };
  }

  /**
   * Admin event status management (Phase 5). Only the status enum is writable;
   * the change is audited with a mandatory reason. Bets and settlements are
   * NEVER touched here — settlement stays in the dedicated settlement service.
   */
  async updateEventStatus(
    eventId: string,
    status: AdminEventStatus,
    reason: string,
    actor: { id: string },
    ip?: string,
    userAgent?: string,
  ): Promise<AdminEventListItem> {
    const existing = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!existing) throw new NotFoundException('Event not found');

    const updated = await this.prisma.event.update({
      where: { id: eventId },
      data: { status, live: status === 'LIVE' },
      include: eventInclude,
    });

    await this.safeAudit(actor.id, 'ADMIN_EVENT_STATUS_CHANGED', 'Event', eventId, ip, userAgent, {
      from: existing.status,
      to: status,
      reason,
    });
    return toEventItem(updated);
  }

  // --------------------------------------------------------------------------
  // Wallet admin view (read-only; adjustments remain in the wallet module)
  // --------------------------------------------------------------------------

  async getUserWalletDetail(
    userId: string,
    query: ListAdminWalletTransactionsQueryDto,
  ): Promise<AdminWalletDetail> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, email: true, status: true, accountType: true },
    });
    // Customer wallet domain only: staff rows are not found here, so the
    // admin wallet surface can never be used to inspect staff accounts.
    if (!user || user.accountType !== 'CUSTOMER') throw new NotFoundException('User not found');

    const wallets = await this.prisma.wallet.findMany({
      where: { userId },
      orderBy: { currency: 'asc' },
    });

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const txWhere: Prisma.WalletTransactionWhereInput = { userId };
    if (query.type) txWhere.type = query.type;
    if (query.status) txWhere.status = query.status;
    // Currency is part of ListAdminWalletTransactionsQueryDto; apply it so the
    // admin wallet screen's currency filter matches the declared contract.
    if (query.currency) txWhere.currency = query.currency;

    const [total, txRows] = await Promise.all([
      this.prisma.walletTransaction.count({ where: txWhere }),
      this.prisma.walletTransaction.findMany({
        where: txWhere,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      user: { id: user.id, username: user.username, email: user.email ?? '', status: user.status },
      wallets: wallets.map(toWalletSummary),
      transactions: {
        items: txRows.map(toWalletTransactionItem),
        total,
        page,
        limit,
      },
    };
  }

  // --------------------------------------------------------------------------
  // Audit log (read-only — the log itself stays append-only)
  // --------------------------------------------------------------------------

  async listAuditLogs(query: ListAdminAuditLogsQueryDto): Promise<AdminAuditLogPage> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.AuditLogWhereInput = {};
    if (query.action) where.action = { contains: query.action, mode: 'insensitive' };
    if (query.actorId) where.actorId = query.actorId;
    if (query.entityType) where.entityType = query.entityType;

    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const items: AdminAuditLogItem[] = rows.map((row) => ({
      id: row.id,
      actorId: row.actorId,
      actorType: row.actorType,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      ip: row.ip,
      createdAt: row.createdAt.toISOString(),
    }));
    return { items, total, page, limit };
  }

  // --------------------------------------------------------------------------
  // Catalog (admin sees ALL statuses — the public API only serves ACTIVE)
  // --------------------------------------------------------------------------

  async listCatalogSports(): Promise<AdminSportItem[]> {
    const sports = await this.prisma.sport.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { competitions: true, games: true } } },
    });
    return sports.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      description: s.description,
      status: s.status,
      sortOrder: s.sortOrder,
      competitionsCount: s._count.competitions,
      gamesCount: s._count.games,
    }));
  }

  async getCatalogSport(sportId: string): Promise<AdminSportDetail> {
    const sport = await this.prisma.sport.findUnique({
      where: { id: sportId },
      include: {
        _count: { select: { competitions: true, games: true } },
        competitions: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: { _count: { select: { events: true } } },
        },
        games: {
          orderBy: { sortOrder: 'asc' },
          include: {
            availability: { select: { gamblingEnabled: true } },
            providerMapping: { select: { providerName: true, status: true } },
          },
        },
      },
    });
    if (!sport) throw new NotFoundException('Sport not found');

    return {
      id: sport.id,
      name: sport.name,
      slug: sport.slug,
      description: sport.description,
      status: sport.status,
      sortOrder: sport.sortOrder,
      competitionsCount: sport._count.competitions,
      gamesCount: sport._count.games,
      competitions: sport.competitions.map((c) => ({
        id: c.id,
        sportId: c.sportId,
        sport: { id: sport.id, name: sport.name, slug: sport.slug },
        name: c.name,
        slug: c.slug,
        country: c.country,
        status: c.status,
        eventsCount: c._count.events,
      })),
      games: sport.games.map((g) => ({
        id: g.id,
        name: g.name,
        slug: g.slug,
        status: g.status,
        gamblingEnabled: g.availability?.gamblingEnabled ?? false,
        providerMapping: g.providerMapping
          ? { providerName: g.providerMapping.providerName, status: g.providerMapping.status }
          : null,
      })),
    };
  }

  async listCompetitions(): Promise<AdminCompetitionItem[]> {
    const competitions = await this.prisma.competition.findMany({
      orderBy: [{ sportId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        sport: { select: { id: true, name: true, slug: true } },
        _count: { select: { events: true } },
      },
    });
    return competitions.map((c) => ({
      id: c.id,
      sportId: c.sportId,
      sport: c.sport,
      name: c.name,
      slug: c.slug,
      country: c.country,
      status: c.status,
      eventsCount: c._count.events,
    }));
  }

  // --------------------------------------------------------------------------
  // Moderation internals (shared by the moderation + staff endpoints)
  // --------------------------------------------------------------------------

  /**
   * Single implementation behind suspend / ban / unsuspend / unban.
   *
   * It enforces the transition table (so an invalid transition is a clear 400,
   * never a silent state change), revokes every active session of the target,
   * and writes the audit entry with the mandatory reason.
   */
  private async setUserStatus(
    userId: string,
    options: SetUserStatusOptions,
  ): Promise<AdminUserDetail> {
    const target = await this.loadModerationTarget(userId, options.actorId, {});

    if (target.status === options.newStatus) {
      throw new BadRequestException(options.alreadyMessage);
    }
    if (!options.allowedFrom.includes(target.status)) {
      throw new BadRequestException(options.invalidMessage(target.status));
    }

    // Status change + session revocation commit together: a banned account
    // must never keep a live session because of a partially applied write.
    const { sessionsRevoked } = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status: options.newStatus } });
      const revoked = await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { sessionsRevoked: revoked.count };
    });

    await this.safeAudit(
      options.actorId,
      options.auditAction,
      'User',
      userId,
      options.ip,
      options.userAgent,
      {
        from: target.status,
        to: options.newStatus,
        reason: options.reason,
        username: target.username,
        sessionsRevoked,
      },
    );
    return this.getUser(userId);
  }

  /**
   * Shared implementation behind every admin-initiated password reset (the user
   * and staff variants differ only in their audit action).
   *
   * Only the argon2id hash is persisted. When the backend generates the value
   * instead of the admin supplying it, the plaintext is returned ONCE in the
   * response and never stored, logged or emailed.
   */
  private async resetPasswordFor(
    target: ModerationTarget,
    dto: AdminResetPasswordDto,
    auditAction: string,
    actor: { id: string },
    ip?: string,
    userAgent?: string,
  ): Promise<{
    userId: string;
    username: string;
    generatedPassword: string | null;
    sessionsRevoked: number;
  }> {
    const supplied = dto.newPassword?.trim();
    const password = supplied ? supplied : generateTemporaryPassword();
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    const { sessionsRevoked } = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: { passwordHash, passwordSetAt: new Date() },
      });
      const revoked = await tx.session.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { sessionsRevoked: revoked.count };
    });

    await this.safeAudit(actor.id, auditAction, 'User', target.id, ip, userAgent, {
      reason: dto.reason,
      username: target.username,
      passwordGeneratedByBackend: !supplied,
      sessionsRevoked,
    });

    return {
      userId: target.id,
      username: target.username,
      /** Present ONLY when generated — shown once in the UI, then discarded. */
      generatedPassword: supplied ? null : password,
      sessionsRevoked,
    };
  }

  /**
   * Loads the target of a moderation action and enforces the rules that hold
   * for EVERY such action:
   *   1. an admin can never moderate their own account (self-lockout);
   *   2. SUPER_ADMIN accounts are untouchable from the admin panel;
   *   3. ACCOUNT-DOMAIN SEPARATION: the customer-moderation paths (profile,
   *      password reset, suspend/ban, soft delete) refuse STAFF targets —
   *      staff are only manageable through the staff endpoints, so a staff id
   *      can never be suspended/banished through the customer surface.
   *
   * `allowSelf` relaxes (1) for pure profile corrections, where preventing an
   * admin from fixing their own name/email would be counter-productive.
   * `expectStaff` inverts (3): the staff endpoints use this same loader and
   * require the target to BE a staff account instead.
   */
  private async loadModerationTarget(
    userId: string,
    actorId: string,
    options: { allowSelf?: boolean; expectStaff?: boolean },
  ): Promise<ModerationTarget> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: moderationTargetSelect,
    });
    if (!user) throw new NotFoundException('User not found');

    if (!options.allowSelf && user.id === actorId) {
      throw new ForbiddenException('You cannot perform this action on your own account.');
    }

    const roles = user.userRoles.map((ur) => ur.role.name);
    if (roles.includes('SUPER_ADMIN')) {
      throw new ForbiddenException(SUPER_ADMIN_PROTECTED_MESSAGE);
    }

    // Account-domain check, AFTER the SUPER_ADMIN guard so a master admin is
    // always rejected with the precise SUPER_ADMIN/master-admin reason.
    if (options.expectStaff && user.accountType !== 'STAFF') {
      throw new BadRequestException('This account is not a staff account.');
    }
    if (!options.expectStaff && user.accountType === 'STAFF') {
      throw new BadRequestException(
        'This is a staff account — manage it under Admin -> Admins.',
      );
    }

    return { ...user, roles };
  }

  /**
   * Same rules as loadModerationTarget plus the staff-only precondition of the
   * Part-C endpoints: the target must BE a staff account (AccountType STAFF).
   * The accountType classification — not a role name — is what makes a row an
   * Admins-directory row, so SUPPORT/FINANCE/ANALYST staff are manageable here
   * too, while customer accounts are rejected before any write.
   */
  private async loadAdminTarget(
    userId: string,
    actorId: string,
    options: { allowSelf?: boolean },
  ): Promise<ModerationTarget> {
    return this.loadModerationTarget(userId, actorId, { ...options, expectStaff: true });
  }

  /**
   * Shared soft-delete routine used by the user soft-delete AND the staff
   * deactivation, so the two anonymization paths can never drift apart.
   *
   * The row is never removed (financial/audit history depends on it): the
   * account is CLOSED, its identity anonymized, its password replaced by the
   * hash of unguessable random bytes, and every active session revoked — all in
   * one transaction.
   */
  private async applySoftDelete(
    userId: string,
    options: { stripRoles?: boolean } = {},
  ): Promise<{ sessionsRevoked: number }> {
    const stamp = randomBytes(8).toString('hex');
    const unusablePasswordHash = await argon2.hash(randomBytes(32).toString('hex'), {
      type: argon2.argon2id,
    });

    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          status: 'CLOSED',
          email: `deleted-${stamp}@deleted.tanvionroyale.local`,
          phone: null,
          username: `deleted-${stamp}`,
          firstName: null,
          lastName: null,
          dateOfBirth: null,
          emailVerified: false,
          phoneVerified: false,
          isTwoFactorEnabled: false,
          twoFactorSecretEnc: null,
          passwordHash: unusablePasswordHash,
          passwordSetAt: new Date(),
        },
      });
      // Staff deactivation additionally strips every role, so RolesGuard can
      // never match an /admin route for the deactivated account again.
      if (options.stripRoles) {
        await tx.userRole.deleteMany({ where: { userId } });
      }
      const revoked = await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { sessionsRevoked: revoked.count };
    });
  }

  /**
   * Defensive invariant: the platform must always keep at least one usable
   * SUPER_ADMIN.
   *
   * SUPER_ADMIN accounts are already unreachable through these endpoints, so
   * this only fires if that rule is ever relaxed — and it stays correct in that
   * case instead of locking the last operator out of the panel.
   */
  private async assertSuperAdminFloor(target: ModerationTarget): Promise<void> {
    if (!target.roles.includes('SUPER_ADMIN')) return;

    const remaining = await this.prisma.user.count({
      where: {
        id: { not: target.id },
        status: 'ACTIVE',
        userRoles: { some: { role: { name: 'SUPER_ADMIN' } } },
      },
    });
    if (remaining === 0) {
      throw new ConflictException(
        'The last active SUPER_ADMIN account cannot be removed or deactivated.',
      );
    }
  }

  /**
   * Master-admin invariant — the fixed MASTER_ADMIN_EMAILS addresses are
   * permanent and can never be deactivated, even by another SUPER_ADMIN, and
   * even when other active SUPER_ADMINs exist (the floor rule alone would allow
   * one master admin to deactivate the other).
   *
   * Runs BEFORE loadAdminTarget on purpose:
   *   * a real master admin holds SUPER_ADMIN, which loadAdminTarget already
   *     blocks with its generic "SUPER_ADMIN cannot be modified" message — this
   *     makes the rejection carry the accurate master-admin reason instead;
   *   * it also covers a master-admin address that currently holds only ADMIN;
   *   * it is a read-only pre-check (email only), so nothing is written.
   */
  private async assertNotMasterAdminTarget(userId: string): Promise<void> {
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!target) throw new NotFoundException('User not found');
    if (isMasterAdminEmail(target.email)) {
      throw new ForbiddenException(MASTER_ADMIN_PROTECTED_MESSAGE);
    }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /** Best-effort audit write — never breaks the admin operation itself. */
  private async safeAudit(
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    ip: string | undefined,
    userAgent: string | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId,
          actorType: 'ADMIN',
          action,
          entityType,
          entityId,
          ip,
          userAgent,
          newValue: metadata as Prisma.InputJsonValue,
        },
      });
    } catch {
      // Best-effort audit — never break the admin operation.
    }
  }
}

// ---------------------------------------------------------------------------
// Row → view mappers (pure functions, unit-testable)
// ---------------------------------------------------------------------------

interface BetRowWithSelections {
  id: string;
  userId: string;
  type: string;
  status: string;
  stake: number;
  potentialPayout: number;
  currency: string;
  result: string | null;
  settledAt: Date | null;
  payout: number | null;
  createdAt: Date;
  user: { username: string };
  selections: Array<{
    id: string;
    selectionId: string;
    eventName: string;
    marketName: string;
    selectionName: string;
    priceAtPlacement: string;
    result: string | null;
    settledAt: Date | null;
  }>;
}

function toBetListItem(row: BetRowWithSelections): AdminBetListItem {
  return {
    id: row.id,
    userId: row.userId,
    username: row.user.username,
    type: row.type,
    status: row.status,
    stake: row.stake,
    potentialPayout: row.potentialPayout,
    currency: row.currency,
    result: row.result,
    settledAt: row.settledAt ? row.settledAt.toISOString() : null,
    payout: row.payout,
    createdAt: row.createdAt.toISOString(),
    selections: row.selections.map((sel) => ({
      id: sel.id,
      selectionId: sel.selectionId,
      eventName: sel.eventName,
      marketName: sel.marketName,
      selectionName: sel.selectionName,
      priceAtPlacement: sel.priceAtPlacement,
      result: sel.result,
      settledAt: sel.settledAt ? sel.settledAt.toISOString() : null,
    })),
  };
}

interface EventRowWithRelations {
  id: string;
  gameId: string;
  name: string;
  homeName: string | null;
  awayName: string | null;
  startTime: Date;
  status: string;
  live: boolean;
  bettingMode: string;
  createdAt: Date;
  competition: {
    id: string;
    name: string;
    slug: string;
    sport: { id: string; name: string; slug: string } | null;
  } | null;
  partnerProvider: { id: string; name: string; status: string } | null;
}

function toEventItem(row: EventRowWithRelations): AdminEventListItem {
  return {
    id: row.id,
    gameId: row.gameId,
    name: row.name,
    homeName: row.homeName,
    awayName: row.awayName,
    startTime: row.startTime.toISOString(),
    status: row.status,
    live: row.live,
    bettingMode: row.bettingMode,
    competition: row.competition
      ? { id: row.competition.id, name: row.competition.name, slug: row.competition.slug }
      : null,
    sport: row.competition?.sport ?? null,
    partnerProvider: row.partnerProvider,
    createdAt: row.createdAt.toISOString(),
  };
}

interface WalletRowShape {
  id: string;
  currency: string;
  availableBalance: number;
  lockedBalance: number;
  status: string;
}

function toWalletSummary(row: WalletRowShape) {
  return {
    id: row.id,
    currency: row.currency,
    availableBalance: row.availableBalance,
    lockedBalance: row.lockedBalance,
    status: row.status,
  };
}

interface WalletTransactionRowShape {
  id: string;
  walletId: string;
  type: string;
  status: string;
  amount: number;
  currency: string;
  reference: string | null;
  failureReason: string | null;
  createdAt: Date;
}

function toWalletTransactionItem(row: WalletTransactionRowShape) {
  return {
    id: row.id,
    walletId: row.walletId,
    type: row.type,
    status: row.status,
    amount: row.amount,
    currency: row.currency,
    reference: row.reference,
    failureReason: row.failureReason,
    createdAt: row.createdAt.toISOString(),
  };
}

function sumCounts(map: Map<string, number>): number {
  let total = 0;
  for (const value of map.values()) total += value;
  return total;
}

function catalogCounts(map: Map<string, number>): { total: number; active: number; inactive: number } {
  return {
    total: sumCounts(map),
    active: map.get('ACTIVE') ?? 0,
    inactive: map.get('INACTIVE') ?? 0,
  };
}

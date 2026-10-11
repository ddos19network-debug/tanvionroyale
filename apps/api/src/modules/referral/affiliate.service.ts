/**
 * AFFILIATE SERVICE Ã¢â‚¬â€ the user-facing earning/reporting layer.
 *
 * IT IS NOT A SECOND REFERRAL SYSTEM
 * ----------------------------------
 * Every figure this service returns is aggregated from the tables
 * `ReferralService` already owns:
 *
 *   referred users      <- Referral (referrerUserId = me)
 *   qualification state <- Referral.status
 *   income / paid       <- ReferralReward (userId = me, recipient = REFERRER)
 *   program rules       <- ReferralProgramSettings
 *   referral code       <- User.referralCode (issued by ReferralService)
 *
 * There is NO affiliate-specific copy of a referral, a reward, an amount or a
 * status. If this file were deleted, the referral program would be untouched
 * and the platform would lose nothing Ã¢â‚¬â€ that is the proof that it is a view,
 * not a competing source of truth.
 *
 * WHAT IT ADDS (only what the referral domain does not model)
 *   1. Monthly targets, addressed per (user, year, month, type) so history can
 *      never be silently overwritten by a mutable "current target".
 *   2. Admin-configurable page content.
 *   3. Click attribution for the top of the funnel.
 *   4. Affiliate MEMBERSHIP itself (`AffiliateProfile`) — the explicit opt-in
 *      that separates the affiliate program from the referral program.
 *
 * REFERRAL != AFFILIATE (the rule this service enforces)
 *   Owning a `User.referralCode` is part of the NORMAL referral program and
 *   never implies affiliate membership. The single authority for "is this user
 *   an affiliate?" is `AffiliateProfile.status === 'ACTIVE'`, and it is only
 *   ever written by an explicit activation. Therefore:
 *     - an inactive user gets NO affiliate link, NO affiliate code, NO
 *       affiliate stats and NO affiliate content;
 *     - an AffiliateClick is recorded ONLY for an ACTIVE affiliate;
 *     - the admin "Total Affiliates" counter counts ACTIVE profiles only;
 *   while the referral code, the referral relationships, the rewards and the
 *   wallet are untouched by any of it.
 *
 * FINANCIAL SAFETY
 *   No number here is ever accepted from the client. `getStats` derives every
 *   amount with a server-side aggregate over `ReferralReward`; the browser
 *   cannot submit, suggest or influence a reward amount, a paid status or a
 *   referrer. `setTarget` accepts only configuration, and every target change
 *   is audited. Activation itself never creates a reward row and never touches
 *   a wallet balance or a ledger entry.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma';
import { ReferralService, type ReferralSettingsRow } from './referral.service';
import {
  AFFILIATE_SAFE_URL_PATTERN,
  type ActivateAffiliateDto,
  type AffiliateContentBlockType,
  type AffiliateTargetTypeParam,
  type SetAffiliateStatusDto,
  type SetAffiliateTargetDto,
  type UpsertAffiliateContentDto,
} from './dto/affiliate.dto';

/** Headline dashboard counters. All amounts are integer MINOR UNITS. */
export interface AffiliateStats {
  totalReferredUsers: number;
  activeReferredUsers: number;
  pendingReferredUsers: number;
  qualifiedReferrals: number;
  totalClicks: number;
  currentMonthClicks: number;
  signups: number;
  conversions: number;
  /** Signups per click, 0-100 with two decimals. NULL when there were no clicks. */
  conversionRate: number | null;
  totalIncome: number;
  pendingIncome: number;
  paidIncome: number;
  rejectedIncome: number;
  currentMonthIncome: number;
  previousMonthIncome: number;
}

export interface AffiliateTargetProgress {
  targetType: AffiliateTargetTypeParam;
  year: number;
  month: number;
  /** Whole units configured by an admin, or null when NO target was set. */
  targetValue: number | null;
  /** Server-aggregated actual for the same month. */
  actual: number;
  /** 0-100, one decimal. Null when there is no target. */
  percentage: number | null;
  /** targetValue - actual, clamped at 0. Null when there is no target. */
  remaining: number | null;
  /** True once actual >= targetValue. */
  reached: boolean;
}

/**
 * A content block exactly as the renderer may receive it.
 *
 * SCOPE IS EXPLICIT, NEVER GUESSED
 *   `affiliateUserId` is the stored discriminator (NULL = GLOBAL) and `scope` is
 *   the same fact pre-computed for the UI, so an admin can never have to work
 *   out whether a row is global or individual by inspecting it.
 */
export interface AffiliateContentBlockView {
  id: string;
  key: string;
  /** NULL = GLOBAL (every ACTIVE affiliate). A user id = INDIVIDUAL. */
  affiliateUserId: string | null;
  /** Convenience mirror of `affiliateUserId` for the admin list. */
  scope: 'GLOBAL' | 'INDIVIDUAL';
  type: AffiliateContentBlockType;
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

/**
 * The affiliate enrollment record, exactly as the API may return it.
 *
 * It is deliberately NOT a referral: a user can have a referral code, referrals
 * and rewards while this row is INACTIVE (or absent entirely). Only an ACTIVE
 * profile unlocks the affiliate link, the affiliate dashboard and affiliate
 * click attribution.
 */
export interface AffiliateProfileView {
  id: string;
  userId: string;
  status: AffiliateStatusValue;
  promotionMethod: string | null;
  promotionUrl: string | null;
  description: string | null;
  termsAcceptedAt: string;
  activatedAt: string;
  deactivatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Literal union mirroring the Prisma `AffiliateStatus` enum. */
export type AffiliateStatusValue = 'ACTIVE' | 'INACTIVE';

/**
 * What the /affiliate page needs BEFORE a user has activated anything.
 *
 * It carries the prefill for the activation form (taken from the existing
 * account) and whether activation is currently possible. It NEVER carries a
 * referral code, a link, a click count or an amount: those belong to an active
 * affiliate, and the inactive page must not be able to render them.
 */
export interface AffiliateActivationView {
  status: AffiliateStatusValue;
  isActive: boolean;
  /** False when the referral program itself is switched off by an admin. */
  programEnabled: boolean;
  canActivate: boolean;
  /** Prefill from the existing account, so nothing is typed twice. */
  prefill: {
    fullName: string | null;
    email: string | null;
    phone: string | null;
  };
  profile: AffiliateProfileView | null;
  activatedAt: string | null;
  deactivatedAt: string | null;
}

@Injectable()
export class AffiliateService {
  private readonly logger = new Logger(AffiliateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly referrals: ReferralService,
  ) {}

  // --------------------------------------------------------------------------
  // Affiliate membership (the opt-in switch that separates the two programs)
  // --------------------------------------------------------------------------

  /**
   * The one authority for "is this user an affiliate?".
   *
   * It reads ONLY `AffiliateProfile` — never `User.referralCode`. A user with a
   * perfectly valid referral code and no profile is INACTIVE, which is the
   * entire point of the separation.
   */
  private async loadProfile(userId: string): Promise<AffiliateProfileView | null> {
    const row = await this.prisma.affiliateProfile.findUnique({ where: { userId } });
    return row ? toProfileView(row) : null;
  }

  /**
   * The pre-activation view for the /affiliate page.
   *
   * Carries the activation form prefill (from the account the user already
   * has, so nothing is asked twice) and NOTHING that belongs to an active
   * affiliate: no code, no link, no clicks, no income. That is what makes the
   * inactive page unable to render a dashboard even if the frontend asked for
   * one.
   */
  async getActivationView(userId: string): Promise<AffiliateActivationView> {
    const [settings, profile, user] = await Promise.all([
      this.referrals.getSettings(),
      this.loadProfile(userId),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true, email: true, phone: true },
      }),
    ]);
    if (!user) throw new NotFoundException('User not found');

    const isActive = profile?.status === 'ACTIVE';
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();

    return {
      status: isActive ? 'ACTIVE' : 'INACTIVE',
      isActive,
      programEnabled: settings.isEnabled,
      // A disabled program must not accept new members; an existing member
      // keeps their profile (and their history) but sees no dashboard.
      canActivate: settings.isEnabled && !isActive,
      prefill: {
        fullName: fullName || null,
        email: user.email ?? null,
        phone: user.phone ?? null,
      },
      profile,
      activatedAt: profile?.activatedAt ?? null,
      deactivatedAt: profile?.deactivatedAt ?? null,
    };
  }

  // --------------------------------------------------------------------------
  // User dashboard
  // --------------------------------------------------------------------------

  /**
   * Everything the /affiliate page needs, from a small number of INDEXED
   * aggregates. Deliberately does not load referred users, transactions or
   * click rows: those have their own paginated endpoints, so this stays fast
   * as the table grows.
   */
  async getDashboard(
    userId: string,
    siteUrl: string,
    now: Date = new Date(),
  ): Promise<{
    affiliateStatus: AffiliateStatusValue;
    activation: AffiliateActivationView;
    programEnabled: boolean;
    currency: string;
    /** Null unless the caller is an ACTIVE affiliate. */
    referralCode: string | null;
    /** Server-built from the configured origin; null unless ACTIVE. */
    referralLink: string | null;
    settings: Pick<
      ReferralSettingsRow,
      | 'qualificationRule'
      | 'minDepositAmount'
      | 'minWagerAmount'
      | 'referrerBonusType'
      | 'referrerBonusAmount'
      | 'referrerBonusPercent'
    >;
    /** Null unless the caller is an ACTIVE affiliate. */
    stats: AffiliateStats | null;
    /** Null unless the caller is an ACTIVE affiliate. */
    target: AffiliateTargetProgress | null;
    /** Global sections first, then THIS affiliate's own sections. Empty for a non-affiliate. */
    content: AffiliateContentBlockView[];
  }> {
    const settings = await this.referrals.getSettings();
    const activation = await this.getActivationView(userId);

    const shared = {
      programEnabled: settings.isEnabled,
      currency: settings.currency,
      settings: {
        qualificationRule: settings.qualificationRule,
        minDepositAmount: settings.minDepositAmount,
        minWagerAmount: settings.minWagerAmount,
        referrerBonusType: settings.referrerBonusType,
        referrerBonusAmount: settings.referrerBonusAmount,
        referrerBonusPercent: settings.referrerBonusPercent,
      },
    };

    if (!activation.isActive) {
      // NOT an affiliate: no code, no link, no stats, no target, no content.
      return {
        affiliateStatus: 'INACTIVE',
        activation,
        ...shared,
        referralCode: null,
        referralLink: null,
        stats: null,
        target: null,
        content: [],
      };
    }

    // The code + link are produced by the EXISTING referral service, so the
    // affiliate page and the profile panel can never disagree about them. The
    // SAME code is used — activation never generates a second one.
    const { summary } = await this.referrals.getMySummary(userId, siteUrl);
    const [stats, target, content] = await Promise.all([
      this.getStats(userId, now),
      this.getTarget(userId, now),
      // Global blocks THEN this affiliate's own blocks. Keyed by the
      // AUTHENTICATED caller's id, so no other affiliate's content can appear.
      this.listContentForAffiliate(userId),
    ]);

    return {
      affiliateStatus: 'ACTIVE',
      activation,
      ...shared,
      referralCode: summary.referralCode,
      referralLink: summary.referralLink,
      stats,
      target,
      content,
    };
  }

  /**
   * Explicit activation. The ONLY place an `AffiliateProfile` is created.
   *
   * IDEMPOTENT: `userId` is UNIQUE, so a second submit (a double click, a
   * retried request, a user who never saw the first response) returns the SAME
   * row instead of creating a second profile. A user who was deactivated comes
   * back on that one row, never on a new one.
   *
   * WHAT IT DELIBERATELY DOES NOT DO
   *   - it never reads a userId from the request: the id is a parameter the
   *     controller derives from the verified JWT;
   *   - it never rewrites `User.referralCode`: the existing code is reused as
   *     it is, and no second code is generated;
   *   - it never writes a Referral, a ReferralReward, a wallet balance or a
   *     ledger entry. Activation pays nobody anything.
   */
  async activate(
    userId: string,
    dto: ActivateAffiliateDto,
    now: Date = new Date(),
  ): Promise<AffiliateActivationView> {
    if (dto.acceptTerms !== true) {
      throw new BadRequestException('You must accept the affiliate agreement to activate');
    }
    // Re-validate the URL here as well as in the DTO, so a caller that skipped
    // validation still cannot store a `javascript:`/`data:` channel link.
    if (
      dto.promotionUrl !== undefined &&
      dto.promotionUrl !== '' &&
      !AFFILIATE_SAFE_URL_PATTERN.test(dto.promotionUrl)
    ) {
      throw new BadRequestException('Only https:// URLs or site-relative paths may be stored');
    }

    const settings = await this.referrals.getSettings();
    if (!settings.isEnabled) {
      throw new BadRequestException('The affiliate program is currently closed');
    }

    const existing = await this.prisma.affiliateProfile.findUnique({ where: { userId } });
    if (existing) {
      // Already a member: report the CURRENT state instead of writing again.
      // A reactivation refreshes the marketing details but keeps the original
      // activatedAt and the whole audit trail intact.
      await this.prisma.affiliateProfile.update({
        where: { userId },
        data: {
          status: 'ACTIVE',
          deactivatedAt: null,
          ...(dto.promotionMethod ? { promotionMethod: dto.promotionMethod } : {}),
          ...(dto.promotionUrl ? { promotionUrl: dto.promotionUrl } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
        },
      });
      return this.getActivationView(userId);
    }

    try {
      await this.prisma.affiliateProfile.create({
        data: {
          userId,
          status: 'ACTIVE',
          promotionMethod: dto.promotionMethod,
          promotionUrl: dto.promotionUrl ?? null,
          description: dto.description ?? null,
          termsAcceptedAt: now,
          activatedAt: now,
        },
      });
    } catch (error) {
      // A concurrent activation won the race. UNIQUE(userId) makes that a
      // success, not a failure: return the state that actually exists.
      if (isUniqueViolation(error)) {
        return this.getActivationView(userId);
      }
      throw error;
    }

    // If the account somehow has no code yet, the EXISTING generator issues
    // exactly one (it is guarded on `referralCode: null`). Activation never
    // replaces or regenerates a code that already exists.
    await this.referrals.ensureReferralCode(userId);

    return this.getActivationView(userId);
  }

  /**
   * Self-service opt-out.
   *
   * Only the affiliate membership flag changes. The referral code, the referral
   * relationships, the rewards, the wallet and the click history are left
   * exactly as they are — deactivating an affiliate is not a deletion.
   */
  async deactivate(
    userId: string,
    now: Date = new Date(),
  ): Promise<AffiliateActivationView> {
    const profile = await this.prisma.affiliateProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('You are not an affiliate');
    if (profile.status === 'INACTIVE') return this.getActivationView(userId);

    await this.prisma.affiliateProfile.update({
      where: { userId },
      data: { status: 'INACTIVE', deactivatedAt: now },
    });
    return this.getActivationView(userId);
  }

  /**
   * Admin activate/deactivate. Audited, reversible, and side-effect free
   * outside the membership flag itself.
   *
   * Reactivating reuses the SAME row (and therefore the same referral code and
   * the same link) and preserves `activatedAt`, so the history stays readable.
   */
  async setStatus(
    userId: string,
    dto: SetAffiliateStatusDto,
    adminUserId: string,
    now: Date = new Date(),
  ): Promise<AffiliateActivationView> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const before = await this.prisma.affiliateProfile.findUnique({ where: { userId } });
    if (!before) {
      // An admin cannot conjure an affiliate out of a plain referral user: the
      // enrollment details only ever come from the user's own activation.
      throw new NotFoundException('This user has no affiliate profile');
    }

    const nextStatus: AffiliateStatusValue = dto.isActive ? 'ACTIVE' : 'INACTIVE';
    // Snapshotted BEFORE the write, so the audit trail can never record the new
    // value as the previous one.
    const previousStatus = before.status as AffiliateStatusValue;
    if (previousStatus === nextStatus) return this.getActivationView(userId);

    await this.prisma.affiliateProfile.update({
      where: { userId },
      data: { status: nextStatus, deactivatedAt: dto.isActive ? null : now },
    });

    // NOTE: no referral, reward, click, wallet or ledger row is written here.
    // Existing click history in particular is PRESERVED for audit.
    await this.audit(
      adminUserId,
      dto.isActive ? 'AFFILIATE_REACTIVATED' : 'AFFILIATE_DEACTIVATED',
      'AffiliateProfile',
      userId,
      { previousStatus, status: nextStatus, reason: dto.reason ?? null },
    );

    return this.getActivationView(userId);
  }


  /**
   * The dashboard counters, all server-aggregated from Referral /
   * ReferralReward / AffiliateClick.
   *
   * `conversionRate` is signups per click, expressed 0-100 with two decimals.
   * It is `null` (NOT 0) when there were no clicks, so a zero is never shown
   * as though it were a measured result.
   */
  async getStats(userId: string, now: Date = new Date()): Promise<AffiliateStats> {
    const monthStart = startOfMonth(now);
    const previousMonthStart = startOfMonth(shiftMonth(now, -1));

    const [byStatus, referrerRewards, pendingRewards, paidRewards, rejectedRewards, monthRewards, previousMonthRewards, totalClicks, monthClicks] =
      await Promise.all([
        this.prisma.referral.groupBy({
          by: ['status'],
          where: { referrerUserId: userId },
          _count: { _all: true },
        }),
        this.prisma.referralReward.aggregate({
          where: { userId, recipient: 'REFERRER' },
          _sum: { amount: true },
        }),
        this.prisma.referralReward.aggregate({
          where: { userId, status: { in: ['PENDING', 'QUALIFIED'] } },
          _sum: { amount: true },
        }),
        this.prisma.referralReward.aggregate({
          where: { userId, status: 'PAID' },
          _sum: { amount: true },
        }),
        this.prisma.referralReward.aggregate({
          where: { userId, status: { in: ['REJECTED', 'CANCELLED'] } },
          _sum: { amount: true },
        }),
        this.prisma.referralReward.aggregate({
          where: { userId, status: 'PAID', updatedAt: { gte: monthStart } },
          _sum: { amount: true },
        }),
        this.prisma.referralReward.aggregate({
          where: {
            userId,
            status: 'PAID',
            updatedAt: { gte: previousMonthStart, lt: monthStart },
          },
          _sum: { amount: true },
        }),
        this.prisma.affiliateClick.count({ where: { affiliateUserId: userId } }),
        this.prisma.affiliateClick.count({
          where: { affiliateUserId: userId, createdAt: { gte: monthStart } },
        }),
      ]);

    const count = (status: string): number =>
      byStatus.find((row) => row.status === status)?._count._all ?? 0;

    const totalReferred = byStatus.reduce((sum, row) => sum + row._count._all, 0);
    const qualified = count('QUALIFIED');
    const pending = count('PENDING');
    const signups = totalReferred;

    return {
      totalReferredUsers: totalReferred,
      activeReferredUsers: qualified,
      pendingReferredUsers: pending,
      qualifiedReferrals: qualified,
      totalClicks,
      currentMonthClicks: monthClicks,
      signups,
      conversions: signups,
      conversionRate:
        totalClicks > 0 ? Math.round((signups / totalClicks) * 10000) / 100 : null,
      totalIncome: referrerRewards._sum.amount ?? 0,
      pendingIncome: pendingRewards._sum.amount ?? 0,
      paidIncome: paidRewards._sum.amount ?? 0,
      rejectedIncome: rejectedRewards._sum.amount ?? 0,
      currentMonthIncome: monthRewards._sum.amount ?? 0,
      previousMonthIncome: previousMonthRewards._sum.amount ?? 0,
    };
  }

  /**
   * This month's target progress for the `QUALIFIED_REFERRALS` metric.
   *
   * "No target set" is represented as `targetValue: null`, which is why the UI
   * can show "No monthly target set" instead of a misleading 0.
   */
  async getTarget(userId: string, now: Date = new Date()): Promise<AffiliateTargetProgress> {
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const targetType: AffiliateTargetTypeParam = 'QUALIFIED_REFERRALS';

    const row = await this.prisma.affiliateMonthlyTarget.findUnique({
      where: {
        affiliateUserId_year_month_targetType: { affiliateUserId: userId, year, month, targetType },
      },
      select: { targetValue: true },
    });

    const actual = await this.prisma.referral.count({
      where: {
        referrerUserId: userId,
        status: 'QUALIFIED',
        qualifiedAt: { gte: startOfMonth(now) },
      },
    });

    const targetValue = row?.targetValue ?? null;
    return {
      targetType,
      year,
      month,
      targetValue,
      actual,
      percentage:
        targetValue !== null && targetValue > 0
          ? Math.min(100, Math.round((actual / targetValue) * 1000) / 10)
          : null,
      remaining: targetValue === null ? null : Math.max(0, targetValue - actual),
      reached: targetValue !== null && targetValue > 0 && actual >= targetValue,
    };
  }

  // --------------------------------------------------------------------------
  // Click attribution
  // --------------------------------------------------------------------------

  /**
   * Records ONE click for a referral code.
   *
   * ACTIVE-ONLY: a code is resolved by the EXISTING referral resolver, but a
   * click is recorded ONLY when that owner is an ACTIVE affiliate. A user who
   * merely owns a referral code and never activated the program contributes
   * no click rows, because affiliate analytics describe affiliate links, not
   * ordinary referrals. Normal referral REGISTRATION attribution is a
   * completely separate path and is untouched by this gate.
   *
   * PRIVACY: only the code owner, a coarse landing path and a HASHED daily
   * visitor fingerprint are stored. No IP, no user agent, no cookie.
   *
   * DE-DUPLICATION: `dedupeKey` is UNIQUE in the database, so a page refresh or
   * a double click is inserted once and then silently ignored. That is what
   * keeps the click number honest instead of counting reloads.
   *
   * Returns `true` only when a NEW click was recorded.
   */
  async trackClick(input: {
    code: string;
    landingPath: string | null;
    fingerprint: { ipPrefix: string | null; userAgentFamily: string | null };
    now?: Date;
  }): Promise<boolean> {
    // The CODE is validated and resolved server-side by the referral service.
    // The browser cannot name a referrer; it can only present a code.
    const owner = await this.referrals.resolveReferrer(input.code);
    if (!owner) return false;

    // Affiliate analytics only apply to a real, currently-active affiliate.
    // A deactivated affiliate's historical clicks stay in the table, but no
    // NEW one is counted.
    const profile = await this.loadProfile(owner.id);
    if (profile?.status !== 'ACTIVE') return false;

    const now = input.now ?? new Date();
    const dedupeKey = createHash('sha256')
      .update(
        [
          owner.id,
          dayBucket(now),
          input.fingerprint.ipPrefix ?? 'no-ip',
          input.fingerprint.userAgentFamily ?? 'no-ua',
        ].join('|'),
        'utf8',
      )
      .digest('hex');

    try {
      await this.prisma.affiliateClick.create({
        data: {
          affiliateUserId: owner.id,
          referralCode: owner.referralCode,
          // Path only. A query string could carry unrelated personal data, so
          // it is reduced to its path component.
          landingPath: normaliseLandingPath(input.landingPath),
          dedupeKey,
        },
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false; // already counted today
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Admin: monthly targets
  // --------------------------------------------------------------------------

  /**
   * Sets (or replaces) ONE monthly target.
   *
   * The write is an UPSERT keyed on (user, year, month, type), so editing
   * October can never touch September Ã¢â‚¬â€ that is the reason the schema stores a
   * row per month instead of one mutable "current target".
   *
   * Every change is audited: who set what, for which month, and the previous
   * value. No reward or balance is touched here Ã¢â‚¬â€ a target is configuration.
   */
  async setTarget(
    userId: string,
    dto: SetAffiliateTargetDto,
    adminUserId: string,
  ): Promise<AffiliateTargetProgress> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('User not found');

    const key = {
      affiliateUserId_year_month_targetType: {
        affiliateUserId: userId,
        year: dto.year,
        month: dto.month,
        targetType: dto.targetType,
      },
    } as const;

    const before = await this.prisma.affiliateMonthlyTarget.findUnique({
      where: key,
      select: { targetValue: true },
    });

    await this.prisma.affiliateMonthlyTarget.upsert({
      where: key,
      create: {
        affiliateUserId: userId,
        year: dto.year,
        month: dto.month,
        targetType: dto.targetType,
        targetValue: dto.targetValue,
        updatedBy: adminUserId,
      },
      update: { targetValue: dto.targetValue, updatedBy: adminUserId },
    });

    await this.audit(adminUserId, 'AFFILIATE_TARGET_SET', 'AffiliateMonthlyTarget', userId, {
      // The owner is recorded explicitly, not only as the entity id, so a
      // target audit can be filtered by affiliate without joining anything.
      affiliateUserId: userId,
      year: dto.year,
      month: dto.month,
      targetType: dto.targetType,
      // No personal data beyond the ids: no email, no name, no referral code.
      before: { targetValue: before?.targetValue ?? null },
      after: { targetValue: dto.targetValue },
      // Retained from the original audit shape for existing consumers.
      previousValue: before?.targetValue ?? null,
      newValue: dto.targetValue,
    });

    // Progress is only meaningful for the CURRENT month; for any other month
    // the actual is reported as 0 so the history stays readable.
    const now = new Date();
    if (dto.year !== now.getFullYear() || dto.month !== now.getMonth() + 1) {
      return {
        targetType: dto.targetType,
        year: dto.year,
        month: dto.month,
        targetValue: dto.targetValue,
        actual: 0,
        percentage: null,
        remaining: dto.targetValue,
        reached: false,
      };
    }
    return this.getTarget(userId, now);
  }

  /** Every target ever set for one affiliate, newest month first. */
  async listTargets(userId: string) {
    return this.prisma.affiliateMonthlyTarget.findMany({
      where: { affiliateUserId: userId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      select: {
        id: true,
        year: true,
        month: true,
        targetType: true,
        targetValue: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Removes ONE target row for ONE affiliate (audited).
   *
   * WHAT THIS IS AND IS NOT
   *   A monthly target is CONFIGURATION ("aim for 100 qualified referrals"),
   *   not a financial transaction. Deleting it therefore removes a single
   *   `AffiliateMonthlyTarget` row and NOTHING else. It does not touch a
   *   Referral, a ReferralReward, an AffiliateClick, a Wallet or a Ledger
   *   entry, and it does not affect any other affiliate's targets: the lookup
   *   is keyed on `id` AND `affiliateUserId` together, so an admin cannot
   *   delete another affiliate's target by changing the URL. A global affiliate
   *   target does not exist and is never created by this path.
   *
   * OWNERSHIP: `findFirst({ id, affiliateUserId: userId })` returning nothing is
   * reported as NOT FOUND, which also covers a target belonging to a different
   * affiliate.
   *
   * Only the CONFIGURATION is removed. Historical referral and reward records
   * survive, so the history an admin sees afterwards is a real history and not
   * a rewritten one.
   */
  async deleteTarget(
    userId: string,
    targetId: string,
    adminUserId: string,
  ): Promise<{ id: string; deleted: true }> {
    const existing = await this.prisma.affiliateMonthlyTarget.findFirst({
      where: { id: targetId, affiliateUserId: userId },
      select: { id: true, year: true, month: true, targetType: true, targetValue: true },
    });
    if (!existing) throw new NotFoundException('Affiliate target not found');

    await this.prisma.affiliateMonthlyTarget.delete({ where: { id: targetId } });
    await this.audit(adminUserId, 'AFFILIATE_TARGET_DELETED', 'AffiliateMonthlyTarget', targetId, {
      affiliateUserId: userId,
      year: existing.year,
      month: existing.month,
      targetType: existing.targetType,
      targetValue: existing.targetValue,
    });
    return { id: targetId, deleted: true };
  }

  // --------------------------------------------------------------------------
  // Admin: content blocks
  // --------------------------------------------------------------------------

  /**
   * The GLOBAL enabled blocks, in display order.
   *
   * SCOPE: this method is the GLOBAL scope by definition. It filters
   * `affiliateUserId: null` EXPLICITLY rather than relying on "no filter", so a
   * single affiliate's custom content can never leak into the global editor or
   * into every other affiliate's page, even if a future caller forgets to pass
   * a scope. This is the read-heavy payload the /affiliate page renders, so it
   * is deliberately small and ordered.
   */
  async listContent(includeDisabled = false): Promise<AffiliateContentBlockView[]> {
    const rows = await this.prisma.affiliateContentBlock.findMany({
      where: {
        affiliateUserId: null,
        ...(includeDisabled ? {} : { isEnabled: true }),
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => toContentView(row));
  }

  /**
   * Every GLOBAL block, enabled or not - the admin list for the global editor.
   *
   * INDIVIDUAL blocks are deliberately NOT included: they belong to whichever
   * affiliate was selected, so the global editor can never show - or act on -
   * somebody else's page content.
   */
  async listContentForAdmin(): Promise<AffiliateContentBlockView[]> {
    return this.listContent(true);
  }

  /**
   * ONE affiliate's INDIVIDUAL blocks, enabled or not - the admin list for the
   * "Individual Content - @username" panel.
   *
   * `affiliateUserId: userId` is the ONLY filter, so this can never return
   * global content, another affiliate's content, or a mixture. The scope is
   * derived from the URL parameter on the server; the browser supplies no scope
   * field of its own.
   */
  async listIndividualContentForAdmin(userId: string): Promise<AffiliateContentBlockView[]> {
    const rows = await this.prisma.affiliateContentBlock.findMany({
      where: { affiliateUserId: userId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => toContentView(row));
  }

  /**
   * Everything ONE ACTIVE affiliate's /affiliate page must render:
   * the enabled GLOBAL blocks followed by that affiliate's own enabled blocks.
   *
   * DETERMINISTIC DISPLAY ORDER (the documented precedence)
   *   1. all enabled GLOBAL blocks, ordered by their own global sortOrder;
   *   2. then this affiliate's own enabled blocks, ordered by THEIR OWN
   *      independent sortOrder;
   *   3. the personal affiliate dashboard, which the page always renders last
   *      and which is not a content block at all.
   *
   * The two runs are concatenated rather than merged on `sortOrder` on purpose:
   * the two scopes number independently, so merging them would interleave
   * unpredictably as soon as an admin used the same position number in both.
   * Concatenation makes the precedence stable and obvious - an individual
   * block can never displace a global one, it is always appended after it.
   *
   * NO CROSS-ACCOUNT LEAK: the second query is keyed by this user's own id, so
   * Affiliate B's content is unreachable here even if it is enabled.
   */
  async listContentForAffiliate(userId: string): Promise<AffiliateContentBlockView[]> {
    const [globalRows, individualRows] = await Promise.all([
      this.prisma.affiliateContentBlock.findMany({
        where: { affiliateUserId: null, isEnabled: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.affiliateContentBlock.findMany({
        where: { affiliateUserId: userId, isEnabled: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    return [...globalRows, ...individualRows].map((row) => toContentView(row));
  }

  /**
   * Creates a GLOBAL block. `assertSafeContent` re-validates the URL protocol
   * here, server-side, so even a caller that skipped the DTO validation cannot
   * store a `javascript:` or `data:` URL.
   *
   * SCOPE: `affiliateUserId` is written as an EXPLICIT null. It is never taken
   * from the request body, so the global route cannot be coaxed into creating
   * an individual block, and no admin can accidentally publish one affiliate's
   * content to everybody. The counterpart that DOES set the scope is
   * `createIndividualContent`, which derives it from the verified URL param.
   */
  async createContent(
    dto: UpsertAffiliateContentDto,
    adminUserId: string,
  ): Promise<AffiliateContentBlockView> {
    const data = this.assertSafeContent(dto);
    const max = await this.prisma.affiliateContentBlock.aggregate({
      _max: { sortOrder: true },
      // Scoped to GLOBAL so the default position is relative to the global
      // sequence only; an individual's positions must not influence it.
      where: { affiliateUserId: null },
    });
    const created = await this.prisma.affiliateContentBlock.create({
      data: {
        affiliateUserId: null,
        key: data.key ?? `block-${Date.now()}`,
        type: dto.type,
        title: data.title ?? null,
        subtitle: data.subtitle ?? null,
        body: data.body ?? null,
        items: data.items ?? null,
        imageUrl: data.imageUrl ?? null,
        ctaText: data.ctaText ?? null,
        ctaUrl: data.ctaUrl ?? null,
        sortOrder: dto.sortOrder ?? (max._max.sortOrder ?? 0) + 10,
        isEnabled: dto.isEnabled ?? true,
        updatedBy: adminUserId,
      },
    });
    await this.audit(adminUserId, 'AFFILIATE_CONTENT_CREATED', 'AffiliateContentBlock', created.id, {
      scope: 'GLOBAL',
      key: created.key,
      type: created.type,
    });
    return toContentView(created);
  }

  /**
   * Updates a GLOBAL block; only the supplied fields change.
   *
   * OWNERSHIP: the row is loaded and must have `affiliateUserId === null`. An
   * INDIVIDUAL block is reported as NOT FOUND here rather than "forbidden", so
   * the global route can neither edit nor reveal the existence of a specific
   * affiliate's content.
   */
  async updateContent(
    id: string,
    dto: UpsertAffiliateContentDto,
    adminUserId: string,
  ): Promise<AffiliateContentBlockView> {
    const existing = await this.prisma.affiliateContentBlock.findUnique({ where: { id } });
    if (!existing || (existing.affiliateUserId ?? null) !== null) {
      throw new NotFoundException('Content block not found');
    }

    const data = this.assertSafeContent(dto);
    const updated = await this.prisma.affiliateContentBlock.update({
      where: { id },
      data: {
        type: dto.type,
        ...(data.key !== undefined ? { key: data.key } : {}),
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.subtitle !== undefined ? { subtitle: data.subtitle } : {}),
        ...(data.body !== undefined ? { body: data.body } : {}),
        ...(data.items !== undefined ? { items: data.items } : {}),
        ...(data.imageUrl !== undefined ? { imageUrl: data.imageUrl } : {}),
        ...(data.ctaText !== undefined ? { ctaText: data.ctaText } : {}),
        ...(data.ctaUrl !== undefined ? { ctaUrl: data.ctaUrl } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isEnabled !== undefined ? { isEnabled: dto.isEnabled } : {}),
        updatedBy: adminUserId,
      },
    });
    await this.audit(adminUserId, 'AFFILIATE_CONTENT_UPDATED', 'AffiliateContentBlock', id, {
      before: { type: existing.type, sortOrder: existing.sortOrder, isEnabled: existing.isEnabled },
      after: { type: updated.type, sortOrder: updated.sortOrder, isEnabled: updated.isEnabled },
    });
    return toContentView(updated);
  }

  /**
   * Deletes a GLOBAL block.
   *
   * Unlike a financial record, a content block is pure presentation, so a hard
   * delete is correct here. The audit entry keeps the removed summary.
   *
   * OWNERSHIP: an INDIVIDUAL block is NOT FOUND here too, so the global route
   * can never delete one affiliate's content.
   */
  async deleteContent(id: string, adminUserId: string): Promise<{ id: string }> {
    const existing = await this.prisma.affiliateContentBlock.findUnique({ where: { id } });
    if (!existing || (existing.affiliateUserId ?? null) !== null) {
      throw new NotFoundException('Content block not found');
    }
    await this.prisma.affiliateContentBlock.delete({ where: { id } });
    await this.audit(adminUserId, 'AFFILIATE_CONTENT_DELETED', 'AffiliateContentBlock', id, {
      scope: 'GLOBAL',
      key: existing.key,
      type: existing.type,
      title: existing.title,
    });
    return { id };
  }

  /**
   * Reorders GLOBAL blocks from an explicit id list.
   *
   * An explicit ordered list is used instead of drag-and-drop so the operation
   * is a single, testable, deterministic request. Unknown ids are rejected
   * rather than silently ignored, so a partial reorder can never look applied.
   *
   * INDEPENDENT ORDERING: the candidate set is filtered to
   * `affiliateUserId: null`, so renumbering the global sequence can never touch
   * an individual's blocks (and vice versa via `reorderIndividualContent`).
   */
  async reorderContent(ids: string[], adminUserId: string): Promise<AffiliateContentBlockView[]> {
    const existing = await this.prisma.affiliateContentBlock.findMany({
      where: { affiliateUserId: null },
      select: { id: true },
    });
    const known = new Set(existing.map((row) => row.id));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown content block id(s): ${unknown.join(', ')}`);
    }

    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.affiliateContentBlock.update({
          where: { id },
          data: { sortOrder: (index + 1) * 10, updatedBy: adminUserId },
        }),
      ),
    );
    await this.audit(adminUserId, 'AFFILIATE_CONTENT_REORDERED', 'AffiliateContentBlock', 'bulk', {
      scope: 'GLOBAL',
      order: ids,
    });
    return this.listContent(true);
  }

  // --------------------------------------------------------------------------
  // Admin: INDIVIDUAL page content (scoped to ONE selected ACTIVE affiliate)
  // --------------------------------------------------------------------------
  //
  // SAME content model, SAME editor, SAME validation as the global scope - only
  // the scope key differs. These methods are the ONLY place that may set a
  // non-null `affiliateUserId`, and they take it from the VERIFIED URL
  // parameter, never from the request body.
  //
  // EVERY entry point re-runs `assertActiveAffiliate`, so the guard holds for
  // create, update, delete and reorder alike. It is intentionally NOT a
  // controller-only concern: a future internal caller cannot bypass it.

  /**
   * The gate for every individual-content operation.
   *
   * Requires BOTH that an `AffiliateProfile` row exists AND that it is ACTIVE.
   * A plain referral user has no profile at all and is refused here, which is
   * what stops content being silently created for somebody who merely owns a
   * referral code. An INACTIVE affiliate is refused too, so a deactivated
   * account can receive no new or edited content - while its EXISTING content
   * and targets stay in the database and return on reactivation.
   */
  private async assertActiveAffiliate(userId: string): Promise<AffiliateProfileView> {
    const profile = await this.loadProfile(userId);
    if (!profile) {
      throw new NotFoundException('Affiliate profile not found for this user');
    }
    if (profile.status !== 'ACTIVE') {
      throw new BadRequestException('Individual content requires an ACTIVE affiliate');
    }
    return profile;
  }

  /**
   * Lists the selected affiliate's own blocks for the admin panel.
   *
   * Read-only, so it does not require ACTIVE: an admin can still INSPECT an
   * inactive affiliate's stored content and targets, which is what makes
   * "deactivate, look, reactivate, everything is still here" verifiable. Only
   * the mutating operations are gated.
   */
  async getIndividualContentForAdmin(userId: string) {
    const [user, profile, blocks] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, referralCode: true, status: true },
      }),
      this.loadProfile(userId),
      this.listIndividualContentForAdmin(userId),
    ]);
    if (!user) throw new NotFoundException('User not found');
    return {
      user,
      profile,
      isAffiliate: profile !== null,
      isActive: profile?.status === 'ACTIVE',
      blocks,
    };
  }

  /**
   * Creates a block for ONE selected ACTIVE affiliate.
   *
   * `affiliateUserId` is taken from the URL parameter AFTER
   * `assertActiveAffiliate` has proved it is a real ACTIVE affiliate - it is
   * never read from the DTO. The admin's own id is never substituted, so an
   * admin can never accidentally author content into their own account.
   */
  async createIndividualContent(
    userId: string,
    dto: UpsertAffiliateContentDto,
    adminUserId: string,
  ): Promise<AffiliateContentBlockView> {
    await this.assertActiveAffiliate(userId);
    const data = this.assertSafeContent(dto);
    // Default position is relative to THIS affiliate's own sequence only.
    const max = await this.prisma.affiliateContentBlock.aggregate({
      _max: { sortOrder: true },
      where: { affiliateUserId: userId },
    });
    const created = await this.prisma.affiliateContentBlock.create({
      data: {
        affiliateUserId: userId,
        key: data.key ?? `block-${Date.now()}`,
        type: dto.type,
        title: data.title ?? null,
        subtitle: data.subtitle ?? null,
        body: data.body ?? null,
        items: data.items ?? null,
        imageUrl: data.imageUrl ?? null,
        ctaText: data.ctaText ?? null,
        ctaUrl: data.ctaUrl ?? null,
        sortOrder: dto.sortOrder ?? (max._max.sortOrder ?? 0) + 10,
        isEnabled: dto.isEnabled ?? true,
        updatedBy: adminUserId,
      },
    });
    await this.audit(adminUserId, 'AFFILIATE_CONTENT_CREATED', 'AffiliateContentBlock', created.id, {
      scope: 'INDIVIDUAL',
      // The OWNER, not the acting admin - that is the fact the audit trail must
      // record, and it carries no personal data beyond the id itself.
      affiliateUserId: userId,
      key: created.key,
      type: created.type,
    });
    return toContentView(created);
  }

  /**
   * Updates ONE individual block, enforcing OWNERSHIP.
   *
   * The row must satisfy BOTH `id = contentId` AND `affiliateUserId = userId`.
   * Anything else - a block owned by another affiliate, or a GLOBAL block - is
   * reported as NOT FOUND. That single `findFirst` is the whole authorization:
   * an admin cannot reach Affiliate B's content by editing the `:userId` path
   * segment, and cannot reach global content through the individual route.
   */
  async updateIndividualContent(
    userId: string,
    contentId: string,
    dto: UpsertAffiliateContentDto,
    adminUserId: string,
  ): Promise<AffiliateContentBlockView> {
    await this.assertActiveAffiliate(userId);
    const existing = await this.prisma.affiliateContentBlock.findFirst({
      where: { id: contentId, affiliateUserId: userId },
    });
    if (!existing) throw new NotFoundException('Content block not found');

    const data = this.assertSafeContent(dto);
    const updated = await this.prisma.affiliateContentBlock.update({
      where: { id: contentId },
      data: {
        type: dto.type,
        ...(data.key !== undefined ? { key: data.key } : {}),
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.subtitle !== undefined ? { subtitle: data.subtitle } : {}),
        ...(data.body !== undefined ? { body: data.body } : {}),
        ...(data.items !== undefined ? { items: data.items } : {}),
        ...(data.imageUrl !== undefined ? { imageUrl: data.imageUrl } : {}),
        ...(data.ctaText !== undefined ? { ctaText: data.ctaText } : {}),
        ...(data.ctaUrl !== undefined ? { ctaUrl: data.ctaUrl } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isEnabled !== undefined ? { isEnabled: dto.isEnabled } : {}),
        updatedBy: adminUserId,
      },
    });
    await this.audit(adminUserId, 'AFFILIATE_CONTENT_UPDATED', 'AffiliateContentBlock', contentId, {
      scope: 'INDIVIDUAL',
      affiliateUserId: userId,
      before: { type: existing.type, sortOrder: existing.sortOrder, isEnabled: existing.isEnabled },
      after: { type: updated.type, sortOrder: updated.sortOrder, isEnabled: updated.isEnabled },
    });
    return toContentView(updated);
  }

  /**
   * Deletes ONE individual block, enforcing the same OWNERSHIP check.
   *
   * A block is presentation, not a financial record, so a hard delete is
   * correct. Nothing in the referral / reward / wallet / ledger data is touched.
   */
  async deleteIndividualContent(
    userId: string,
    contentId: string,
    adminUserId: string,
  ): Promise<{ id: string }> {
    await this.assertActiveAffiliate(userId);
    const existing = await this.prisma.affiliateContentBlock.findFirst({
      where: { id: contentId, affiliateUserId: userId },
    });
    if (!existing) throw new NotFoundException('Content block not found');

    await this.prisma.affiliateContentBlock.delete({ where: { id: contentId } });
    await this.audit(adminUserId, 'AFFILIATE_CONTENT_DELETED', 'AffiliateContentBlock', contentId, {
      scope: 'INDIVIDUAL',
      affiliateUserId: userId,
      key: existing.key,
      type: existing.type,
      title: existing.title,
    });
    return { id: contentId };
  }

  /**
   * Reorders ONE affiliate's blocks, enforcing OWNERSHIP on every id.
   *
   * The candidate set is `{ affiliateUserId: userId }`, so:
   *   - another affiliate's id counts as "unknown" and the WHOLE reorder is
   *     refused rather than partially applied;
   *   - a global id counts as "unknown" here, so the individual route can never
   *     renumber the global sequence;
   *   - renumbering this affiliate never touches global or other affiliates,
   *     because the two scopes number independently.
   */
  async reorderIndividualContent(
    userId: string,
    ids: string[],
    adminUserId: string,
  ): Promise<AffiliateContentBlockView[]> {
    await this.assertActiveAffiliate(userId);
    const existing = await this.prisma.affiliateContentBlock.findMany({
      where: { affiliateUserId: userId },
      select: { id: true },
    });
    const known = new Set(existing.map((row) => row.id));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown content block id(s): ${unknown.join(', ')}`);
    }

    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.affiliateContentBlock.update({
          where: { id },
          data: { sortOrder: (index + 1) * 10, updatedBy: adminUserId },
        }),
      ),
    );
    await this.audit(adminUserId, 'AFFILIATE_CONTENT_REORDERED', 'AffiliateContentBlock', 'bulk', {
      scope: 'INDIVIDUAL',
      affiliateUserId: userId,
      order: ids,
    });
    return this.listIndividualContentForAdmin(userId);
  }

  // --------------------------------------------------------------------------
  // Admin: program-wide overview
  // --------------------------------------------------------------------------

  /**
   * Program-level counters for the admin affiliate dashboard.
   *
   * MEMBERSHIP vs REFERRAL (the distinction the counters must not blur):
   *   - `totalAffiliates` counts users with an ACTIVE `AffiliateProfile` and
   *     nothing else. It is deliberately NOT "users with a referral code" —
   *     every registered user has one of those, so that count would report the
   *     entire user base as affiliates.
   *   - `totalReferredUsers` / `signups` stay on the existing `Referral`
   *     count, because a normal referral is a real thing that really happened.
   *   - clicks are the `AffiliateClick` rows, which are only ever written for
   *     ACTIVE affiliates, and rewards stay derived from `ReferralReward`.
   *   - `inactiveAffiliates` is reported separately so an admin can see how
   *     many enrolled members are currently switched off.
   */
  async getAdminOverview(now: Date = new Date()): Promise<{
    programEnabled: boolean;
    currency: string;
    /** ACTIVE AffiliateProfile count. NOT the referral-code user count. */
    totalAffiliates: number;
    /** Enrolled profiles currently switched off by an admin or the member. */
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
  }> {
    const settings = await this.referrals.getSettings();
    const monthStart = startOfMonth(now);

    const [
      totalAffiliates,
      inactiveAffiliates,
      referralByStatus,
      rewardByStatus,
      totalClicks,
      monthClicks,
      targetsThisMonth,
    ] = await Promise.all([
      this.prisma.affiliateProfile.count({ where: { status: 'ACTIVE' } }),
      this.prisma.affiliateProfile.count({ where: { status: 'INACTIVE' } }),
      this.prisma.referral.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.referralReward.groupBy({ by: ['status'], _sum: { amount: true } }),
      this.prisma.affiliateClick.count(),
      this.prisma.affiliateClick.count({ where: { createdAt: { gte: monthStart } } }),
      this.prisma.affiliateMonthlyTarget.count({
        where: { year: now.getFullYear(), month: now.getMonth() + 1 },
      }),
    ]);

    const signups = referralByStatus.reduce((sum, row) => sum + row._count._all, 0);
    const rewardSum = (status: string): number =>
      rewardByStatus.find((row) => row.status === status)?._sum.amount ?? 0;

    return {
      programEnabled: settings.isEnabled,
      currency: settings.currency,
      totalAffiliates,
      inactiveAffiliates,
      totalReferredUsers: signups,
      totalClicks,
      currentMonthClicks: monthClicks,
      signups,
      conversions: signups,
      conversionRate: totalClicks > 0 ? Math.round((signups / totalClicks) * 10000) / 100 : null,
      pendingRewardAmount: rewardSum('PENDING') + rewardSum('QUALIFIED'),
      paidRewardAmount: rewardSum('PAID'),
      rejectedRewardAmount: rewardSum('REJECTED') + rewardSum('CANCELLED'),
      targetsSetThisMonth: targetsThisMonth,
    };
  }

  /**
   * One affiliate's full admin view: identity, the activation details the
   * member supplied, stats, and the current target plus its history.
   *
   * It works with an ACTUAL affiliate profile: a user who has a referral code
   * but never activated has no `AffiliateProfile`, so `profile` is null and
   * `stats` are reported as zeros rather than fabricated — an admin can see
   * that the account is a referral user and NOT an affiliate.
   *
   * CONTENT: `individualContent` is this affiliate's OWN blocks and
   * `globalContent` is the shared set, so the panel can label each row's scope
   * instead of making an admin guess. Both are returned for every profile
   * status, including INACTIVE, so stored content is still inspectable after a
   * deactivation and is visibly intact after a reactivation.
   *
   * Every figure is computed by the EXISTING server-side aggregations; the
   * browser is never trusted for an amount, a status or a user id.
   */
  async getAdminAffiliateDetail(userId: string, now: Date = new Date()) {
    const [user, profile] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, referralCode: true, status: true, accountType: true, createdAt: true },
      }),
      this.loadProfile(userId),
    ]);
    if (!user) throw new NotFoundException('User not found');
    if (!profile) {
      // Not an affiliate. Say so plainly instead of presenting referral figures
      // as affiliate earnings.
      return {
        user,
        profile: null,
        isAffiliate: false,
        stats: null,
        target: null,
        targets: [],
        globalContent: await this.listContentForAdmin(),
        individualContent: [],
      };
    }
    const [stats, target, targets, globalContent, individualContent] = await Promise.all([
      this.getStats(userId, now),
      this.getTarget(userId, now),
      this.listTargets(userId),
      this.listContentForAdmin(),
      this.listIndividualContentForAdmin(userId),
    ]);
    return {
      user,
      profile,
      isAffiliate: true,
      stats,
      target,
      targets,
      globalContent,
      individualContent,
    };
  }

  /**
   * The ACTIVE affiliate list for admin search.
   *
   * Filters on `AffiliateProfile.status = 'ACTIVE'`, so a plain referral user
   * who never activated can never appear here. Searchable by username, user id
   * or referral code only — the OR is applied to those three fields, so the
   * search can never probe a password, an email or any other private column.
   * Paginated, so the browser never loads every affiliate.
   */
  async searchActiveAffiliates(
    search: string,
    options: { page?: number; pageSize?: number; includeInactive?: boolean } = {},
  ): Promise<{
    items: Array<{
      userId: string;
      username: string;
      referralCode: string | null;
      affiliateStatus: AffiliateStatusValue;
      promotionMethod: string | null;
      activatedAt: string;
      deactivatedAt: string | null;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const term = (search ?? '').trim();
    const page = Math.max(options.page ?? 1, 1);
    const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100);
    if (!term) return { items: [], total: 0, page, pageSize };

    // Only ACTIVE members are listed by default; `includeInactive` widens the
    // filter to the enrolled-but-switched-off ones. A plain referral user has
    // no profile at all and can therefore never appear in either list.
    const statuses: AffiliateStatusValue[] = options.includeInactive
      ? ['ACTIVE', 'INACTIVE']
      : ['ACTIVE'];
    // One where clause reused by the list and the count, so the total can never
    // drift from the rows actually returned.
    const where: Prisma.AffiliateProfileWhereInput = { status: { in: statuses } };
    const userFilter: Prisma.UserWhereInput = {
      OR: [
        { id: { equals: term, mode: 'insensitive' } },
        { username: { contains: term, mode: 'insensitive' } },
        { referralCode: { equals: term, mode: 'insensitive' } },
      ],
    };

    const [rows, total] = await Promise.all([
      this.prisma.affiliateProfile.findMany({
        where: { ...where, user: userFilter },
        orderBy: [{ activatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          userId: true,
          status: true,
          promotionMethod: true,
          activatedAt: true,
          deactivatedAt: true,
          user: { select: { username: true, referralCode: true } },
        },
      }),
      this.prisma.affiliateProfile.count({ where: { ...where, user: userFilter } }),
    ]);

    return {
      items: rows.map((row) => ({
        userId: row.userId,
        username: row.user.username,
        referralCode: row.user.referralCode,
        affiliateStatus: row.status,
        promotionMethod: row.promotionMethod,
        activatedAt: row.activatedAt.toISOString(),
        deactivatedAt: row.deactivatedAt ? row.deactivatedAt.toISOString() : null,
      })),
      total,
      page,
      pageSize,
    };
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /**
   * Re-validates a URL server-side, independently of the DTO decorator.
   *
   * Defence in depth: the service must be safe even when it is called from a
   * test or a future internal caller that never went through the pipe.
   */
  private assertSafeContent(dto: UpsertAffiliateContentDto) {
    for (const value of [dto.imageUrl, dto.ctaUrl]) {
      if (value === undefined || value === null || value === '') continue;
      if (!AFFILIATE_SAFE_URL_PATTERN.test(value)) {
        throw new BadRequestException(
          'Only https:// URLs or site-relative paths may be stored',
        );
      }
    }
    return dto;
  }

  /** Append-only, secret-free admin audit. */
  private async audit(
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId,
          actorType: 'ADMIN',
          action,
          entityType,
          entityId,
          newValue: data as never,
        },
      });
    } catch (error) {
      this.logger.warn(`affiliate.audit_failed action=${action} error=${String(error)}`);
    }
  }
}

/** First instant of a month, in server local time. */
function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Moves a date by whole months, keeping the day-of-month = 1. */
function shiftMonth(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

/**
 * A coarse DAILY bucket (UTC date). It is part of the click de-duplication key
 * so a refresh on the same day cannot count twice, while a genuine return
 * visit the next day legitimately does.
 */
function dayBucket(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Keeps only the PATH of a landing URL, and bounds its length.
 *
 * A query string is dropped entirely: `?email=â€¦` or `?token=â€¦` must never be
 * persisted, and the path alone is all the funnel needs.
 */
function normaliseLandingPath(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  const withoutQuery = raw.split('?')[0].split('#')[0];
  const path = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
  return path.slice(0, 64);
}

/** Turns a stored block into the exact shape the renderer may receive. */
function toContentView(row: {
  id: string;
  key: string;
  /** Missing on a row fetched before the individual-scope migration; treated as GLOBAL. */
  affiliateUserId?: string | null;
  type: string;
  title: string | null;
  subtitle: string | null;
  body: string | null;
  items: string | null;
  imageUrl: string | null;
  ctaText: string | null;
  ctaUrl: string | null;
  sortOrder: number;
  isEnabled: boolean;
}): AffiliateContentBlockView {
  const affiliateUserId = row.affiliateUserId ?? null;
  return {
    id: row.id,
    key: row.key,
    affiliateUserId,
    scope: affiliateUserId ? 'INDIVIDUAL' : 'GLOBAL',
    type: row.type as AffiliateContentBlockType,
    title: row.title,
    subtitle: row.subtitle,
    body: row.body,
    // Split on newlines so the frontend renders a real list and never has to
    // parse a delimited string itself.
    items: row.items ? row.items.split('\n').map((line) => line.trim()).filter(Boolean) : null,
    imageUrl: row.imageUrl,
    ctaText: row.ctaText,
    ctaUrl: row.ctaUrl,
    sortOrder: row.sortOrder,
    isEnabled: row.isEnabled,
  };
}

/** Turns a stored profile row into the exact shape the API may return. */
function toProfileView(row: {
  id: string;
  userId: string;
  status: string;
  promotionMethod: string | null;
  promotionUrl: string | null;
  description: string | null;
  termsAcceptedAt: Date;
  activatedAt: Date;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AffiliateProfileView {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status as AffiliateStatusValue,
    promotionMethod: row.promotionMethod,
    promotionUrl: row.promotionUrl,
    description: row.description,
    termsAcceptedAt: row.termsAcceptedAt.toISOString(),
    activatedAt: row.activatedAt.toISOString(),
    deactivatedAt: row.deactivatedAt ? row.deactivatedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** True for the Prisma unique-constraint violation (P2002). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}


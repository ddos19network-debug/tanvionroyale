import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { WalletService } from '../wallet/wallet.service';
import {
  generateReferralCode,
  normalizeReferralCode,
  referralEventKey,
  referralRewardEventKey,
} from './referral-code';
import type {
  ReferralBonusType,
  ReferralQualificationRule,
} from './referral-code';

/**
 * USER REFERRAL SERVICE â€” the single owner of the referral domain.
 *
 * SAFETY RULES ENFORCED HERE (and nowhere else):
 *   1. A referral relationship is created EXACTLY ONCE, at registration, and is
 *      never updated. `Referral.referredUserId` is UNIQUE, so there is no second
 *      row and no code path that could re-point a user at another referrer.
 *   2. Every reward amount is computed SERVER-SIDE from the admin settings and
 *      the real wallet/transaction ledger. No client value (amount, referrer id,
 *      qualification status) is ever trusted or read from a request body.
 *   3. Money is never mutated directly. Every credit goes through
 *      `WalletService.creditReferralBonus`, which writes a WalletTransaction and
 *      an append-only LedgerEntry under a row lock.
 *   4. Every payout is exactly-once. `ReferralReward.eventKey` is unique and the
 *      wallet transaction is unique on (userId, idempotencyKey), so a replayed
 *      webhook, a double qualification or a re-run of the evaluator can never
 *      pay twice.
 *   5. Reward history is never deleted. Rejected/cancelled rewards are status
 *      changes on an existing row.
 *
 * The service reuses the EXISTING User / Wallet / WalletTransaction /
 * LedgerEntry / AuditLog / Notification structures. It introduces no second
 * account, wallet, ledger or notification system.
 */

/** Maximum attempts before a code collision is treated as an outage. */
const MAX_CODE_ATTEMPTS = 8;

export interface ReferralSettingsRow {
  id: number;
  isEnabled: boolean;
  currency: string;
  signupPath: string;
  referrerBonusType: ReferralBonusType;
  referrerBonusAmount: number;
  referrerBonusPercent: number;
  referredBonusType: ReferralBonusType;
  referredBonusAmount: number;
  referredBonusPercent: number;
  qualificationRule: ReferralQualificationRule;
  minDepositAmount: number;
  minWagerAmount: number;
  maxRewardPerReferral: number;
  maxTotalRewardPerUser: number | null;
  qualificationExpiresInDays: number | null;
  requireVerifiedAccount: boolean;
  updatedAt: Date;
  updatedBy: string | null;
}

/** Safe defaults used before an admin has configured anything. */
export const DEFAULT_REFERRAL_SETTINGS: ReferralSettingsRow = {
  id: 1,
  isEnabled: false,
  currency: 'BDT',
  // The canonical signup path. Both `/signup` and `/register` serve the SAME
  // page (see apps/web/app/(auth)/register/page.tsx), so a link issued in
  // either form works; `/signup` is the canonical one.
  signupPath: '/signup',
  referrerBonusType: 'FIXED_AMOUNT',
  referrerBonusAmount: 0,
  referrerBonusPercent: 0,
  referredBonusType: 'FIXED_AMOUNT',
  referredBonusAmount: 0,
  referredBonusPercent: 0,
  qualificationRule: 'REGISTRATION',
  minDepositAmount: 0,
  minWagerAmount: 0,
  maxRewardPerReferral: 0,
  maxTotalRewardPerUser: null,
  qualificationExpiresInDays: null,
  requireVerifiedAccount: false,
  updatedAt: new Date(0),
  updatedBy: null,
};

export type ReferralEvaluationOutcome =
  | 'NOT_A_REFERRAL'
  | 'PROGRAM_DISABLED'
  | 'ALREADY_QUALIFIED'
  | 'ALREADY_TERMINAL'
  | 'EXPIRED'
  | 'PENDING'
  | 'QUALIFIED';

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    // Global NotificationsModule provider. Optional so a unit test that news up
    // this service directly still compiles; runtime always injects it. A push
    // failure NEVER fails a referral (same contract as every other caller).
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  /** True for the Prisma unique-constraint violation (P2002). */
  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
    );
  }

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
          // AuditLog stores before/after, not a generic payload.
          newValue: data as never,
        },
      });
    } catch (error) {
      this.logger.warn(`referral.audit_failed action=${action} error=${String(error)}`);
    }
  }

  // --------------------------------------------------------------------------
  // Settings
  // --------------------------------------------------------------------------

  /**
   * The singleton settings row. The migration seeds it, but a missing row must
   * never throw a 500 â€” the DISABLED defaults are returned instead, so a
   * partially deployed schema can never pay anybody anything.
   */
  async getSettings(): Promise<ReferralSettingsRow> {
    const row = await this.prisma.referralProgramSettings.findUnique({
      where: { id: 1 },
    });
    return row ? ({ ...row } as ReferralSettingsRow) : { ...DEFAULT_REFERRAL_SETTINGS };
  }

  /** Admin-only: writes the configuration. Nothing about a reward is hard-coded. */
  async updateSettings(
    patch: Partial<ReferralSettingsRow>,
    adminUserId: string,
  ): Promise<ReferralSettingsRow> {
    const data: Record<string, unknown> = { ...patch, updatedBy: adminUserId };
    // The id and the timestamp are server-owned.
    delete data.id;
    delete data.updatedAt;

    const saved = await this.prisma.referralProgramSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...data } as never,
      update: data as never,
    });

    await this.audit(
      adminUserId,
      'REFERRAL_SETTINGS_UPDATED',
      'ReferralProgramSettings',
      '1',
      { patch },
    );

    return { ...(saved as unknown as ReferralSettingsRow) };
  }

  // --------------------------------------------------------------------------
  // Referral codes
  // --------------------------------------------------------------------------

  /**
   * Returns the user's own referral code, creating it exactly once if it is
   * missing (an account predating the backfill, or one created by an older code
   * path).
   *
   * EXACTLY ONCE: the write is a conditional `updateMany` guarded by
   * `referralCode: null`. Two concurrent callers therefore race inside the
   * database and only one can win, so an issued code can never change afterwards.
   */
  async ensureReferralCode(userId: string): Promise<string> {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });
    if (!existing) {
      throw new NotFoundException('User not found');
    }
    if (existing.referralCode) return existing.referralCode;

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      const candidate = generateReferralCode();
      // The guarded write is the concurrency gate: only the caller whose
      // referralCode is still NULL actually performs the update.
      const updated = await this.prisma.user.updateMany({
        where: { id: userId, referralCode: null },
        data: { referralCode: candidate },
      });
      if (updated.count === 1) return candidate;
      // Lost the race (or the candidate collided) â€” re-read and try again.
      const current = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { referralCode: true },
      });
      if (current?.referralCode) return current.referralCode;
    }

    this.logger.error(`referral.code_all_attempts_failed userId=${userId}`);
    throw new ConflictException('Could not allocate a referral code, please retry');
  }

  /**
   * Resolves a code a NEW user submitted to its owner.
   *
   * Returns `null` for every unusable case â€” blank, malformed, unknown, a staff
   * account, or an owner whose account is banned / suspended / closed.
   * Registration is never FAILED because of a bad code; the user is simply
   * registered without a referrer.
   */
  async resolveReferrer(
    rawCode: string | null | undefined,
  ): Promise<{ id: string; referralCode: string } | null> {
    const code = normalizeReferralCode(rawCode);
    if (!code) return null;

    const settings = await this.getSettings();
    if (!settings.isEnabled) return null;

    const owner = await this.prisma.user.findUnique({
      where: { referralCode: code },
      select: { id: true, referralCode: true, accountType: true, status: true },
    });
    if (!owner?.referralCode) return null;
    // Staff accounts are never eligible referrers.
    if (owner.accountType !== 'CUSTOMER') return null;
    // A banned / suspended / closed account must not accrue referral rewards.
    if (owner.status === 'BANNED' || owner.status === 'CLOSED' || owner.status === 'SUSPENDED') {
      return null;
    }
    return { id: owner.id, referralCode: owner.referralCode };
  }

  /**
   * Records the immutable attribution at registration time.
   *
   * CALLED ONLY FROM `AuthService.register`, immediately after the User row is
   * created. It is best-effort and swallows its own failures: a referral
   * problem must never prevent a legitimate user from registering.
   *
   * GUARDS (each one simply leaves the new user unattributed):
   *   - the program is disabled;
   *   - the code is blank / malformed / unknown / the owner is ineligible;
   *   - SELF-REFERRAL: the resolved referrer IS the new user. Registration
   *     creates a brand new account, so this cannot normally happen, but it is
   *     checked explicitly rather than assumed away;
   *   - a duplicate attribution (unique on `referredUserId`): the FIRST referrer
   *     always wins and any later attempt is ignored.
   */
  async attributeRegistration(
    newUserId: string,
    rawCode: string | null | undefined,
  ): Promise<{ referralId: string; referrerUserId: string; referralCode: string } | null> {
    try {
      const referrer = await this.resolveReferrer(rawCode);
      if (!referrer) return null;

      // SELF-REFERRAL: never let user A be attributed to user A.
      if (referrer.id === newUserId) {
        this.logger.warn(`referral.self_rejected newUserId=${newUserId}`);
        return null;
      }

      // The relationship is immutable: if one already exists, it is kept as-is.
      const existing = await this.prisma.referral.findUnique({
        where: { referredUserId: newUserId },
        select: { id: true },
      });
      if (existing) return null;

      const settings = await this.getSettings();
      const referral = await this.prisma.referral.create({
        data: {
          referrerUserId: referrer.id,
          referredUserId: newUserId,
          referralCode: referrer.referralCode,
          status: 'PENDING',
        },
      });

      // Append-only registration signal (unique eventKey => counted once).
      await this.recordEvent(referral.id, 'REGISTRATION', newUserId, 0);

      // Best-effort on the EXISTING notification system.
      await this.notifications
        ?.create({
          recipientUserId: referrer.id,
          type: 'REFERRAL_JOINED' as never,
          title: 'You have a new referral',
          message: 'Someone just signed up with your referral link.',
          actionUrl: '/profile',
          dedupeKey: `referral-joined:${referral.id}`,
          data: { referralId: referral.id },
        })
        .catch(() => undefined);

      // A registration-only rule qualifies immediately; every other rule waits
      // for the deposit / wager signals the evaluator counts later.
      if (settings.qualificationRule === 'REGISTRATION') {
        await this.qualify(referral.id).catch((error: unknown) => {
          this.logger.error(
            `referral.registration_qualify_failed referralId=${referral.id} error=${String(error)}`,
          );
        });
      }

      return {
        referralId: referral.id,
        referrerUserId: referrer.id,
        referralCode: referrer.referralCode,
      };
    } catch (error) {
      // A referral failure must NEVER break registration.
      this.logger.error(
        `referral.attribute_failed newUserId=${newUserId} error=${String(error)}`,
      );
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // Qualifying signals (deposits / wagers)
  // --------------------------------------------------------------------------

  /**
   * Counts ONE qualifying signal (a completed deposit or wager) and re-runs the
   * evaluator.
   *
   * `sourceId` MUST be the immutable id of the wallet transaction that produced
   * the movement (e.g. `walletTransaction.id`). The resulting
   * `ReferralEvent.eventKey` is UNIQUE, so replaying the same webhook or
   * re-running the same settlement counts it exactly once and can never pay
   * twice. A duplicate is REPORTED, never silently absorbed.
   *
   * This is the safe integration point for any deposit/wager flow. It is purely
   * additive: it never modifies the caller's transaction and never touches the
   * provider logic it is called from.
   */
  async recordQualifyingEvent(
    userId: string,
    kind: 'DEPOSIT' | 'WAGER',
    sourceId: string,
    amountMinorUnits: number,
  ): Promise<{ recorded: boolean; outcome: ReferralEvaluationOutcome }> {
    const settings = await this.getSettings();
    if (!settings.isEnabled) return { recorded: false, outcome: 'PROGRAM_DISABLED' };
    if (amountMinorUnits <= 0) return { recorded: false, outcome: 'PENDING' };

    const referral = await this.prisma.referral.findFirst({
      where: { referredUserId: userId, status: 'PENDING' },
      select: { id: true },
    });
    if (!referral) return { recorded: false, outcome: 'NOT_A_REFERRAL' };

    const recorded = await this.recordEvent(
      referral.id,
      kind,
      sourceId,
      amountMinorUnits,
    );
    if (!recorded) {
      // Already counted. Re-evaluate so a lost race still converges, but never
      // pay twice.
      return { recorded: false, outcome: await this.evaluate(referral.id) };
    }

    return { recorded: true, outcome: await this.evaluate(referral.id) };
  }

  /**
   * Appends one signal to the immutable event log.
   *
   * Returns false when the same signal was already recorded (a duplicate
   * webhook, a replayed callback, a re-run). The unique `eventKey` is what makes
   * that safe - the insert loses the race and is caught.
   */
  private async recordEvent(
    referralId: string,
    kind: 'REGISTRATION' | 'DEPOSIT' | 'WAGER',
    sourceId: string,
    amountMinorUnits: number,
  ): Promise<boolean> {
    const eventKey = referralEventKey(referralId, kind, sourceId);
    try {
      await this.prisma.referralEvent.create({
        data: { referralId, kind, eventKey, amount: Math.max(0, amountMinorUnits) },
      });
      return true;
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        this.logger.warn(`referral.event_duplicate key=${eventKey}`);
        return false;
      }
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Qualification
  // --------------------------------------------------------------------------

  /**
   * Decides whether one referral currently satisfies the admin-configured
   * qualification rule, using ONLY server-side evidence.
   *
   * The deposit and wager totals are recomputed from the immutable
   * `ReferralEvent` log rather than trusted from any request, so a client can
   * never claim a qualification it has not earned. The log itself is fed by the
   * wallet ledger (`recordQualifyingEvent`), so the two always agree.
   */
  async evaluate(referralId: string): Promise<ReferralEvaluationOutcome> {
    const settings = await this.getSettings();
    if (!settings.isEnabled) return 'PROGRAM_DISABLED';

    const referral = await this.prisma.referral.findUnique({
      where: { id: referralId },
      select: { id: true, status: true, createdAt: true, referredUserId: true },
    });
    if (!referral) return 'NOT_A_REFERRAL';
    // Already terminal: a qualified/rejected/cancelled referral is never
    // re-evaluated, so money can never be paid twice for the same referral.
    if (referral.status !== 'PENDING') return 'ALREADY_TERMINAL';

    // Expiry is evaluated against the immutable registration timestamp.
    if (
      settings.qualificationExpiresInDays !== null &&
      this.daysSince(referral.createdAt) > settings.qualificationExpiresInDays
    ) {
      return 'EXPIRED';
    }

    const totals = await this.qualificationTotals(referral.id, referral.referredUserId);
    if (totals.expired) return 'EXPIRED';
    if (!this.meetsRule(settings, totals)) return 'PENDING';

    const qualified = await this.qualify(referral.id, totals);
    return qualified ? 'QUALIFIED' : 'PENDING';
  }

  /**
   * The REAL evidence for a qualification, recomputed from the ledger.
   *
   * `verified` reads the authoritative verification columns on `User`
   * (emailVerified / phoneVerified), which are only ever set by the
   * verification flows - never by a referral request.
   */
  private async qualificationTotals(
    referralId: string,
    referredUserId: string,
  ): Promise<{
    deposit: number;
    wager: number;
    verified: boolean;
    expired: boolean;
  }> {
    const [grouped, user, settings] = await Promise.all([
      this.prisma.referralEvent.groupBy({
        by: ['kind'],
        where: { referralId },
        _sum: { amount: true },
      }),
      this.prisma.user.findUnique({
        where: { id: referredUserId },
        select: { emailVerified: true, phoneVerified: true, status: true },
      }),
      this.getSettings(),
    ]);

    const deposit =
      grouped.find((row) => row.kind === 'DEPOSIT')?._sum.amount ?? 0;
    const wager = grouped.find((row) => row.kind === 'WAGER')?._sum.amount ?? 0;

    // A referred account that was closed/banned after signing up must not
    // trigger a payout.
    const inactive =
      user?.status === 'BANNED' || user?.status === 'CLOSED' || user?.status === 'SUSPENDED';
    const verified = Boolean(user?.emailVerified || user?.phoneVerified);
    const expired =
      settings.qualificationExpiresInDays !== null &&
      settings.qualificationExpiresInDays < 0;

    return {
      deposit: Math.max(0, deposit),
      wager: Math.max(0, wager),
      verified,
      expired: inactive || expired,
    };
  }

  /**
   * The qualification RULES. Pure, so every branch is directly testable.
   *
   * Only `REGISTRATION` pays on its own; every other rule requires the
   * corresponding ledger evidence. `requireVerifiedAccount` is an ADDITIONAL
   * gate an admin can switch on independently of the chosen rule.
   */
  private meetsRule(
    settings: ReferralSettingsRow,
    totals: { deposit: number; wager: number; verified: boolean },
  ): boolean {
    if (settings.requireVerifiedAccount && !totals.verified) return false;

    switch (settings.qualificationRule) {
      case 'REGISTRATION':
        return true;
      case 'VERIFIED_ACCOUNT':
        return totals.verified;
      case 'MIN_DEPOSIT':
        return totals.deposit >= settings.minDepositAmount;
      case 'MIN_WAGER':
        return totals.wager >= settings.minWagerAmount;
      case 'DEPOSIT_AND_WAGER':
        return (
          totals.deposit >= settings.minDepositAmount &&
          totals.wager >= settings.minWagerAmount
        );
      default:
        return false;
    }
  }

  private daysSince(date: Date): number {
    return Math.floor((Date.now() - date.getTime()) / 86_400_000);
  }

  // --------------------------------------------------------------------------
  // Reward payout (real money - idempotent and transactional)
  // --------------------------------------------------------------------------

  /**
   * Flips one referral to QUALIFIED and pays its rewards EXACTLY ONCE.
   *
   * IDEMPOTENCY, in layers:
   *   1. The PENDING -> QUALIFIED flip is a CONDITIONAL `updateMany`
   *      (`status: 'PENDING'`). Of two concurrent callers exactly one flips the
   *      row; the loser sees count = 0 and returns without paying.
   *   2. Each reward row is inserted with a UNIQUE `eventKey`
   *      (`referral_reward:<referralId>:<recipient>`), so a second insert for
   *      the same reward can never succeed.
   *   3. The wallet credit uses the SAME `eventKey` as the wallet
   *      `idempotencyKey`, which is unique on (userId, idempotencyKey), so even
   *      a crash between the reward insert and the credit can be retried safely.
   *
   * TRANSACTIONAL: the status flip, the reward rows and the wallet credits all
   * run inside ONE Prisma transaction. If any leg fails, nothing is committed -
   * no half-paid referral, no reward row without a ledger entry.
   */
  async qualify(
    referralId: string,
    totalsOverride?: { deposit: number; wager: number; verified: boolean },
  ): Promise<boolean> {
    const settings = await this.getSettings();
    if (!settings.isEnabled) return false;

    const referral = await this.prisma.referral.findUnique({
      where: { id: referralId },
      select: { id: true, status: true, referrerUserId: true, referredUserId: true },
    });
    if (!referral) return false;
    if (referral.status !== 'PENDING') return false;

    const totals =
      totalsOverride ??
      (await this.qualificationTotals(referral.id, referral.referredUserId));
    if (!this.meetsRule(settings, totals)) return false;

    // TRANSACTIONAL: the guarded status flip, the reward rows and the wallet
    // credits are ONE unit of work. If any leg fails the whole thing rolls back,
    // so a referral can never end up QUALIFIED-but-unpaid (which would make it
    // permanently unpayable, because a non-PENDING referral is never re-run).
    return this.prisma.$transaction(async (db) => {
      // LAYER 1: the guarded flip, INSIDE the transaction. Of two concurrent
      // callers exactly one flips the row; the loser sees count = 0, returns
      // false and commits nothing.
      const flipped = await db.referral.updateMany({
        where: { id: referralId, status: 'PENDING' },
        data: {
          status: 'QUALIFIED',
          qualifiedAt: new Date(),
          qualifiedDepositAmount: totals.deposit,
          qualifiedWagerAmount: totals.wager,
        },
      });
      if (flipped.count !== 1) {
        this.logger.warn(`referral.qualify_lost_race referralId=${referralId}`);
        return false;
      }

      return this.payRewards(db, referral, settings, totals.deposit);
    });
  }

  /**
   * Creates + pays both configured rewards inside ONE transaction.
   *
   * The PERCENTAGE path is deliberately bounded: the computed value is capped by
   * `maxRewardPerReferral` and then by the remaining head-room of
   * `maxTotalRewardPerUser`, so a percentage reward can never mint unbounded
   * money no matter how much the referred user deposits.
   */
  private async payRewards(
    db: Prisma.TransactionClient,
    referral: { id: string; referrerUserId: string; referredUserId: string },
    settings: ReferralSettingsRow,
    qualifiedDeposit: number,
  ): Promise<boolean> {
    {
      const plans = [
        {
          recipient: 'REFERRER' as const,
          userId: referral.referrerUserId,
          type: settings.referrerBonusType,
          fixed: settings.referrerBonusAmount,
          percent: settings.referrerBonusPercent,
        },
        {
          recipient: 'REFERRED' as const,
          userId: referral.referredUserId,
          type: settings.referredBonusType,
          fixed: settings.referredBonusAmount,
          percent: settings.referredBonusPercent,
        },
      ];

      let allPaid = true;

      for (const plan of plans) {
        const gross = this.computeRewardAmount(plan, qualifiedDeposit);
        if (gross <= 0) continue; // a zero reward is simply not created

        const amount = await this.applyCaps(db, plan.userId, gross, settings);
        if (amount === null) {
          allPaid = false;
          continue;
        }

        const eventKey = referralRewardEventKey(referral.id, plan.recipient);
        const basis = {
          type: plan.type,
          percent: plan.type === 'PERCENTAGE' ? plan.percent : null,
          fixed: plan.type === 'FIXED_AMOUNT' ? plan.fixed : null,
          qualifiedDeposit,
          grossBeforeCaps: gross,
          cappedByRule:
            settings.maxRewardPerReferral > 0 && gross > settings.maxRewardPerReferral,
          qualificationRule: settings.qualificationRule,
        } as Prisma.InputJsonValue;

        // LAYER 2: the reward row is created with the UNIQUE eventKey. If it
        // already exists the insert loses and we simply return - no second pay.
        let reward;
        try {
          reward = await db.referralReward.create({
            data: {
              referralId: referral.id,
              userId: plan.userId,
              recipient: plan.recipient,
              status: 'QUALIFIED',
              amount: 0,
              currency: settings.currency,
              eventKey,
              basis,
            },
          });
        } catch (error) {
          if (this.isUniqueViolation(error)) {
            this.logger.warn(`referral.reward_duplicate key=${eventKey}`);
            continue; // already paid by an earlier run
          }
          throw error;
        }

        // LAYER 3 + the ledger. WalletService takes the wallet row lock, writes
        // the WalletTransaction and the append-only LedgerEntry, and is itself
        // idempotent on the same key. If it returns `duplicate` we keep the
        // ORIGINAL transaction id rather than paying again.
        const credit = await this.wallet.creditReferralBonus(
          db,
          plan.userId,
          amount,
          settings.currency,
          eventKey,
          `REFERRAL_REWARD:${plan.recipient}:${referral.id}`,
        );

        await db.referralReward.update({
          where: { id: reward.id },
          data: {
            amount,
            status: 'PAID',
            walletTransactionId: credit.transactionId,
            beforeBalance: credit.availableBalance - amount,
            afterBalance: credit.availableBalance,
            updatedAt: new Date(),
          },
        });
      }

      if (allPaid) {
        // Notify both beneficiaries on the EXISTING notification system.
        await this.notifyQualified(referral);
      }

      return allPaid;
    }
  }

  /**
   * Applies the admin caps.
   *
   * `null` means "this beneficiary has exhausted their total referral budget"
   * and NO reward row should exist. A positive value is the amount actually
   * payable after the remaining head-room was taken into account.
   */
  private async applyCaps(
    db: Prisma.TransactionClient,
    userId: string,
    gross: number,
    settings: ReferralSettingsRow,
  ): Promise<number | null> {
    let amount = gross;

    // Cap per single referral (0 = uncapped).
    if (settings.maxRewardPerReferral > 0) {
      amount = Math.min(amount, settings.maxRewardPerReferral);
    }

    // Cap across ALL referral rewards this user has ever received.
    if (settings.maxTotalRewardPerUser !== null) {
      const paid = await db.referralReward.aggregate({
        where: { userId, status: 'PAID' },
        _sum: { amount: true },
      });
      const already = paid._sum.amount ?? 0;
      const headroom = settings.maxTotalRewardPerUser - already;
      if (headroom <= 0) return null;
      amount = Math.min(amount, headroom);
    }

    return amount > 0 ? Math.floor(amount) : null;
  }

  /**
   * Server-side reward arithmetic. Pure, so the percentage and cap behaviour is
   * directly testable.
   *
   * PERCENTAGE is a share of the referred user's QUALIFIED DEPOSIT total, and is
   * always passed through `applyCaps` before it can reach a wallet.
   */
  private computeRewardAmount(
    plan: { type: ReferralBonusType; fixed: number; percent: number },
    qualifiedDeposit: number,
  ): number {
    if (plan.type === 'FIXED_AMOUNT') {
      return Math.max(0, Math.floor(plan.fixed));
    }
    // PERCENTAGE: percent is an integer 1-100 over the qualified deposit.
    const percent = Math.max(0, Math.min(100, Math.floor(plan.percent)));
    if (percent === 0) return 0;
    return Math.max(0, Math.floor((Math.max(0, qualifiedDeposit) * percent) / 100));
  }

  /** Best-effort notifications on the EXISTING notification system. */
  private async notifyQualified(referral: {
    id: string;
    referrerUserId: string;
    referredUserId: string;
  }): Promise<void> {
    const notifier = this.notifications;
    if (!notifier) return;
    try {
      await notifier.create({
        recipientUserId: referral.referrerUserId,
        type: 'REFERRAL_QUALIFIED' as never,
        title: 'Referral qualified',
        message: 'One of your referrals met the requirement.',
        actionUrl: '/profile',
        dedupeKey: `referral-qualified:${referral.id}:REFERRER`,
        data: { referralId: referral.id },
      });
      await notifier.create({
        recipientUserId: referral.referredUserId,
        type: 'REFERRAL_BONUS_CREDITED' as never,
        title: 'Welcome bonus credited',
        message: 'Your referral bonus has been added to your wallet.',
        actionUrl: '/wallet',
        dedupeKey: `referral-qualified:${referral.id}:REFERRED`,
        data: { referralId: referral.id },
      });
    } catch (error) {
      // A notification failure must NEVER roll back a paid reward.
      this.logger.warn(`referral.notify_failed id=${referral.id} error=${String(error)}`);
    }
  }

  // --------------------------------------------------------------------------
  // User-facing reads (strictly scoped to the authenticated caller)
  // --------------------------------------------------------------------------

  /**
   * The caller's own referral identity and headline numbers.
   *
   * Every query below is filtered on `referrerUserId = auth.id` or
   * `userId = auth.id`, so this can only ever describe the caller. There is no
   * public referral endpoint and no `/:userId` route.
   */
  async getMySummary(userId: string, siteUrl: string): Promise<{
    settings: ReferralSettingsRow;
    summary: {
      referralCode: string;
      referralLink: string;
      programEnabled: boolean;
      qualificationRule: ReferralQualificationRule;
      minDepositAmount: number;
      minWagerAmount: number;
      totalReferrals: number;
      activeReferrals: number;
      qualifiedReferrals: number;
      pendingReferrals: number;
      rejectedReferrals: number;
      totalEarned: number;
      paidTotal: number;
      availableTotal: number;
      currency: string;
    };
  }> {
    const settings = await this.getSettings();
    const referralCode = await this.ensureReferralCode(userId);

    const [byStatus, referrerRewards, referredRewards] = await Promise.all([
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
        where: { userId, recipient: 'REFERRED' },
        _sum: { amount: true },
      }),
    ]);

    const count = (status: string): number =>
      byStatus.find((row) => row.status === status)?._count._all ?? 0;

    const totalEarned = (referrerRewards._sum.amount ?? 0) + (referredRewards._sum.amount ?? 0);
    const pending = await this.prisma.referralReward.aggregate({
      where: { userId, status: { in: ['PENDING', 'QUALIFIED'] } },
      _sum: { amount: true },
    });

    const activeReferrals = count('QUALIFIED');

    return {
      settings,
      summary: {
        referralCode,
        referralLink: this.buildReferralLink(siteUrl, settings.signupPath, referralCode),
        programEnabled: settings.isEnabled,
        qualificationRule: settings.qualificationRule,
        minDepositAmount: settings.minDepositAmount,
        minWagerAmount: settings.minWagerAmount,
        totalReferrals: byStatus.reduce((sum, row) => sum + row._count._all, 0),
        activeReferrals,
        qualifiedReferrals: activeReferrals,
        pendingReferrals: count('PENDING'),
        rejectedReferrals: count('REJECTED') + count('CANCELLED'),
        totalEarned,
        paidTotal: totalEarned - (pending._sum.amount ?? 0),
        availableTotal: pending._sum.amount ?? 0,
        currency: settings.currency,
      },
    };
  }

  /** Builds the shareable link from the CONFIGURED site URL, never hard-coded. */
  buildReferralLink(siteUrl: string, signupPath: string, code: string): string {
    const base = siteUrl.replace(/\/+$/, '');
    const path = signupPath.startsWith('/') ? signupPath : `/${signupPath}`;
    return `${base}${path}?ref=${encodeURIComponent(code)}`;
  }

  /**
   * The caller's own referred users.
   *
   * PRIVACY: only a safe display identifier is returned - the username and a
   * MASKED email. A password, token, phone number, IP, payment detail or any
   * other private field of another user is never selected here, so it cannot
   * leak even by accident. The query is hard-scoped to `referrerUserId =
   * userId`; there is no parameter that could widen it.
   */
  async getMyReferredUsers(
    userId: string,
    options: { page?: number; pageSize?: number } = {},
  ): Promise<{
    items: Array<{
      referralId: string;
      username: string;
      maskedEmail: string | null;
      joinedAt: string;
      status: string;
      bonusEarned: number;
      qualifiedAt: string | null;
      statusReason: string | null;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Math.max(options.page ?? 1, 1);
    const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100);

    const where = { referrerUserId: userId };
    const [rows, total] = await Promise.all([
      this.prisma.referral.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          referralCode: true,
          status: true,
          statusReason: true,
          qualifiedAt: true,
          createdAt: true,
          // Safe display fields ONLY.
          referred: { select: { username: true, email: true } },
          rewards: {
            where: { recipient: 'REFERRER', status: 'PAID' },
            select: { amount: true },
          },
        },
      }),
      this.prisma.referral.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        referralId: row.id,
        username: row.referred.username,
        maskedEmail: maskEmail(row.referred.email),
        joinedAt: row.createdAt.toISOString(),
        status: row.status,
        bonusEarned: row.rewards.reduce((sum, reward) => sum + reward.amount, 0),
        qualifiedAt: row.qualifiedAt ? row.qualifiedAt.toISOString() : null,
        statusReason: row.statusReason,
      })),
      total,
      page,
      pageSize,
    };
  }

  /** The caller's own referral reward history (both directions). */
  async getMyRewards(
    userId: string,
    options: { page?: number; pageSize?: number } = {},
  ): Promise<{
    items: Array<{
      id: string;
      referralId: string;
      recipient: string;
      status: string;
      amount: number;
      currency: string;
      username: string | null;
      createdAt: string;
      paidAt: string | null;
      statusReason: string | null;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Math.max(options.page ?? 1, 1);
    const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100);
    const where = { userId };

    const [rows, total] = await Promise.all([
      this.prisma.referralReward.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          referralId: true,
          recipient: true,
          status: true,
          amount: true,
          currency: true,
          createdAt: true,
          updatedAt: true,
          statusReason: true,
          // The username of the OTHER party, so the row is readable. Only the
          // safe public display name - never an email, phone or credential.
          referral: {
            select: {
              referrer: { select: { username: true } },
              referred: { select: { username: true } },
            },
          },
        },
      }),
      this.prisma.referralReward.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        referralId: row.referralId,
        recipient: row.recipient,
        status: row.status,
        amount: row.amount,
        currency: row.currency,
        username:
          row.recipient === 'REFERRER' ? row.referral.referred.username : row.referral.referrer.username,
        createdAt: row.createdAt.toISOString(),
        paidAt: row.status === 'PAID' ? row.updatedAt.toISOString() : null,
        statusReason: row.statusReason,
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Re-runs the evaluator for every referral the user is on the receiving end
   * of. Exposed as an explicit user action (`POST /me/referral/sync`) and used
   * as a lazy catch-up on read, so a deposit or wager that happened through any
   * flow is always eventually picked up - without any provider-specific code
   * having to know that referrals exist.
   */
  async syncUser(userId: string): Promise<{ evaluated: number; qualified: number }> {
    const referrals = await this.prisma.referral.findMany({
      where: { referredUserId: userId, status: 'PENDING' },
      select: { id: true },
    });
    let qualified = 0;
    for (const referral of referrals) {
      try {
        if ((await this.evaluate(referral.id)) === 'QUALIFIED') qualified += 1;
      } catch (error) {
        this.logger.error(
          `referral.sync_failed id=${referral.id} error=${String(error)}`,
        );
      }
    }
    return { evaluated: referrals.length, qualified };
  }
  // --------------------------------------------------------------------------
  // Admin reporting (ADMIN / SUPER_ADMIN only - enforced by @Roles on the
  // controller, never by a query parameter)
  // --------------------------------------------------------------------------

  /** Headline counters for the admin referral dashboard. */
  async getAdminStats(): Promise<{
    programEnabled: boolean;
    totalReferrers: number;
    totalReferredUsers: number;
    pendingReferrals: number;
    qualifiedReferrals: number;
    rejectedReferrals: number;
    cancelledReferrals: number;
    totalRewards: number;
    pendingRewardAmount: number;
    paidRewardAmount: number;
    rejectedRewardAmount: number;
    currency: string;
  }> {
    const settings = await this.getSettings();
    const [referralsByStatus, referrerCount, totalRewards, rewardsByStatus] = await Promise.all([
      this.prisma.referral.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.referral.groupBy({ by: ['referrerUserId'] }),
      this.prisma.referralReward.count(),
      this.prisma.referralReward.groupBy({ by: ['status'], _sum: { amount: true } }),
    ]);

    const referrals = (status: string): number =>
      referralsByStatus.find((row) => row.status === status)?._count._all ?? 0;
    const rewardSum = (status: string): number =>
      rewardsByStatus.find((row) => row.status === status)?._sum.amount ?? 0;

    return {
      programEnabled: settings.isEnabled,
      totalReferrers: referrerCount.length,
      totalReferredUsers: referralsByStatus.reduce((sum, row) => sum + row._count._all, 0),
      pendingReferrals: referrals('PENDING'),
      qualifiedReferrals: referrals('QUALIFIED'),
      rejectedReferrals: referrals('REJECTED'),
      cancelledReferrals: referrals('CANCELLED'),
      totalRewards,
      pendingRewardAmount: rewardSum('PENDING') + rewardSum('QUALIFIED'),
      paidRewardAmount: rewardSum('PAID'),
      rejectedRewardAmount: rewardSum('REJECTED') + rewardSum('CANCELLED'),
      currency: settings.currency,
    };
  }

  /**
   * Searchable referrer list.
   *
   * `search` matches a username, a user id or a referral code. The search is
   * applied as an OR of contains/equals on ONLY those three fields, so it can
   * never be used to probe a password, an email or any other private column.
   */
  async searchReferrers(
    search: string,
    options: { page?: number; pageSize?: number } = {},
  ): Promise<{ items: unknown[]; total: number; page: number; pageSize: number }> {
    const term = (search ?? '').trim();
    const page = Math.max(options.page ?? 1, 1);
    const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100);
    if (!term) return { items: [], total: 0, page, pageSize };

    const groups = await this.prisma.referral.groupBy({
      by: ['referrerUserId'],
      where: {
        OR: [
          { referrerUserId: { equals: term, mode: 'insensitive' } },
          { referralCode: { equals: term, mode: 'insensitive' } },
        ],
      },
      _count: { _all: true },
      orderBy: { _count: { referrerUserId: 'desc' } },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const total = await this.prisma.referral.count({
      where: {
        OR: [
          { referrerUserId: { equals: term, mode: 'insensitive' } },
          { referralCode: { equals: term, mode: 'insensitive' } },
        ],
      },
    });

    const users = await this.prisma.user.findMany({
      where: {
        id: { in: groups.map((group) => group.referrerUserId) },
        OR: [
          { id: { equals: term, mode: 'insensitive' } },
          { username: { contains: term, mode: 'insensitive' } },
          { referralCode: { equals: term, mode: 'insensitive' } },
        ],
      },
      select: { id: true, username: true, referralCode: true },
    });

    const usersById = new Map(users.map((user) => [user.id, user]));

    return {
      items: groups
        .map((group) => {
          const user = usersById.get(group.referrerUserId);
          if (!user) return null;
          return {
            userId: user.id,
            username: user.username,
            referralCode: user.referralCode,
            referredCount: group._count._all,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null),
      total,
      page,
      pageSize,
    };
  }

  /** Top referrers by qualified count, for the admin dashboard. */
  async getTopReferrers(limit = 10): Promise<
    Array<{
      userId: string;
      username: string;
      referralCode: string | null;
      referredCount: number;
      qualifiedCount: number;
      earnedTotal: number;
    }>
  > {
    const grouped = await this.prisma.referral.groupBy({
      by: ['referrerUserId'],
      _count: { _all: true },
      orderBy: { _count: { referrerUserId: 'desc' } },
      take: Math.min(Math.max(limit, 1), 50),
    });

    if (grouped.length === 0) return [];
    const ids = grouped.map((row) => row.referrerUserId);

    const [users, qualified, earnings] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, username: true, referralCode: true },
      }),
      this.prisma.referral.groupBy({
        by: ['referrerUserId'],
        where: { referrerUserId: { in: ids }, status: 'QUALIFIED' },
        _count: { _all: true },
      }),
      this.prisma.referralReward.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, recipient: 'REFERRER', status: 'PAID' },
        _sum: { amount: true },
      }),
    ]);

    const byId = new Map(users.map((user) => [user.id, user]));
    return grouped
      .map((row) => {
        const user = byId.get(row.referrerUserId);
        if (!user) return null;
        return {
          userId: user.id,
          username: user.username,
          referralCode: user.referralCode,
          referredCount: row._count._all,
          qualifiedCount:
            qualified.find((entry) => entry.referrerUserId === row.referrerUserId)?._count
              ._all ?? 0,
          earnedTotal:
            earnings.find((entry) => entry.userId === row.referrerUserId)?._sum.amount ?? 0,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }

  /** Searchable reward list for the admin reward table. */
  async searchRewards(
    filters: { search?: string; status?: string } = {},
    options: { page?: number; pageSize?: number } = {},
  ): Promise<{ items: unknown[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(options.page ?? 1, 1);
    const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100);
    const term = (filters.search ?? '').trim();

    const where: Prisma.ReferralRewardWhereInput = {};
    if (filters.status) where.status = filters.status as never;
    if (term) {
      where.OR = [
        { userId: { equals: term, mode: 'insensitive' } },
        { referral: { referrer: { username: { contains: term, mode: 'insensitive' } } } },
        { referral: { referred: { username: { contains: term, mode: 'insensitive' } } } },
        { referral: { referralCode: { equals: term, mode: 'insensitive' } } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.referralReward.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          referralId: true,
          userId: true,
          recipient: true,
          status: true,
          amount: true,
          currency: true,
          createdAt: true,
          updatedAt: true,
          statusReason: true,
          referral: { select: { referralCode: true } },
        },
      }),
      this.prisma.referralReward.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        referralId: row.referralId,
        userId: row.userId,
        recipient: row.recipient,
        status: row.status,
        amount: row.amount,
        currency: row.currency,
        referralCode: row.referral.referralCode,
        createdAt: row.createdAt.toISOString(),
        paidAt: row.status === 'PAID' ? row.updatedAt.toISOString() : null,
        statusReason: row.statusReason,
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * ADMIN MANUAL ADJUSTMENT of one referral reward.
   *
   * Never a silent balance change: the delta is applied through the SAME
   * WalletService ledger, and the reward row permanently records the admin, the
   * reason, the amount, the before/after balance and the timestamp. The
   * adjustment is additive on top of the original amount and the resulting
   * `WalletTransaction` is idempotent on a key derived from the adjustment
   * itself, so a double-click cannot pay twice.
   *
   * A negative delta is allowed (clawing back a wrongly paid bonus) and is
   * refused if it would take the balance below zero - the wallet service is
   * the authority and raises its structured error instead.
   */
  async adjustReward(
    rewardId: string,
    deltaMinorUnits: number,
    reason: string,
    adminUserId: string,
  ): Promise<{ rewardId: string; amount: number; beforeBalance: number; afterBalance: number }> {
    const trimmed = reason?.trim();
    if (!trimmed) {
      throw new BadRequestException('A reason is required for every manual adjustment');
    }
    if (!Number.isInteger(deltaMinorUnits) || deltaMinorUnits === 0) {
      throw new BadRequestException('Adjustment must be a non-zero integer in minor units');
    }

    const reward = await this.prisma.referralReward.findUnique({
      where: { id: rewardId },
      select: { id: true, userId: true, amount: true, currency: true, referralId: true },
    });
    if (!reward) {
      throw new NotFoundException('Referral reward not found');
    }

    const result = await this.prisma.$transaction(async (db) => {
      const key = `referral_adjust:${rewardId}:${Date.now()}:${adminUserId}`;
      const ledger = await this.wallet.adjustBalanceInTx(
        db,
        reward.userId,
        deltaMinorUnits,
        reward.currency,
        key,
        `REFERRAL_ADJUSTMENT:${trimmed.slice(0, 80)}`,
      );

      const before = ledger.duplicate
        ? (ledger.availableBalance ?? 0)
        : ledger.availableBalance - deltaMinorUnits;
      const after = ledger.availableBalance ?? 0;

      await db.referralReward.update({
        where: { id: rewardId },
        data: {
          amount: { increment: deltaMinorUnits },
          adjustedByUserId: adminUserId,
          adjustedAt: new Date(),
          adjustmentReason: trimmed.slice(0, 500),
          beforeBalance: before,
          afterBalance: after,
          walletTransactionId: ledger.transactionId,
          updatedAt: new Date(),
        },
      });

      return { rewardId, amount: reward.amount + deltaMinorUnits, beforeBalance: before, afterBalance: after };
    });

    // Permanent, separate audit trail entry.
    await this.audit(adminUserId, 'REFERRAL_REWARD_ADJUSTED', 'ReferralReward', rewardId, {
      referralId: reward.referralId,
      userId: reward.userId,
      delta: deltaMinorUnits,
      reason: trimmed,
      beforeBalance: result.beforeBalance,
      afterBalance: result.afterBalance,
    });

    return result;
  }

  /** Admin-only: rejects / cancels a referral relationship (never deletes it). */
  async setReferralStatus(
    referralId: string,
    status: 'REJECTED' | 'CANCELLED',
    reason: string,
    adminUserId: string,
  ): Promise<{ referralId: string; status: string }> {
    const trimmed = reason?.trim();
    if (!trimmed) {
      throw new BadRequestException('A reason is required when changing a referral status');
    }
    const updated = await this.prisma.referral.updateMany({
      where: { id: referralId, status: 'PENDING' },
      data: { status, statusReason: trimmed.slice(0, 500) },
    });
    if (updated.count !== 1) {
      throw new BadRequestException('Only a pending referral can be rejected or cancelled');
    }
    // Any reward still pending for it is cancelled too - never deleted.
    await this.prisma.referralReward.updateMany({
      where: { referralId, status: { in: ['PENDING', 'QUALIFIED'] } },
      data: { status: 'CANCELLED', statusReason: trimmed.slice(0, 500), updatedAt: new Date() },
    });
    await this.audit(adminUserId, `REFERRAL_${status}`, 'Referral', referralId, { reason: trimmed });
    return { referralId, status };
  }
}

/**
 * Masks an email for display in another user's referral list.
 *
 * `player786@example.com` -> `p*****6@example.com`. A one-character local part
 * is fully masked. `null` in, `null` out (the field simply does not exist).
 */
export function maskEmail(email: string | null | undefined): string | null {
  const value = (email ?? '').trim();
  if (!value || !value.includes('@')) return null;
  const at = value.indexOf('@');
  const local = value.slice(0, at);
  const domain = value.slice(at);
  if (local.length <= 2) return `${'*'.repeat(local.length)}${domain}`;
  return `${local[0]}${'*'.repeat(local.length - 2)}${local[local.length - 1]}${domain}`;

}

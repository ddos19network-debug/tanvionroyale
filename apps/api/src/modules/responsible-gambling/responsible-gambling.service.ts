import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import type { PlayLimit, SelfExclusion } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import {
  loadResponsibleGamblingConfig,
  type ResponsibleGamblingConfig,
} from './responsible-gambling.config';

/**
 * TANVION ROYALE — Responsible Gambling controls (Task 2 / audit F3).
 *
 * Encodes the player-protection rules that the Royale REAL_MONEY eligibility
 * gate enforces BEFORE any wallet reservation:
 *
 *   * isExcluded(userId)   — is an active self-exclusion / cooling-off in force?
 *   * assertCanStake(...)  — may this user stake `amount` right now? (per-bet
 *     cap + period LOSS + period DEPOSIT limits, all computed from the ONE
 *     wallet ledger — never a second source of truth).
 *
 * CHANGE RULES (the whole point of the cooling-off):
 *   * lowering a limit  OR self-excluding       -> effective IMMEDIATELY;
 *   * raising a limit   OR ending an exclusion  -> effective only after
 *     `coolingOffMs` (ROYALE_RG_COOLING_OFF_HOURS, default 24h);
 *   * PERMANENT exclusion -> endsAt is NULL and can NEVER be revoked by the
 *     user (an admin override is the only way out).
 *
 * Every change writes an AuditLog row. All reads FAIL CLOSED: an unknown /
 * missing user or a failed read propagates as an error, which the caller turns
 * into a rejection — never a silent "allowed".
 *
 * FREE_PLAY never reaches this service (the Royale eligibility gate only runs
 * for REAL_MONEY), so free players are never asked for KYC or limits.
 */

export type RgErrorCode =
  | 'ROYALE_SELF_EXCLUDED'
  | 'ROYALE_LIMIT_EXCEEDED'
  | 'ROYALE_EXCLUSION_PERMANENT'
  | 'RG_VALIDATION_ERROR'
  | 'RG_NOT_FOUND';

/** Structured, client-safe RG error (mirrors royaleError's body shape). */
export function rgError(
  code: RgErrorCode,
  message: string,
  status = 403,
  details?: unknown,
): never {
  throw new HttpException(
    { statusCode: status, message, code, ...(details !== undefined ? { details } : {}) },
    status,
  );
}

const PERIOD_WINDOW_MS: Record<string, number> = {
  DAILY: 86_400_000,
  WEEKLY: 7 * 86_400_000,
  MONTHLY: 30 * 86_400_000,
};

/** Default durations when the player does not specify one. */
const DEFAULT_EXCLUSION_HOURS: Record<string, number> = {
  COOLING_OFF: 24,
  TEMPORARY: 72,
};

export interface SetLimitInput {
  kind: 'DEPOSIT' | 'LOSS' | 'STAKE_PER_BET';
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  amount: number;
  currency: string;
}

export interface SelfExcludeInput {
  type: 'COOLING_OFF' | 'TEMPORARY' | 'PERMANENT';
  durationHours?: number;
  reason?: string;
}

export interface RgCallOptions {
  actorId?: string;
  actorType?: 'USER' | 'ADMIN' | 'SYSTEM';
  now?: Date;
}

@Injectable()
export class ResponsibleGamblingService {
  private readonly logger = new Logger(ResponsibleGamblingService.name);
  private readonly config: ResponsibleGamblingConfig = loadResponsibleGamblingConfig();

  constructor(private readonly prisma: PrismaService) {}

  /** Cooling-off delay in ms (exposed for status output + tests). */
  get coolingOffMs(): number {
    return this.config.coolingOffMs;
  }

  /**
   * The ACTIVE self-exclusion for a user, or null. A row is active while it
   * has started, has not expired, and has not (yet) been revoked — a FUTURE
   * `revokedAt` means the player asked to end it but the cooling-off delay is
   * still running, so the exclusion REMAINS in force.
   */
  async isExcluded(userId: string, now: Date = new Date()): Promise<SelfExclusion | null> {
    const rows = await this.prisma.selfExclusion.findMany({ where: { userId } });
    for (const row of rows) {
      if (row.startsAt > now) continue; // not started yet
      if (row.endsAt && row.endsAt <= now) continue; // expired on its own
      if (row.revokedAt && row.revokedAt <= now) continue; // ended (past)
      return row;
    }
    return null;
  }

  /** Effective (already-cooled-off) amount for one limit row at `now`. */
  effectiveAmount(limit: PlayLimit, now: Date): number {
    if (
      limit.pendingAmount !== null &&
      limit.pendingEffectiveAt !== null &&
      limit.pendingEffectiveAt <= now
    ) {
      return limit.pendingAmount;
    }
    return limit.amount;
  }


  /**
   * Assert that `userId` may stake `amount` of `currency` right now. Throws a
   * structured 403 (ROYALE_SELF_EXCLUDED / ROYALE_LIMIT_EXCEEDED) when not.
   * Called by RoyaleEligibilityService for REAL_MONEY, BEFORE any reservation.
   */
  async assertCanStake(
    userId: string,
    amount: number,
    currency: string,
    now: Date = new Date(),
  ): Promise<void> {
    const excluded = await this.isExcluded(userId, now);
    if (excluded) {
      rgError(
        'ROYALE_SELF_EXCLUDED',
        'You have an active self-exclusion and cannot place real-money bets',
        403,
        {
          exclusionType: excluded.type,
          startsAt: excluded.startsAt.toISOString(),
          endsAt: excluded.endsAt ? excluded.endsAt.toISOString() : null,
        },
      );
    }

    const limits = await this.prisma.playLimit.findMany({ where: { userId } });
    const applicable = limits.filter((limit) => limit.currency === currency);
    for (const limit of applicable) {
      const effective = this.effectiveAmount(limit, now);
      if (limit.kind === 'STAKE_PER_BET') {
        if (amount > effective) {
          rgError(
            'ROYALE_LIMIT_EXCEEDED',
            `This stake exceeds your ${limit.period.toLowerCase()} per-bet limit`,
            403,
            { kind: limit.kind, period: limit.period, limit: effective, attempted: amount },
          );
        }
      } else if (limit.kind === 'LOSS') {
        const from = this.windowStart(limit.period, now);
        const loss = await this.periodNetLoss(userId, currency, from, now);
        if (loss >= effective) {
          rgError(
            'ROYALE_LIMIT_EXCEEDED',
            `You have reached your ${limit.period.toLowerCase()} loss limit`,
            403,
            { kind: limit.kind, period: limit.period, limit: effective, current: loss },
          );
        }
      } else if (limit.kind === 'DEPOSIT') {
        const from = this.windowStart(limit.period, now);
        const deposited = await this.periodDeposits(userId, currency, from, now);
        if (deposited >= effective) {
          rgError(
            'ROYALE_LIMIT_EXCEEDED',
            `You have reached your ${limit.period.toLowerCase()} deposit limit`,
            403,
            { kind: limit.kind, period: limit.period, limit: effective, current: deposited },
          );
        }
      }
    }
  }

  /** Effective + pending limits for a user (the GET /limits payload). */
  async getLimits(userId: string, now: Date = new Date()) {
    const rows = await this.prisma.playLimit.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((limit) => this.toLimitView(limit, now));
  }

  /** Full protection state for a user (exclusions + limits). */
  async getState(userId: string, now: Date = new Date()) {
    const [exclusions, limits, active] = await Promise.all([
      this.prisma.selfExclusion.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.playLimit.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      this.isExcluded(userId, now),
    ]);
    return {
      excluded: active !== null,
      activeExclusion: active ? this.toExclusionView(active, now) : null,
      exclusions: exclusions.map((row) => this.toExclusionView(row, now)),
      limits: limits.map((limit) => this.toLimitView(limit, now)),
      coolingOffHours: this.config.coolingOffHours,
    };
  }

  // ==========================================================================
  // Mutations — player
  // ==========================================================================

  /**
   * Set (create/lower/raise) one limit. Lowering applies immediately; a RAISE
   * is parked as pending* and only becomes effective after the cooling-off
   * delay. First-time creation counts as a lowering (there was no cap before).
   */
  async setLimit(
    userId: string,
    input: SetLimitInput,
    opts: RgCallOptions = {},
  ): Promise<PlayLimit> {
    const now = opts.now ?? new Date();
    this.validateLimitInput(input);

    const existing = await this.prisma.playLimit.findUnique({
      where: { userId_kind_period: { userId, kind: input.kind, period: input.period } },
    });
    const currentEffective = existing
      ? this.effectiveAmount(existing, now)
      : Number.POSITIVE_INFINITY;

    if (input.amount < currentEffective) {
      // LOWER (or first-ever set) -> immediate.
      if (existing) {
        const updated = await this.prisma.playLimit.update({
          where: { id: existing.id },
          data: {
            amount: input.amount,
            currency: input.currency,
            effectiveFrom: now,
            pendingAmount: null,
            pendingEffectiveAt: null,
          },
        });
        await this.audit(opts, 'RG_LIMIT_LOWERED', 'PlayLimit', updated.id, existing, updated);
        return updated;
      }
      const created = await this.prisma.playLimit.create({
        data: {
          userId,
          kind: input.kind,
          period: input.period,
          amount: input.amount,
          currency: input.currency,
          effectiveFrom: now,
        },
      });
      await this.audit(opts, 'RG_LIMIT_CREATED', 'PlayLimit', created.id, null, created);
      return created;
    }

    if (input.amount > currentEffective && existing) {
      // RAISE -> delayed by the cooling-off window.
      const pendingEffectiveAt = new Date(now.getTime() + this.config.coolingOffMs);
      const updated = await this.prisma.playLimit.update({
        where: { id: existing.id },
        data: { pendingAmount: input.amount, pendingEffectiveAt },
      });
      await this.audit(opts, 'RG_LIMIT_RAISE_SCHEDULED', 'PlayLimit', updated.id, existing, {
        ...updated,
        coolingOffHours: this.config.coolingOffHours,
      });
      return updated;
    }

    // Unchanged (equal to the current effective value) — nothing to write.
    if (existing) return existing;
    // amount === Infinity is impossible for a finite input; defensive create.
    const created = await this.prisma.playLimit.create({
      data: {
        userId,
        kind: input.kind,
        period: input.period,
        amount: input.amount,
        currency: input.currency,
        effectiveFrom: now,
      },
    });
    await this.audit(opts, 'RG_LIMIT_CREATED', 'PlayLimit', created.id, null, created);
    return created;
  }

  /**
   * Self-exclude IMMEDIATELY (cooling-off / temporary / permanent). The
   * exclusion starts at `now`, so the very next stake attempt is rejected.
   */
  async selfExclude(
    userId: string,
    input: SelfExcludeInput,
    opts: RgCallOptions = {},
  ): Promise<SelfExclusion> {
    const now = opts.now ?? new Date();
    if (!['COOLING_OFF', 'TEMPORARY', 'PERMANENT'].includes(input.type)) {
      rgError('RG_VALIDATION_ERROR', 'Unknown self-exclusion type', 400);
    }
    let endsAt: Date | null = null;
    if (input.type !== 'PERMANENT') {
      const hours = input.durationHours ?? DEFAULT_EXCLUSION_HOURS[input.type] ?? 24;
      if (!Number.isFinite(hours) || hours <= 0) {
        rgError('RG_VALIDATION_ERROR', 'durationHours must be a positive number', 400);
      }
      endsAt = new Date(now.getTime() + hours * 3_600_000);
    }
    const created = await this.prisma.selfExclusion.create({
      data: {
        userId,
        type: input.type,
        startsAt: now,
        endsAt,
        reason: input.reason ?? null,
        revokedAt: null,
      },
    });
    await this.audit(opts, 'RG_SELF_EXCLUDED', 'SelfExclusion', created.id, null, created);
    this.logger.log(`Self-exclusion created userId=${userId} type=${input.type}`);
    return created;
  }

  /**
   * Request to END one of your own exclusions. Takes effect only after the
   * cooling-off delay (revokedAt is scheduled in the future). PERMANENT
   * exclusions can NEVER be ended by the player — 403.
   */
  async endExclusion(
    userId: string,
    exclusionId: string,
    opts: RgCallOptions = {},
  ): Promise<SelfExclusion> {
    const now = opts.now ?? new Date();
    const row = await this.prisma.selfExclusion.findUnique({ where: { id: exclusionId } });
    if (!row || row.userId !== userId) {
      rgError('RG_NOT_FOUND', 'Exclusion not found', 404);
    }
    if (row.type === 'PERMANENT') {
      rgError(
        'ROYALE_EXCLUSION_PERMANENT',
        'A permanent self-exclusion cannot be lifted by the account holder',
        403,
      );
    }
    if (row.revokedAt && row.revokedAt <= now) return row; // already ended
    const revokedAt = new Date(now.getTime() + this.config.coolingOffMs);
    const updated = await this.prisma.selfExclusion.update({
      where: { id: row.id },
      data: { revokedAt },
    });
    await this.audit(opts, 'RG_EXCLUSION_END_SCHEDULED', 'SelfExclusion', updated.id, row, {
      ...updated,
      coolingOffHours: this.config.coolingOffHours,
    });
    return updated;
  }

  // ==========================================================================
  // Mutations — admin (override)
  // ==========================================================================

  /** Admin override: lift an exclusion IMMEDIATELY (no cooling-off). */
  async adminRevokeExclusion(
    userId: string,
    exclusionId: string,
    opts: RgCallOptions = {},
  ): Promise<SelfExclusion> {
    const now = opts.now ?? new Date();
    const row = await this.prisma.selfExclusion.findUnique({ where: { id: exclusionId } });
    if (!row || row.userId !== userId) {
      rgError('RG_NOT_FOUND', 'Exclusion not found', 404);
    }
    const updated = await this.prisma.selfExclusion.update({
      where: { id: row.id },
      data: { revokedAt: now },
    });
    await this.audit(
      { ...opts, actorType: opts.actorType ?? 'ADMIN' },
      'RG_EXCLUSION_REVOKED_ADMIN',
      'SelfExclusion',
      updated.id,
      row,
      updated,
    );
    return updated;
  }

  /** Admin override: set a limit IMMEDIATELY (bypasses the cooling-off). */
  async adminSetLimit(
    userId: string,
    input: SetLimitInput,
    opts: RgCallOptions = {},
  ): Promise<PlayLimit> {
    const now = opts.now ?? new Date();
    this.validateLimitInput(input);
    const existing = await this.prisma.playLimit.findUnique({
      where: { userId_kind_period: { userId, kind: input.kind, period: input.period } },
    });
    if (existing) {
      const updated = await this.prisma.playLimit.update({
        where: { id: existing.id },
        data: {
          amount: input.amount,
          currency: input.currency,
          effectiveFrom: now,
          pendingAmount: null,
          pendingEffectiveAt: null,
        },
      });
      await this.audit(
        { ...opts, actorType: opts.actorType ?? 'ADMIN' },
        'RG_LIMIT_SET_ADMIN',
        'PlayLimit',
        updated.id,
        existing,
        updated,
      );
      return updated;
    }
    const created = await this.prisma.playLimit.create({
      data: {
        userId,
        kind: input.kind,
        period: input.period,
        amount: input.amount,
        currency: input.currency,
        effectiveFrom: now,
      },
    });
    await this.audit(
      { ...opts, actorType: opts.actorType ?? 'ADMIN' },
      'RG_LIMIT_SET_ADMIN',
      'PlayLimit',
      created.id,
      null,
      created,
    );
    return created;
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private validateLimitInput(input: SetLimitInput): void {
    if (!Number.isInteger(input.amount) || input.amount < 0) {
      rgError('RG_VALIDATION_ERROR', 'Limit amount must be a non-negative integer', 400);
    }
    if (typeof input.currency !== 'string' || input.currency.trim().length !== 3) {
      rgError('RG_VALIDATION_ERROR', 'Currency must be a 3-letter ISO 4217 code', 400);
    }
    if (!PERIOD_WINDOW_MS[input.period]) {
      rgError('RG_VALIDATION_ERROR', 'Unknown limit period', 400);
    }
  }

  private windowStart(period: string, now: Date): Date {
    const ms = PERIOD_WINDOW_MS[period] ?? PERIOD_WINDOW_MS.DAILY;
    return new Date(now.getTime() - ms);
  }

  /** Net loss (staked - paid, floored at 0) over [from, now] from the wallet ledger. */
  private async periodNetLoss(
    userId: string,
    currency: string,
    from: Date,
    to: Date,
  ): Promise<number> {
    const [stakes, payouts] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where: { userId, type: 'BET_STAKE', status: 'COMPLETED', currency },
      }),
      this.prisma.walletTransaction.findMany({
        where: { userId, type: 'BET_PAYOUT', status: 'COMPLETED', currency },
      }),
    ]);
    let staked = 0;
    for (const tx of stakes)
      if (tx.createdAt >= from && tx.createdAt <= to) staked += Math.abs(tx.amount);
    let paid = 0;
    for (const tx of payouts)
      if (tx.createdAt >= from && tx.createdAt <= to) paid += Math.abs(tx.amount);
    return Math.max(0, staked - paid);
  }

  /** Total deposits over [from, now] from the wallet ledger. */
  private async periodDeposits(
    userId: string,
    currency: string,
    from: Date,
    to: Date,
  ): Promise<number> {
    const deposits = await this.prisma.walletTransaction.findMany({
      where: { userId, type: 'DEPOSIT', status: 'COMPLETED', currency },
    });
    let sum = 0;
    for (const tx of deposits)
      if (tx.createdAt >= from && tx.createdAt <= to) sum += Math.abs(tx.amount);
    return sum;
  }

  private toLimitView(limit: PlayLimit, now: Date) {
    const effective = this.effectiveAmount(limit, now);
    const raising = limit.pendingAmount !== null && limit.pendingAmount > limit.amount;
    return {
      id: limit.id,
      kind: limit.kind,
      period: limit.period,
      currency: limit.currency,
      amount: limit.amount,
      effectiveAmount: effective,
      pendingAmount: limit.pendingAmount,
      pendingEffectiveAt: limit.pendingEffectiveAt ? limit.pendingEffectiveAt.toISOString() : null,
      raisePending: raising,
      effectiveFrom: limit.effectiveFrom.toISOString(),
      coolingOffHours: this.config.coolingOffHours,
    };
  }

  private toExclusionView(row: SelfExclusion, now: Date) {
    const active =
      row.startsAt <= now &&
      (!row.endsAt || row.endsAt > now) &&
      (!row.revokedAt || row.revokedAt > now);
    return {
      id: row.id,
      type: row.type,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt ? row.endsAt.toISOString() : null,
      reason: row.reason,
      revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
      endScheduledAt: row.revokedAt && row.revokedAt > now ? row.revokedAt.toISOString() : null,
      active,
    };
  }

  /** Append an AuditLog row for every change (best-effort, never blocks). */
  private async audit(
    opts: RgCallOptions,
    action: string,
    entityType: string,
    entityId: string,
    oldValue: unknown,
    newValue: unknown,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: opts.actorId ?? null,
          actorType: opts.actorType ?? 'USER',
          action,
          entityType,
          entityId,
          ...(oldValue !== undefined && oldValue !== null
            ? { oldValue: oldValue as Prisma.InputJsonValue }
            : {}),
          ...(newValue !== undefined && newValue !== null
            ? { newValue: newValue as Prisma.InputJsonValue }
            : {}),
        },
      });
    } catch (error) {
      // The change itself already succeeded; a failed audit write must not undo
      // it, but it IS logged loudly so it can be investigated.
      this.logger.error(
        `Audit write failed action=${action} entityId=${entityId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

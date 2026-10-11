import { Injectable, Logger, NotFoundException, Inject, Optional } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { bettingError } from './betting-errors';
import { WALLET_SERVICE, type WalletServiceInterface } from './wallet.service';
import { Prisma } from '../../generated/prisma';
import { NotificationService } from '../notifications/notification.service';
import type { ReferralService } from '../referral/referral.service';

/**
 * Phase 7 â€” Bet settlement & lifecycle engine.
 *
 * Deterministic, idempotent, atomic settlement for SINGLE bets.
 *
 * Trusted boundary: settlement is driven by an ADMIN (dev) boundary or a
 * future licensed-operator webhook that supplies per-selection results
 * (WIN | LOSS | VOID | PUSH). Normal users can never settle. The engine only
 * issues CREDITS through the wallet's ledger service; it NEVER edits balances
 * directly.
 *
 * Atomicity: the whole settlement runs in ONE Prisma interactive transaction â€”
 * bet row lock -> validate -> resolve outcome -> (optional) wallet credit ->
 * bet -> SETTLED -> selection result -> audit. Any failure rolls everything
 * back (no SETTLED-without-payout, no paid-without-SETTLED).
 *
 * Idempotency: the bet row is locked `FOR UPDATE`, so a repeat settlement sees
 * `status === SETTLED` and returns `alreadySettled: true` without paying
 * again. The wallet credit key `settle:<betId>:<type>` is additionally unique
 * per (userId, idempotencyKey) as a backstop against double-pay.
 *
 * DEVELOPMENT NOTE: settlement results currently come from an ADMIN endpoint.
 * No real operator/provider is connected; all settlement is simulation only.
 * NO REAL MONEY.
 */

export type SettlementOutcome = 'WIN' | 'LOSS' | 'VOID';
export type SettlementInputResult = 'WIN' | 'LOSS' | 'VOID' | 'PUSH';

export interface SettlementSelectionInput {
  selectionId: string;
  result: SettlementInputResult;
}

export interface SettleBetResult {
  betId: string;
  status: 'SETTLED';
  result: SettlementOutcome;
  payout: number;
  alreadySettled: boolean;
}

interface SettlementSource {
  actorId?: string;
  ip?: string;
  userAgent?: string;
}

/** Event statuses in which a bet cannot (yet) be settled. */
const NOT_FINISHED = ['SCHEDULED', 'LIVE', 'SUSPENDED'] as const;

interface BetRow {
  id: string;
  userId: string;
  type: string;
  status: string;
  stake: number;
  potentialPayout: number;
  currency: string;
  providerReference: string | null;
  result: string | null;
  payout: number | null;
  selections: Array<{ id: string; selectionId: string }>;
}

interface EventRow {
  id: string;
  status: string;
}

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WALLET_SERVICE) private readonly wallet: WalletServiceInterface,
    @Optional() private readonly notifications?: NotificationService,
    // Referral qualification. Optional so the existing 3-arg construction used
    // by the settlement unit tests keeps compiling, and so a missing service
    // simply emits no referral signal.
    @Optional() private readonly referrals?: ReferralService,
  ) {}

  /**
   * Settle a SINGLE bet deterministically. Returns `alreadySettled: true` when
   * the bet was already settled (idempotent â€” never pays twice).
   */
  async settleBet(
    betId: string,
    results: SettlementSelectionInput[],
    source?: SettlementSource,
  ): Promise<SettleBetResult> {
    const settled = await this.prisma.$transaction(async (db) => {
      // Serialize concurrent settlements of the SAME bet via a row lock.
      await db.$queryRaw`SELECT id FROM "Bet" WHERE id = ${betId} FOR UPDATE`;

      const bet = (await db.bet.findUnique({
        where: { id: betId },
        include: { selections: true },
      })) as unknown as BetRow | null;

      if (!bet) throw new NotFoundException('Bet not found');

      if (bet.status === 'SETTLED') {
        return {
          betId,
          status: 'SETTLED' as const,
          result: (bet.result as SettlementOutcome) ?? 'VOID',
          payout: bet.payout ?? 0,
          alreadySettled: true,
        };
      }
      if (bet.status !== 'ACCEPTED') {
        bettingError('INVALID_BET_STATE', `Cannot settle a bet in status ${bet.status}`, 409, {
          betId,
          status: bet.status,
        });
      }
      if (bet.type !== 'SINGLE') {
        bettingError('INVALID_BET_STATE', 'Only SINGLE bets can be settled in this phase', 400, {
          betId,
        });
      }

      const selection = bet.selections?.[0];
      if (!selection) {
        bettingError('INVALID_BET_STATE', 'Bet has no selections to settle', 409, { betId });
      }

      // Resolve event status through selection -> market -> event.
      const selRow = (await db.selection.findUnique({
        where: { id: selection.selectionId },
        include: { market: { include: { event: true } } },
      })) as unknown as { market: { event: EventRow | null } | null } | null;
      const eventStatus = selRow?.market?.event?.status;

      if (!eventStatus) {
        bettingError('UNSETTLEABLE_EVENT', 'Unable to resolve the event for this bet', 404, {
          betId,
        });
      }
      if ((NOT_FINISHED as readonly string[]).includes(eventStatus)) {
        bettingError('UNSETTLEABLE_EVENT', `Event has not finished (${eventStatus})`, 409, {
          betId,
          eventStatus,
        });
      }

      // Determine the deterministic SINGLE outcome.
      const provided = results.find((r) => r.selectionId === selection.selectionId)?.result;
      let outcome: SettlementOutcome;
      if (eventStatus === 'CANCELLED') {
        outcome = 'VOID'; // cancelled event -> refund the stake
      } else if (provided === 'WIN') {
        outcome = 'WIN';
      } else if (provided === 'LOSS') {
        outcome = 'LOSS';
      } else {
        outcome = 'VOID'; // VOID or PUSH -> refund the stake
      }

      // Payout uses the snapshot saved at placement (integer minor units).
      let amount = 0;
      let creditType: 'BET_PAYOUT' | 'BET_REFUND' | null = null;
      if (outcome === 'WIN') {
        amount = bet.potentialPayout;
        creditType = 'BET_PAYOUT';
      } else if (outcome === 'VOID') {
        amount = bet.stake;
        creditType = 'BET_REFUND';
      }
      // LOSS -> amount 0, no wallet movement.

      if (creditType) {
        const walletTx = await this.wallet.settleBetCredit(
          db,
          bet.userId,
          amount,
          bet.currency,
          creditType,
          `settle:${bet.id}:${creditType}`,
          `BET_SETTLED_${outcome}`,
        );
        if (walletTx.duplicate) {
          this.logger.warn(`Settlement credit already present for bet ${betId}`);
        }
      }

      const now = new Date();
      await db.bet.update({
        where: { id: bet.id },
        data: { status: 'SETTLED', result: outcome, settledAt: now, payout: amount },
      });

      // Referral qualification signal (ADDITIVE, BEST-EFFORT, POST-COMMIT).
      // A settled bet is a real wager, so it can satisfy an admin-configured
      // "minimum wager" referral rule. The signal is keyed by the immutable bet
      // id, so re-running a settlement (which is explicitly idempotent) counts
      // it exactly once and can never pay twice. A referral failure NEVER fails
      // a settlement, and no provider-specific logic is touched.
      void this.referrals
        ?.recordQualifyingEvent(bet.userId, 'WAGER', bet.id, bet.stake)
        .catch(() => undefined);

      await db.betSelection.updateMany({
        where: { betId: bet.id },
        data: { result: outcome, settledAt: now },
      });

      // Audit (best-effort, never blocks settlement).
      await this.writeAudit(db, source, `BET_${outcome}`, bet, {
        result: outcome,
        payout: amount,
        status: 'SETTLED',
        reference: bet.providerReference,
      });
      if (creditType) {
        await this.writeAudit(
          db,
          source,
          creditType === 'BET_PAYOUT' ? 'BET_PAYOUT' : 'BET_REFUND',
          bet,
          { amount, currency: bet.currency },
        );
      }
      await this.writeAudit(db, source, 'BET_SETTLED', bet, { result: outcome, payout: amount });

      return {
        betId,
        status: 'SETTLED' as const,
        result: outcome,
        payout: amount,
        alreadySettled: false,
      };
    });
    // Post-commit only: settlement already committed (or returned
    // alreadySettled). Duplicate/replayed settlements never re-notify
    // (bet-settlement:{betId} dedupeKey). VOID refunds carry no win/loss
    // notice. Best-effort: never throws, never rolls back the payout.
    if (!settled.alreadySettled && (settled.result === 'WIN' || settled.result === 'LOSS')) {
      try {
        if (!this.notifications) return settled;
        const settledBet = await this.prisma.bet.findUnique({
          where: { id: settled.betId },
          select: { userId: true, currency: true },
        });
        if (settledBet && this.notifications) {
          await this.notifications.notifyBetSettled({
            userId: String((settledBet as unknown as { userId: string }).userId),
            betId: settled.betId,
            won: settled.result === 'WIN',
            payout: settled.payout ?? 0,
            currency: String((settledBet as unknown as { currency: string }).currency),
          });
        }
      } catch (error) {
        this.logger.warn(
          `Post-settlement notification skipped for bet ${settled.betId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return settled;
  }

  /**
   * Settle every ACCEPTED bet that references the given event's selections.
   * Results are matched to each bet's selection (SINGLE). Unsettleable or
   * already-settled bets are returned without double-pay.
   */
  async settleEvent(
    eventId: string,
    results: SettlementSelectionInput[],
    source?: SettlementSource,
  ): Promise<SettleBetResult[]> {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    const markets = await this.prisma.market.findMany({ where: { eventId } });
    const marketIds = markets.map((m) => m.id);
    const selections = await this.prisma.selection.findMany({
      where: { marketId: { in: marketIds } },
    });
    const selectionIds = selections.map((s) => s.id);

    const bets = (await this.prisma.bet.findMany({
      where: {
        status: 'ACCEPTED',
        selections: { some: { selectionId: { in: selectionIds } } },
      },
      include: { selections: true },
    })) as unknown as BetRow[];

    const settled: SettleBetResult[] = [];
    for (const bet of bets) {
      settled.push(await this.settleBet(bet.id, results, source));
    }
    return settled;
  }

  private async writeAudit(
    db: Prisma.TransactionClient,
    source: SettlementSource | undefined,
    action: string,
    bet: BetRow,
    extra: Record<string, unknown>,
  ): Promise<void> {
    try {
      await db.auditLog.create({
        data: {
          actorId: source?.actorId ?? null,
          actorType: source?.actorId ? 'ADMIN' : 'SYSTEM',
          action,
          entityType: 'Bet',
          entityId: bet.id,
          oldValue: Prisma.JsonNull,
          newValue: {
            betId: bet.id,
            userId: bet.userId,
            currency: bet.currency,
            stake: bet.stake,
            ...extra,
          } as Prisma.InputJsonValue,
          ip: source?.ip,
          userAgent: source?.userAgent,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to write settlement audit ${action}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

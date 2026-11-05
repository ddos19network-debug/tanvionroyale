import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common';
import type { Server } from 'socket.io';
import { Prisma } from '../../generated/prisma';
import type { CrashRoundStatus } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { CrashEventBus, CRASH_ROOM } from './crash-events';
import {
  computeSeedHash,
  decryptServerSeed,
  deriveCrashMultiplier,
  encryptServerSeed,
  generateClientSeed,
  generateServerSeed,
} from './provably-fair';
import { crashDurationMs, multiplierAt } from './crash-math';
import { assertRoundTransition } from './round-state';
import { CrashFreePlayWalletService } from './crash-freeplay-wallet.service';
import { CrashSequenceService } from './crash-sequence.service';
import { loadCrashConfig, type CrashConfig } from './crash.config';
import type { CrashRoundRow } from './crash.types';

/**
 * TANVION ROYALE — authoritative crash round scheduler.
 *
 * Round state lives in the DATABASE (CrashRound rows); this service only
 * orchestrates the pre-determined transitions on a short tick:
 *
 *   CREATED → BETTING_OPEN → RUNNING → CRASHED → SETTLED → COMPLETED
 *
 * The crash point is determined BEFORE betting opens and NEVER recalculated:
 *
 *   - OPERATOR SEQUENCE (CrashSequenceState configured): each round consumes
 *     exactly ONE configured multiplier at creation (atomic — advisory lock +
 *     row lock in the same transaction). The point is frozen on the round row,
 *     so admin updates can never mutate a running round. The configured point
 *     also survives restarts via crashPointConfigured.
 *   - NO SEQUENCE CONFIGURED: the classic provably-fair path — the crash point
 *     is derived from the crypto-seeded commit/reveal seed, exactly as before.
 *
 * The server seed is kept encrypted at rest (crashPointSeedEnc) so a restarted
 * instance RESUMES the exact same round instead of inventing a different
 * result. If the seed cannot be recovered (e.g. rotated ENCRYPTION_KEY) but a
 * configured point exists, the configured point is used; otherwise the round
 * is VOIDED SAFELY: every unsettled bet is REFUNDED through the wallet of the
 * ACTIVE mode (free-play points in FREE_PLAY, released Wallet reservation in
 * REAL_MONEY — see refundVoidedStake) and the round is finalized without a
 * multiplier — no player is ever paid or charged from an invented result.
 *
 * Multi-instance safety comes from a Postgres transaction-scoped advisory
 * lock: at most one API instance performs scheduler transitions per tick, so
 * two servers can never run conflicting rounds.
 */

export interface RunningTiming {
  crashMultiplier: number;
  crashAtMs: number;
}

/**
 * Safe scheduler error when a round cannot be created and no winner exists.
 * Surfaces as HTTP 503 (never a generic 500) so scheduler ticks can retry.
 */
export class CrashRoundUnavailableError extends ServiceUnavailableException {
  constructor(message = 'Crash round is temporarily unavailable. Please try again.') {
    super({ statusCode: 503, message, code: 'SERVICE_UNAVAILABLE' });
  }
}

interface CrashBetSettleRow {
  id: string;
  userId: string;
  stake: number;
  status: string;
  idempotencyKey: string;
}

const ACTIVE_ROUND_STATUSES: CrashRoundStatus[] = [
  'CREATED',
  'BETTING_OPEN',
  'RUNNING',
];

@Injectable()
export class CrashRoundEngine implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CrashRoundEngine.name);
  private readonly config: CrashConfig = loadCrashConfig();

  /** In-process authority for the LIVE round's secret timing (multiplier/clock). */
  private readonly running = new Map<string, RunningTiming>();

  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private broadcastTimer: ReturnType<typeof setInterval> | null = null;
  private wsServer: Server | null = null;

  setServer(server: Server): void {
    this.wsServer = server;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly freeWallet: CrashFreePlayWalletService,
    private readonly wallet: WalletService,
    private readonly events: CrashEventBus,
    private readonly sequence: CrashSequenceService,
  ) {}

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  onApplicationBootstrap(): void {
    if (!this.config.enabled) {
      this.logger.warn('Crash engine disabled by configuration — round loop not started.');
      return;
    }
    // Recover a round left RUNNING/BETTING_OPEN by a previous process BEFORE
    // the loop starts, so the same pre-determined crash point continues.
    void this.recoverRunningRound();
    this.tickTimer = setInterval(() => void this.tick(), 200);
    this.broadcastTimer = setInterval(() => void this.broadcastMultiplier(), 300);
    this.logger.log(
      `Crash engine started (mode=${this.config.mode}; ${this.config.realMoneyReason})`,
    );
  }

  onApplicationShutdown(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.broadcastTimer) clearInterval(this.broadcastTimer);
    this.tickTimer = null;
    this.broadcastTimer = null;
  }

  /** Timing authority consulted by the cash-out flow. */
  getRunningTiming(roundId: string): RunningTiming | undefined {
    return this.running.get(roundId);
  }

  /**
   * THE single place a round's predetermined crash multiplier is resolved:
   * operator-configured point first, then the provably-fair seed derivation.
   * Called by recovery / start / crash-rebuild so a configured round can NEVER
   * drift to a seed-derived value (and vice versa).
   */
  private resolveCrashMultiplier(round: CrashRoundRow): number | null {
    if (round.crashSource === 'CONFIGURED' && round.crashPointConfigured != null) {
      return round.crashPointConfigured;
    }
    const seed = decryptServerSeed(round.crashPointSeedEnc);
    if (!seed) return null;
    return deriveCrashMultiplier(seed, round.clientSeed, round.nonce);
  }

  // --------------------------------------------------------------------------
  // Scheduler tick — performs at most one deterministic phase transition
  // --------------------------------------------------------------------------

  private ticking = false;

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.prisma.$transaction(
        async (db) => {
          // Transaction-scoped advisory lock: only ONE API instance runs the
          // scheduler per tick (multi-instance safe, auto-released on commit).
          await db.$executeRaw`SELECT pg_advisory_xact_lock(${this.config.advisoryLockId}::bigint)`;
          const round = (await db.crashRound.findFirst({
            where: { gameSlug: this.config.gameSlug, status: { in: ACTIVE_ROUND_STATUSES } },
            orderBy: { roundNumber: 'desc' },
          })) as unknown as CrashRoundRow | null;
          if (!round) {
            await this.createRoundInTx(db);
            return;
          }
          const now = Date.now();
          switch (round.status) {
            case 'CREATED':
              await this.openBettingInTx(db, round, now);
              break;
            case 'BETTING_OPEN':
              if (now >= round.bettingCloseAt.getTime()) {
                await this.startRunningInTx(db, round, now);
              }
              break;
            case 'RUNNING':
              await this.maybeCrashInTx(db, round, now);
              break;
            default:
              break;
          }
        },
        {
          maxWait: 5000,
          timeout: 15000,
        },
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Crash scheduler tick failed: ${msg}`);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Server-restart recovery: a round left RUNNING by a previous process is
   * resumed with the SAME pre-determined crash point (decrypted seed). If the
   * seed is unrecoverable the round is voided safely with refunds.
   */
  private async recoverRunningRound(): Promise<void> {
    try {
      const round = (await this.prisma.crashRound.findFirst({
        where: { gameSlug: this.config.gameSlug, status: { in: ACTIVE_ROUND_STATUSES } },
        orderBy: { roundNumber: 'desc' },
      })) as unknown as CrashRoundRow | null;
      if (!round || round.status !== 'RUNNING') return;
      const crashMultiplier = this.resolveCrashMultiplier(round);
      if (crashMultiplier == null) {
        await this.voidRoundSafely(round);
        return;
      }
      const duration = crashDurationMs(crashMultiplier);
      const crashAtMs = round.startAt.getTime() + duration;
      this.running.set(round.id, { crashMultiplier, crashAtMs });
      // SECURITY: neither the crash multiplier nor the reconstructed crash time
      // (a monotonic function of the multiplier) is logged — the round is still
      // LIVE, so either value would reveal the upcoming result to anyone with
      // log access. Only non-sensitive progress metadata is recorded.
      this.logger.log(
        `Recovered RUNNING round #${round.roundNumber} — pre-determined crash point resumed (not disclosed)`,
      );
    } catch (error) {
      this.logger.error(
        `Crash recovery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // --------------------------------------------------------------------------
  // Phase transitions (all inside the scheduler transaction)
  // --------------------------------------------------------------------------

  private async createRoundInTx(db: Prisma.TransactionClient): Promise<CrashRoundRow> {
    // Seed material is generated BEFORE the round row exists and the crash
    // point NEVER changes afterwards. When an operator sequence is configured
    // the configured point is ALSO consumed here — atomically, in this same
    // transaction (advisory lock + FOR UPDATE row lock guard the position).
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const nonce = 1;
    const configured = await this.sequence.consumeForNewRound(
      db,
      this.config.gameSlug,
    );
    const last = (await db.crashRound.findFirst({
      where: { gameSlug: this.config.gameSlug },
      orderBy: { roundNumber: 'desc' },
    })) as unknown as CrashRoundRow | null;
    const roundNumber = (last?.roundNumber ?? 0) + 1;
    const now = Date.now();
    const delay = roundNumber === 1 ? 1_000 : this.config.nextRoundDelayMs;
    const startAt = new Date(now + delay);
    const bettingCloseAt = new Date(startAt.getTime() + this.config.bettingDurationMs);

    try {
      const row = (await db.crashRound.create({
        data: {
          gameSlug: this.config.gameSlug,
          mode: this.config.mode,
          status: 'CREATED',
          roundNumber,
          serverSeedHash: computeSeedHash(serverSeed),
          // Plaintext seed is NEVER persisted. The encrypted copy lets a
          // restarted instance resume the SAME crash point.
          crashPointSeedEnc: encryptServerSeed(serverSeed),
          clientSeed,
          nonce,
          algorithmVersion: this.config.algorithmVersion,
          // Operator sequence fields — frozen for the life of the round.
          crashSource: configured ? 'CONFIGURED' : 'PROVABLY_FAIR',
          sequenceMode: configured ? configured.mode : null,
          sequenceIndex: configured ? configured.index : null,
          crashPointConfigured: configured ? configured.multiplier : null,
          startAt,
          bettingCloseAt,
        },
      })) as unknown as CrashRoundRow;
      // SECURITY: the committed crash point is a FUTURE result — whether it came
      // from the operator sequence (configuredPoint) or from the provably-fair
      // seed derivation, it is NEVER logged at any level (debug included).
      // Only non-sensitive metadata is recorded: round number, seed commitment
      // hash prefix, crash source and the sequence phase + position (both of
      // which are already public to clients).
      this.logger.debug(
        `Round #${roundNumber} committed (hash=${row.serverSeedHash.slice(0, 12)}…, ` +
          (configured
            ? `source=CONFIGURED phase=${configured.mode} index=${configured.index})`
            : 'source=PROVABLY_FAIR) — crash point withheld until the round settles'),
      );
      return row;
    } catch (error) {
      // Unique (gameSlug, roundNumber) race with another instance — ignore.
      const existing = (await db.crashRound.findFirst({
        where: { gameSlug: this.config.gameSlug, roundNumber },
      })) as unknown as CrashRoundRow | null;
      if (!existing) {
        // Genuinely unexpected: the create failed AND no winner exists.
        // Log server-side with context and surface a safe 503 so the tick
        // retries instead of crashing the scheduler with a generic 500.
        this.logger.error(
          `Crash round #${roundNumber} creation failed with no winner: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw new CrashRoundUnavailableError();
      }
      return existing;
    }
  }

  private async openBettingInTx(
    db: Prisma.TransactionClient,
    round: CrashRoundRow,
    now: number,
  ): Promise<void> {
    assertRoundTransition('CREATED', 'BETTING_OPEN');
    await db.crashRound.update({
      where: { id: round.id, status: 'CREATED' },
      data: { status: 'BETTING_OPEN' },
    });
    this.events.emit(CRASH_ROOM, 'BETTING_OPEN', {
      roundId: round.id,
      roundNumber: round.roundNumber,
      bettingCloseAt: round.bettingCloseAt.getTime(),
      serverTime: now,
    });
    this.events.emit(CRASH_ROOM, 'ROUND_CREATED', {
      roundId: round.id,
      roundNumber: round.roundNumber,
      mode: round.mode,
      serverSeedHash: round.serverSeedHash,
      serverTime: now,
    });
  }

  private async startRunningInTx(
    db: Prisma.TransactionClient,
    round: CrashRoundRow,
    now: number,
  ): Promise<void> {
    // Resolve the SAME pre-determined crash point (configured or seed-derived).
    const crashMultiplier = this.resolveCrashMultiplier(round);
    if (crashMultiplier == null) {
      // Crash point unrecoverable — the round cannot run with an invented result.
      await this.voidRoundSafely(round);
      return;
    }
    // The actual flight begins RIGHT NOW — record the authoritative flight start time
    // so elapsed time for multiplier calculation starts at 0ms (1.00x), not 6s in the past.
    const flightStartMs = now;
    const crashAtMs = flightStartMs + crashDurationMs(crashMultiplier);

    assertRoundTransition('BETTING_OPEN', 'RUNNING');
    await db.crashRound.update({
      where: { id: round.id, status: 'BETTING_OPEN' },
      data: {
        status: 'RUNNING',
        bettingClosedAt: new Date(now),
        startAt: new Date(flightStartMs),
      },
    });
    // In-process timing authority for cash-outs (single instance holds it).
    this.running.set(round.id, { crashMultiplier, crashAtMs });

    this.events.emit(CRASH_ROOM, 'BETTING_CLOSED', {
      roundId: round.id,
      roundNumber: round.roundNumber,
      serverTime: now,
    });
    this.events.emit(CRASH_ROOM, 'ROUND_STARTED', {
      roundId: round.id,
      roundNumber: round.roundNumber,
      startAt: flightStartMs,
      serverTime: now,
    });
    this.logger.log(`Round #${round.roundNumber} started (RUNNING)`);
  }

  private async maybeCrashInTx(
    db: Prisma.TransactionClient,
    round: CrashRoundRow,
    now: number,
  ): Promise<void> {
    const timing = this.running.get(round.id);
    if (!timing) {
      // Timing lost (e.g. this instance just recovered leadership) — rebuild
      // deterministically from the frozen round data (configured point or seed).
      const crashMultiplier = this.resolveCrashMultiplier(round);
      if (crashMultiplier == null) {
        await this.voidRoundSafely(round);
        return;
      }
      const crashAtMs = round.startAt.getTime() + crashDurationMs(crashMultiplier);
      this.running.set(round.id, { crashMultiplier, crashAtMs });
      return;
    }
    if (now < timing.crashAtMs) return; // still flying — no crash yet

    // CRASH: the pre-determined point is reached. Settle ALL bets in the SAME
    // transaction as the round transition (atomic crash + settlement).
    assertRoundTransition('RUNNING', 'CRASHED');
    await db.crashRound.update({
      where: { id: round.id, status: 'RUNNING' },
      data: {
        status: 'CRASHED',
        crashAt: new Date(timing.crashAtMs),
        crashMultiplier: timing.crashMultiplier,
        crashedAt: new Date(now),
        // Provably fair reveal — safe to publish ONLY now.
        serverSeed: decryptServerSeed(round.crashPointSeedEnc),
      },
    });
    this.running.delete(round.id);

    const bets = (await db.crashBet.findMany({
      where: { roundId: round.id, status: 'ACTIVE' },
    })) as unknown as CrashBetSettleRow[];

    const crashMultiplier = timing.crashMultiplier;
    for (const bet of bets) {
      // REAL_MONEY: settle the RESERVED stake in the SAME transaction as the
      // LOST transition (locked -= stake, BET_STAKE PENDING -> COMPLETED, one
      // ledger entry) — a lost stake is CAPTURED, never refunded, and can never
      // stay locked after the round settles. Exactly-once: the capture is a
      // guarded transition, so a retried crash tick consumes nothing twice.
      const stakeTransactionId =
        this.config.mode === 'REAL_MONEY'
          ? await this.captureLostStakeInTx(db, bet)
          : null;
      // Unsettled bet at crash → LOST according to the game rules. The stake
      // was already debited at placement; NO payout, idempotent by unique key.
      await db.crashBet.update({
        where: { id: bet.id, status: 'ACTIVE' },
        data: { status: 'LOST', settledAt: new Date(now) },
      });
      await db.crashSettlement.create({
        data: {
          roundId: round.id,
          betId: bet.id,
          userId: bet.userId,
          result: 'LOST',
          stake: bet.stake,
          cashoutMultiplier: null,
          payout: 0,
          // The wallet movement that consumed the stake (REAL_MONEY audit anchor).
          transactionId: stakeTransactionId,
          idempotencyKey: `settle:${bet.idempotencyKey}`,
        },
      });
    }

    await db.crashRound.update({
      where: { id: round.id, status: 'CRASHED' },
      data: { status: 'SETTLED', settledAt: new Date(now) },
    });

    this.events.emit(CRASH_ROOM, 'ROUND_CRASHED', {
      roundId: round.id,
      roundNumber: round.roundNumber,
      crashMultiplier,
      crashAt: timing.crashAtMs,
      serverSeedHash: round.serverSeedHash,
      serverTime: now,
    });
    this.events.emit(CRASH_ROOM, 'ROUND_SETTLED', {
      roundId: round.id,
      roundNumber: round.roundNumber,
      settledAt: now,
      serverTime: now,
    });
    // The round is CRASHED + SETTLED at this point (same transaction) and the
    // multiplier has already been published to clients, so recording it here is
    // safe — this is a POST-crash log, never a pre-round one.
    this.logger.log(`Round #${round.roundNumber} crashed at ${crashMultiplier.toFixed(2)}×`);
  }


  /**
   * Captures the RESERVED stake of a LOST bet — REAL_MONEY only, inside the
   * crash transaction.
   *
   * Placement reserved the stake (available -> locked). A loss CONSUMES it
   * through the canonical WalletService.captureStakeInTx: locked -= stake, the
   * WalletTransaction becomes COMPLETED and exactly one ledger entry
   * (BET_STAKE_CAPTURED) records it. The stake is genuinely gone (a loss is NOT
   * a refund), and lockedBalance is never left holding it.
   *
   * IDEMPOTENCY: the capture is a guarded PENDING -> COMPLETED transition, so a
   * retried tick (or a duplicate crash transition) can never consume the stake
   * twice and can never capture a reservation that was already RELEASED.
   *
   * A missing reservation means nothing was ever locked for that bet (nothing to
   * capture): the bet still settles as a plain loss, and the round can always
   * finish. Returns the wallet transaction id for the settlement row.
   */
  private async captureLostStakeInTx(
    db: Prisma.TransactionClient,
    bet: CrashBetSettleRow,
  ): Promise<string | null> {
    const reservation = await this.wallet.findTransaction(bet.userId, bet.idempotencyKey);
    if (!reservation) {
      this.logger.warn(
        `Bet ${bet.id} settled as LOST without a stake reservation to capture — no funds were locked`,
      );
      return null;
    }
    const captured = await this.wallet.captureStakeInTx(db, bet.userId, bet.idempotencyKey);
    return captured?.id ?? null;
  }

  // --------------------------------------------------------------------------
  // Safe void — refunds every unsettled bet, finalizes the round immutably
  // --------------------------------------------------------------------------

  /**
   * A round whose pre-determined crash point cannot be recovered (seed lost,
   * encryption key rotated) NEVER runs with an invented result. Every
   * unsettled bet is refunded (stake returned, settlement REFUNDED) and the
   * round is finalized as SETTLED with crashMultiplier NULL — immutable,
   * auditable, and financially consistent.
   */
  private async voidRoundSafely(round: CrashRoundRow): Promise<void> {
    const now = Date.now();
    const fresh = (await this.prisma.crashRound.findUniqueOrThrow({
      where: { id: round.id },
    })) as unknown as CrashRoundRow;

    const bets = (await this.prisma.crashBet.findMany({
      where: { roundId: fresh.id, status: 'ACTIVE' },
    })) as unknown as CrashBetSettleRow[];

    for (const bet of bets) {
      await this.refundVoidedStake(bet);
      await this.prisma.crashBet.update({
        where: { id: bet.id },
        data: { status: 'REFUNDED', settledAt: new Date(now) },
      });
    }

    await this.prisma.crashRound.update({
      where: { id: fresh.id, status: fresh.status },
      data: { status: 'SETTLED', settledAt: new Date(now) },
    });
    this.running.delete(fresh.id);

    this.events.emit(CRASH_ROOM, 'ROUND_CRASHED', {
      roundId: fresh.id,
      roundNumber: fresh.roundNumber,
      crashMultiplier: null,
      crashAt: now,
      serverTime: now,
      voided: true,
    });
    this.logger.warn(`Round #${fresh.roundNumber} voided safely — refunds issued`);
  }

  /**
   * Refunds ONE unsettled bet whose round was VOIDED — through the wallet of the
   * mode that is actually ACTIVE, so a void can never move the wrong money:
   *
   *  - FREE_PLAY: credit free-play points via CrashFreePlayWallet ONLY. Points
   *    are not money: WalletService / Wallet / WalletTransaction / LedgerEntry
   *    are never touched on this path (isolation is preserved).
   *
   *  - REAL_MONEY: release the stake RESERVATION through the canonical
   *    WalletService.releaseStake(...) operation — the same mechanism the
   *    betting and casino flows use when a reserved stake must not be captured.
   *    CrashService.placeBet reserves the stake (available -= stake,
   *    locked += stake, WalletTransaction PENDING) inside its own transaction
   *    and NEVER captures at placement, so releasing the reservation is the
   *    exact inverse: locked funds return to available, the transaction becomes
   *    REVERSED and one ledger entry records it (reason BET_STAKE_RELEASED).
   *    Afterwards locked is not left dangling and available is not inflated.
   *    FREEPLAY points are NOT credited on this path.
   *
   *    WHY RELEASE IS STILL THE CORRECT INVERSE (capture-at-settlement): a stake
   *    is captured only together with the bet's TERMINAL status flip — by
   *    CrashService.cashOut (CASHED_OUT, together with the payout credit) or by
   *    CrashRoundEngine.maybeCrashInTx (LOST). Every bet that is still ACTIVE
   *    therefore still holds a PENDING reservation, and this path only ever sees
   *    ACTIVE bets. A reservation that already reached a terminal state
   *    (COMPLETED / REVERSED) is never touched by releaseStake, so a void can
   *    never refund an already consumed (lost or won) stake and never credits a
   *    second time.
   *
   * IDEMPOTENCY: the refund is keyed by the bet's own idempotency key (the same
   * key the reservation was made under), and releaseStake no-ops unless the
   * reservation is still PENDING. A retried scheduler tick therefore cannot
   * refund twice, and the balance invariants (available/locked ≥ 0) are held by
   * the wallet's own row lock inside the ledger engine (the guarded
   * PENDING -> REVERSED transition).
   */
  private async refundVoidedStake(bet: CrashBetSettleRow): Promise<void> {
    if (this.config.mode === 'FREE_PLAY') {
      await this.freeWallet.credit(
        bet.userId,
        bet.stake,
        'BET_REFUND',
        `refund:${bet.idempotencyKey}`,
        { type: 'CRASH_SETTLEMENT', id: bet.id },
      );
      return;
    }
    // REAL_MONEY: release the PENDING stake reservation (idempotent).
    await this.wallet.releaseStake(bet.userId, bet.idempotencyKey);
  }

  // --------------------------------------------------------------------------
  // Real-time multiplier broadcast — derived from SERVER data only
  // --------------------------------------------------------------------------

  private async broadcastMultiplier(): Promise<void> {
    if (!this.config.enabled) return;
    try {
      const round = (await this.prisma.crashRound.findFirst({
        where: { gameSlug: this.config.gameSlug, status: { in: ACTIVE_ROUND_STATUSES } },
        orderBy: { roundNumber: 'desc' },
      })) as unknown as CrashRoundRow | null;
      if (!round) return;

      const now = Date.now();
      const payload: Record<string, unknown> = {
        roundId: round.id,
        roundNumber: round.roundNumber,
        state: round.status,
        serverTime: now,
        startAt: round.startAt.getTime(),
        bettingCloseAt: round.bettingCloseAt.getTime(),
        // Operator-sequence context (phase + consumed position only — never
        // future multipliers). Clients render it as a passive badge.
        sequenceMode: round.sequenceMode,
        sequenceIndex: round.sequenceIndex,
      };

      if (round.status === 'RUNNING') {
        const timing = this.running.get(round.id);
        if (timing) {
          payload.multiplier = multiplierAt(
            {
              startAtMs: round.startAt.getTime(),
              crashAtMs: timing.crashAtMs,
              crashMultiplier: timing.crashMultiplier,
            },
            now,
          );
        }
      }
      this.events.emit(CRASH_ROOM, 'MULTIPLIER_UPDATE', payload);
    } catch (error) {
      this.logger.error(
        `Crash engine broadcast failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

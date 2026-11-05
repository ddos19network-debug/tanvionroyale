/**
 * TANVION ROYALE — Sky Rocket crash game service (server-authoritative).
 *
 * Every client-visible value comes from the database or the CrashRoundEngine:
 *  - the multiplier a cash-out is ACCEPTED at is computed from the server clock
 *  - the crash point was fixed BEFORE betting opened (provably fair)
 *  - wallet mutations are ledger-based and idempotent
 *  - cash-out races with the crash transition are serialized by row locks
 */

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma';
import type { CrashGameMode } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { WalletService, type StakeReservation } from '../wallet/wallet.service';
import { CrashRoundEngine } from './crash-round-engine';
import { CrashFreePlayWalletService } from './crash-freeplay-wallet.service';
import { CrashSequenceService } from './crash-sequence.service';
import { CrashEventBus, CRASH_ROOM } from './crash-events';
import { loadCrashConfig, type CrashConfig } from './crash.config';
import { crashError } from './crash-errors';
import { cashoutMultiplierAt, cashoutPayout, multiplierAt } from './crash-math';
import { verifyCrashRound } from './provably-fair';
import { maskUsername } from './crash.types';
import { CashOutCrashBetDto, PlaceCrashBetDto } from './dto/crash.dto';
import type {
  AnonymizedLiveBet,
  CrashBetRow,
  CrashBetView,
  CrashHistoryEntry,
  CrashPlayerHistoryEntry,
  CrashRoundRow,
  CrashRoundView,
  CrashSnapshotView,
  CrashVerificationView,
} from './crash.types';

@Injectable()
export class CrashService {
  private readonly logger = new Logger(CrashService.name);
  private readonly config: CrashConfig = loadCrashConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: CrashRoundEngine,
    private readonly events: CrashEventBus,
    private readonly freeWallet: CrashFreePlayWalletService,
    private readonly wallet: WalletService,
    private readonly sequence: CrashSequenceService,
  ) {}

  // --------------------------------------------------------------------------
  // Views (never leak the unrevealed seed, other users' identities, balances)
  // --------------------------------------------------------------------------



  private toRoundView(row: CrashRoundRow): CrashRoundView {
    const now = Date.now();
    const timing = this.engine.getRunningTiming(row.id);
    const crashed =
      row.status === 'CRASHED' || row.status === 'SETTLED' || row.status === 'COMPLETED';
    return {
      id: row.id,
      gameSlug: row.gameSlug,
      mode: row.mode,
      status: row.status,
      roundNumber: row.roundNumber,
      startAt: row.startAt.toISOString(),
      startedAt: row.bettingClosedAt?.toISOString() ?? null,
      bettingCloseAt: row.bettingCloseAt.toISOString(),
      crashAt: row.crashAt?.toISOString() ?? null,
      crashMultiplier: row.crashMultiplier,
      serverSeedHash: row.serverSeedHash,
      clientSeed: row.clientSeed,
      nonce: row.nonce,
      algorithmVersion: row.algorithmVersion,
      crashSource: row.crashSource,
      sequenceMode: row.sequenceMode,
      sequenceIndex: row.sequenceIndex,
      bettingOpen: row.status === 'BETTING_OPEN' && now < row.bettingCloseAt.getTime(),
      serverTime: new Date(now).toISOString(),
      currentMultiplier:
        row.status === 'RUNNING' && timing
          ? multiplierAt(
              {
                startAtMs: row.startAt.getTime(),
                crashAtMs: timing.crashAtMs,
                crashMultiplier: timing.crashMultiplier,
              },
              now,
            )
          : null,
      revealedSeed: crashed ? row.serverSeed : null,
      crashed,
    };
  }

  private toBetView(bet: CrashBetRow, roundNumber: number): CrashBetView {
    return {
      id: bet.id,
      roundId: bet.roundId,
      roundNumber,
      mode: bet.mode,
      stake: bet.stake,
      currency: bet.currency,
      status: bet.status,
      cashoutMultiplier: bet.cashoutMultiplier,
      payout: bet.payout,
      result: bet.settlement?.result ?? null,
      placedAt: bet.placedAt.toISOString(),
      cashoutAt: bet.cashoutAt?.toISOString() ?? null,
      settledAt: bet.settledAt?.toISOString() ?? null,
    };
  }

  // ------------------------------------------------------------------------
  // Snapshot / history / live feed
  // ------------------------------------------------------------------------

  async getSnapshot(userId?: string): Promise<CrashSnapshotView> {
    const [round, lastCrash] = await Promise.all([
      this.prisma.crashRound.findFirst({
        where: {
          gameSlug: this.config.gameSlug,
          status: { in: ['CREATED', 'BETTING_OPEN', 'RUNNING'] },
        },
        orderBy: { roundNumber: 'desc' },
      }) as unknown as Promise<CrashRoundRow | null>,
      this.prisma.crashRound.findFirst({
        where: {
          gameSlug: this.config.gameSlug,
          crashMultiplier: { not: null },
          status: { in: ['SETTLED', 'COMPLETED'] },
        },
        orderBy: { roundNumber: 'desc' },
      }) as unknown as Promise<CrashRoundRow | null>,
    ]);

    let myBet: CrashBetView | null = null;
    let myBets: CrashBetView[] = [];
    if (userId && round) {
      const bets = (await this.prisma.crashBet.findMany({
        where: { roundId: round.id, userId },
        orderBy: { placedAt: 'asc' },
      })) as unknown as (CrashBetRow & { settlement?: CrashBetRow['settlement'] })[];
      myBets = bets.map((b) => this.toBetView(b, round.roundNumber));
      myBet = myBets[myBets.length - 1] ?? null;
    }

    return {
      gameSlug: this.config.gameSlug,
      mode: this.config.mode,
      enabled: this.config.enabled,
      realMoneyAvailable: this.config.realMoneyAvailable,
      round: round ? this.toRoundView(round) : null,
      myBet,
      myBets,
      sequence: await this.sequence.getPublicView(this.config.gameSlug),
      lastCrash:
        lastCrash && lastCrash.crashMultiplier != null
          ? {
              roundId: lastCrash.id,
              roundNumber: lastCrash.roundNumber,
              crashMultiplier: lastCrash.crashMultiplier,
              crashedAt: (
                lastCrash.crashedAt ?? lastCrash.settledAt ?? lastCrash.startAt
              ).toISOString(),
              mode: lastCrash.mode,
            }
          : null,
      config: {
        minStake: this.config.minStake,
        maxStake: this.config.maxStake,
        currency: this.config.mode === 'FREE_PLAY' ? 'FREEPLAY' : this.config.currency,
        bettingDurationMs: this.config.bettingDurationMs,
        nextRoundDelayMs: this.config.nextRoundDelayMs,
      },
    };
  }

  /** Public previous-crash multipliers (no private data). */
  async getPublicHistory(limit = 20): Promise<CrashHistoryEntry[]> {
    const rows = (await this.prisma.crashRound.findMany({
      where: {
        gameSlug: this.config.gameSlug,
        crashMultiplier: { not: null },
        status: { in: ['SETTLED', 'COMPLETED'] },
      },
      orderBy: { roundNumber: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    })) as unknown as CrashRoundRow[];
    return rows.map((r) => ({
      roundId: r.id,
      roundNumber: r.roundNumber,
      crashMultiplier: r.crashMultiplier as number,
      crashedAt: (r.crashedAt ?? r.settledAt ?? r.startAt).toISOString(),
      mode: r.mode,
    }));
  }

  /** Anonymized live bet list for the current round (privacy-safe). */
  async getLiveBets(roundId: string): Promise<{ roundId: string; bets: AnonymizedLiveBet[] }> {
    const bets = (await this.prisma.crashBet.findMany({
      where: { roundId },
      orderBy: { stake: 'desc' },
      take: 100,
      include: { user: { select: { username: true } } },
    })) as unknown as (CrashBetRow & { user?: { username?: string } })[];
    return {
      roundId,
      bets: bets.map((b) => ({
        player: maskUsername(b.user?.username ?? 'player'),
        stake: b.stake,
        cashoutMultiplier: b.cashoutMultiplier,
        payout: b.payout,
        cashedOut: b.status === 'CASHED_OUT',
      })),
    };
  }

  async getMyBet(userId: string, betId: string): Promise<CrashBetView> {
    const bet = (await this.prisma.crashBet.findUnique({
      where: { id: betId },
      include: {
        round: { select: { roundNumber: true } },
        settlement: true,
      },
    })) as unknown as (CrashBetRow & { round: { roundNumber: number } }) | null;
    if (!bet) crashError('BET_NOT_FOUND', 'Bet not found', 404);
    if (bet.userId !== userId) crashError('BET_NOT_YOURS', 'This bet belongs to another player', 403);
    return this.toBetView(bet, bet.round.roundNumber);
  }

  async findActiveBetForUser(userId: string): Promise<CrashBetRow | null> {
    const bet = await this.prisma.crashBet.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        round: { status: 'RUNNING' },
      },
      orderBy: { placedAt: 'desc' },
    });
    return bet as unknown as CrashBetRow | null;
  }

  async getMyHistory(userId: string, limit = 25, mode?: string): Promise<CrashPlayerHistoryEntry[]> {
    const rows = (await this.prisma.crashBet.findMany({
      where: { userId, mode: (mode ?? this.config.mode) as CrashGameMode },
      orderBy: { placedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      include: { round: { select: { roundNumber: true } }, settlement: true },
    })) as unknown as (CrashBetRow & { round: { roundNumber: number } })[];
    return rows.map((b) => ({
      roundNumber: b.round.roundNumber,
      createdAt: b.placedAt.toISOString(),
      stake: b.stake,
      currency: b.currency,
      status: b.status,
      result: b.settlement?.result ?? null,
      cashoutMultiplier: b.cashoutMultiplier,
      payout: b.payout,
    }));
  }

  /**
   * Fairness verification — source-honest:
   *  - PROVABLY_FAIR rounds: recompute the crash multiplier from the REVEALED
   *    server seed (available only after the round crashed) and re-check the
   *    commitment hash. A mismatch means the round was tampered with.
   *  - CONFIGURED (operator sequence) rounds: the multiplier was set by the
   *    persisted sequence, NOT the seed — the response says so explicitly
   *    (fairnessModel=ADMIN_SEQUENCE) instead of falsely claiming a seed
   *    derivation. Only the seed material's commitment integrity is checked.
   */
  async verifyRound(roundNumber: number): Promise<CrashVerificationView> {
    const row = (await this.prisma.crashRound.findUnique({
      where: { gameSlug_roundNumber: { gameSlug: this.config.gameSlug, roundNumber } },
    })) as unknown as CrashRoundRow | null;
    if (!row) crashError('ROUND_NOT_FOUND', 'Round not found', 404);
    if (!row.serverSeed || row.crashMultiplier == null) {
      crashError('ROUND_NOT_ACTIVE', 'Round not finished — seed is not revealed yet', 409);
    }
    const { commitmentHash, hashHex, crashMultiplier } = verifyCrashRound(
      row.serverSeed,
      row.clientSeed,
      row.nonce,
    );
    const commitmentValid = commitmentHash === row.serverSeedHash;

    if (row.crashSource === 'CONFIGURED') {
      return {
        roundId: row.id,
        roundNumber: row.roundNumber,
        serverSeedHash: row.serverSeedHash,
        serverSeed: row.serverSeed,
        clientSeed: row.clientSeed,
        nonce: row.nonce,
        algorithmVersion: row.algorithmVersion,
        crashMultiplier: row.crashMultiplier,
        derivedCommitmentHash: commitmentHash,
        derivedHash: hashHex,
        derivedMultiplier: crashMultiplier,
        // Integrity of the seed material only — the multiplier was NOT
        // derived from it, so no seed-match is claimed here.
        verified: commitmentValid,
        crashSource: 'CONFIGURED',
        fairnessModel: 'ADMIN_SEQUENCE',
        note:
          'This round’s crash multiplier was predetermined by the operator’s persisted sequence' +
          (row.sequenceMode && row.sequenceIndex
            ? ` (position ${row.sequenceMode} #${row.sequenceIndex})`
            : '') +
          '. The seed commitment/reveal is retained for round-integrity auditing but does NOT determine the outcome.',
        sequenceMode: row.sequenceMode,
        sequenceIndex: row.sequenceIndex,
      };
    }

    return {
      roundId: row.id,
      roundNumber: row.roundNumber,
      serverSeedHash: row.serverSeedHash,
      serverSeed: row.serverSeed,
      clientSeed: row.clientSeed,
      nonce: row.nonce,
      algorithmVersion: row.algorithmVersion,
      crashMultiplier: row.crashMultiplier,
      derivedCommitmentHash: commitmentHash,
      derivedHash: hashHex,
      derivedMultiplier: crashMultiplier,
      verified:
        commitmentValid &&
        Math.abs(crashMultiplier - row.crashMultiplier) < 0.005,
      crashSource: 'PROVABLY_FAIR',
      fairnessModel: 'HMAC_SHA256_COMMIT_REVEAL',
      note:
        'The crash multiplier is deterministically derived from HMAC-SHA256(serverSeed, clientSeed:nonce) — reproducible from the revealed seed.',
      sequenceMode: row.sequenceMode,
      sequenceIndex: row.sequenceIndex,
    };
  }

  // ------------------------------------------------------------------------
  // Bet placement — atomic: eligibility + debit + bet + audit in ONE tx
  // ------------------------------------------------------------------------

  async placeBet(user: AuthenticatedUser, dto: PlaceCrashBetDto): Promise<CrashBetView> {
    if (!this.config.enabled) {
      crashError('GAME_DISABLED', 'Sky Rocket is currently unavailable', 503);
    }

    const idempotencyKey = dto.clientRequestId ?? randomUUID();

    // Fast duplicate return — the DB unique constraint stays the hard gate.
    const duplicate = (await this.prisma.crashBet.findUnique({
      where: { userId_idempotencyKey: { userId: user.id, idempotencyKey } },
      include: { round: { select: { roundNumber: true } } },
    })) as unknown as (CrashBetRow & { round: { roundNumber: number } }) | null;
    if (duplicate) return this.toBetView(duplicate, duplicate.round.roundNumber);

    if (dto.stake < this.config.minStake || dto.stake > this.config.maxStake) {
      crashError(
        'INVALID_STAKE',
        `Stake must be between ${this.config.minStake} and ${this.config.maxStake}`,
        400,
      );
    }
    if (this.config.mode === 'REAL_MONEY' && !this.config.realMoneyAvailable) {
      crashError('REAL_MONEY_UNAVAILABLE', 'Real-money play is not enabled on this deployment', 403);
    }

    const placed = await this.prisma
      .$transaction(async (db) => {
      const round = (await db.crashRound.findFirst({
        where: {
          gameSlug: this.config.gameSlug,
          status: { in: ['CREATED', 'BETTING_OPEN', 'RUNNING'] },
        },
        orderBy: { roundNumber: 'desc' },
      })) as unknown as CrashRoundRow | null;
      if (!round) crashError('ROUND_NOT_ACTIVE', 'No round is accepting bets right now', 409);

      // Row lock serializes this placement against the crash transition.
      await db.$queryRaw`SELECT id FROM "CrashRound" WHERE id = ${round.id} FOR UPDATE`;

      const now = Date.now();
      if (round.status !== 'BETTING_OPEN' || now >= round.bettingCloseAt.getTime()) {
        crashError('BETTING_CLOSED', 'The betting window is closed — waiting for the next round', 409);
      }

      // Real-money eligibility: platform status + KYC (free play is open).
      if (this.config.mode === 'REAL_MONEY') {
        const dbUser = (await db.user.findUnique({
          where: { id: user.id },
          select: { status: true, kycStatus: true },
        })) as { status: string; kycStatus: string } | null;
        if (!dbUser || dbUser.status !== 'ACTIVE') {
          crashError('FORBIDDEN', 'Account is not eligible to place real-money bets', 403);
        }
        if (dbUser.kycStatus !== 'VERIFIED') {
          crashError('FORBIDDEN', 'Identity verification is required for real-money play', 403);
        }
      }

      // Debit the stake in the SAME transaction that creates the bet —
      // wallet debited without a bet (or vice versa) is impossible.
      let reservation: StakeReservation | null = null;
      if (this.config.mode === 'FREE_PLAY') {
        await this.freeWallet.getOrCreateWalletInTx(db, user.id);
        await this.freeWallet.debitInTx(db, user.id, dto.stake, idempotencyKey, {
          type: 'CRASH_BET',
          id: round.id,
        });
      } else {
        // REAL_MONEY canonical stake lifecycle (one reservation, one terminal
        // outcome — see cashOut / CrashRoundEngine):
        //   reserveStakeInTx -> available -= stake, locked += stake (PENDING)
        //   cash out         -> captureStakeInTx + BET_PAYOUT credit (win)
        //   crash / loss     -> captureStakeInTx (stake consumed, no payout)
        //   void / cancel    -> releaseStake (locked back to available)
        // Reserving INSIDE this transaction is what keeps the stake atomic with
        // the bet that owns it: a failed placement rolls the reservation back
        // with it, so locked funds can never be left behind without a bet.
        reservation = await this.wallet.reserveStakeInTx(
          db,
          user.id,
          dto.stake,
          this.config.currency,
          idempotencyKey,
        );
      }

      const bet = (await db.crashBet.create({
        data: {
          roundId: round.id,
          userId: user.id,
          mode: this.config.mode,
          stake: dto.stake,
          currency: this.config.mode === 'FREE_PLAY' ? 'FREEPLAY' : this.config.currency,
          status: 'ACTIVE',
          idempotencyKey,
          placedAt: new Date(now),
          // REAL_MONEY: the wallet transaction holding the reserved stake —
          // the audit/recovery anchor of the stake lifecycle. Null in FREE_PLAY
          // (points live in the free-play ledger).
          transactionId: reservation?.transactionId ?? null,
        },
      })) as unknown as CrashBetRow;

      await db.gameAuditLog.create({
        data: {
          gameSlug: this.config.gameSlug,
          roundId: round.id,
          betId: bet.id,
          userId: user.id,
          action: 'BET_PLACED',
          metadata: { stake: dto.stake, mode: this.config.mode, currency: bet.currency },
        },
      });

      return { bet, round };
    })
      .catch(async (error: unknown) => {
        // A concurrent duplicate of the SAME request (same clientRequestId) lost
        // the unique (userId, idempotencyKey) race. The winner's bet is the
        // authoritative result, and the wallet movement is idempotent by that
        // very key, so the loser reserved nothing: return the winner instead of
        // surfacing a conflict.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const winner = (await this.prisma.crashBet.findUnique({
            where: { userId_idempotencyKey: { userId: user.id, idempotencyKey } },
            include: { round: { select: { roundNumber: true } } },
          })) as unknown as (CrashBetRow & { round: { roundNumber: number } }) | null;
          if (winner) {
            return { duplicateView: this.toBetView(winner, winner.round.roundNumber) };
          }
        }
        throw error;
      });

    if ('duplicateView' in placed) return placed.duplicateView;
    const { bet, round } = placed;

    this.events.emit(CRASH_ROOM, 'PLAYER_BET_UPDATE', {
      roundId: round.id,
      roundNumber: round.roundNumber,
      betId: bet.id,
      stake: bet.stake,
      currency: bet.currency,
      serverTime: Date.now(),
    });

    return this.toBetView(bet, round.roundNumber);
  }

  // ------------------------------------------------------------------------
  // Cash-out — server decides the accepted multiplier; crash-safe by locks
  // ------------------------------------------------------------------------

  async cashOut(
    user: AuthenticatedUser,
    betId: string,
    dto?: CashOutCrashBetDto,
  ): Promise<CrashBetView> {
    const idempotencyKey = dto?.clientRequestId ?? randomUUID();

    const existing = (await this.prisma.crashBet.findUnique({
      where: { id: betId },
      include: { round: { select: { roundNumber: true } }, settlement: true },
    })) as unknown as (CrashBetRow & { round: { roundNumber: number } }) | null;
    if (!existing) crashError('BET_NOT_FOUND', 'Bet not found', 404);
    if (existing.userId !== user.id) {
      crashError('BET_NOT_YOURS', 'This bet belongs to another player', 403);
    }

    // Already settled? Return the authoritative result (idempotent retry).
    if (existing.settlement || existing.status !== 'ACTIVE') {
      return this.toBetView(existing, existing.round.roundNumber);
    }

    const result = await this.prisma.$transaction(async (db) => {
      const bet = (await db.crashBet.findUnique({ where: { id: betId } })) as unknown as
        | CrashBetRow
        | null;
      if (!bet) crashError('BET_NOT_FOUND', 'Bet not found', 404);
      if (bet.userId !== user.id) {
        crashError('BET_NOT_YOURS', 'This bet belongs to another player', 403);
      }

      // Lock the round row FIRST: serializes against the engine's crash
      // transaction so only one of {cash-out, crash} can be first.
      await db.$queryRaw`SELECT id FROM "CrashRound" WHERE id = ${bet.roundId} FOR UPDATE`;

      const round = (await db.crashRound.findUnique({
        where: { id: bet.roundId },
      })) as unknown as CrashRoundRow;
      if (round.status !== 'RUNNING') {
        crashError('ROUND_CRASHED', 'The round is no longer running', 409);
      }

      // Re-read the ACTIVE bet AFTER acquiring the round lock.
      const fresh = (await db.crashBet.findUnique({ where: { id: betId } })) as unknown as
        | CrashBetRow
        | null;
      if (!fresh || fresh.status !== 'ACTIVE') {
        if (fresh?.status === 'CASHED_OUT') return { bet: fresh, multiplier: fresh.cashoutMultiplier as number };
        crashError('BET_NOT_ACTIVE', 'This bet is already settled', 409);
      }

      // SERVER-authoritative acceptance point, sampled AFTER the round lock.
      const timing = this.engine.getRunningTiming(round.id);
      if (!timing) {
        crashError('ROUND_CRASHED', 'The round is no longer running', 409);
      }
      const acceptedAt = Date.now();
      if (acceptedAt >= timing.crashAtMs) {
        crashError('ROUND_CRASHED', 'The round crashed before the cash-out was accepted', 409);
      }
      // The client NEVER chooses this value.
      const multiplier = cashoutMultiplierAt(
        {
          startAtMs: round.startAt.getTime(),
          crashAtMs: timing.crashAtMs,
          crashMultiplier: timing.crashMultiplier,
        },
        acceptedAt,
      );
      const payout = cashoutPayout(fresh.stake, multiplier);
      if (payout <= 0) {
        crashError('ROUND_CRASHED', 'The round crashed before the cash-out was accepted', 409);
      }

      // Conditional state flip — the guard makes double payout impossible.
      const updated = await db.crashBet.updateMany({
        where: { id: fresh.id, status: 'ACTIVE' },
        data: {
          status: 'CASHED_OUT',
          cashoutMultiplier: multiplier,
          payout,
          cashoutAt: new Date(acceptedAt),
        },
      });
      if (updated.count !== 1) {
        crashError('BET_NOT_ACTIVE', 'This bet is already settled', 409);
      }

      // Settle the money in the SAME transaction (bet won ⇒ wallet credited).
      let stakeTransactionId: string | null = null;
      if (this.config.mode === 'FREE_PLAY') {
        await this.freeWallet.creditInTx(
          db,
          user.id,
          payout,
          'BET_PAYOUT',
          `cashout:${fresh.idempotencyKey}`,
          { type: 'CRASH_BET', id: fresh.id },
        );
      } else {
        // REAL_MONEY win — TWO canonical wallet steps, in this order:
        //   1. captureStakeInTx: the RESERVED stake is resolved
        //      (locked -= stake, BET_STAKE PENDING -> COMPLETED, one ledger
        //      entry). Without it the stake would stay locked forever while the
        //      payout is credited.
        //   2. settleBetCredit: the gross payout is credited
        //      (available += payout, BET_PAYOUT COMPLETED, one ledger entry).
        // Net effect for a winning stake: available = A - stake + payout,
        // locked = L (exactly the pre-bet lock level). Both steps are
        // exactly-once and run inside the caller's transaction, so the wallet
        // can never hold the stake locked while the payout is credited.
        const captured = await this.wallet.captureStakeInTx(
          db,
          user.id,
          fresh.idempotencyKey,
        );
        stakeTransactionId = captured?.id ?? null;
        await this.wallet.settleBetCredit(
          db,
          user.id,
          payout,
          this.config.currency,
          'BET_PAYOUT',
          `win:${fresh.idempotencyKey}`,
          'CRASH_CASHOUT',
        );
      }

      await db.crashSettlement.create({
        data: {
          roundId: round.id,
          betId: fresh.id,
          userId: user.id,
          result: 'CASHED_OUT',
          stake: fresh.stake,
          cashoutMultiplier: multiplier,
          payout,
          // The wallet movement that resolved the stake (REAL_MONEY audit anchor).
          transactionId: stakeTransactionId,
          idempotencyKey,
        },
      });
      await db.gameAuditLog.create({
        data: {
          gameSlug: this.config.gameSlug,
          roundId: round.id,
          betId: fresh.id,
          userId: user.id,
          action: 'CASH_OUT',
          metadata: { multiplier, payout, serverAcceptedAt: acceptedAt },
        },
      });
      return { bet: { ...fresh, status: 'CASHED_OUT', cashoutMultiplier: multiplier, payout } as CrashBetRow, multiplier };
    });

    this.events.emit(CRASH_ROOM, 'PLAYER_CASHOUT', {
      roundId: existing.roundId,
      roundNumber: existing.round.roundNumber,
      betId,
      cashoutMultiplier: result.multiplier,
      payout: result.bet.payout,
      serverTime: Date.now(),
    });

    return this.toBetView(result.bet, existing.round.roundNumber);
  }
}

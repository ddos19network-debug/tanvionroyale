import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma';
import type { RoyaleMinesRound } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { WalletService } from '../wallet/wallet.service';
import { CrashFreePlayWalletService } from '../crash/crash-freeplay-wallet.service';
import { loadRoyaleConfig, type RoyaleConfig } from './royale.config';
import { royaleError } from './royale.errors';
import { RoyaleEligibilityService } from './royale-eligibility.service';
import {
  computeSeedHash,
  decryptRoundSeed,
  deriveMinesPositions,
  encryptRoundSeed,
  generateClientSeed,
  generateServerSeed,
  verifyMinesRound,
} from './royale-fair';
import { minesMultiplierBp, payoutFor, validateMinesBoard, validateStake } from './royale-math';
import { FREEPLAY_CURRENCY } from './royale-plinko.service';
import type { StartMinesDto } from './dto/royale.dto';

export const MINES_GAME_SLUG = 'royale-mines';

/** Public view. NEVER contains serverSeedEnc — seed/mines appear only after settlement. */
export interface RoyaleMinesRoundView {
  id: string;
  gameSlug: typeof MINES_GAME_SLUG;
  mode: 'FREE_PLAY' | 'REAL_MONEY';
  status: 'ACTIVE' | 'CASHED_OUT' | 'BUSTED' | 'VOIDED';
  gridSize: number;
  minesCount: number;
  stake: number;
  currency: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  revealed: number[];
  safeCount: number;
  currentMultiplierBp: number;
  /** floor(stake * bp / 10000) at the current (or final) multiplier. */
  potentialPayout: number;
  payout: number | null;
  /** NULL while ACTIVE — published only at settlement. */
  serverSeed: string | null;
  /** NULL while ACTIVE — published only at settlement. */
  minesRevealed: number[] | null;
  transactionId: string | null;
  createdAt: string;
  updatedAt: string;
  settledAt: string | null;
}

export interface MinesRevealResult {
  round: RoyaleMinesRoundView;
  /** True when the picked tile was safe (false on bust/duplicate/void). */
  hit: boolean;
  /** True when this exact tile was already revealed (idempotent duplicate). */
  duplicate: boolean;
  /** True when the round settled as a VOID with a full refund this call. */
  voided: boolean;
}

/** Deterministic ledger idempotency keys, namespaced for reconciliation. */
export const minesStakeKey = (idem: string): string => `royale:mines:stake:${idem}`;
export const minesWinKey = (roundId: string): string => `royale:mines:win:${roundId}`;
export const minesBustKey = (roundId: string): string => `royale:mines:bust:${roundId}`;
export const minesVoidKey = (roundId: string): string => `royale:mines:void:${roundId}`;
export const minesSettleWinKey = (roundId: string): string => `royale:mines:settle:win:${roundId}`;
export const minesSettleBustKey = (roundId: string): string => `royale:mines:settle:bust:${roundId}`;
export const minesSettleVoidKey = (roundId: string): string => `royale:mines:settle:void:${roundId}`;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  );
}

/**
 * TANVION ROYALE — server-authoritative Mines.
 *
 * Hidden state: the mine positions are derived from a CSPRNG serverSeed that
 * is committed (SHA-256) at start, stored AES-256-GCM encrypted at rest, and
 * published ONLY at settlement. Every tile selection / cash-out runs inside a
 * transaction holding `SELECT ... FOR UPDATE` on the round row, so concurrent
 * actions serialize; terminal status flips are conditional, and settlement
 * rows + wallet keys are unique — double settlement is structurally
 * impossible. FREE_PLAY uses the ONE existing points ledger; REAL_MONEY uses
 * the ONE existing Wallet (reserve at start, capture/credit at settlement,
 * release on void).
 */
@Injectable()
export class RoyaleMinesService {
  private readonly logger = new Logger(RoyaleMinesService.name);
  private readonly config: RoyaleConfig = loadRoyaleConfig();
  /** REAL_MONEY eligibility gate — always defined (DI-injected or defaulted). */
  private readonly eligibilityService: RoyaleEligibilityService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly freeWallet: CrashFreePlayWalletService,
    eligibility?: RoyaleEligibilityService,
  ) {
    // Nest injects the shared gate in production. A directly-constructed
    // (unit-test) service builds a real gate so checks are never skipped.
    this.eligibilityService = eligibility ?? new RoyaleEligibilityService(prisma);
  }

  toView(row: RoyaleMinesRound): RoyaleMinesRoundView {
    const settled = row.status !== 'ACTIVE';
    return {
      id: row.id,
      gameSlug: MINES_GAME_SLUG,
      mode: row.mode,
      status: row.status,
      gridSize: row.gridSize,
      minesCount: row.minesCount,
      stake: row.stake,
      currency: row.currency,
      serverSeedHash: row.serverSeedHash,
      clientSeed: row.clientSeed,
      nonce: row.nonce,
      revealed: row.revealed,
      safeCount: row.revealed.length,
      currentMultiplierBp: row.currentMultiplierBp,
      potentialPayout: payoutFor(row.stake, row.currentMultiplierBp),
      payout: row.payout,
      serverSeed: settled ? row.serverSeed : null,
      // Revealed only when the round actually resolved an outcome; a VOID
      // publishes nothing (the seed could not be recovered by definition).
      minesRevealed:
        row.status === 'CASHED_OUT' || row.status === 'BUSTED' ? row.minesRevealed : null,
      transactionId: row.transactionId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      settledAt: row.settledAt?.toISOString() ?? null,
    };
  }

  /**
   * Start a round: one ACTIVE round per user (advisory lock serializes
   * concurrent starts), stake moved, mine seed committed + encrypted — all in
   * one transaction. Idempotent by (userId, clientRequestId).
   */
  async start(user: AuthenticatedUser, dto: StartMinesDto): Promise<RoyaleMinesRoundView> {
    const cfg = this.config;
    this.assertEnabled();
    try {
      validateStake(dto.stake, cfg.minStake, cfg.maxStake);
      validateMinesBoard(dto.gridSize, dto.minesCount, cfg.grids, cfg.minMines, cfg.maxMines);
    } catch (error) {
      royaleError('VALIDATION_ERROR', error instanceof Error ? error.message : 'Invalid board');
    }

    const idempotencyKey = dto.clientRequestId ?? randomUUID();
    const existing = await this.prisma.royaleMinesRound.findUnique({
      where: { userId_idempotencyKey: { userId: user.id, idempotencyKey } },
    });
    if (existing) return this.toView(existing);

    const isReal = cfg.mode === 'REAL_MONEY';
    const currency = isReal ? cfg.currency : FREEPLAY_CURRENCY;

    // REAL_MONEY eligibility gate (Task 1 / audit F1,F2,F4): status, KYC, age,
    // self-exclusion and play limits MUST pass BEFORE the reservation
    // transaction opens — a rejection creates NO round, NO ledger row and NO
    // wallet reservation. FREE_PLAY never runs this gate.
    // NOTE: only NEW stakes are gated. An already-reserved ACTIVE round is
    // deliberately NOT re-checked in reveal/cashout/forfeit, so a player who
    // becomes self-excluded mid-round can still finish and cash out — we never
    // trap money that is already in play.
    if (isReal) {
      await this.eligibilityService.assertEligibleForRealMoney(
        user.id,
        dto.stake,
        currency,
        'mines',
      );
    }

    let conflict: RoyaleMinesRound | null = null;

    try {
      conflict = await this.prisma.$transaction(async (db) => {
        // Serialize starts for THIS user across instances (Postgres advisory
        // lock): two racing starts can never both pass the ACTIVE check.
        await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`royale-mines:${user.id}`}))`;
        const active = await db.royaleMinesRound.findFirst({
          where: { userId: user.id, status: 'ACTIVE' },
        });
        if (active) return active;

        // Commit + encrypt the hidden outcome BEFORE accepting the stake.
        const serverSeed = generateServerSeed();
        const clientSeed = generateClientSeed();
        const serverSeedHash = computeSeedHash(serverSeed);
        const nonce = (await db.royaleMinesRound.count({ where: { userId: user.id } })) + 1;
        const serverSeedEnc = encryptRoundSeed(serverSeed);

        let transactionId: string | null = null;
        if (isReal) {
          const reservation = await this.wallet.reserveStakeInTx(
            db,
            user.id,
            dto.stake,
            currency,
            minesStakeKey(idempotencyKey),
          );
          transactionId = reservation.transactionId;
        }

        const round = await db.royaleMinesRound.create({
          data: {
            userId: user.id,
            mode: cfg.mode,
            status: 'ACTIVE',
            gridSize: dto.gridSize,
            minesCount: dto.minesCount,
            stake: dto.stake,
            currency,
            serverSeedHash,
            serverSeedEnc,
            clientSeed,
            nonce,
            transactionId,
            idempotencyKey,
          },
        });

        if (isReal) {
          // Reservation stays PENDING until cash-out/bust/void resolves it.
        } else {
          await this.freeWallet.debitInTx(db, user.id, dto.stake, minesStakeKey(idempotencyKey), {
            type: 'ROYALE_MINES',
            id: round.id,
          });
        }

        await db.gameAuditLog.create({
          data: {
            gameSlug: MINES_GAME_SLUG,
            roundId: round.id,
            userId: user.id,
            action: 'MINES_START',
            metadata: {
              mode: cfg.mode,
              gridSize: dto.gridSize,
              minesCount: dto.minesCount,
              stake: dto.stake,
            } as Prisma.InputJsonValue,
          },
        });
        return null;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const winner = await this.prisma.royaleMinesRound.findUnique({
          where: { userId_idempotencyKey: { userId: user.id, idempotencyKey } },
        });
        if (winner) return this.toView(winner);
      }
      throw error;
    }

    if (conflict) {
      // Another round is already in progress — hand back the SAME session so
      // the client resumes it instead of creating a second stake.
      royaleError(
        'ACTIVE_SESSION_EXISTS',
        'A Mines round is already in progress — resume or cash out that round first',
        409,
        { round: this.toView(conflict) },
      );
    }

    const round = await this.prisma.royaleMinesRound.findUnique({
      where: { userId_idempotencyKey: { userId: user.id, idempotencyKey } },
    });
    if (!round) royaleError('INTERNAL', 'Round could not be loaded after start', 503);
    this.logger.log(
      `Mines round started id=${round.id} grid=${round.gridSize} mines=${round.minesCount} mode=${round.mode}`,
    );
    return this.toView(round);
  }

  /** The player's current ACTIVE round (reconnect/restart recovery). */
  async getActive(userId: string): Promise<RoyaleMinesRoundView | null> {
    const round = await this.prisma.royaleMinesRound.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    return round ? this.toView(round) : null;
  }

  /**
   * Reveal one tile. Serialized by `FOR UPDATE` on the round row, so
   * concurrent reveals/duplicates can never double-settle. A duplicate reveal
   * of an already-revealed SAFE tile is idempotent (returns current state).
   */
  async reveal(user: AuthenticatedUser, roundId: string, tile: number): Promise<MinesRevealResult> {
    const cfg = this.config;
    this.assertEnabled();

    try {
      const outcome = await this.prisma.$transaction(async (db) => {
        // Row lock: every concurrent action on THIS round queues here.
        await db.$queryRaw`SELECT id FROM "RoyaleMinesRound" WHERE id = ${roundId} FOR UPDATE`;
        const round = await db.royaleMinesRound.findUnique({ where: { id: roundId } });
        // Ownership: a foreign or unknown round is indistinguishable (404).
        if (!round || round.userId !== user.id) {
          royaleError('ROUND_NOT_FOUND', 'Round not found', 404);
        }
        if (round.status !== 'ACTIVE') {
          royaleError('ROUND_SETTLED', 'This round has already finished', 409, {
            round: this.toView(round),
          });
        }
        if (!Number.isInteger(tile) || tile < 0 || tile >= round.gridSize) {
          royaleError('VALIDATION_ERROR', `Tile must be in [0, ${round.gridSize})`);
        }
        if (round.revealed.includes(tile)) {
          // Idempotent duplicate — no state change, no settlement.
          return { round, hit: true, duplicate: true, voided: false };
        }

        // Decrypt the committed seed. Failure => VOID (refund, never guess).
        const seed = decryptRoundSeed(round.serverSeedEnc);
        if (!seed) {
          const voided = await this.voidInTx(db, round, 'seed_unrecoverable');
          return { round: voided, hit: false, duplicate: false, voided: true };
        }
        const mines = deriveMinesPositions(
          seed,
          round.clientSeed,
          round.nonce,
          round.gridSize,
          round.minesCount,
        );

        if (mines.includes(tile)) {
          const busted = await this.bustInTx(db, round, seed, mines, {
            action: 'MINES_BUST',
            tile,
          });
          return { round: busted, hit: false, duplicate: false, voided: false };
        }

        // Safe tile: advance progression with exact BigInt multiplier math.
        const revealed = [...round.revealed, tile].sort((a, b) => a - b);
        const multiplierBp = minesMultiplierBp(
          round.gridSize,
          round.minesCount,
          revealed.length,
          cfg.rtpBp,
          cfg.maxMultiplierBp,
        );
        const updated = await db.royaleMinesRound.update({
          where: { id: round.id },
          data: { revealed, currentMultiplierBp: multiplierBp },
        });
        // Audit WITHOUT secrets: never the seed or the mine positions.
        await db.gameAuditLog.create({
          data: {
            gameSlug: MINES_GAME_SLUG,
            roundId: round.id,
            userId: user.id,
            action: 'MINES_REVEAL',
            metadata: {
              tile,
              safeCount: revealed.length,
              multiplierBp,
              potentialPayout: payoutFor(round.stake, multiplierBp),
            } as Prisma.InputJsonValue,
          },
        });
        return { round: updated, hit: true, duplicate: false, voided: false };
      });

      return {
        round: this.toView(outcome.round),
        hit: outcome.hit,
        duplicate: outcome.duplicate,
        voided: outcome.voided,
      };
    } catch (error) {
      // A concurrent terminal transition won the race — return authoritative state.
      if (isUniqueViolation(error)) {
        const current = await this.prisma.royaleMinesRound.findUnique({ where: { id: roundId } });
        if (current && current.userId === user.id) {
          return { round: this.toView(current), hit: false, duplicate: true, voided: false };
        }
      }
      throw error;
    }
  }

  /**
   * BUST (mine hit): terminal flip + publish seed/mines + resolve the stake —
   * all inside the caller's locked transaction.
   *   REAL_MONEY: captureStakeInTx (reservation PENDING -> COMPLETED, stake
   *               consumed — no payout credit on a loss).
   *   FREE_PLAY : stake was debited at start; nothing further to move.
   * The settlement row's unique (userId, idempotencyKey) is a second
   * exactly-once guard on top of the conditional status flip.
   */
  private async bustInTx(
    db: Prisma.TransactionClient,
    round: RoyaleMinesRound,
    seed: string,
    mines: number[],
    meta: { action: 'MINES_BUST'; tile: number } | { action: 'MINES_FORFEIT'; tile?: undefined },
  ): Promise<RoyaleMinesRound> {
    const updated = await db.royaleMinesRound.update({
      where: { id: round.id },
      data: {
        status: 'BUSTED',
        serverSeed: seed,
        minesRevealed: mines,
        payout: 0,
        settledAt: new Date(),
      },
    });
    if (round.mode === 'REAL_MONEY') {
      await this.wallet.captureStakeInTx(db, round.userId, minesStakeKey(round.idempotencyKey));
    }
    await db.royaleSettlement.create({
      data: {
        gameSlug: MINES_GAME_SLUG,
        roundId: round.id,
        userId: round.userId,
        result: 'MINES_BUST',
        stake: round.stake,
        payout: 0,
        multiplierBp: null,
        transactionId: round.mode === 'REAL_MONEY' ? round.transactionId : null,
        idempotencyKey: minesSettleBustKey(round.id),
      },
    });
    await db.gameAuditLog.create({
      data: {
        gameSlug: MINES_GAME_SLUG,
        roundId: round.id,
        userId: round.userId,
        action: meta.action,
        metadata: {
          ...(meta.tile !== undefined ? { tile: meta.tile } : {}),
          safeCount: round.revealed.length,
          stake: round.stake,
          mode: round.mode,
          minesCount: round.minesCount,
        } as Prisma.InputJsonValue,
      },
    });
    this.logger.log(`Mines round busted id=${round.id} via=${meta.action}`);
    return updated;
  }

  /**
   * VOID (seed unrecoverable — e.g. rotated ENCRYPTION_KEY): refund the stake
   * through the wallet of the ACTIVE mode and finish WITHOUT inventing any
   * outcome. Never pays a guessed result, never charges an invented loss.
   *   REAL_MONEY: releaseStakeInTx — the exact inverse of the reservation.
   *   FREE_PLAY : BET_REFUND credit of the stake to the points ledger.
   */
  private async voidInTx(
    db: Prisma.TransactionClient,
    round: RoyaleMinesRound,
    reason: string,
  ): Promise<RoyaleMinesRound> {
    const updated = await db.royaleMinesRound.update({
      where: { id: round.id },
      data: { status: 'VOIDED', settledAt: new Date() },
    });
    if (round.mode === 'REAL_MONEY') {
      await this.wallet.releaseStakeInTx(db, round.userId, minesStakeKey(round.idempotencyKey));
    } else {
      await this.freeWallet.creditInTx(
        db,
        round.userId,
        round.stake,
        'BET_REFUND',
        minesVoidKey(round.idempotencyKey),
        { type: 'ROYALE_MINES', id: round.id },
      );
    }
    await db.royaleSettlement.create({
      data: {
        gameSlug: MINES_GAME_SLUG,
        roundId: round.id,
        userId: round.userId,
        result: 'VOIDED',
        stake: round.stake,
        payout: round.stake, // amount returned to the player
        multiplierBp: null,
        transactionId: round.mode === 'REAL_MONEY' ? round.transactionId : null,
        idempotencyKey: minesSettleVoidKey(round.id),
      },
    });
    await db.gameAuditLog.create({
      data: {
        gameSlug: MINES_GAME_SLUG,
        roundId: round.id,
        userId: round.userId,
        action: 'MINES_VOID',
        metadata: { reason, stake: round.stake, mode: round.mode } as Prisma.InputJsonValue,
      },
    });
    this.logger.warn(`Mines round voided safely id=${round.id} reason=${reason}`);
    return updated;
  }

  /**
   * Cash out the current multiplier. Serialized by `FOR UPDATE`; an already
   * CASHED_OUT round returns its authoritative state (idempotent), every other
   * terminal state is a 409 carrying the finished round for client resync.
   * REAL_MONEY: captureStakeInTx (resolve the reservation) + settleBetCredit
   * (payout), both exactly-once by key, inside ONE transaction.
   */
  async cashout(user: AuthenticatedUser, roundId: string): Promise<MinesRevealResult> {
    this.assertEnabled();
    try {
      const outcome = await this.prisma.$transaction(async (db) => {
        await db.$queryRaw`SELECT id FROM "RoyaleMinesRound" WHERE id = ${roundId} FOR UPDATE`;
        const round = await db.royaleMinesRound.findUnique({ where: { id: roundId } });
        if (!round || round.userId !== user.id) {
          royaleError('ROUND_NOT_FOUND', 'Round not found', 404);
        }
        if (round.status === 'CASHED_OUT') {
          return { round, hit: true, settledHere: false };
        }
        if (round.status !== 'ACTIVE') {
          royaleError('ROUND_SETTLED', 'This round has already finished', 409, {
            round: this.toView(round),
          });
        }

        const seed = decryptRoundSeed(round.serverSeedEnc);
        if (!seed) {
          const voided = await this.voidInTx(db, round, 'seed_unrecoverable');
          return { round: voided, hit: false, settledHere: true };
        }
        const mines = deriveMinesPositions(
          seed,
          round.clientSeed,
          round.nonce,
          round.gridSize,
          round.minesCount,
        );
        const payout = payoutFor(round.stake, round.currentMultiplierBp);

        const updated = await db.royaleMinesRound.update({
          where: { id: round.id },
          data: {
            status: 'CASHED_OUT',
            serverSeed: seed,
            minesRevealed: mines,
            payout,
            settledAt: new Date(),
          },
        });

        if (round.mode === 'REAL_MONEY') {
          // 1. Reservation PENDING -> COMPLETED (stake consumed exactly once).
          await this.wallet.captureStakeInTx(db, round.userId, minesStakeKey(round.idempotencyKey));
          // 2. Payout credit (idempotent key — a retry can never pay twice).
          if (payout > 0) {
            await this.wallet.settleBetCredit(
              db,
              round.userId,
              payout,
              round.currency,
              'BET_PAYOUT',
              minesWinKey(round.id),
              'ROYALE_MINES_CASHOUT',
            );
          }
        } else if (payout > 0) {
          await this.freeWallet.creditInTx(
            db,
            round.userId,
            payout,
            'BET_PAYOUT',
            minesWinKey(round.id),
            { type: 'ROYALE_MINES', id: round.id },
          );
        }

        await db.royaleSettlement.create({
          data: {
            gameSlug: MINES_GAME_SLUG,
            roundId: round.id,
            userId: round.userId,
            result: 'MINES_CASHOUT',
            stake: round.stake,
            payout,
            multiplierBp: round.currentMultiplierBp,
            transactionId: round.mode === 'REAL_MONEY' ? round.transactionId : null,
            idempotencyKey: minesSettleWinKey(round.id),
          },
        });
        await db.gameAuditLog.create({
          data: {
            gameSlug: MINES_GAME_SLUG,
            roundId: round.id,
            userId: round.userId,
            action: 'MINES_CASHOUT',
            metadata: {
              safeCount: round.revealed.length,
              multiplierBp: round.currentMultiplierBp,
              stake: round.stake,
              payout,
              mode: round.mode,
            } as Prisma.InputJsonValue,
          },
        });
        this.logger.log(
          `Mines cash-out settled id=${round.id} safe=${round.revealed.length} mode=${round.mode}`,
        );
        return { round: updated, hit: true, settledHere: true };
      });
      return {
        round: this.toView(outcome.round),
        hit: outcome.hit,
        duplicate: !outcome.settledHere,
        voided: outcome.round.status === 'VOIDED',
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const current = await this.prisma.royaleMinesRound.findUnique({ where: { id: roundId } });
        if (current && current.userId === user.id) {
          return { round: this.toView(current), hit: true, duplicate: true, voided: false };
        }
      }
      throw error;
    }
  }

  /**
   * Forfeit an ACTIVE round (abandon without picking): settles as a bust via
   * the SAME locked, exactly-once path. A player may also simply disconnect —
   * round state lives in the database, so GET /mines/active resumes it.
   */
  async forfeit(user: AuthenticatedUser, roundId: string): Promise<MinesRevealResult> {
    this.assertEnabled();
    try {
      const outcome = await this.prisma.$transaction(async (db) => {
        await db.$queryRaw`SELECT id FROM "RoyaleMinesRound" WHERE id = ${roundId} FOR UPDATE`;
        const round = await db.royaleMinesRound.findUnique({ where: { id: roundId } });
        if (!round || round.userId !== user.id) {
          royaleError('ROUND_NOT_FOUND', 'Round not found', 404);
        }
        if (round.status !== 'ACTIVE') {
          return { round, settledHere: false };
        }
        const seed = decryptRoundSeed(round.serverSeedEnc);
        if (!seed) {
          const voided = await this.voidInTx(db, round, 'seed_unrecoverable');
          return { round: voided, settledHere: true };
        }
        const mines = deriveMinesPositions(
          seed,
          round.clientSeed,
          round.nonce,
          round.gridSize,
          round.minesCount,
        );
        const busted = await this.bustInTx(db, round, seed, mines, { action: 'MINES_FORFEIT' });
        return { round: busted, settledHere: true };
      });
      return {
        round: this.toView(outcome.round),
        hit: false,
        duplicate: !outcome.settledHere,
        voided: outcome.round.status === 'VOIDED',
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const current = await this.prisma.royaleMinesRound.findUnique({ where: { id: roundId } });
        if (current && current.userId === user.id) {
          return { round: this.toView(current), hit: false, duplicate: true, voided: false };
        }
      }
      throw error;
    }
  }

  /** The player's own recent rounds (ownership enforced by the userId filter). */
  async getHistory(userId: string, limit = 25): Promise<RoyaleMinesRoundView[]> {
    this.assertEnabled();
    const rows = await this.prisma.royaleMinesRound.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map((row) => this.toView(row));
  }

  /**
   * Independent verification of a SETTLED round: recomputes the commitment
   * and the mine positions from the revealed seed and compares them with the
   * published values (documented in docs/games/plinko-mines.md).
   */
  async verify(userId: string, roundId: string): Promise<Record<string, unknown>> {
    this.assertEnabled();
    const row = await this.prisma.royaleMinesRound.findUnique({ where: { id: roundId } });
    if (!row || row.userId !== userId) {
      royaleError('ROUND_NOT_FOUND', 'Round not found', 404);
    }
    if (row.status === 'ACTIVE' || !row.serverSeed) {
      royaleError(
        'ROUND_NOT_ACTIVE',
        'The round must finish (cash out, bust, or void) before its seed is revealed',
        409,
      );
    }
    const result = verifyMinesRound(
      row.serverSeed,
      row.clientSeed,
      row.nonce,
      row.gridSize,
      row.minesCount,
      row.serverSeedHash,
      row.minesRevealed,
    );
    // Sanity: no revealed safe tile may be a mine.
    const safeTilesValid = row.revealed.every((tile) => !result.positions.includes(tile));
    return {
      roundId: row.id,
      status: row.status,
      algorithm: 'HMAC_SHA256_COMMIT_REVEAL',
      algorithmNote:
        'positions = Fisher-Yates shuffle of [0,gridSize) driven by HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}:swap:${i}`); commitment = SHA-256(serverSeed).',
      serverSeedHash: row.serverSeedHash,
      derivedCommitmentHash: result.commitmentHash,
      serverSeed: row.serverSeed,
      clientSeed: row.clientSeed,
      nonce: row.nonce,
      gridSize: row.gridSize,
      minesCount: row.minesCount,
      storedMines: row.minesRevealed,
      derivedMines: result.positions,
      revealedSafeTiles: row.revealed,
      payout: row.payout,
      stake: row.stake,
      verified: result.verified && safeTilesValid,
      safeTilesValid,
    };
  }

  private assertEnabled(): void {
    if (!this.config.enabled) {
      royaleError('GAME_DISABLED', 'Mines is currently disabled', 503);
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma';
import type { RoyalePlinkoRound } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { WalletService } from '../wallet/wallet.service';
import { CrashFreePlayWalletService } from '../crash/crash-freeplay-wallet.service';
import {
  loadRoyaleConfig,
  PLINKO_RISKS,
  type PlinkoRisk,
  type RoyaleConfig,
} from './royale.config';
import { royaleError } from './royale.errors';
import { RoyaleEligibilityService } from './royale-eligibility.service';
import {
  computeSeedHash,
  derivePlinkoPath,
  generateClientSeed,
  generateServerSeed,
  plinkoBinFromPath,
  verifyPlinkoRound,
} from './royale-fair';
import {
  checkPlinkoTable,
  plinkoPayoutTable,
  payoutFor,
  validatePlinkoRisk,
  validatePlinkoRows,
  validateStake,
} from './royale-math';
import type { DropPlinkoDto } from './dto/royale.dto';

export const PLINKO_GAME_SLUG = 'royale-plinko';
export const FREEPLAY_CURRENCY = 'FREEPLAY';

/** Public view of a Plinko round — seeds are public (settled at creation). */
export interface RoyalePlinkoRoundView {
  id: string;
  gameSlug: typeof PLINKO_GAME_SLUG;
  mode: 'FREE_PLAY' | 'REAL_MONEY';
  status: 'SETTLED';
  rows: number;
  risk: string;
  stake: number;
  currency: string;
  path: number[];
  binIndex: number;
  multiplierBp: number;
  payout: number;
  serverSeedHash: string;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  transactionId: string | null;
  createdAt: string;
  settledAt: string;
}

export interface PlinkoPayoutTableView {
  rows: number;
  risk: PlinkoRisk;
  multipliersBp: number[];
  rtpBp: number;
  evBp: number;
  maxMultiplierBp: number;
  /** Honest label — the achieved EV BEFORE per-round flooring (floors reduce it). */
  note: string;
}

/** Deterministic ledger idempotency keys, namespaced for reconciliation. */
export const plinkoStakeKey = (idem: string): string => `royale:plinko:stake:${idem}`;
export const plinkoWinKey = (idem: string): string => `royale:plinko:win:${idem}`;
export const plinkoSettleKey = (idem: string): string => `royale:plinko:settle:${idem}`;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  );
}

/**
 * TANVION ROYALE — server-authoritative Plinko.
 *
 * One drop = one atomic transaction that (a) freezes the outcome (path/bin/
 * multiplier derived from committed seed material BEFORE the stake moves), and
 * (b) moves money through the ONE existing ledger:
 *   REAL_MONEY: WalletService.reserveStakeInTx -> captureStakeInTx ->
 *               settleBetCredit(payout)  [all keyed, all exactly-once]
 *   FREE_PLAY : CrashFreePlayWallet.debitInTx -> creditInTx(payout)
 * A retried request with the same clientRequestId hits the unique
 * (userId, idempotencyKey) row and returns the ORIGINAL round — the money
 * movements inside a failed/duplicate transaction roll back together with it,
 * so no path can double-spend or double-pay.
 */
@Injectable()
export class RoyalePlinkoService {
  private readonly logger = new Logger(RoyalePlinkoService.name);
  private readonly config: RoyaleConfig = loadRoyaleConfig();
  /** REAL_MONEY eligibility gate — always defined (DI-injected or defaulted). */
  private readonly eligibilityService: RoyaleEligibilityService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly freeWallet: CrashFreePlayWalletService,
    eligibility?: RoyaleEligibilityService,
  ) {
    // Nest injects the shared gate in production. When a unit test constructs
    // this service directly it builds a real (not stubbed) gate from the same
    // prisma client, so the checks are never silently skipped.
    this.eligibilityService = eligibility ?? new RoyaleEligibilityService(prisma);
  }

  getConfigView(): Record<string, unknown> {
    const cfg = this.config;
    return {
      enabled: cfg.enabled,
      mode: cfg.mode,
      realMoneyAvailable: cfg.realMoneyAvailable,
      realMoneyReason: cfg.realMoneyReason,
      minStake: cfg.minStake,
      maxStake: cfg.maxStake,
      currency: cfg.mode === 'FREE_PLAY' ? FREEPLAY_CURRENCY : cfg.currency,
      rtpBp: cfg.rtpBp,
      maxMultiplierBp: cfg.maxMultiplierBp,
      algorithmVersion: cfg.algorithmVersion,
      plinko: { minRows: cfg.minRows, maxRows: cfg.maxRows, risks: [...PLINKO_RISKS] },
      mines: { grids: cfg.grids, minMines: cfg.minMines, maxMines: cfg.maxMines },
    };
  }

  toView(row: RoyalePlinkoRound): RoyalePlinkoRoundView {
    return {
      id: row.id,
      gameSlug: PLINKO_GAME_SLUG,
      mode: row.mode,
      status: 'SETTLED',
      rows: row.rows,
      risk: row.risk,
      stake: row.stake,
      currency: row.currency,
      path: row.path,
      binIndex: row.binIndex,
      multiplierBp: row.multiplierBp,
      payout: row.payout,
      serverSeedHash: row.serverSeedHash,
      serverSeed: row.serverSeed,
      clientSeed: row.clientSeed,
      nonce: row.nonce,
      transactionId: row.transactionId,
      createdAt: row.createdAt.toISOString(),
      settledAt: row.settledAt.toISOString(),
    };
  }

  /** Server-computed, validated payout table for a board configuration. */
  payoutTable(rowsInput: number, riskInput: string): PlinkoPayoutTableView {
    this.assertEnabled();
    let rows: number;
    let risk: PlinkoRisk;
    try {
      rows = validatePlinkoRows(rowsInput, this.config.minRows, this.config.maxRows);
      risk = validatePlinkoRisk(riskInput);
    } catch (error) {
      royaleError('INVALID_CONFIG', error instanceof Error ? error.message : 'Invalid board');
    }
    const table = plinkoPayoutTable(rows, risk, this.config.rtpBp, this.config.maxMultiplierBp);
    const check = checkPlinkoTable(rows, table, this.config.rtpBp, this.config.maxMultiplierBp);
    if (!check.valid) {
      // Server-computed tables must always pass — defensive, never serve broken.
      this.logger.error(`Plinko table failed sanity check rows=${rows} reason=${check.reason}`);
      royaleError('INTERNAL', 'Payout table is temporarily unavailable', 503);
    }
    return {
      rows,
      risk,
      multipliersBp: table,
      rtpBp: this.config.rtpBp,
      evBp: check.evBp,
      maxMultiplierBp: this.config.maxMultiplierBp,
      note: 'Expected value before per-round integer flooring; floors and the cap only ever reduce payouts.',
    };
  }

  /**
   * Drop the ball: freeze the outcome FIRST, then settle stake + payout
   * atomically through the existing ledger. Idempotent by
   * (userId, clientRequestId) — a retry can never double-spend or double-pay.
   */
  async drop(user: AuthenticatedUser, dto: DropPlinkoDto): Promise<RoyalePlinkoRoundView> {
    const cfg = this.config;
    this.assertEnabled();
    try {
      validateStake(dto.stake, cfg.minStake, cfg.maxStake);
      validatePlinkoRows(dto.rows, cfg.minRows, cfg.maxRows);
      validatePlinkoRisk(dto.risk);
    } catch (error) {
      royaleError('VALIDATION_ERROR', error instanceof Error ? error.message : 'Invalid drop');
    }

    const idempotencyKey = dto.clientRequestId ?? randomUUID();

    // Fast path: an identical retried request returns the ORIGINAL round
    // without touching the ledger again.
    const existing = await this.prisma.royalePlinkoRound.findUnique({
      where: { userId_idempotencyKey: { userId: user.id, idempotencyKey } },
    });
    if (existing) return this.toView(existing);

    // Outcome is frozen BEFORE any money moves: committed seed material in,
    // deterministic path + validated table out.
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const serverSeedHash = computeSeedHash(serverSeed);
    const nonce = (await this.prisma.royalePlinkoRound.count({ where: { userId: user.id } })) + 1;
    const path = derivePlinkoPath(serverSeed, clientSeed, nonce, dto.rows);
    const binIndex = plinkoBinFromPath(path);
    const table = plinkoPayoutTable(dto.rows, dto.risk, cfg.rtpBp, cfg.maxMultiplierBp);
    const multiplierBp = table[binIndex];
    const payout = payoutFor(dto.stake, multiplierBp);
    const isReal = cfg.mode === 'REAL_MONEY';
    const currency = isReal ? cfg.currency : FREEPLAY_CURRENCY;

    // REAL_MONEY eligibility gate (Task 1 / audit F1,F2,F4): status, KYC, age,
    // self-exclusion and play limits MUST pass BEFORE the reservation
    // transaction opens. A rejection therefore creates NO round, NO ledger row
    // and NO wallet reservation. FREE_PLAY never runs this gate.
    if (isReal) {
      await this.eligibilityService.assertEligibleForRealMoney(user.id, dto.stake, currency);
    }

    try {
      await this.prisma.$transaction(async (db) => this.settleInTx(db, {
        user, dto, idempotencyKey, cfg, isReal, currency,
        serverSeed, clientSeed, serverSeedHash, nonce, path, binIndex, multiplierBp, payout,
      }));
    } catch (error) {
      // Duplicate key = a concurrent/retried identical request won the race:
      // this transaction rolled back entirely, return the original round.
      if (isUniqueViolation(error)) {
        const winner = await this.prisma.royalePlinkoRound.findUnique({
          where: { userId_idempotencyKey: { userId: user.id, idempotencyKey } },
        });
        if (winner) return this.toView(winner);
      }
      throw error;
    }

    const round = await this.prisma.royalePlinkoRound.findUnique({
      where: { userId_idempotencyKey: { userId: user.id, idempotencyKey } },
    });
    if (!round) royaleError('INTERNAL', 'Round could not be loaded after settlement', 503);
    this.logger.log(
      `Plinko drop settled id=${round.id} rows=${round.rows} bin=${round.binIndex} mode=${round.mode}`,
    );
    return this.toView(round);
  }

  /** All money + rows of one drop, in ONE caller transaction (atomic). */
  private async settleInTx(
    db: Prisma.TransactionClient,
    input: {
      user: AuthenticatedUser;
      dto: DropPlinkoDto;
      idempotencyKey: string;
      cfg: RoyaleConfig;
      isReal: boolean;
      currency: string;
      serverSeed: string;
      clientSeed: string;
      serverSeedHash: string;
      nonce: number;
      path: number[];
      binIndex: number;
      multiplierBp: number;
      payout: number;
    },
  ): Promise<void> {
    const { user, dto, idempotencyKey, cfg, isReal, currency } = input;
    let transactionId: string | null = null;
    if (isReal) {
      // 1. REAL_MONEY stake: reserve (available -> locked, PENDING) first so a
      //    failed round creation rolls the reservation back with it.
      const reservation = await this.wallet.reserveStakeInTx(
        db,
        user.id,
        dto.stake,
        currency,
        plinkoStakeKey(idempotencyKey),
      );
      transactionId = reservation.transactionId;
    }

    // 2. Freeze the round row — unique (userId, idempotencyKey) = exactly once.
    const round = await db.royalePlinkoRound.create({
      data: {
        userId: user.id,
        mode: cfg.mode,
        rows: dto.rows,
        risk: dto.risk,
        stake: dto.stake,
        currency,
        serverSeedHash: input.serverSeedHash,
        serverSeed: input.serverSeed,
        clientSeed: input.clientSeed,
        nonce: input.nonce,
        path: input.path,
        binIndex: input.binIndex,
        multiplierBp: input.multiplierBp,
        payout: input.payout,
        transactionId,
        idempotencyKey,
      },
    });

    if (isReal) {
      // 3a. Stake consumed (PENDING -> COMPLETED) — exactly one terminal move.
      await this.wallet.captureStakeInTx(db, user.id, plinkoStakeKey(idempotencyKey));
    } else {
      // 3b. FREE_PLAY: debit points from the ONE existing points ledger.
      await this.freeWallet.debitInTx(db, user.id, dto.stake, plinkoStakeKey(idempotencyKey), {
        type: 'ROYALE_PLINKO',
        id: round.id,
      });
    }

    // 4. Payout credit, idempotent by key — a retry can never pay twice.
    if (input.payout > 0) {
      if (isReal) {
        await this.wallet.settleBetCredit(
          db,
          user.id,
          input.payout,
          currency,
          'BET_PAYOUT',
          plinkoWinKey(idempotencyKey),
          'ROYALE_PLINKO_PAYOUT',
        );
      } else {
        await this.freeWallet.creditInTx(
          db,
          user.id,
          input.payout,
          'BET_PAYOUT',
          plinkoWinKey(idempotencyKey),
          { type: 'ROYALE_PLINKO', id: round.id },
        );
      }
    }

    // 5. Durable settlement + audit records (reconciliation anchors).
    await db.royaleSettlement.create({
      data: {
        gameSlug: PLINKO_GAME_SLUG,
        roundId: round.id,
        userId: user.id,
        result: 'PLINKO_PAYOUT',
        stake: dto.stake,
        payout: input.payout,
        multiplierBp: input.multiplierBp,
        transactionId: isReal ? transactionId : null,
        idempotencyKey: plinkoSettleKey(idempotencyKey),
      },
    });
    await db.gameAuditLog.create({
      data: {
        gameSlug: PLINKO_GAME_SLUG,
        roundId: round.id,
        userId: user.id,
        action: 'PLINKO_DROP',
        metadata: {
          mode: cfg.mode,
          rows: dto.rows,
          risk: dto.risk,
          stake: dto.stake,
          binIndex: input.binIndex,
          multiplierBp: input.multiplierBp,
          payout: input.payout,
        } as Prisma.InputJsonValue,
      },
    });
  }

  /** The player's own recent drops (ownership enforced by the userId filter). */
  async getHistory(userId: string, limit = 25): Promise<RoyalePlinkoRoundView[]> {
    this.assertEnabled();
    const rows = await this.prisma.royalePlinkoRound.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map((row) => this.toView(row));
  }

  /**
   * Independent verification of one of the player's rounds. Returns the
   * revealed material plus the recomputed commitment/path so anyone can
   * reproduce the result (documented in docs/games/plinko-mines.md).
   */
  async verify(userId: string, roundId: string): Promise<Record<string, unknown>> {
    this.assertEnabled();
    const row = await this.prisma.royalePlinkoRound.findUnique({ where: { id: roundId } });
    // Ownership enforced: a foreign or unknown round is indistinguishable.
    if (!row || row.userId !== userId) {
      royaleError('ROUND_NOT_FOUND', 'Round not found', 404);
    }
    const result = verifyPlinkoRound(
      row.serverSeed,
      row.clientSeed,
      row.nonce,
      row.rows,
      row.serverSeedHash,
      row.path,
      row.binIndex,
    );
    return {
      roundId: row.id,
      algorithm: 'HMAC_SHA256_COMMIT_REVEAL',
      algorithmNote:
        'path[i] = firstByte(HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}:row:${i}`)) & 1; bin = sum(path); commitment = SHA-256(serverSeed).',
      serverSeedHash: row.serverSeedHash,
      derivedCommitmentHash: result.commitmentHash,
      serverSeed: row.serverSeed,
      clientSeed: row.clientSeed,
      nonce: row.nonce,
      rows: row.rows,
      risk: row.risk,
      storedPath: row.path,
      derivedPath: pathOf(result.path),
      storedBinIndex: row.binIndex,
      derivedBinIndex: result.binIndex,
      multiplierBp: row.multiplierBp,
      payout: row.payout,
      stake: row.stake,
      verified: result.verified,
    };
  }

  private assertEnabled(): void {
    if (!this.config.enabled) {
      royaleError('GAME_DISABLED', 'Plinko is currently disabled', 503);
    }
  }
}

/** Narrowing helper so the verify payload keeps number[] typing. */
function pathOf(path: number[]): number[] {
  return [...path];
}

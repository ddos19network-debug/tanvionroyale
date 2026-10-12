import { HttpException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../generated/prisma';
import type { RoyaleAceRound } from '../../../generated/prisma';
import { PrismaService } from '../../../database/prisma.service';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user';
import { WalletService } from '../../wallet/wallet.service';
import { CrashFreePlayWalletService } from '../../crash/crash-freeplay-wallet.service';
import { loadRoyaleConfig, type RoyaleConfig } from '../royale.config';
import { royaleError } from '../royale.errors';
import { RoyaleEligibilityService } from '../royale-eligibility.service';
import { FREEPLAY_CURRENCY } from '../royale-plinko.service';
import { AceConfigStore } from './ace-config-store';
import {
  ACE_GAME_SLUG,
  betLevelsFor,
  cloneAceConfig,
  DEFAULT_ACE_CONFIG,
  effectiveMaxWinBp,
  isCountryCurrencyAllowed,
  validateAceConfig,
  validateAceStake,
  type AceGameConfig,
} from './ace-config';
import {
  aceCommitment,
  aceRoundPayoutMinorUnits,
  decryptAceSeed,
  encryptAceSeed,
  generateAceClientSeed,
  generateAceServerSeed,
  generateAceRound,
  verifyAceSpin,
  type AceRoundSeeds,
} from './ace-fair';
import type { AceRoundResult } from './ace-math';
import type { AceSpinDto } from '../dto/ace.dto';

export const ACE_MODE_SLUG = ACE_GAME_SLUG;

/** A single playable spin/round for the client to replay (server-authoritative). */
export interface AceRoundView {
  id: string;
  gameSlug: typeof ACE_GAME_SLUG;
  mode: 'FREE_PLAY' | 'REAL_MONEY';
  status: 'ACTIVE' | 'SETTLED' | 'VOIDED';
  stake: number;
  currency: string;
  /** Total win in minor units (capped); null while ACTIVE. */
  payout: number | null;
  /** Uncapped total in bp of stake (for the win display before flooring). */
  totalPayBp: number;
  maxMultiplierBp: number;
  capped: boolean;
  /** The full pre-derived outcome (grids, cascades, multipliers, free spins). */
  result: AceRoundResult;
  configVersion: number;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  /** NULL while ACTIVE; revealed at settlement. */
  serverSeed: string | null;
  transactionId: string | null;
  createdAt: string;
  settledAt: string | null;
}

/** Deterministic ledger idempotency keys, namespaced for reconciliation. */
export const aceStakeKey = (idem: string): string => `royale:ace:stake:${idem}`;
export const aceWinKey = (roundId: string): string => `royale:ace:win:${roundId}`;
export const aceSettleKey = (roundId: string): string => `royale:ace:settle:${roundId}`;
export const aceVoidKey = (roundId: string): string => `royale:ace:void:${roundId}`;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  );
}

/**
 * TANVION ROYALE — server-authoritative Royale Ace (royale-ace).
 *
 * One spin = ONE database transaction that (a) pre-derives the ENTIRE round
 * (initial grid, every cascade, wild placements, multipliers, scatter trigger,
 * the whole free-spin sequence and the capped total win) from committed seed
 * material, and (b) moves money through the ONE existing ledger:
 *   REAL_MONEY: WalletService.reserveStakeInTx -> captureStakeInTx ->
 *               settleBetCredit(capped win)  [all keyed, all exactly-once]
 *   FREE_PLAY : CrashFreePlayWallet.debitInTx -> creditInTx(capped win)
 * The client never decides anything — it only replays `result`.
 *
 * REAL_MONEY gate order on EVERY spin (fail-closed; a rejection creates NO
 * round, NO ledger row and NO wallet reservation):
 *   1. master switch (RoyaleConfig.enabled / realMoneyAvailable)
 *   2. game switch (ACTIVE AceGameConfig.enabled)
 *   3. jurisdiction + currency allowed (AceJurisdictionRules, admin-managed)
 *   4. account status + KYC + 18+ (RoyaleEligibilityService)
 *   5. responsible-gambling limits / self-exclusion (RoyaleEligibilityService)
 * FREE_PLAY skips 3-5 entirely and never touches the real wallet.
 *
 * Rounds settle atomically at spin time. A round left ACTIVE (process death
 * between phases, or an admin action) is completed by `reconcile`, which can
 * only ever apply the exact pre-derived outcome — it never invents a result.
 */
@Injectable()
export class RoyaleAceService {
  private readonly logger = new Logger(RoyaleAceService.name);
  private readonly royaleConfig: RoyaleConfig = loadRoyaleConfig();
  private readonly eligibilityService: RoyaleEligibilityService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly freeWallet: CrashFreePlayWalletService,
    private readonly configStore: AceConfigStore,
    eligibility?: RoyaleEligibilityService,
  ) {
    this.eligibilityService = eligibility ?? new RoyaleEligibilityService(prisma);
  }

  /** Public config + gate status for the client (never any secret). */
  async getConfigView(user?: AuthenticatedUser): Promise<Record<string, unknown>> {
    const cfg = await this.configStore.getActive();
    const royale = this.royaleConfig;
    const isReal = royale.mode === 'REAL_MONEY';
    const country = user ? await this.countryOf(user.id) : null;
    const allowedCurrencies = isReal ? this.allowedCurrencies(cfg, country) : [];
    const currencies = isReal ? allowedCurrencies : [FREEPLAY_CURRENCY];
    return {
      gameSlug: ACE_GAME_SLUG,
      enabled: royale.enabled && cfg.enabled,
      mode: royale.mode,
      realMoneyAvailable: royale.realMoneyAvailable,
      realMoneyReason: royale.realMoneyReason,
      configVersion: cfg.version,
      configName: cfg.configName,
      targetRtpBp: cfg.targetRtpBp,
      volatilityLabel: cfg.volatilityLabel,
      maxWinBp: cfg.maxWinBp,
      reels: 5,
      rows: 4,
      ways: 1024,
      goldenToWild: cfg.goldenToWild,
      baseLadderBp: cfg.baseLadderBp,
      freeSpinLadderBp: cfg.freeSpinLadderBp,
      scatterPayBp: cfg.scatterPayBp,
      freeSpins: cfg.freeSpins,
      paytableBp: cfg.paytableBp,
      // Per-currency bet levels the player may actually use right now.
      betLevels: Object.fromEntries(
        currencies.map((c) => [c, betLevelsFor(cfg, c) ?? cfg.freePlayBetLevels]),
      ),
      freePlayBetLevels: cfg.freePlayBetLevels,
      allowedCurrencies,
      country,
      dailyWinCapMinorUnits: cfg.dailyWinCapMinorUnits,
    };
  }

  /** Build the public view. NEVER exposes serverSeedEnc. */
  private toView(row: RoyaleAceRound, result: AceRoundResult): AceRoundView {
    return {
      id: row.id,
      gameSlug: ACE_GAME_SLUG,
      mode: row.mode,
      status: row.status,
      stake: row.stake,
      currency: row.currency,
      payout: row.payout,
      totalPayBp: result.totalPayBp,
      maxMultiplierBp: row.maxMultiplierBp,
      capped: row.capped,
      result,
      configVersion: row.configVersion,
      serverSeedHash: row.serverSeedHash,
      clientSeed: row.clientSeed,
      nonce: row.nonce,
      serverSeed: row.serverSeed,
      transactionId: row.transactionId,
      createdAt: row.createdAt.toISOString(),
      settledAt: row.settledAt?.toISOString() ?? null,
    };
  }

  /** Parse the stored round JSON back into the pre-derived outcome. */
  private parseResult(row: RoyaleAceRound): AceRoundResult {
    return row.resultJson as unknown as AceRoundResult;
  }

  /**
   * Play one full round. The ENTIRE outcome is derived BEFORE any money moves,
   * then stake + capped win settle in ONE transaction. Idempotent by
   * (userId, clientRequestId) — a retry can never double-spend or double-pay.
   *
   * DIAGNOSTICS: an unexpected (non-HttpException) failure is logged ONCE,
   * server-side, with the error name/message and Prisma code — never with
   * seeds, keys, tokens or other secrets — and then rethrown unchanged, so
   * the global exception filter keeps producing the same response shape.
   */
  async spin(user: AuthenticatedUser, dto: AceSpinDto): Promise<AceRoundView> {
    try {
      return await this.performSpin(user, dto);
    } catch (error) {
      this.logUnexpectedSpinError(error);
      throw error;
    }
  }

  /**
   * Logs an unexpected spin failure exactly once. Deliberate, client-safe
   * refusals (HttpException from royaleError/eligibility) are NOT logged
   * here — the global filter already handles those. Only the error name, its
   * message and any Prisma error code are logged; never seeds, keys, tokens
   * or other secrets.
   */
  private logUnexpectedSpinError(error: unknown): void {
    if (error instanceof HttpException) return;
    const name = error instanceof Error ? error.name : typeof error;
    const message = error instanceof Error ? error.message : String(error);
    const prismaCode =
      error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;
    this.logger.error(
      `Ace spin failed unexpectedly name=${name}${prismaCode ? ` prismaCode=${prismaCode}` : ''} message=${message}`,
    );
  }

  /** Spin implementation (wrapped by `spin` for one-shot unexpected-error logging). */
  private async performSpin(user: AuthenticatedUser, dto: AceSpinDto): Promise<AceRoundView> {
    const royale = this.royaleConfig;
    // 1. Master switch.
    if (!royale.enabled) {
      royaleError('GAME_DISABLED', 'Royale Ace is currently disabled', 403);
    }
    const cfg = await this.configStore.getActive();
    // 2. Game switch.
    if (!cfg.enabled) {
      royaleError('GAME_DISABLED', 'Royale Ace is currently disabled', 403);
    }

    const isReal = royale.mode === 'REAL_MONEY';
    const requested = (dto.currency ?? royale.currency).toUpperCase();
    const country = await this.countryOf(user.id);
    const currency = isReal ? requested : FREEPLAY_CURRENCY;

    // 3. Jurisdiction + currency gate (REAL_MONEY only). Fail-closed.
    if (isReal) {
      if (!isCountryCurrencyAllowed(cfg, country, currency)) {
        royaleError(
          'REAL_MONEY_UNAVAILABLE',
          'Real-money play is not available for your region or currency',
          403,
          { country, currency },
        );
      }
      const levels = betLevelsFor(cfg, currency);
      if (!levels) {
        royaleError('REAL_MONEY_UNAVAILABLE', `Currency ${currency} is not supported`, 403);
      }
      try {
        validateAceStake(cfg, currency, dto.stake);
      } catch (error) {
        royaleError('INVALID_STAKE', error instanceof Error ? error.message : 'Invalid stake');
      }
      // 4 + 5. Account status, KYC, 18+, self-exclusion, play limits.
      await this.eligibilityService.assertEligibleForRealMoney(
        user.id,
        dto.stake,
        currency,
        ACE_GAME_SLUG,
      );
    } else {
      // FREE_PLAY bounds (points).
      const fp = cfg.freePlayBetLevels;
      if (
        !Number.isInteger(dto.stake) ||
        dto.stake < fp.minStake ||
        dto.stake > fp.maxStake ||
        dto.stake % fp.step !== 0
      ) {
        royaleError(
          'INVALID_STAKE',
          `Stake must be between ${fp.minStake} and ${fp.maxStake} (step ${fp.step})`,
        );
      }
    }

    const idempotencyKey = dto.clientRequestId ?? randomUUID();
    const existing = await this.prisma.royaleAceRound.findUnique({
      where: { userId_idempotencyKey: { userId: user.id, idempotencyKey } },
    });
    if (existing) return this.toView(existing, this.parseResult(existing));

    // Freeze the ENTIRE round from committed seed material BEFORE any money
    // moves, exactly like the other Royale games.
    const maxWinBp = effectiveMaxWinBp(cfg, dto.stake);
    const seeds: AceRoundSeeds = {
      serverSeed: generateAceServerSeed(),
      clientSeed: generateAceClientSeed(),
      nonce: (await this.prisma.royaleAceRound.count({ where: { userId: user.id } })) + 1,
    };
    const result = generateAceRound(cfg, seeds, dto.stake);
    const payout = aceRoundPayoutMinorUnits(result, dto.stake, maxWinBp);
    const serverSeedHash = aceCommitment(seeds.serverSeed);
    const serverSeedEnc = encryptAceSeed(seeds.serverSeed);

    try {
      await this.prisma.$transaction(async (db) => {
        // Serialize spins for THIS user+currency across instances.
        // pg_advisory_xact_lock returns Postgres `void`, which Prisma
        // $queryRaw cannot deserialize ("Failed to deserialize column of
        // type 'void'") — $executeRaw is the safe form for void-returning
        // functions (same pattern as crash-round-engine.ts).
        await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`royale-ace:${user.id}:${currency}`}))`;

        let transactionId: string | null = null;
        if (isReal) {
          const reservation = await this.wallet.reserveStakeInTx(
            db,
            user.id,
            dto.stake,
            currency,
            aceStakeKey(idempotencyKey),
          );
          transactionId = reservation.transactionId;
        }

        const round = await db.royaleAceRound.create({
          data: {
            userId: user.id,
            mode: royale.mode,
            status: 'SETTLED',
            stake: dto.stake,
            currency,
            payout,
            maxMultiplierBp: result.maxMultiplierBp,
            capped: result.capped,
            serverSeedHash,
            serverSeedEnc,
            serverSeed: seeds.serverSeed,
            clientSeed: seeds.clientSeed,
            nonce: seeds.nonce,
            configVersion: cfg.version,
            resultJson: result as unknown as Prisma.InputJsonValue,
            transactionId,
            idempotencyKey,
            settledAt: new Date(),
          },
        });

        // FREE_PLAY: debit the stake from the ONE points ledger (keyed,
        // exactly-once, throws on overdraw) — mirrors the REAL_MONEY reservation
        // above so the stake always leaves the bankroll before the win is paid.
        if (!isReal) {
          await this.freeWallet.getOrCreateWalletInTx(db, user.id);
          await this.freeWallet.debitInTx(db, user.id, dto.stake, aceStakeKey(idempotencyKey), {
            type: 'ROYALE_ACE',
            id: round.id,
          });
        }

        if (isReal) {
          await this.wallet.captureStakeInTx(db, user.id, aceStakeKey(idempotencyKey));
          if (payout > 0) {
            await this.wallet.settleBetCredit(
              db,
              user.id,
              payout,
              currency,
              'BET_PAYOUT',
              aceWinKey(round.id),
              'ROYALE_ACE_PAYOUT',
            );
          }
        } else if (payout > 0) {
          await this.freeWallet.creditInTx(db, user.id, payout, 'BET_PAYOUT', aceWinKey(round.id), {
            type: 'ROYALE_ACE',
            id: round.id,
          });
        }

        await db.royaleSettlement.create({
          data: {
            gameSlug: ACE_GAME_SLUG,
            roundId: round.id,
            userId: user.id,
            result: 'ACE_SPIN',
            stake: dto.stake,
            payout,
            multiplierBp: result.maxMultiplierBp,
            transactionId: isReal ? transactionId : null,
            idempotencyKey: aceSettleKey(round.id),
          },
        });
        await db.gameAuditLog.create({
          data: {
            gameSlug: ACE_GAME_SLUG,
            roundId: round.id,
            userId: user.id,
            action: 'ACE_SPIN',
            metadata: {
              mode: royale.mode,
              stake: dto.stake,
              currency,
              payout,
              capped: result.capped,
              freeSpinsPlayed: result.freeSpinsPlayed,
              maxMultiplierBp: result.maxMultiplierBp,
              configVersion: cfg.version,
            } as Prisma.InputJsonValue,
          },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const winner = await this.prisma.royaleAceRound.findUnique({
          where: { userId_idempotencyKey: { userId: user.id, idempotencyKey } },
        });
        if (winner) return this.toView(winner, this.parseResult(winner));
      }
      throw error;
    }

    const round = await this.prisma.royaleAceRound.findUnique({
      where: { userId_idempotencyKey: { userId: user.id, idempotencyKey } },
    });
    if (!round) royaleError('INTERNAL', 'Round could not be loaded after settlement', 503);
    this.logger.log(
      `Ace round settled id=${round.id} mode=${round.mode} payout=${payout} fs=${result.freeSpinsPlayed}`,
    );
    return this.toView(round, result);
  }

  /** The player's own recent rounds (ownership enforced by the userId filter). */
  async getHistory(userId: string, limit = 25): Promise<AceRoundView[]> {
    const rows = await this.prisma.royaleAceRound.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map((row) => this.toView(row, this.parseResult(row)));
  }

  /** The player's ISO country code from the account record (may be null). */
  private async countryOf(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { country: true },
    });
    return user?.country ?? null;
  }

  /** Currencies this player may use for REAL_MONEY right now (fail-closed). */
  private allowedCurrencies(cfg: AceGameConfig, country: string | null): string[] {
    const jur = cfg.jurisdiction;
    const code = country?.trim().toUpperCase();
    if (code && jur.blockedCountries.map((c) => c.toUpperCase()).includes(code)) return [];
    const explicit = code ? jur.currencyByCountry[code] : undefined;
    const list =
      explicit && explicit.length > 0
        ? explicit
        : jur.unknownCountryPolicy === 'USE_DEFAULT' || !code
          ? jur.defaultCurrencies
          : [];
    return list.map((c) => c.toUpperCase()).filter((c) => betLevelsFor(cfg, c) !== null);
  }

  /**
   * Independent verification of one of the player's rounds. Re-derives the
   * ENTIRE round from the revealed seeds + the exact config version it was
   * played with, so a tampered round record can always be detected.
   */
  async verify(userId: string, roundId: string): Promise<Record<string, unknown>> {
    const row = await this.prisma.royaleAceRound.findUnique({ where: { id: roundId } });
    if (!row || row.userId !== userId) {
      royaleError('ROUND_NOT_FOUND', 'Round not found', 404);
    }
    if (row.status === 'ACTIVE' || !row.serverSeed) {
      royaleError('ROUND_NOT_ACTIVE', 'The round must finish before its seed is revealed', 409);
    }
    const config = (await this.configStore.getVersion(row.configVersion)) ?? DEFAULT_ACE_CONFIG;
    const seeds: AceRoundSeeds = {
      serverSeed: row.serverSeed,
      clientSeed: row.clientSeed,
      nonce: row.nonce,
    };
    const stored = this.parseResult(row);
    const result = verifyAceSpin(config, seeds, row.stake, {
      totalPayBp: stored.totalPayBp,
      payoutMinorUnits: row.payout ?? 0,
      freeSpinsPlayed: stored.freeSpinsPlayed,
    });
    return {
      roundId: row.id,
      status: row.status,
      algorithm: 'HMAC_SHA256_STREAM_REJECTION_SAMPLING',
      algorithmNote:
        'Each phase (base + every free spin) draws from its own HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}:${stream}:${counter}`) sub-stream with rejection sampling; grids, cascades, wilds, multipliers and totals are re-derived from those draws; commitment = SHA-256(serverSeed).',
      serverSeedHash: row.serverSeedHash,
      derivedCommitmentHash: aceCommitment(row.serverSeed),
      serverSeed: row.serverSeed,
      clientSeed: row.clientSeed,
      nonce: row.nonce,
      configVersion: row.configVersion,
      maxWinBp: effectiveMaxWinBp(config, row.stake),
      storedTotalPayBp: stored.totalPayBp,
      derivedTotalPayBp: result.totalPayBp,
      storedPayout: row.payout ?? 0,
      derivedPayout: result.payoutMinorUnits,
      valid: result.valid,
      reasons: result.reasons,
    };
  }

  /**
   * Reconciler: complete any round left ACTIVE (process death between phases,
   * a mid-round country flip, or an admin intervention). It can only ever apply
   * the exact pre-derived outcome stored in `resultJson` — it never invents a
   * result. When the seed is unrecoverable it VOIDs (refunds) instead.
   *
   * Idempotent and exactly-once: each round is settled under a FOR UPDATE lock
   * and every money movement is keyed, so a repeated reconcile is a no-op.
   */
  async reconcile(limit = 100): Promise<{ completed: number; voided: number }> {
    const stuck = await this.prisma.royaleAceRound.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 500),
    });
    let completed = 0;
    let voided = 0;
    for (const row of stuck) {
      try {
        const outcome = await this.prisma.$transaction(async (db) => {
          await db.$queryRaw`SELECT id FROM "RoyaleAceRound" WHERE id = ${row.id} FOR UPDATE`;
          const round = await db.royaleAceRound.findUnique({ where: { id: row.id } });
          if (!round || round.status !== 'ACTIVE') return 'skipped';
          const seed = decryptAceSeed(round.serverSeedEnc);
          if (!seed) {
            await this.voidInTx(db, round, 'seed_unrecoverable');
            return 'voided';
          }
          await this.completeInTx(db, round);
          return 'completed';
        });
        if (outcome === 'completed') completed += 1;
        else if (outcome === 'voided') voided += 1;
      } catch (error) {
        this.logger.error(
          `Ace reconcile failed for round ${row.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (completed + voided > 0) {
      this.logger.log(`Ace reconcile finished: ${completed} completed, ${voided} voided`);
    }
    return { completed, voided };
  }

  /** Settle an ACTIVE round using its pre-derived outcome (money moved once). */
  private async completeInTx(
    db: Prisma.TransactionClient,
    round: RoyaleAceRound,
  ): Promise<RoyaleAceRound> {
    const result = this.parseResult(round);
    const cfg = (await this.configStore.getVersion(round.configVersion)) ?? DEFAULT_ACE_CONFIG;
    const payout = aceRoundPayoutMinorUnits(
      result,
      round.stake,
      effectiveMaxWinBp(cfg, round.stake),
    );
    const seed = decryptAceSeed(round.serverSeedEnc);
    const updated = await db.royaleAceRound.update({
      where: { id: round.id },
      data: { status: 'SETTLED', payout, serverSeed: seed, settledAt: new Date() },
    });
    if (round.mode === 'REAL_MONEY') {
      await this.wallet.captureStakeInTx(db, round.userId, aceStakeKey(round.idempotencyKey));
      if (payout > 0) {
        await this.wallet.settleBetCredit(
          db,
          round.userId,
          payout,
          round.currency,
          'BET_PAYOUT',
          aceWinKey(round.id),
          'ROYALE_ACE_RECONCILE',
        );
      }
    } else if (payout > 0) {
      await this.freeWallet.creditInTx(db, round.userId, payout, 'BET_PAYOUT', aceWinKey(round.id), {
        type: 'ROYALE_ACE',
        id: round.id,
      });
    }
    await db.royaleSettlement.upsert({
      where: {
        userId_idempotencyKey: { userId: round.userId, idempotencyKey: aceSettleKey(round.id) },
      },
      update: { payout },
      create: {
        gameSlug: ACE_GAME_SLUG,
        roundId: round.id,
        userId: round.userId,
        result: 'ACE_SPIN',
        stake: round.stake,
        payout,
        multiplierBp: result.maxMultiplierBp,
        transactionId: round.mode === 'REAL_MONEY' ? round.transactionId : null,
        idempotencyKey: aceSettleKey(round.id),
      },
    });
    await db.gameAuditLog.create({
      data: {
        gameSlug: ACE_GAME_SLUG,
        roundId: round.id,
        userId: round.userId,
        action: 'ACE_RECONCILE',
        metadata: { payout, mode: round.mode, stake: round.stake } as Prisma.InputJsonValue,
      },
    });
    this.logger.warn(`Ace round reconciled id=${round.id} payout=${payout}`);
    return updated;
  }

  /** VOID an ACTIVE round (seed unrecoverable): refund the stake, pay nothing. */
  private async voidInTx(
    db: Prisma.TransactionClient,
    round: RoyaleAceRound,
    reason: string,
  ): Promise<RoyaleAceRound> {
    const updated = await db.royaleAceRound.update({
      where: { id: round.id },
      data: { status: 'VOIDED', settledAt: new Date() },
    });
    if (round.mode === 'REAL_MONEY') {
      await this.wallet.releaseStakeInTx(db, round.userId, aceStakeKey(round.idempotencyKey));
    } else {
      await this.freeWallet.creditInTx(
        db,
        round.userId,
        round.stake,
        'BET_REFUND',
        aceVoidKey(round.idempotencyKey),
        { type: 'ROYALE_ACE', id: round.id },
      );
    }
    await db.royaleSettlement.upsert({
      where: { userId_idempotencyKey: { userId: round.userId, idempotencyKey: aceVoidKey(round.id) } },
      update: {},
      create: {
        gameSlug: ACE_GAME_SLUG,
        roundId: round.id,
        userId: round.userId,
        result: 'VOIDED',
        stake: round.stake,
        payout: round.stake,
        multiplierBp: null,
        transactionId: round.mode === 'REAL_MONEY' ? round.transactionId : null,
        idempotencyKey: aceVoidKey(round.id),
      },
    });
    await db.gameAuditLog.create({
      data: {
        gameSlug: ACE_GAME_SLUG,
        roundId: round.id,
        userId: round.userId,
        action: 'ACE_VOID',
        metadata: { reason, stake: round.stake, mode: round.mode } as Prisma.InputJsonValue,
      },
    });
    this.logger.warn(`Ace round voided safely id=${round.id} reason=${reason}`);
    return updated;
  }
}




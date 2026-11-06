/**
 * SlotService — server-authoritative engine execution, persistence & wallet moves.
 *
 * One spin = ONE atomic Prisma transaction:
 *   1. Advisory lock on user
 *   2. Idempotency check: if (userId, clientRequestId) exists, return cached outcome
 *   3. Stake validation against allowed levels
 *   4. debitInTx(stake) from CrashFreePlayWallet (throws on insufficient balance)
 *   5. deriveRound with CryptoRng (node:crypto randomInt)
 *   6. creditInTx(payout) when payout > 0
 *   7. Insert FreePlaySlotRound
 *   8. Insert GameResult (keeps existing profile/history screens functional)
 *   9. Read balanceAfter and return response
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../../database/prisma.service';
import { CrashFreePlayWalletService } from '../../crash/crash-freeplay-wallet.service';
import { CryptoRng } from './core/rng';
import { deriveRound } from './core/round';
import { getSlot, slotToPublicConfigView } from './slot.registry';
import type {
  SlotConfigView,
  SlotRoundHistoryEntry,
  SlotSpinRequest,
  SlotSpinResponse,
} from '@tanvion-royale/types';

export const slotStakeKey = (userId: string, reqId: string) => `slot:${userId}:${reqId}:stake`;
export const slotPayoutKey = (userId: string, reqId: string) => `slot:${userId}:${reqId}:payout`;

@Injectable()
export class SlotService {
  private readonly logger = new Logger(SlotService.name);
  private readonly rng = new CryptoRng();

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: CrashFreePlayWalletService,
  ) {}

  /** Public game config (paytable, rules, symbols, stake levels). */
  getConfig(slug: string): SlotConfigView {
    const slot = getSlot(slug);
    if (!slot) {
      throw new NotFoundException(`Slot game "${slug}" not found`);
    }
    return slotToPublicConfigView(slot.config);
  }

  /** Play one spin server-authoritatively. */
  async spin(
    userId: string,
    slug: string,
    dto: SlotSpinRequest,
  ): Promise<SlotSpinResponse> {
    const slot = getSlot(slug);
    if (!slot) {
      throw new NotFoundException(`Slot game "${slug}" not found`);
    }
    const { config, hooks } = slot;

    // Stake validation
    if (!Number.isInteger(dto.stake) || !config.stakeLevels.includes(dto.stake)) {
      throw new BadRequestException(
        `Invalid stake ${dto.stake}. Allowed levels: [${config.stakeLevels.join(', ')}]`,
      );
    }

    if (!dto.clientRequestId || typeof dto.clientRequestId !== 'string') {
      throw new BadRequestException('clientRequestId is required');
    }

    // Single atomic transaction
    return this.prisma.$transaction(async (db) => {
      // 1. Advisory lock serialized per user
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`slot:${userId}`}))`;

      // 2. Idempotency check
      const existing = await db.freePlaySlotRound.findUnique({
        where: {
          userId_clientRequestId: {
            userId,
            clientRequestId: dto.clientRequestId,
          },
        },
      });

      if (existing) {
        // Return existing round without moving money again
        const outcome = existing.outcome as any;
        const currentBalance = await this.wallet.getBalance(userId);
        return {
          roundId: existing.id,
          gameSlug: existing.gameSlug,
          stake: existing.stake,
          baseGrid: outcome.baseGrid,
          steps: outcome.steps ?? [],
          freeSpins: outcome.freeSpins,
          totalPayBp: existing.totalPayBp,
          payout: existing.payout,
          capped: existing.capped,
          balanceAfter: currentBalance,
          message:
            existing.payout > 0
              ? `Win ${existing.payout} points`
              : 'No win this spin',
        };
      }

      // 3. Ensure wallet exists
      await this.wallet.getOrCreateWalletInTx(db, userId);

      // 4. Debit stake
      const stakeKey = slotStakeKey(userId, dto.clientRequestId);
      await this.wallet.debitInTx(db, userId, dto.stake, stakeKey, {
        type: 'SYSTEM',
        id: `slot:${slug}`,
      });

      // 5. Derive round server-authoritatively
      const round = deriveRound(this.rng, config, dto.stake, hooks);

      // 6. Credit payout if > 0
      if (round.payout > 0) {
        const payoutKey = slotPayoutKey(userId, dto.clientRequestId);
        await this.wallet.creditInTx(
          db,
          userId,
          round.payout,
          'BET_PAYOUT',
          payoutKey,
          { type: 'SYSTEM', id: `slot:${slug}` },
        );
      }

      const outcomeData = {
        baseGrid: round.baseGrid,
        steps: round.baseSteps,
        freeSpins: round.freeSpins,
        meta: round.meta,
      };

      // 7. Save FreePlaySlotRound
      const savedRound = await db.freePlaySlotRound.create({
        data: {
          userId,
          gameSlug: slug,
          clientRequestId: dto.clientRequestId,
          stake: dto.stake,
          totalPayBp: round.totalPayBp,
          payout: round.payout,
          capped: round.capped,
          outcome: outcomeData as unknown as Prisma.InputJsonValue,
        },
      });

      // 8. Save GameResult for legacy history / user stats
      const outcomeLabel = round.payout > 0 ? 'WIN' : 'LOSS';
      const msg =
        round.payout > 0
          ? `Win ${round.payout} points`
          : 'No win this spin';

      await db.gameResult.create({
        data: {
          userId,
          gameSlug: slug,
          score: round.payout,
          outcome: outcomeLabel,
          meta: {
            message: msg,
            roundId: savedRound.id,
            stake: dto.stake,
            totalPayBp: round.totalPayBp,
          } as Prisma.InputJsonValue,
        },
      });

      // 9. Read balanceAfter in the same transaction
      const balanceRow = await db.crashFreePlayWallet.findUnique({
        where: { userId },
      });
      const balanceAfter = balanceRow?.balance ?? 0;

      return {
        roundId: savedRound.id,
        gameSlug: slug,
        stake: dto.stake,
        baseGrid: round.baseGrid,
        steps: round.baseSteps,
        freeSpins: round.freeSpins,
        totalPayBp: round.totalPayBp,
        payout: round.payout,
        capped: round.capped,
        balanceAfter,
        message: msg,
      };
    });
  }

  /** List user's recent rounds for a game. */
  async listRounds(
    userId: string,
    slug: string,
  ): Promise<SlotRoundHistoryEntry[]> {
    const rows = await this.prisma.freePlaySlotRound.findMany({
      where: { userId, gameSlug: slug },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return rows.map((r) => ({
      roundId: r.id,
      gameSlug: r.gameSlug,
      stake: r.stake,
      payout: r.payout,
      totalPayBp: r.totalPayBp,
      capped: r.capped,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}

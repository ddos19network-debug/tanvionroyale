import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PrismaService } from '../../database/prisma.service';
import { RoyalePlinkoService } from './royale-plinko.service';
import { AdminSettlementsQueryDto } from './dto/royale.dto';

/**
 * TANVION ROYALE — Royale Play admin surface (read/operations only).
 *
 * AUTHORIZATION: JwtAuthGuard + RolesGuard + @Roles('ADMIN','SUPER_ADMIN') +
 * @RequirePermissions(ROYALE_READ). Ordinary users can NEVER reach these
 * routes. Responses NEVER include a server seed, an encrypted seed, or mine
 * positions — only operational aggregates and settlement records.
 *
 * `reconcile` is the reconciliation tool: it compares Royale settlement
 * payout totals against the actual ledger movements (WalletTransaction
 * BET_PAYOUT credits and CrashFreePlayWallet BET_PAYOUT credits, both keyed
 * "royale:*"), so finance can detect drift between game records and money.
 */
@ApiTags('admin/royale')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@RequirePermissions(ADMIN_PERMISSIONS.ROYALE_READ)
@Controller('admin/royale')
export class RoyaleAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plinko: RoyalePlinkoService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Royale Play gate status + operational counts (no secrets)' })
  async getStatus() {
    const [plinkoCount, settlementCount, minesGroups] = await Promise.all([
      this.prisma.royalePlinkoRound.count(),
      this.prisma.royaleSettlement.count(),
      this.prisma.royaleMinesRound.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const minesByStatus: Record<string, number> = {};
    for (const group of minesGroups) minesByStatus[group.status] = group._count._all;
    return {
      config: this.plinko.getConfigView(),
      counts: { plinkoRounds: plinkoCount, minesByStatus, settlements: settlementCount },
      note: 'REAL_MONEY activates only when the full fail-closed gate passes; approval records are verified outside this API.',
    };
  }

  @Get('settlements')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Recent Royale settlements (reconciliation anchors, no seeds)' })
  async getSettlements(@Query() query: AdminSettlementsQueryDto) {
    const rows = await this.prisma.royaleSettlement.findMany({
      where: query.gameSlug ? { gameSlug: query.gameSlug } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(query.limit ?? 50, 1), 200),
    });
    return {
      settlements: rows.map((row) => ({
        id: row.id,
        gameSlug: row.gameSlug,
        roundId: row.roundId,
        userId: row.userId,
        result: row.result,
        stake: row.stake,
        payout: row.payout,
        multiplierBp: row.multiplierBp,
        transactionId: row.transactionId,
        idempotencyKey: row.idempotencyKey,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  @Get('reconcile')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Compare Royale settlement totals against ledger movements' })
  async reconcile() {
    const [settlements, walletWins, walletPending, freeplayWins, freeplayRefunds] =
      await Promise.all([
        this.prisma.royaleSettlement.findMany({
          select: { gameSlug: true, result: true, payout: true, transactionId: true },
        }),
        this.prisma.walletTransaction.aggregate({
          where: { type: 'BET_PAYOUT', idempotencyKey: { startsWith: 'royale:' } },
          _sum: { amount: true },
          _count: true,
        }),
        this.prisma.walletTransaction.count({
          where: { type: 'BET_STAKE', status: 'PENDING', idempotencyKey: { startsWith: 'royale:' } },
        }),
        this.prisma.crashFreePlayTransaction.aggregate({
          where: { type: 'BET_PAYOUT', idempotencyKey: { startsWith: 'royale:' } },
          _sum: { amount: true },
          _count: true,
        }),
        this.prisma.crashFreePlayTransaction.aggregate({
          where: { type: 'BET_REFUND', idempotencyKey: { startsWith: 'royale:' } },
          _sum: { amount: true },
          _count: true,
        }),
      ]);

    // REAL_MONEY settlements carry the wallet anchor (transactionId != null).
    let realWinSettlementPayout = 0;
    let freeWinSettlementPayout = 0;
    let voidSettlementPayout = 0;
    let bustCount = 0;
    for (const row of settlements) {
      if (row.result === 'VOIDED') {
        voidSettlementPayout += row.payout;
        continue;
      }
      if (row.result === 'MINES_BUST') bustCount += 1;
      if (row.transactionId) realWinSettlementPayout += row.payout;
      else freeWinSettlementPayout += row.payout;
    }

    const walletWinSum = walletWins._sum.amount ?? 0;
    const freeWinSum = freeplayWins._sum.amount ?? 0;
    return {
      generatedAt: new Date().toISOString(),
      settlements: {
        total: settlements.length,
        bustCount,
        voidPayout: voidSettlementPayout,
        realMoneyWinPayout: realWinSettlementPayout,
        freePlayWinPayout: freeWinSettlementPayout,
      },
      ledger: {
        walletBetPayoutSum: walletWinSum,
        walletBetPayoutCount: walletWins._count,
        walletPendingStakes: walletPending,
        freePlayBetPayoutSum: freeWinSum,
        freePlayBetPayoutCount: freeplayWins._count,
        freePlayRefundSum: freeplayRefunds._sum.amount ?? 0,
        freePlayRefundCount: freeplayRefunds._count,
      },
      matches: {
        // A mismatch means game records and money disagree — investigate before
        // ANY real-money enablement (an operational blocker, not a warning).
        realMoneyWins: walletWinSum === realWinSettlementPayout,
        freePlayWins: freeWinSum === freeWinSettlementPayout,
      },
    };
  }
}

/**
 * REST contract for the Sky Rocket crash game (server-authoritative).
 *
 * All endpoints require authentication (global JWT guard) except the public
 * provably-fair verification and public crash history. Clients NEVER provide
 * multipliers, crash points, or balances — only stakes and idempotency keys.
 */

import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CrashService } from './crash.service';
import { CrashFreePlayWalletService } from './crash-freeplay-wallet.service';
import { CRASH_FREE_PLAY_CURRENCY } from './crash.types';
import {
  CashOutCrashBetDto,
  CrashHistoryQueryDto,
  CrashMyHistoryQueryDto,
  CrashRoundVerifyQueryDto,
  PlaceCrashBetDto,
} from './dto/crash.dto';

@Controller('games/crash')
export class CrashController {
  constructor(
    private readonly crash: CrashService,
    private readonly freePlayWallet: CrashFreePlayWalletService,
  ) {}

  /**
   * The caller's FREE-PLAY points balance.
   *
   * This is the ONLY way the frontend may read demo points. The points ledger
   * (`CrashFreePlayWallet` / `CrashFreePlayTransaction`) is a completely
   * separate, append-only ledger from the real-money `Wallet` — different
   * table, different currency code, no deposit or withdrawal path — so this
   * value must never be rendered next to, or mistaken for, a real balance.
   *
   * The wallet row is created on first read so a brand-new account reports the
   * configured starting points instead of a misleading zero.
   */
  @Get('free-play/points')
  async getFreePlayPoints(@CurrentUser() user: AuthenticatedUser) {
    const wallet = await this.freePlayWallet.getOrCreateWallet(user.id);

    return {
      points: wallet.balance,
      currency: CRASH_FREE_PLAY_CURRENCY,
      /*
       * An explicit marker so the client can never accidentally treat this
       * number as money.
       */
      mode: 'FREE_PLAY',
    };
  }

  /** Authoritative snapshot — the reconnect/resume mechanism. */
  @Get('current')
  async getCurrent(@CurrentUser() user: AuthenticatedUser) {
    return this.crash.getSnapshot(user.id);
  }

  /** Public previous-crash multipliers (no private data). */
  @Public()
  @Get('history')
  async getHistory(@Query() query: CrashHistoryQueryDto) {
    const history = await this.crash.getPublicHistory(query.limit ?? 20);
    return { history };
  }

  /** Anonymized live bet list for a round (privacy-safe). */
  @Get('rounds/:roundId/bets')
  async getLiveBets(@Param('roundId') roundId: string) {
    return this.crash.getLiveBets(roundId);
  }

  @Post('bets')
  async placeBet(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PlaceCrashBetDto,
  ) {
    return { bet: await this.crash.placeBet(user, dto) };
  }

  @Post('bets/:betId/cashout')
  async cashOut(
    @CurrentUser() user: AuthenticatedUser,
    @Param('betId') betId: string,
    @Body() dto: CashOutCrashBetDto,
  ) {
    return { bet: await this.crash.cashOut(user, betId, dto) };
  }

  @Get('bets/:betId')
  async getBet(
    @CurrentUser() user: AuthenticatedUser,
    @Param('betId') betId: string,
  ) {
    return { bet: await this.crash.getMyBet(user.id, betId) };
  }

  @Get('my-history')
  async getMyHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CrashMyHistoryQueryDto,
  ) {
    const history = await this.crash.getMyHistory(user.id, query.limit ?? 25, query.mode);
    return { history };
  }

  /** Provably-fair verification (seed is revealed only after the crash). */
  @Public()
  @Get('rounds/verify')
  async verifyRound(@Query() query: CrashRoundVerifyQueryDto) {
    return this.crash.verifyRound(query.roundNumber);
  }
}

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
import {
  CashOutCrashBetDto,
  CrashHistoryQueryDto,
  CrashMyHistoryQueryDto,
  CrashRoundVerifyQueryDto,
  PlaceCrashBetDto,
} from './dto/crash.dto';

@Controller('games/crash')
export class CrashController {
  constructor(private readonly crash: CrashService) {}

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

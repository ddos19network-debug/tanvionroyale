import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { RoyaleAceService } from './ace/ace.service';
import { AceAutoplayLimitsDto, AceHistoryQueryDto, AceSpinDto } from './dto/ace.dto';
import { DEFAULT_ACE_CONFIG } from './ace/ace-config';

/**
 * TANVION ROYALE — "Royale Ace" (royale-ace) REST contract.
 *
 * Every route requires authentication (global JwtAuthGuard); there are no
 * @Public routes. The client sends ONLY a stake, an optional currency, an
 * idempotency key and presentation flags — the server derives the ENTIRE round
 * (initial grid, every cascade step, golden->wild placements, the multiplier
 * ladder, the scatter trigger, the whole free-spin sequence and the capped
 * total win) and the client only replays it.
 *
 * Abuse prevention mirrors the other Royale games: per-route Throttler limits
 * on top of the global rate limit, idempotency keys on every money-moving
 * call, and one in-flight round per user per currency (advisory lock).
 *
 * REAL_MONEY is fail-closed on EVERY spin: master switch -> game switch ->
 * jurisdiction + currency -> account status/KYC/18+ -> responsible-gambling
 * limits. A rejection produces the same "real money unavailable" shape as the
 * other games and leaves the wallet untouched; FREE_PLAY keeps working.
 */
@ApiTags('games/royale-ace')
@Controller('games/royale-ace')
export class RoyaleAceController {
  constructor(private readonly ace: RoyaleAceService) {}

  @Get('config')
  @ApiOperation({
    summary: 'Server config, paytable, ladders, bet levels and REAL/FREE gate status',
  })
  getConfig(@CurrentUser() user?: AuthenticatedUser) {
    return this.ace.getConfigView(user);
  }

  @Post('spin')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Play one full round — the whole cascade + free-spin outcome is derived and settled server-side in one transaction',
  })
  async spin(@CurrentUser() user: AuthenticatedUser, @Body() dto: AceSpinDto) {
    return { round: await this.ace.spin(user, dto) };
  }

  @Get('history')
  @ApiOperation({ summary: 'My recent Royale Ace rounds' })
  async history(@CurrentUser() user: AuthenticatedUser, @Query() query: AceHistoryQueryDto) {
    return { rounds: await this.ace.getHistory(user.id, query.limit ?? 25) };
  }

  @Get('rounds/:roundId/verify')
  @ApiOperation({
    summary:
      'Re-derive an entire settled round from the revealed seeds + its exact config version',
  })
  verify(@CurrentUser() user: AuthenticatedUser, @Param('roundId') roundId: string) {
    return this.ace.verify(user.id, roundId);
  }

  /**
   * Responsible-play contract. Autoplay is a client-side loop over `spin`, so
   * the limits themselves are advisory to the SERVER; they are validated here
   * and returned to the UI so it can stop deterministically (on any limit, on a
   * feature trigger, and when the reality-check timer fires).
   */
  @Post('autoplay/limits')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Validate the autoplay limit set the client will self-enforce',
  })
  autoplayLimits(@Body() dto: AceAutoplayLimitsDto) {
    return {
      accepted: true,
      stopsOnFeatureTrigger: true,
      stopsOnLossLimit: dto.lossLimit > 0,
      stopsOnWinLimit: dto.winLimit > 0,
      spinCount: dto.spinCount,
      lossLimit: dto.lossLimit,
      winLimit: dto.winLimit,
      /** Server-side sanity ceiling, independent of the client's request. */
      maxSpinCount: 1000,
      maxWinMultiplierBp: DEFAULT_ACE_CONFIG.maxWinBp,
    };
  }
}

import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user';
import { RoyaleAceService } from './ace.service';
import { AceAutoplayLimitsDto, AceHistoryQueryDto, AceSpinDto } from '../dto/ace.dto';

/**
 * TANVION ROYALE — "Royale Ace" (royale-ace) player REST contract.
 *
 * Every route requires authentication (the global JwtAuthGuard) — there are no
 * @Public routes here. Clients send ONLY a stake, an optional currency, an
 * idempotency key and presentation flags; the server owns the reels, cascades,
 * multipliers, payouts and balances.
 *
 * The client is a DUMB REPLAYER: `spin` returns the ENTIRE round up front
 * (initial grid, every cascade step, wild placements, multipliers, the full
 * free-spin sequence and the capped total win) and the client animates it.
 * No route accepts — or could ever accept — a multiplier, payout, grid or seed.
 *
 * Abuse prevention: per-route Throttler limits on top of the global rate limit,
 * plus idempotency keys for retried money-moving requests.
 */
@ApiTags('games/royale')
@Controller('games/royale')
export class RoyaleAceController {
  constructor(private readonly ace: RoyaleAceService) {}

  // --------------------------------------------------------------------------
  // Royale Ace
  // --------------------------------------------------------------------------

  @Get('ace/config')
  @ApiOperation({ summary: 'Ace config + mode/gate status, paytable and bet levels' })
  async aceConfig(@CurrentUser() user?: AuthenticatedUser) {
    return this.ace.getConfigView(user);
  }

  @Post('ace/spin')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Spin — the whole round is frozen server-side and settled atomically' })
  async aceSpin(@CurrentUser() user: AuthenticatedUser, @Body() dto: AceSpinDto) {
    return { round: await this.ace.spin(user, dto) };
  }

  /**
   * Autoplay limits are validated and echoed back so the UI can enforce them
   * and drive the reality-check timer. Autoplay itself is a client loop over
   * `spin`, and it MUST stop on a feature trigger or when any limit is hit.
   */
  @Post('ace/autoplay/limits')
  @ApiOperation({ summary: 'Validate the autoplay loss/win/spin-count limits' })
  aceAutoplayLimits(@CurrentUser() _user: AuthenticatedUser, @Body() dto: AceAutoplayLimitsDto) {
    return { limits: dto };
  }

  @Get('ace/history')
  @ApiOperation({ summary: 'My recent Royale Ace rounds' })
  async aceHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AceHistoryQueryDto,
  ) {
    return { rounds: await this.ace.getHistory(user.id, query.limit ?? 25) };
  }

  @Get('ace/rounds/:roundId')
  @ApiOperation({ summary: 'One of my Royale Ace rounds (full replay payload)' })
  async aceRound(@CurrentUser() user: AuthenticatedUser, @Param('roundId') roundId: string) {
    return { round: await this.ace.getRound(user.id, roundId) };
  }

  @Post('ace/rounds/:roundId/verify')
  @ApiOperation({ summary: 'Provably-fair verification of a SETTLED Royale Ace round' })
  aceVerify(@CurrentUser() user: AuthenticatedUser, @Param('roundId') roundId: string) {
    return this.ace.verify(user.id, roundId);
  }
}

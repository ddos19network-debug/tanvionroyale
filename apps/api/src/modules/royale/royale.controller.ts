import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { RoyalePlinkoService } from './royale-plinko.service';
import { RoyaleMinesService } from './royale-mines.service';
import {
  DropPlinkoDto,
  MinesActionDto,
  PayoutTableQueryDto,
  RevealMinesTileDto,
  RoyaleHistoryQueryDto,
  StartMinesDto,
} from './dto/royale.dto';

/**
 * TANVION ROYALE — Royale Play REST contract (Plinko + Mines).
 *
 * Every route requires authentication (global JwtAuthGuard) — there are no
 * @Public routes here. Clients send ONLY stakes, board choices, tile indexes
 * and idempotency keys; the server owns outcomes, multipliers, payouts and
 * balances. Abuse prevention: per-route Throttler limits on top of the global
 * rate limit, plus idempotency keys for retried money-moving requests.
 */
@ApiTags('games/royale')
@Controller('games/royale')
export class RoyaleController {
  constructor(
    private readonly plinko: RoyalePlinkoService,
    private readonly mines: RoyaleMinesService,
  ) {}

  @Get('config')
  @ApiOperation({ summary: 'Server config + mode/gate status for both Royale games' })
  getConfig() {
    return this.plinko.getConfigView();
  }

  // --------------------------------------------------------------------------
  // Plinko
  // --------------------------------------------------------------------------

  @Get('plinko/payout-table')
  @ApiOperation({ summary: 'Validated server payout table for a board configuration' })
  payoutTable(@Query() query: PayoutTableQueryDto) {
    return this.plinko.payoutTable(query.rows, query.risk);
  }

  @Post('plinko/drop')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Drop the ball — outcome frozen server-side, settled atomically' })
  async drop(@CurrentUser() user: AuthenticatedUser, @Body() dto: DropPlinkoDto) {
    return { round: await this.plinko.drop(user, dto) };
  }

  @Get('plinko/history')
  @ApiOperation({ summary: 'My recent Plinko rounds' })
  async plinkoHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: RoyaleHistoryQueryDto,
  ) {
    return { rounds: await this.plinko.getHistory(user.id, query.limit ?? 25) };
  }

  @Get('plinko/rounds/:roundId/verify')
  @ApiOperation({ summary: 'Provably-fair verification of one of my Plinko rounds' })
  verifyPlinko(@CurrentUser() user: AuthenticatedUser, @Param('roundId') roundId: string) {
    return this.plinko.verify(user.id, roundId);
  }

  // --------------------------------------------------------------------------
  // Mines
  // --------------------------------------------------------------------------

  @Get('mines/active')
  @ApiOperation({ summary: 'My ACTIVE Mines round (reconnect/restart recovery)' })
  async minesActive(@CurrentUser() user: AuthenticatedUser) {
    return { round: await this.mines.getActive(user.id) };
  }

  @Post('mines/start')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Start a Mines round — one ACTIVE round per player' })
  async minesStart(@CurrentUser() user: AuthenticatedUser, @Body() dto: StartMinesDto) {
    return { round: await this.mines.start(user, dto) };
  }

  @Post('mines/:roundId/reveal')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Reveal one tile (idempotent for already-revealed safe tiles)' })
  minesReveal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('roundId') roundId: string,
    @Body() dto: RevealMinesTileDto,
  ) {
    return this.mines.reveal(user, roundId, dto.tile);
  }

  @Post('mines/:roundId/cashout')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Cash out the current Mines multiplier' })
  minesCashout(
    @CurrentUser() user: AuthenticatedUser,
    @Param('roundId') roundId: string,
    @Body() dto: MinesActionDto,
  ) {
    void dto; // optional clientRequestId accepted for client-side tracing
    return this.mines.cashout(user, roundId);
  }

  @Post('mines/:roundId/forfeit')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Forfeit an ACTIVE Mines round (settles as a bust)' })
  minesForfeit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('roundId') roundId: string,
    @Body() dto: MinesActionDto,
  ) {
    void dto;
    return this.mines.forfeit(user, roundId);
  }

  @Get('mines/history')
  @ApiOperation({ summary: 'My recent Mines rounds' })
  async minesHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: RoyaleHistoryQueryDto,
  ) {
    return { rounds: await this.mines.getHistory(user.id, query.limit ?? 25) };
  }

  @Get('mines/rounds/:roundId/verify')
  @ApiOperation({ summary: 'Provably-fair verification of a SETTLED Mines round' })
  verifyMines(@CurrentUser() user: AuthenticatedUser, @Param('roundId') roundId: string) {
    return this.mines.verify(user.id, roundId);
  }
}
import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { BettingService } from './betting.service';

/**
 * Public, read-only betting data. Only events belonging to gambling-available
 * games are ever served. Never exposes provider identifiers or secrets.
 */
@ApiTags('events')
@Public()
@Controller('events')
export class EventsController {
  constructor(private readonly bettingService: BettingService) {}

  @Get()
  @ApiOperation({ summary: 'List public, bettable events (active events only)' })
  async listEvents(
    @Query('status') status?: string,
    @Query('sport') sport?: string,
    @Query('competition') competition?: string,
  ) {
    return this.bettingService.listEvents(status, sport, competition);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an event with its markets, selections and odds' })
  async getEvent(@Param('id') id: string) {
    return this.bettingService.getEvent(id);
  }

  @Get(':id/markets')
  @ApiOperation({ summary: 'List markets for an event' })
  async listEventMarkets(@Param('id') id: string) {
    return this.bettingService.listEventMarkets(id);
  }

  @Get(':id/odds')
  @ApiOperation({ summary: 'List markets with selections and current odds for an event' })
  async listEventOdds(@Param('id') id: string) {
    return this.bettingService.getEvent(id);
  }
}

/**
 * Partner event routing. The destination is resolved server-side from the
 * allowlisted PartnerProvider configuration — the client can never supply an
 * arbitrary URL. Authentication is optional (public events are viewable), but
 * when a user is present we audit the redirect safely.
 */
@ApiTags('events')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('events')
export class PartnerEventsController {
  constructor(private readonly bettingService: BettingService) {}

  private context(req: Request): { ip?: string; userAgent?: string } {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  @Get(':id/redirect')
  @ApiOperation({ summary: 'Resolve the approved partner destination for a PARTNER event' })
  async getPartnerRedirect(
    @Param('id') id: string,
    @CurrentUser() auth: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.bettingService.getPartnerRedirect(id, auth, ip, userAgent);
  }
}

@ApiTags('markets')
@Public()
@Controller('markets')
export class MarketsController {
  constructor(private readonly bettingService: BettingService) {}

  @Get(':id/selections')
  @ApiOperation({ summary: 'List selections (with current odds) for a market' })
  async listSelections(@Param('id') id: string) {
    return this.bettingService.listMarketSelections(id);
  }
}
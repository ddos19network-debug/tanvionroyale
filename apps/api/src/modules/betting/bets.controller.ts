import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { BettingService } from './betting.service';
import { PlaceBetDto } from './dto/place-bet.dto';
import { ListBetsQueryDto } from './dto/list-bets-query.dto';

/**
 * Authenticated betting endpoints. JWT is required (the global guard already
 * enforces it since these routes are not @Public). A user is only ever able to
 * read/place their OWN bets — ownership is enforced in BettingService.
 */
@ApiTags('bets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('bets')
export class BetsController {
  constructor(private readonly bettingService: BettingService) {}

  private context(req: Request): { ip?: string; userAgent?: string } {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Place a bet (idempotency-safe)' })
  async placeBet(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() dto: PlaceBetDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.bettingService.placeBet(auth, dto, ip, userAgent);
  }

  @Get()
  @ApiOperation({ summary: 'List my bets, optional status filter' })
  async listMyBets(
    @CurrentUser() auth: AuthenticatedUser,
    @Query() query: ListBetsQueryDto,
  ) {
    return this.bettingService.listMyBets(auth, query.status, {
      limit: query.limit,
      page: query.page,
      search: query.search,
      result: query.result,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one of my bets (ownership enforced)' })
  async getMyBet(@CurrentUser() auth: AuthenticatedUser, @Param('id') id: string) {
    return this.bettingService.getMyBet(auth, id);
  }
}
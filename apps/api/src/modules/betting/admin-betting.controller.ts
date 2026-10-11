import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { SettlementService } from './settlement.service';
import { SettleEventDto, SettleBetDto } from './dto/settle-bet.dto';

/**
 * Trusted backend boundary for bet settlement.
 *
 * DEVELOPMENT/ADMIN ONLY — never exposed to normal users. Settlement is an
 * ADMIN/RBAC operation. ADMIN and SUPER_ADMIN are both accepted (matches the
 * rest of the admin panel). A future licensed operator would call the same
 * SettlementService from a verified webhook rather than this HTTP controller;
 * the wallet, ledger, bet model and frontend stay unchanged.
 */
@ApiTags('admin-betting')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@RequirePermissions(ADMIN_PERMISSIONS.BETTING_READ, ADMIN_PERMISSIONS.BETTING_SETTLE)
@Controller('admin/betting')
export class AdminBettingController {
  constructor(private readonly settlementService: SettlementService) {}

  @Post('bets/:id/settle')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Settle a SINGLE bet (ADMIN; atomic, idempotent; WIN/LOSS/VOID)',
  })
  async settleBet(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SettleBetDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = { ip: req.ip, userAgent: req.headers['user-agent'] };
    return this.settlementService.settleBet(id, dto.results, {
      actorId: auth.id,
      ip,
      userAgent,
    });
  }

  @Post('events/:id/settle')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Settle all accepted bets for an event (ADMIN; atomic per bet)',
  })
  async settleEvent(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SettleEventDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = { ip: req.ip, userAgent: req.headers['user-agent'] };
    return this.settlementService.settleEvent(id, dto.results, {
      actorId: auth.id,
      ip,
      userAgent,
    });
  }
}
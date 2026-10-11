import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { TradingService } from './trading.service';
import { PlaceTradingOrderDto, UpdateTradingInstrumentDto } from './dto/trading.dto';

/**
 * VIRTUAL PAPER TRADING — TANVIONROYALE Trading Platform.
 * Clearly labelled simulator: virtual balance only, never real money, never
 * the Wallet. Prices come from the configured MarketDataProvider and are
 * labelled DEMO until a real feed is configured.
 */
@ApiTags('trading')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('trading')
export class TradingController {
  constructor(private readonly tradingService: TradingService) {}

  @Get('account')
  @ApiOperation({ summary: 'Get (or create) my virtual paper-trading account' })
  async getAccount(@CurrentUser() auth: AuthenticatedUser) {
    return this.tradingService.getOrCreateAccount(auth.id);
  }

  @Get('account/portfolio')
  @ApiOperation({ summary: 'Virtual portfolio, equity, positions and P&L' })
  async portfolio(@CurrentUser() auth: AuthenticatedUser) {
    return this.tradingService.listPortfolio(auth.id);
  }

  @Get('instruments')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'List tradable virtual instruments with current prices' })
  async instruments(@CurrentUser() auth: AuthenticatedUser) {
    return this.tradingService.listInstruments(auth.id);
  }

  @Get('instruments/:id')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Instrument detail with price history chart data' })
  async instrument(@CurrentUser() auth: AuthenticatedUser, @Param('id') id: string) {
    return this.tradingService.getInstrument(auth.id, id);
  }

  @Post('orders')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Place a virtual market order (paper trading only)' })
  async placeOrder(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() dto: PlaceTradingOrderDto,
  ) {
    return this.tradingService.placeOrder(auth.id, dto.instrumentId, dto.side, dto.quantity);
  }

  @Get('orders')
  @ApiOperation({ summary: 'My recent virtual orders' })
  async orders(
    @CurrentUser() auth: AuthenticatedUser,
    @Query('limit') limit?: string,
  ) {
    return this.tradingService.listOrders(auth.id, Number.parseInt(limit ?? '50', 10));
  }

  @Get('positions')
  @ApiOperation({ summary: 'My open virtual positions' })
  async positions(@CurrentUser() auth: AuthenticatedUser) {
    const portfolio = await this.tradingService.listPortfolio(auth.id);
    return portfolio.positions;
  }

  @Post('positions/:id/close')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Close an open virtual position' })
  async closePosition(@CurrentUser() auth: AuthenticatedUser, @Param('id') id: string) {
    return this.tradingService.closePosition(auth.id, id);
  }

  @Get('history')
  @ApiOperation({ summary: 'Virtual transaction history (paper ledger)' })
  async history(
    @CurrentUser() auth: AuthenticatedUser,
    @Query('limit') limit?: string,
  ) {
    return this.tradingService.listTransactions(auth.id, Number(limit ?? '50'));
  }

  @Get('leaderboard')
  @ApiOperation({ summary: 'Top virtual accounts by equity' })
  async leaderboard(@CurrentUser() auth: AuthenticatedUser, @Query('limit') limit?: string) {
    void auth;
    return this.tradingService.getLeaderboard(Number(limit ?? '10'));
  }
}

/**
 * Admin endpoints for the paper-trading catalog (enable/disable instruments).
 * Secrets are never exposed; the panel only toggles availability.
 */
@ApiTags('admin/trading')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
@RequirePermissions(ADMIN_PERMISSIONS.TRADING_READ)
@Controller('admin/trading')
export class AdminTradingController {
  constructor(private readonly tradingService: TradingService) {}

  @Get('instruments')
  @ApiOperation({ summary: 'List all virtual instruments incl. disabled (admin)' })
  async instruments() {
    return this.tradingService.adminListInstruments();
  }

  @Patch('instruments/:id')
  @RequirePermissions(ADMIN_PERMISSIONS.TRADING_MANAGE)
  @ApiOperation({ summary: 'Enable/disable a virtual instrument (admin)' })
  async setEnabled(
    @Param('id') id: string,
    @Body() dto: UpdateTradingInstrumentDto,
    @Req() req: Request,
  ) {
    void req;
    return this.tradingService.adminSetInstrumentEnabled(id, dto.isEnabled);
  }
}
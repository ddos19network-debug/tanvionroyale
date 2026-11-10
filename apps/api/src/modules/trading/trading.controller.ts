import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { TradingService } from './trading.service';
import {
  PlaceTradingOrderDto,
  UpdateTradingInstrumentDto,
  VirtualBalanceFaucetDto,
} from './dto/trading.dto';

/**
 * TRADING PLATFORM API — TANVIONROYALE
 * Provides full exchange features: Candlesticks, Order Book, Market Depth,
 * Market / Limit / Stop-Limit execution, Real-time P&L, Demo Faucet.
 */
@ApiTags('trading')
@Controller('trading')
export class TradingController {
  constructor(private readonly tradingService: TradingService) {}

  // --------------------------------------------------------------------------
  // Public Market Data (Fast & Available to All)
  // --------------------------------------------------------------------------

  @Get('instruments')
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'List tradable virtual instruments with current prices' })
  async instruments(@CurrentUser() auth?: AuthenticatedUser) {
    return this.tradingService.listInstruments(auth?.id);
  }

  @Get('instruments/:id')
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Instrument detail with price history chart data' })
  async instrument(@Param('id') id: string, @CurrentUser() auth?: AuthenticatedUser) {
    return this.tradingService.getInstrument(auth?.id, id);
  }

  @Get('instruments/:id/candles')
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Instrument candlestick chart data (OHLCV)' })
  async candles(
    @Param('id') id: string,
    @Query('timeframe') timeframe?: string,
    @Query('count') count?: string,
    @CurrentUser() auth?: AuthenticatedUser,
  ) {
    return this.tradingService.getCandles(
      auth?.id,
      id,
      timeframe ?? '15m',
      count ? Number.parseInt(count, 10) : 80,
    );
  }

  @Get('instruments/:id/orderbook')
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Live Order Book Level 2 depth' })
  async orderBook(@Param('id') id: string, @CurrentUser() auth?: AuthenticatedUser) {
    return this.tradingService.getOrderBook(auth?.id, id);
  }

  @Get('instruments/:id/trades')
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Recent market trade executions stream' })
  async trades(
    @Param('id') id: string,
    @Query('count') count?: string,
    @CurrentUser() auth?: AuthenticatedUser,
  ) {
    return this.tradingService.getRecentTrades(
      auth?.id,
      id,
      count ? Number.parseInt(count, 10) : 25,
    );
  }

  @Get('leaderboard')
  @Public()
  @ApiOperation({ summary: 'Top virtual accounts by equity' })
  async leaderboard(@Query('limit') limit?: string) {
    return this.tradingService.getLeaderboard(Number(limit ?? '10'));
  }

  // --------------------------------------------------------------------------
  // Authenticated User Endpoints (Protected by JWT)
  // --------------------------------------------------------------------------

  @Get('account')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get (or create) my virtual paper-trading account' })
  async getAccount(@CurrentUser() auth: AuthenticatedUser) {
    return this.tradingService.getOrCreateAccount(auth.id);
  }

  @Post('account/faucet')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Claim demo faucet or reset virtual balance' })
  async faucet(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() dto: VirtualBalanceFaucetDto,
  ) {
    return this.tradingService.claimFaucet(auth.id, dto?.amount, dto?.reset);
  }

  @Get('account/portfolio')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Virtual portfolio, equity, positions and P&L' })
  async portfolio(@CurrentUser() auth: AuthenticatedUser) {
    return this.tradingService.listPortfolio(auth.id);
  }

  @Post('orders')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Place a virtual order (Market / Limit / Stop-Limit)' })
  async placeOrder(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() dto: PlaceTradingOrderDto,
  ) {
    return this.tradingService.placeOrder(
      auth.id,
      dto.instrumentId,
      dto.side,
      dto.quantity,
      dto.type ?? 'MARKET',
      dto.limitPrice,
      dto.stopPrice,
      dto.leverage ?? 1,
    );
  }

  @Get('orders/open')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'My active open limit/stop orders' })
  async openOrders(@CurrentUser() auth: AuthenticatedUser) {
    return this.tradingService.listOpenOrders(auth.id);
  }

  @Post('orders/:id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an open limit or stop order' })
  async cancelOrder(@CurrentUser() auth: AuthenticatedUser, @Param('id') id: string) {
    return this.tradingService.cancelOrder(auth.id, id);
  }

  @Get('orders')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'My recent virtual orders' })
  async orders(
    @CurrentUser() auth: AuthenticatedUser,
    @Query('limit') limit?: string,
  ) {
    return this.tradingService.listOrders(auth.id, Number.parseInt(limit ?? '50', 10));
  }

  @Get('positions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'My open virtual positions' })
  async positions(@CurrentUser() auth: AuthenticatedUser) {
    const portfolio = await this.tradingService.listPortfolio(auth.id);
    return portfolio.positions;
  }

  @Post('positions/:id/close')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Close an open virtual position' })
  async closePosition(@CurrentUser() auth: AuthenticatedUser, @Param('id') id: string) {
    return this.tradingService.closePosition(auth.id, id);
  }

  @Get('history')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Virtual transaction history (paper ledger)' })
  async history(
    @CurrentUser() auth: AuthenticatedUser,
    @Query('limit') limit?: string,
  ) {
    return this.tradingService.listTransactions(auth.id, Number(limit ?? '50'));
  }
}

/**
 * Admin endpoints for the paper-trading catalog (enable/disable instruments).
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

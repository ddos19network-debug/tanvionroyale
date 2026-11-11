import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TradingController, AdminTradingController } from './trading.controller';
import { TradingService } from './trading.service';
import { TradingGateway } from './trading.gateway';
import { MarketDataController } from './market-data.controller';
import { MarketDataService } from './market-data.service';

/**
 * PAPER (virtual) trading module — TANVION ROYALE Trading Platform.
 *
 * The paper account is fully separate from the real Wallet. Prices come from
 * the MarketDataProvider (DEMO until a real feed is configured). Everything is
 * virtual: no deposits/withdrawals, no real-money language.
 *
 * MarketDataService + MarketDataController provide server-side proxy
 * endpoints for Frankfurter (forex) and Yahoo Finance (stocks) so the
 * frontend never calls third-party APIs directly from the browser.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [
    TradingController,
    AdminTradingController,
    MarketDataController,
  ],
  providers: [TradingService, TradingGateway, MarketDataService],
  exports: [TradingService, MarketDataService],
})
export class TradingModule {}
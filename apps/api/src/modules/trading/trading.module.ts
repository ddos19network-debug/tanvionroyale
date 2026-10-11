import { Module } from '@nestjs/common';
import { TradingController, AdminTradingController } from './trading.controller';
import { TradingService } from './trading.service';

/**
 * PAPER (virtual) trading module — TANVION ROYALE Trading Platform.
 *
 * The paper account is fully separate from the real Wallet. Prices come from
 * the MarketDataProvider (DEMO until a real feed is configured). Everything is
 * virtual: no deposits/withdrawals, no real-money language.
 */
@Module({
  controllers: [TradingController, AdminTradingController],
  providers: [TradingService],
  exports: [TradingService],
})
export class TradingModule {}
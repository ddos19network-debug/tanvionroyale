import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TradingController, AdminTradingController } from './trading.controller';
import { TradingService } from './trading.service';
import { TradingGateway } from './trading.gateway';

/**
 * PAPER (virtual) trading module — TANVION ROYALE Trading Platform.
 *
 * The paper account is fully separate from the real Wallet. Prices come from
 * the MarketDataProvider (DEMO until a real feed is configured). Everything is
 * virtual: no deposits/withdrawals, no real-money language.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [TradingController, AdminTradingController],
  providers: [TradingService, TradingGateway],
  exports: [TradingService],
})
export class TradingModule {}
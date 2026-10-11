import { Module, type Provider } from '@nestjs/common';
import { createBettingProvider } from './betting-provider.factory';
import { BETTING_PROVIDER } from './provider.token';
import { WALLET_SERVICE } from './wallet.service';
import { WalletModule, WalletService } from '../wallet/wallet.module';
import { ReferralModule } from '../referral/referral.module';
import { BettingService } from './betting.service';
import { BetsController } from './bets.controller';
import { EventsController, MarketsController, PartnerEventsController } from './events.controller';
import { AdminBettingController } from './admin-betting.controller';
import { SettlementService } from './settlement.service';

/**
 * Phase 5 betting module + Phase 6 wallet integration.
 *
 * The provider abstraction is reused (packages/integrations): this module wires
 * the configured provider behind OperatorProviderInterface — no second
 * provider architecture. The provider factory NEVER selects a mock provider in
 * production: unset/unknown providers are replaced by the fail-safe
 * UnconfiguredOperatorAdapter (bets are never placed with fake money/odds).
 * Development/test continue to use the clearly-labelled MockOperatorAdapter. The
 * wallet boundary is the extended WalletServiceInterface: the ledger-backed
 * WalletService (WalletModule) is injected behind the SAME token.
 */
const bettingProvider: Provider = {
  provide: BETTING_PROVIDER,
  useFactory: () => createBettingProvider(),
};

@Module({
  imports: [WalletModule, ReferralModule],
  controllers: [
    BetsController,
    EventsController,
    MarketsController,
    PartnerEventsController,
    AdminBettingController,
  ],
  providers: [
    BettingService,
    SettlementService,
    bettingProvider,
    { provide: WALLET_SERVICE, useExisting: WalletService },
  ],
  exports: [BettingService],
})
export class BettingModule {}
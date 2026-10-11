import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { WinHouseAdminController } from './winhouse-admin.controller';
import { WinHouseCallbacksController } from './winhouse-callbacks.controller';
import { WinHouseController } from './winhouse.controller';
import { WinHouseLaunchService } from './winhouse-launch.service';
import { WinHouseProviderFactory } from './winhouse-provider.factory';
import { WinHouseWalletService } from './winhouse-wallet.service';

/**
 * EMBEDDED SPORTSBOOK module — BIG SPORT via WinHouse (SPORTS_IFRAME, Model B).
 *
 * Boundaries this module deliberately keeps:
 *  - the provider hosts the book; TANVION owns identity AND money. No odds,
 *    matches or betting data are invented or cached here;
 *  - money movements reuse the ONE wallet (`WalletModule`) — the provider never
 *    owns, stores or is trusted with a balance;
 *  - the two provider callbacks are authenticated by the callback token plus
 *    the HMAC-SHA256 signature (never a TANVION JWT), and they bypass the
 *    response envelope because their bodies ARE the provider's wire contract;
 *  - the browser only ever receives the PUBLIC embed key and a short-lived
 *    signed launch token.
 */
@Module({
  imports: [WalletModule],
  controllers: [WinHouseController, WinHouseCallbacksController, WinHouseAdminController],
  providers: [WinHouseProviderFactory, WinHouseLaunchService, WinHouseWalletService],
  exports: [WinHouseProviderFactory, WinHouseWalletService],
})
export class WinHouseModule {}

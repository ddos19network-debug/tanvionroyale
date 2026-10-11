/**
 * Sky Rocket crash game module — server-authoritative round engine,
 * ledger-backed bets/cash-outs, provably-fair seed handling, and the
 * WebSocket fan-out for web / mobile web / future native apps.
 */

import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { CrashAdminController } from './crash-admin.controller';
import { CrashController } from './crash.controller';
import { CrashEventBus } from './crash-events';
import { CrashFreePlayWalletService } from './crash-freeplay-wallet.service';
import { CrashGateway } from './crash.gateway';
import { CrashRoundEngine } from './crash-round-engine';
import { CrashSequenceService } from './crash-sequence.service';
import { CrashService } from './crash.service';

@Module({
  imports: [WalletModule],
  controllers: [CrashController, CrashAdminController],
  providers: [
    CrashEventBus,
    CrashRoundEngine,
    CrashSequenceService,
    CrashFreePlayWalletService,
    CrashService,
    CrashGateway,
  ],
  exports: [
    CrashEventBus,
    // Exported so the Royale Play module can reuse the ONE existing free-play
    // points ledger (no second points wallet is ever created).
    CrashFreePlayWalletService,
  ],
})
export class CrashModule {}

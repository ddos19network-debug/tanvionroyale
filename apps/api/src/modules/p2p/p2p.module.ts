import { Module } from '@nestjs/common';
import { P2PController } from './p2p.controller';
import { AdminP2PController } from './p2p.controller';
import { P2PService } from './p2p.service';
import { WalletModule } from '../wallet/wallet.module';

/**
 * P2P Crypto Marketplace + Royale Pay module.
 *
 * Reuses the existing WalletService for all atomic balance operations.
 * No duplicate wallet or transaction system is created.
 */
@Module({
  imports: [WalletModule],
  controllers: [P2PController, AdminP2PController],
  providers: [P2PService],
  exports: [P2PService],
})
export class P2PModule {}
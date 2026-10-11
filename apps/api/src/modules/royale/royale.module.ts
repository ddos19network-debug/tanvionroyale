import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { CrashModule } from '../crash/crash.module';
import { RoyaleController } from './royale.controller';
import { RoyaleAdminController } from './royale-admin.controller';
import { RoyalePlinkoService } from './royale-plinko.service';
import { RoyaleMinesService } from './royale-mines.service';

/**
 * Royale Play module — original server-authoritative Plinko + Mines.
 *
 * Reuses, never duplicates:
 *  - WalletModule (WalletService): the ONE real-money wallet/ledger/settlement.
 *  - CrashModule (CrashFreePlayWalletService): the ONE free-play points ledger.
 * Outcomes come from royale-fair (CSPRNG + HMAC commit/reveal); every action
 * writes GameAuditLog rows; admin routes are RBAC-guarded (ROYALE_READ).
 */
@Module({
  imports: [WalletModule, CrashModule],
  controllers: [RoyaleController, RoyaleAdminController],
  providers: [RoyalePlinkoService, RoyaleMinesService],
  exports: [RoyalePlinkoService, RoyaleMinesService],
})
export class RoyaleModule {}
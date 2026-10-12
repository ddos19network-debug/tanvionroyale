import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { CrashModule } from '../crash/crash.module';
import { ResponsibleGamblingModule } from '../responsible-gambling/responsible-gambling.module';
import { JurisdictionModule } from '../jurisdiction/jurisdiction.module';
import { RoyaleController } from './royale.controller';
import { RoyaleAdminController } from './royale-admin.controller';
import { RoyalePlinkoService } from './royale-plinko.service';
import { RoyaleMinesService } from './royale-mines.service';
import { RoyaleEligibilityService } from './royale-eligibility.service';
import { RoyaleAceController } from './ace.controller';
import { RoyaleAceAdminController } from './ace-admin.controller';
import { RoyaleAceService } from './ace/ace.service';
import { RoyaleAceAdminService } from './ace/ace-admin.service';
import { AceConfigStore } from './ace/ace-config-store';

/**
 * Royale Play module — original server-authoritative Plinko, Mines and
 * "Royale Ace" (royale-ace), a 5x4 / 1024-ways cascading card slot.
 *
 * Reuses, never duplicates:
 *  - WalletModule (WalletService): the ONE real-money wallet/ledger/settlement.
 *  - CrashModule (CrashFreePlayWalletService): the ONE free-play points ledger.
 *  - ResponsibleGamblingModule: self-exclusion + play limits enforced by the
 *    shared RoyaleEligibilityService BEFORE any REAL_MONEY wallet reservation.
 *  - JurisdictionModule: the central jurisdiction + currency control and the
 *    REAL_MONEY_ALL / GAME:<slug> kill switches, also enforced by the shared
 *    RoyaleEligibilityService before any REAL_MONEY wallet reservation.
 * Outcomes come from royale-fair / ace-fair (CSPRNG + HMAC commit/reveal); every
 * action writes GameAuditLog rows; admin routes are RBAC-guarded (ROYALE_READ).
 *
 * Royale Ace adds `AceConfigStore`: the single cached source of the ACTIVE
 * versioned game config (paytable, strips, ladders, caps, bet levels and
 * jurisdiction rules). Only `RoyaleAceAdminService` writes versions, and only
 * through `AceConfigStore`'s reload path.
 */
@Module({
  imports: [WalletModule, CrashModule, ResponsibleGamblingModule, JurisdictionModule],
  controllers: [RoyaleController, RoyaleAdminController, RoyaleAceController, RoyaleAceAdminController],
  providers: [
    RoyalePlinkoService,
    RoyaleMinesService,
    RoyaleEligibilityService,
    AceConfigStore,
    RoyaleAceService,
    RoyaleAceAdminService,
  ],
  exports: [
    RoyalePlinkoService,
    RoyaleMinesService,
    RoyaleEligibilityService,
    AceConfigStore,
    RoyaleAceService,
    RoyaleAceAdminService,
  ],
})
export class RoyaleModule {}
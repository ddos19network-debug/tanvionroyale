import { Global, Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { ReferralService } from './referral.service';
import { ReferralController } from './referral.controller';
import { AdminReferralController } from './admin-referral.controller';
import { AffiliateService } from './affiliate.service';
import { AffiliateController } from './affiliate.controller';
import { AdminAffiliateController } from './admin-affiliate.controller';

/**
 * REFERRAL MODULE.
 *
 * GLOBAL — the same pattern `NotificationsModule` already uses, and for the
 * same reason: `WalletModule` (via DepositService) and `AuthModule` (via
 * AuthService) both need `ReferralService` to emit a qualification signal and
 * to attribute a registration, but `ReferralModule` itself depends on
 * `WalletService` from `WalletModule`. Importing ReferralModule back into
 * WalletModule would be a circular import, so the module is GLOBAL and the
 * provider resolves anywhere without an explicit import.
 *
 * `NotificationsModule` is likewise NOT imported: it is `@Global()` too, so
 * `NotificationService` resolves without an import cycle.
 *
 * `WalletModule` IS imported because referral rewards are real money and must
 * move through the ledger-backed `WalletService` - never around it.
 *
 * The AFFILIATE layer (`AffiliateService` + its two controllers) lives in this
 * same module on purpose. It is a reporting layer over the tables this module
 * already owns, not a second referral system: it holds no referral, no reward
 * and no balance of its own.
 */
@Global()
@Module({
  imports: [WalletModule],
  controllers: [
    ReferralController,
    AdminReferralController,
    AffiliateController,
    AdminAffiliateController,
  ],
  providers: [ReferralService, AffiliateService],
  exports: [ReferralService, AffiliateService],
})
export class ReferralModule {}

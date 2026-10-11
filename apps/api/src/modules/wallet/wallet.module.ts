import { Module, type Provider } from '@nestjs/common';
import { DEPOSIT_PROVIDER, WITHDRAWAL_PROVIDER } from './payment.provider.token';
import { createDepositProvider, createWithdrawalProvider } from './payment-provider.factory';
import { WalletService } from './wallet.service';
import { DepositService } from './deposit.service';
import { WithdrawalService } from './withdrawal.service';
import { ManualPaymentService } from './manual-payment.service';
import { PaymentGatewaysService } from './payment-gateways.service';
import { PaymentWebhooksService } from './payment-webhooks.service';
import { WalletController } from './wallet.controller';
import { AdminWalletController } from './admin-wallet.controller';
import { AdminPaymentMethodsController } from './admin-payment-methods.controller';
import { AdminManualDepositsController } from './admin-manual-deposits.controller';
import { AdminManualWithdrawalsController } from './admin-manual-withdrawals.controller';
import { AdminPaymentGatewaysController } from './admin-payment-gateways.controller';
import { PaymentWebhooksController } from './payment-webhooks.controller';

/**
 * Phase 6 wallet module.
 *
 * The provider abstraction is reused (packages/integrations): payment providers
 * are selected by the payment-provider factory. The factory NEVER selects a
 * dev-mock provider in production: unset/unknown providers are replaced by
 * the fail-safe UnconfiguredPaymentProvider (no fake money is ever created).
 * Development/test continue to use the clearly-labelled DevMock providers.
 */
const depositProvider: Provider = {
  provide: DEPOSIT_PROVIDER,
  useFactory: () => createDepositProvider(),
};

const withdrawalProvider: Provider = {
  provide: WITHDRAWAL_PROVIDER,
  useFactory: () => createWithdrawalProvider(),
};

@Module({
  controllers: [
    WalletController,
    AdminWalletController,
    AdminPaymentMethodsController,
    AdminManualDepositsController,
    AdminManualWithdrawalsController,
    AdminPaymentGatewaysController,
    PaymentWebhooksController,
  ],
  providers: [
    WalletService,
    DepositService,
    WithdrawalService,
    ManualPaymentService,
    PaymentGatewaysService,
    PaymentWebhooksService,
    depositProvider,
    withdrawalProvider,
  ],
  exports: [WalletService, ManualPaymentService, PaymentGatewaysService, PaymentWebhooksService],
})
export class WalletModule {}

export { WalletService };
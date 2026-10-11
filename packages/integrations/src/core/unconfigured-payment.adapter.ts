import type {
  DepositProviderInterface,
  DepositProviderResult,
  DepositRequest,
  WithdrawalProviderInterface,
  WithdrawalProviderResult,
  WithdrawalRequest,
} from '../interfaces/payment-provider.interface';
import type { ProviderTransactionStatus } from '../interfaces/types';

/**
 * Placeholder payment provider returned when NO real payment provider has been
 * configured.
 *
 * PRODUCTION SAFETY: this adapter is wired whenever `PAYMENT_PROVIDER`
 * is unset/`mock` (or names a provider with no adapter implemented yet). It
 * NEVER fabricates deposits, withdrawals or balances — every operation fails
 * with a clear provider-unavailable error so the wallet shows
 * "configuration required / service unavailable" instead of fake money.

 * The dev-mock payment provider remains available ONLY outside production
 * (dev/test) where it is used by automated tests and local development.
 */
export class UnconfiguredPaymentProvider implements DepositProviderInterface, WithdrawalProviderInterface {
  readonly name = 'unconfigured';

  constructor(private readonly detail = 'Payment provider is not configured') {}

  private fail(): never {
    const error = new Error(this.detail);
    (error as { code?: string }).code = 'PROVIDER_UNAVAILABLE';
    throw error;
  }

  async initDeposit(_request: DepositRequest): Promise<DepositProviderResult> {
    this.fail();
  }
  async getDepositStatus(_externalTransactionId: string): Promise<ProviderTransactionStatus> {
    this.fail();
  }
  async requestWithdrawal(_request: WithdrawalRequest): Promise<WithdrawalProviderResult> {
    this.fail();
  }
  async getWithdrawalStatus(_externalTransactionId: string): Promise<ProviderTransactionStatus> {
    this.fail();
  }
}
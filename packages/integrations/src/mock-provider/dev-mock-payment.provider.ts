/* eslint-disable @typescript-eslint/no-unused-vars */
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
 * DEVELOPMENT ONLY — NO REAL MONEY.
 *
 * Synchronous in-process mock of a licensed payment provider. It never touches
 * a network, a bank, a card or any real funds. It always completes instantly
 * unless `simulateFailure` (or the WALLET_MOCK_FAILURE env flag) forces the
 * failure path so the PENDING → FAILED lifecycle can be exercised.
 *
 * A real licensed payment provider replaces this class behind
 * DepositProviderInterface / WithdrawalProviderInterface with no other
 * changes to the application.
 */
export class DevMockPaymentProvider implements DepositProviderInterface, WithdrawalProviderInterface {
  readonly name = 'dev-mock-payments';

  /** Force provider-side failures (tests / explicit dev wiring only). */
  public simulateFailure = false;

  private ref(externalId: string): string {
    return `mock-tx-${externalId}`;
  }

  private status(): 'FAILED' | 'SUCCESS' {
    return this.simulateFailure ? 'FAILED' : 'SUCCESS';
  }

  private message(): string {
    return this.simulateFailure ? 'DEVELOPMENT MOCK — simulated provider failure' : 'DEVELOPMENT MOCK — no real money';
  }

  async initDeposit(request: DepositRequest): Promise<DepositProviderResult> {
    return {
      externalTransactionId: this.ref(request.idempotencyKey),
      status: this.status(),
      message: this.message(),
    };
  }

  async requestWithdrawal(request: WithdrawalRequest): Promise<WithdrawalProviderResult> {
    return {
      externalTransactionId: this.ref(request.idempotencyKey),
      status: this.status(),
      message: this.message(),
    };
  }

  async getDepositStatus(_externalTransactionId: string): Promise<ProviderTransactionStatus> {
    return this.status();
  }

  async getWithdrawalStatus(_externalTransactionId: string): Promise<ProviderTransactionStatus> {
    return this.status();
  }
}

/** Development-only deposit provider alias (DEVELOPMENT ONLY / NO REAL MONEY). */
export class DevMockDepositProvider extends DevMockPaymentProvider {}

/** Development-only withdrawal provider alias (DEVELOPMENT ONLY / NO REAL MONEY). */
export class DevMockWithdrawalProvider extends DevMockPaymentProvider {}

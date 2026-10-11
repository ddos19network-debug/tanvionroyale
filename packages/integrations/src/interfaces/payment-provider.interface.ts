import type { MinorUnit } from '@tanvion-royale/types';
import type { ProviderTransactionStatus } from './types';

/**
 * Payment provider contracts (Phase 6 wallet foundation).
 *
 * These are the ONLY integration points a future licensed payment partner
 * needs to implement — the wallet domain, ledger, frontend and betting code
 * depend exclusively on these interfaces. No real provider is implemented;
 * only clearly-marked development mocks exist.
 *
 * All money is integer minor units; all currency codes are ISO 4217.
 */

export interface DepositRequest {
  /** TanvionRoyale internal user id (never a provider account identity). */
  accountRef: string;
  /** Positive integer minor units. */
  amount: MinorUnit;
  currency: string;
  /** Idempotency key shared with the wallet transaction row. */
  idempotencyKey: string;
}

export interface DepositProviderResult {
  externalTransactionId: string;
  status: Extract<ProviderTransactionStatus, 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED'>;
  message: string | null;
}

export interface WithdrawalRequest {
  accountRef: string;
  amount: MinorUnit;
  currency: string;
  idempotencyKey: string;
}

export interface WithdrawalProviderResult {
  externalTransactionId: string;
  status: Extract<ProviderTransactionStatus, 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'CANCELLED'>;
  message: string | null;
}

/**
 * A deposit provider moves external money INTO the wallet. Providers only
 * ever CONFIRM outcomes; the wallet credits funds only after provider
 * confirmation (never from frontend input).
 */
export interface DepositProviderInterface {
  readonly name: string;
  initDeposit(request: DepositRequest): Promise<DepositProviderResult>;
  getDepositStatus(externalTransactionId: string): Promise<ProviderTransactionStatus>;
}

/**
 * A withdrawal provider moves wallet funds OUT to an external destination.
 * The caller must reserve/lock funds BEFORE calling the provider and settle
 * the lock afterwards (completed → release debit, failed → release credit).
 */
export interface WithdrawalProviderInterface {
  readonly name: string;
  requestWithdrawal(request: WithdrawalRequest): Promise<WithdrawalProviderResult>;
  getWithdrawalStatus(externalTransactionId: string): Promise<ProviderTransactionStatus>;
}

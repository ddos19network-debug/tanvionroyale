import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { CreateWalletTransactionResponse } from '@tanvion-royale/types';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import {
  WalletService,
  toTransactionView,
  toWalletView,
  type WalletTransactionRow,
} from './wallet.service';
import { WITHDRAWAL_PROVIDER, type WithdrawalProviderInterface } from './payment.provider.token';
import { isWalletError } from './wallet-errors';

/**
 * Withdrawal orchestration (Phase 6 foundation).
 *
 * Funds are RESERVED FIRST: available -= amount, locked += amount (one ledger
 * entry). Then the provider runs:
 *   COMPLETED  → locked -= amount (funds leave; second ledger entry)
 *   FAILED     → locked -= amount, available += amount (release; credit entry)
 * availableBalance can never go below zero — the check happens under a row
 * lock inside the wallet ledger engine.
 *
 * No real provider is wired; DevMockWithdrawalProvider is
 * DEVELOPMENT ONLY / NO REAL MONEY.
 */
@Injectable()
export class WithdrawalService {
  constructor(
    private readonly wallet: WalletService,
    @Inject(WITHDRAWAL_PROVIDER) private readonly provider: WithdrawalProviderInterface,
  ) {}

  async createWithdrawal(
    auth: AuthenticatedUser,
    input: { amount: number; currency: string; idempotencyKey: string },
    ip?: string,
    userAgent?: string,
  ): Promise<CreateWalletTransactionResponse> {
    // Server-side policy: currency + limits. Never trusted from the client.
    this.wallet.assertAmountInRange(input.amount, 'withdrawal');

    // Idempotency: a repeat request returns the original transaction.
    const existing = await this.wallet.findTransaction(auth.id, input.idempotencyKey);
    if (existing) {
      const walletRow = await this.wallet.getOrCreateWalletForUser(auth.id, input.currency);
      return {
        transaction: toTransactionView(existing),
        wallet: toWalletView(walletRow),
        duplicate: true,
      };
    }

    // 1. Reserve the funds (atomic lock + ledger entry; throws INSUFFICIENT_FUNDS).
    const walletRow = await this.wallet.getOrCreateWalletForUser(auth.id, input.currency);
    const pending = await this.wallet.reserveWithdrawal(walletRow, input);
    await this.wallet.audit('WITHDRAWAL_CREATED', auth.id, 'WalletTransaction', pending.id, {
      amount: input.amount,
      currency: input.currency,
    });

    // 2. Ask the provider (the dev mock resolves synchronously).
    try {
      const result = await this.provider.requestWithdrawal({
        accountRef: auth.id,
        amount: input.amount,
        currency: input.currency,
        idempotencyKey: input.idempotencyKey,
      });

      if (result.status === 'FAILED' || result.status === 'CANCELLED') {
        const failed = await this.wallet.releaseWithdrawal(
          pending,
          walletRow,
          'FAILED',
          result.message ?? 'Provider rejected the withdrawal',
        );
        await this.wallet.audit('WITHDRAWAL_FAILED', auth.id, 'WalletTransaction', pending.id, {
          reason: result.message,
        });
        return {
          transaction: toTransactionView(failed),
          wallet: toWalletView(await this.wallet.getOrCreateWalletForUser(auth.id, input.currency)),
          duplicate: false,
        };
      }

      // 3. Provider confirmed with SUCCESS → settle the lock: funds leave the wallet.
      // PENDING / PROCESSING means the gateway has NOT confirmed yet — keep the
      // funds reserved (transaction stays PENDING) so a later status check /
      // webhook can settle exactly once. Never complete without confirmation.
      if (result.status === 'PENDING' || result.status === 'PROCESSING') {
        const parked = await this.wallet.transitionTransaction(
          pending,
          'PROCESSING',
          result.message ?? 'Waiting for provider confirmation',
        );
        await this.wallet.audit('WITHDRAWAL_PENDING', auth.id, 'WalletTransaction', pending.id, {
          amount: input.amount,
          currency: input.currency,
          reference: result.externalTransactionId,
        });
        return {
          transaction: toTransactionView(parked),
          wallet: toWalletView(await this.wallet.getOrCreateWalletForUser(auth.id, input.currency)),
          duplicate: false,
        };
      }
      const completed = (await this.wallet.completeWithdrawal(pending, walletRow, result.externalTransactionId)) as WalletTransactionRow;
      await this.wallet.audit('WITHDRAWAL_COMPLETED', auth.id, 'WalletTransaction', pending.id, {
        amount: input.amount,
        currency: input.currency,
        reference: result.externalTransactionId,
      });
      return {
        transaction: toTransactionView(completed),
        wallet: toWalletView(await this.wallet.getOrCreateWalletForUser(auth.id, input.currency)),
        duplicate: false,
      };
    } catch (error) {
      // A provider that is not configured must surface clearly - never pretend
      // funds left the wallet or leave a hung lock.

      if (
        error instanceof ServiceUnavailableException ||
        (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'PROVIDER_UNAVAILABLE')
      ) {
        throw new ServiceUnavailableException('Payment provider is not configured. Contact support to enable withdrawals.');
      }
      // Domain errors (validation) propagate; provider failures release funds.
      if (isWalletError(error, 'PROVIDER_UNAVAILABLE')) throw error;
      const released = await this.wallet
        .releaseWithdrawal(pending, walletRow, 'FAILED', 'Provider unavailable')
        .catch(() => null);
      if (released) {
        await this.wallet.audit('WITHDRAWAL_FAILED', auth.id, 'WalletTransaction', pending.id, {
          reason: 'Provider unavailable',
          ip,
          userAgent,
        });
        return {
          transaction: toTransactionView(released),
          wallet: toWalletView(await this.wallet.getOrCreateWalletForUser(auth.id, input.currency)),
          duplicate: false,
        };
      }
      throw error;
    }
  }
}

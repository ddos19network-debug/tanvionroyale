import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import type { CreateWalletTransactionResponse } from '@tanvion-royale/types';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { DEPOSIT_PROVIDER, type DepositProviderInterface } from './payment.provider.token';
import type { ReferralService } from '../referral/referral.service';
import {
  WalletService,
  toTransactionView,
  toWalletView,
  type WalletTransactionRow,
} from './wallet.service';

/**
 * Deposit orchestration (Phase 6 foundation).
 *
 * Lifecycle: PENDING → PROCESSING → COMPLETED (or PENDING → FAILED).
 * Only backend/provider confirmation can complete a deposit — the frontend
 * has NO endpoint to mark a deposit completed. No real provider is wired;
 * DevMockDepositProvider is DEVELOPMENT ONLY / NO REAL MONEY.
 */
@Injectable()
export class DepositService {
  constructor(
    private readonly wallet: WalletService,
    @Inject(DEPOSIT_PROVIDER) private readonly provider: DepositProviderInterface,
    // Referral qualification. Optional so the existing 2-arg unit tests and any
    // module that provides DepositService without ReferralModule keep working;
    // a missing service simply means no referral signal is emitted.
    @Optional() private readonly referrals?: ReferralService,
  ) {}

  async createDeposit(
    auth: AuthenticatedUser,
    input: { amount: number; currency: string; idempotencyKey: string },
    ip?: string,
    userAgent?: string,
  ): Promise<CreateWalletTransactionResponse> {
    // Server-side policy: currency + limits. Never trusted from the client.
    this.wallet.assertAmountInRange(input.amount, 'deposit');

    // Idempotency: a repeat request returns the original transaction.
    const walletRow = await this.wallet.getOrCreateWalletForUser(auth.id, input.currency);
    const existing = await this.wallet.findTransaction(auth.id, input.idempotencyKey);
    if (existing) {
      return {
        transaction: toTransactionView(existing),
        wallet: toWalletView(walletRow),
        duplicate: true,
      };
    }

    // 1. Record the PENDING request (no funds move yet).
    const pending = await this.wallet.createPendingTransaction(walletRow, {
      type: 'DEPOSIT',
      amount: input.amount,
      currency: input.currency,
      idempotencyKey: input.idempotencyKey,
    });
    await this.wallet.audit('DEPOSIT_CREATED', auth.id, 'WalletTransaction', pending.id, {
      amount: input.amount,
      currency: input.currency,
    });

    // 2. Ask the provider (the dev mock resolves synchronously).
    try {
      const result = await this.provider.initDeposit({
        accountRef: auth.id,
        amount: input.amount,
        currency: input.currency,
        idempotencyKey: input.idempotencyKey,
      });

      if (result.status === 'FAILED') {
        const failed = await this.wallet.transitionTransaction(pending, 'FAILED', result.message ?? undefined);
        await this.wallet.audit('DEPOSIT_FAILED', auth.id, 'WalletTransaction', pending.id, {
          reason: result.message,
        });
        return {
          transaction: toTransactionView(failed),
          wallet: toWalletView(walletRow),
          duplicate: false,
        };
      }

      // PENDING / PROCESSING means the gateway has NOT confirmed funds yet.
      // Never credit on an unconfirmed state — leave the transaction PENDING
      // so a later status check / webhook can complete it exactly once.
      if (result.status === 'PENDING' || result.status === 'PROCESSING') {
        const parked = await this.wallet.transitionTransaction(
          pending,
          'PROCESSING',
          result.message ?? 'Waiting for provider confirmation',
        );
        await this.wallet.audit('DEPOSIT_PENDING', auth.id, 'WalletTransaction', pending.id, {
          amount: input.amount,
          currency: input.currency,
          reference: result.externalTransactionId,
        });
        return {
          transaction: toTransactionView(parked),
          wallet: toWalletView(walletRow),
          duplicate: false,
        };
      }

      // 3. Provider confirmed → credit the wallet through the ledger.
      const completed = (await this.wallet.completeTransactionWithLedger(
        pending,
        walletRow,
        {
          availableDelta: input.amount,
          lockedDelta: 0,
          direction: 'CREDIT',
          amount: input.amount,
          reason: 'DEPOSIT_COMPLETED',
        },
        result.externalTransactionId,
      )) as WalletTransactionRow;
      await this.wallet.audit('DEPOSIT_COMPLETED', auth.id, 'WalletTransaction', pending.id, {
        amount: input.amount,
        currency: input.currency,
        reference: result.externalTransactionId,
      });

      // Referral qualification signal (ADDITIVE, BEST-EFFORT).
      // A confirmed deposit may satisfy an admin-configured "minimum deposit"
      // referral rule. The signal is keyed by the immutable wallet transaction
      // id, so a replayed webhook or a retried call counts it exactly once and
      // can never pay twice. A referral failure NEVER fails the deposit.
      await this.referrals
        ?.recordQualifyingEvent(auth.id, 'DEPOSIT', completed.id, input.amount)
        .catch(() => undefined);

      const freshWallet = await this.wallet.getOrCreateWalletForUser(auth.id, input.currency);
      return {
        transaction: toTransactionView(completed),
        wallet: toWalletView(freshWallet),
        duplicate: false,
      };
    } catch (error) {
      // A provider that is not configured must surface clearly - never pretend
      // a deposit happened or leave a hung PENDING row.

      if (
        error instanceof ServiceUnavailableException ||
        (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'PROVIDER_UNAVAILABLE')
      ) {
        throw new ServiceUnavailableException('Payment provider is not configured. Contact support to enable deposits.');
      }
      // Provider failure: the deposit must end FAILED, never hung or credited.
      const failed = await this.wallet
        .transitionTransaction(pending, 'FAILED', 'Provider unavailable')
        .catch(() => null);
      if (failed) {
        await this.wallet.audit('DEPOSIT_FAILED', auth.id, 'WalletTransaction', pending.id, {
          reason: 'Provider unavailable',
          ip,
          userAgent,
        });
        return {
          transaction: toTransactionView(failed as WalletTransactionRow),
          wallet: toWalletView(walletRow),
          duplicate: false,
        };
      }
      throw error;
    }
  }
}

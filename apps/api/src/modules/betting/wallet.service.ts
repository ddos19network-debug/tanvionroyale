import { Injectable } from '@nestjs/common';
import type { MinorUnit } from '@tanvion-royale/types';
import { Prisma } from '../../generated/prisma';

/**
 * Clear boundary for the wallet integration.
 *
 * Phase 5 introduced this interface with a read-only dev mock balance.
 * Phase 6 extends it with reserve/capture/release so bets actually move
 * wallet funds through the ledger. Implementations:
 *  - WalletService (modules/wallet) - ledger-backed, production path.
 *  - DevMockWalletService - DEVELOPMENT ONLY in-memory fallback, kept for
 *    Phase 5 compatibility (never real funds).
 *
 * All money is integer minor units. All operations are idempotent by
 * idempotencyKey (the bet placement key).
 */
export interface StakeReservation {
  transactionId: string;
  duplicate: boolean;
}

/** Result of posting a settlement credit (payout/refund). */
export interface SettlementCreditResult {
  walletId: string;
  transactionId: string;
  duplicate: boolean;
}

export interface WalletServiceInterface {
  getAvailableBalance(userId: string): Promise<MinorUnit>;
  /** Lock the stake: available -= amount, locked += amount. */
  reserveStake(
    userId: string,
    amount: MinorUnit,
    currency: string,
    idempotencyKey: string,
  ): Promise<StakeReservation>;
  /** Convert a locked stake into a completed BET_STAKE debit. */
  captureStake(userId: string, idempotencyKey: string): Promise<void>;
  /** Return a locked stake to available (bet rejected/failed). */
  releaseStake(userId: string, idempotencyKey: string): Promise<void>;
  /**
   * Credit a bet payout (WIN) or refund (VOID/PUSH) to the user's wallet and
   * write a ledger entry — atomically inside the caller's `db` transaction.
   * Debits never happen from a settlement; the wallet service owns all
   * balance edits, so the settlement engine never mutates balances directly.
   */
  settleBetCredit(
    db: Prisma.TransactionClient,
    userId: string,
    amount: MinorUnit,
    currency: string,
    type: 'BET_PAYOUT' | 'BET_REFUND',
    idempotencyKey: string,
    reason: string,
  ): Promise<SettlementCreditResult>;
}

export const WALLET_SERVICE = Symbol('WALLET_SERVICE');

/**
 * DEVELOPMENT ONLY - in-memory mock wallet used by unit tests and legacy
 * Phase 5 wiring. Never real funds; balances are not persisted.
 */
@Injectable()
export class DevMockWalletService implements WalletServiceInterface {
  /** Dev-only mock balance: 1000.00 BDT (minor units). Never real funds. */
  private readonly available: MinorUnit = 100_000;

  async getAvailableBalance(_userId: string): Promise<MinorUnit> {
    return this.available;
  }

  async reserveStake(
    _userId: string,
    _amount: MinorUnit,
    _currency: string,
    idempotencyKey: string,
  ): Promise<StakeReservation> {
    return { transactionId: 'mock-reserve-' + idempotencyKey, duplicate: false };
  }

  async captureStake(_userId: string, _idempotencyKey: string): Promise<void> {
    /* dev mock: no-op */
  }

  async releaseStake(_userId: string, _idempotencyKey: string): Promise<void> {
    /* dev mock: no-op */
  }

  async settleBetCredit(
    _db: Prisma.TransactionClient,
    _userId: string,
    _amount: MinorUnit,
    _currency: string,
    _type: 'BET_PAYOUT' | 'BET_REFUND',
    idempotencyKey: string,
    _reason: string,
  ): Promise<SettlementCreditResult> {
    /* dev mock: record-only, no real funds */
    return { walletId: 'mock-wallet', transactionId: 'mock-settle-' + idempotencyKey, duplicate: false };
  }
}

import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import type {
  MinorUnit,
  WalletBalanceView,
  WalletTransactionType,
  WalletTransactionView,
  WalletView,
} from '@tanvion-royale/types';
import { loadWalletConfig, type WalletConfig } from './wallet.config';
import { walletError } from './wallet-errors';

export interface WalletRow {
  id: string;
  userId: string;
  currency: string;
  availableBalance: number;
  lockedBalance: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WalletTransactionRow {
  id: string;
  walletId: string;
  userId: string;
  type: string;
  status: string;
  amount: number;
  currency: string;
  reference: string | null;
  failureReason: string | null;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StakeReservation {
  transactionId: string;
  duplicate: boolean;
}

/** Persisted WalletTransaction states (mirrors the Prisma enum). */
export type WalletTransactionStatusName =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REVERSED';

export interface LedgerMutation {
  availableDelta: number;
  lockedDelta: number;
  direction: 'CREDIT' | 'DEBIT';
  amount: number;
  reason: string;
}

export function toWalletView(wallet: WalletRow): WalletView {
  return {
    id: wallet.id,
    userId: wallet.userId,
    currency: wallet.currency,
    availableBalance: wallet.availableBalance,
    lockedBalance: wallet.lockedBalance,
    status: wallet.status as WalletView['status'],
    createdAt: wallet.createdAt.toISOString(),
    updatedAt: wallet.updatedAt.toISOString(),
  };
}

export function toTransactionView(
  tx: WalletTransactionRow,
): WalletTransactionView {
  return {
    id: tx.id,
    walletId: tx.walletId,
    userId: tx.userId,
    type: tx.type as WalletTransactionView['type'],
    status: tx.status as WalletTransactionView['status'],
    amount: tx.amount,
    currency: tx.currency,
    reference: tx.reference,
    failureReason: tx.failureReason,
    createdAt: tx.createdAt.toISOString(),
    updatedAt: tx.updatedAt.toISOString(),
  };
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private readonly config: WalletConfig = loadWalletConfig();

  constructor(private readonly prisma: PrismaService) {}

  // --------------------------------------------------------------------------
  // Queries
  // --------------------------------------------------------------------------

  async getMyWallet(auth: AuthenticatedUser): Promise<WalletView> {
    const wallet = await this.getOrCreateWallet(
      auth.id,
      this.config.currency,
    );

    return toWalletView(wallet);
  }

  async getMyBalance(auth: AuthenticatedUser): Promise<WalletBalanceView> {
    const wallet = await this.getOrCreateWallet(
      auth.id,
      this.config.currency,
    );

    return {
      currency: wallet.currency,
      availableBalance: wallet.availableBalance,
      lockedBalance: wallet.lockedBalance,
    };
  }

  /**
   * Returns a wallet for a specific supported currency.
   *
   * This allows BDT/USD/EUR to have independent balances.
   */
  async getMyWalletByCurrency(
    auth: AuthenticatedUser,
    currency: string,
  ): Promise<WalletView> {
    const normalizedCurrency = this.normalizeCurrency(currency);

    const wallet = await this.getOrCreateWallet(
      auth.id,
      normalizedCurrency,
    );

    return toWalletView(wallet);
  }

  async getMyBalanceByCurrency(
    auth: AuthenticatedUser,
    currency: string,
  ): Promise<WalletBalanceView> {
    const normalizedCurrency = this.normalizeCurrency(currency);

    const wallet = await this.getOrCreateWallet(
      auth.id,
      normalizedCurrency,
    );

    return {
      currency: wallet.currency,
      availableBalance: wallet.availableBalance,
      lockedBalance: wallet.lockedBalance,
    };
  }

  async listMyTransactions(
    auth: AuthenticatedUser,
    filters: {
      status?: string;
      type?: string;
      currency?: string;
      limit?: number;
      page?: number;
      cursor?: string;
      search?: string;
    } = {},
  ): Promise<WalletTransactionView[]> {
    const limit = Math.min(
      Math.max(filters.limit ?? 25, 1),
      100,
    );

    const page = Math.max(filters.page ?? 1, 1);

    const where: Record<string, unknown> = {
      userId: auth.id,
    };

    if (filters.status && filters.status !== 'ALL') {
      where['status'] = filters.status;
    }

    if (filters.type && filters.type !== 'ALL') {
      where['type'] = filters.type;
    }

    if (filters.currency && filters.currency !== 'ALL') {
      where['currency'] = this.normalizeCurrency(filters.currency);
    }

    if (filters.search && filters.search.trim()) {
      const q = filters.search.trim();

      const or: Record<string, unknown>[] = [
        {
          reference: {
            contains: q,
            mode: 'insensitive',
          },
        },
        {
          idempotencyKey: {
            contains: q,
            mode: 'insensitive',
          },
        },
      ];

      if (q.length >= 8 && q.length <= 64) {
        or.unshift({ id: q });
      }

      where['OR'] = or;
    }

    const rows = await this.prisma.walletTransaction.findMany({
      where: where as never,
      orderBy: {
        createdAt: 'desc',
      },
      ...(filters.cursor
        ? {
            cursor: {
              id: filters.cursor,
            },
            skip: 1,
          }
        : {
            skip: (page - 1) * limit,
          }),
      take: limit,
    });

    return (rows as unknown as WalletTransactionRow[]).map(
      toTransactionView,
    );
  }

  async getMyTransaction(
    auth: AuthenticatedUser,
    id: string,
  ): Promise<WalletTransactionView> {
    const row = await this.prisma.walletTransaction.findUnique({
      where: { id },
    });

    const tx = row as unknown as WalletTransactionRow | null;

    if (!tx) {
      throw new NotFoundException('Transaction not found');
    }

    if (tx.userId !== auth.id) {
      throw new ForbiddenException('Not your transaction');
    }

    return toTransactionView(tx);
  }

  async getOrCreateWalletForUser(
    userId: string,
    currency: string,
  ): Promise<WalletRow> {
    const normalizedCurrency = this.normalizeCurrency(currency);

    return this.getOrCreateWallet(
      userId,
      normalizedCurrency,
    );
  }

  // --------------------------------------------------------------------------
  // Betting integration
  // --------------------------------------------------------------------------

  async getAvailableBalance(
    userId: string,
  ): Promise<MinorUnit> {
    const wallet = await this.getOrCreateWallet(
      userId,
      this.config.currency,
    );

    return wallet.availableBalance;
  }

  /**
   * Lock a stake: available -= amount, locked += amount (one ledger entry).
   *
   * Idempotent by (userId, idempotencyKey). Opens its OWN transaction; callers
   * whose reservation must be atomic with their own rows (e.g. the crash bet)
   * use `reserveStakeInTx` instead.
   */
  async reserveStake(
    userId: string,
    amount: MinorUnit,
    currency: string,
    idempotencyKey: string,
  ): Promise<StakeReservation> {
    return this.prisma.$transaction((db) =>
      this.reserveStakeInTx(
        db,
        userId,
        amount,
        currency,
        idempotencyKey,
      ),
    );
  }

  /**
   * Canonical stake RESERVATION inside the caller's transaction.
   *
   * Creates ONE `BET_STAKE` WalletTransaction (status PENDING,
   * amount = -stake, reason BET_STAKE_RESERVED) with available -> locked and
   * exactly one append-only ledger entry, under the wallet row lock. Running in
   * the CALLER's transaction means a failed bet/settlement rolls the reservation
   * back with it — a reservation can never outlive the bet that owns it, so no
   * stake can be left locked behind a failed placement. A repeated call with the
   * same key returns the ORIGINAL reservation and moves nothing.
   */
  async reserveStakeInTx(
    db: Prisma.TransactionClient,
    userId: string,
    amount: MinorUnit,
    currency: string,
    idempotencyKey: string,
  ): Promise<StakeReservation> {
    const normalizedCurrency = this.normalizeCurrency(currency);

    this.assertPositiveAmount(amount);

    const existing = await this.findExistingInTx(
      db,
      userId,
      idempotencyKey,
    );

    if (existing) {
      return {
        transactionId: existing.id,
        duplicate: true,
      };
    }

    const wallet = await this.getOrCreateWalletInTx(
      db,
      userId,
      normalizedCurrency,
    );

    const txRow = await this.mutate(
      wallet,
      {
        availableDelta: -amount,
        lockedDelta: amount,
        direction: 'DEBIT',
        amount,
        reason: 'BET_STAKE_RESERVED',
      },
      {
        type: 'BET_STAKE' as WalletTransactionType,
        amount: -amount,
        currency: normalizedCurrency,
        idempotencyKey,
        status: 'PENDING',
      },
      db,
    );

    return {
      transactionId: txRow.id,
      duplicate: false,
    };
  }

  /** Convert a locked stake into a completed BET_STAKE debit (own tx). */
  async captureStake(
    userId: string,
    idempotencyKey: string,
  ): Promise<void> {
    await this.prisma.$transaction((db) =>
      this.captureStakeInTx(db, userId, idempotencyKey),
    );
  }

  /**
   * Canonical stake CAPTURE inside the caller's transaction — the WIN/LOSS
   * settlement of a reservation: locked -= stake, available unchanged, the
   * WalletTransaction becomes COMPLETED and one append-only ledger entry
   * (BET_STAKE_CAPTURED) records it. The stake has then genuinely left the
   * wallet and NOTHING is left behind in lockedBalance.
   *
   * EXACTLY ONCE: the guarded transition (`from: ['PENDING']`) makes a repeated
   * or racing capture a deterministic no-op, and a reservation that was already
   * RELEASED can never be captured afterwards. Throws NOT_FOUND when no
   * reservation exists — a settlement must never pay out or book a loss against
   * a stake that was never reserved.
   */
  async captureStakeInTx(
    db: Prisma.TransactionClient,
    userId: string,
    idempotencyKey: string,
  ): Promise<WalletTransactionRow> {
    const tx = await this.findExistingInTx(
      db,
      userId,
      idempotencyKey,
    );

    if (!tx) {
      walletError(
        'NOT_FOUND',
        'Stake reservation not found',
        404,
      );
    }

    // Already terminal (COMPLETED / REVERSED): never move money again. The
    // guarded transition below is the authoritative gate; this is a fast path.
    if (tx.status !== 'PENDING') {
      return tx;
    }

    const wallet = await this.getOrCreateWalletInTx(
      db,
      userId,
      tx.currency,
    );

    return this.mutateExisting(
      wallet,
      tx,
      {
        availableDelta: 0,
        lockedDelta: tx.amount,
        direction: 'DEBIT',
        amount: Math.abs(tx.amount),
        reason: 'BET_STAKE_CAPTURED',
      },
      {
        status: 'COMPLETED',
        from: ['PENDING'],
      },
      db,
    );
  }

  /** Return a locked stake to available (bet rejected/failed). Own tx. */
  async releaseStake(
    userId: string,
    idempotencyKey: string,
  ): Promise<void> {
    await this.prisma.$transaction((db) =>
      this.releaseStakeInTx(db, userId, idempotencyKey),
    );
  }

  /**
   * Canonical stake RELEASE inside the caller's transaction — the inverse of a
   * reservation (void / cancelled round): locked -= stake, available += stake,
   * the WalletTransaction becomes REVERSED and one append-only ledger entry
   * (BET_STAKE_RELEASED) records it, restoring the pre-reservation
   * available/locked state EXACTLY (available is not inflated, locked is not
   * left dangling).
   *
   * EXACTLY ONCE and non-destructive: a missing reservation, or one that already
   * reached a terminal state (COMPLETED / REVERSED), is left untouched — an
   * already-captured (lost or won) stake can never be released, so a retried
   * void or a late scheduler tick refunds nothing twice. Returns null when there
   * was nothing to release.
   */
  async releaseStakeInTx(
    db: Prisma.TransactionClient,
    userId: string,
    idempotencyKey: string,
  ): Promise<WalletTransactionRow | null> {
    const tx = await this.findExistingInTx(
      db,
      userId,
      idempotencyKey,
    );

    if (!tx || tx.status !== 'PENDING') {
      return null;
    }

    const wallet = await this.getOrCreateWalletInTx(
      db,
      userId,
      tx.currency,
    );

    return this.mutateExisting(
      wallet,
      tx,
      {
        availableDelta: Math.abs(tx.amount),
        lockedDelta: tx.amount,
        direction: 'CREDIT',
        amount: Math.abs(tx.amount),
        reason: 'BET_STAKE_RELEASED',
      },
      {
        status: 'REVERSED',
        from: ['PENDING'],
      },
      db,
    );
  }

  // --------------------------------------------------------------------------
  // Betting settlement
  // --------------------------------------------------------------------------

  async settleBetCredit(
    db: Prisma.TransactionClient,
    userId: string,
    amount: number,
    currency: string,
    type: 'BET_PAYOUT' | 'BET_REFUND',
    idempotencyKey: string,
    reason: string,
  ): Promise<{
    walletId: string;
    transactionId: string;
    duplicate: boolean;
  }> {
    const normalizedCurrency = this.normalizeCurrency(currency);

    this.assertPositiveAmount(amount);

    const existing = await db.walletTransaction.findUnique({
      where: {
        userId_idempotencyKey: {
          userId,
          idempotencyKey,
        },
      },
    });

    if (existing) {
      return {
        walletId: existing.walletId,
        transactionId: existing.id,
        duplicate: true,
      };
    }

    let wallet = (await db.wallet.findUnique({
      where: {
        userId_currency: {
          userId,
          currency: normalizedCurrency,
        },
      },
    })) as unknown as WalletRow | null;

    if (!wallet) {
      wallet = (await db.wallet.create({
        data: {
          userId,
          currency: normalizedCurrency,
        },
      })) as unknown as WalletRow;

      await this.auditInTx(
        db,
        'WALLET_CREATED',
        userId,
        'Wallet',
        wallet.id,
        {
          currency: normalizedCurrency,
        },
      );
    }

    await db.$queryRaw`
      SELECT id
      FROM "Wallet"
      WHERE id = ${wallet.id}
      FOR UPDATE
    `;

    const fresh = (await db.wallet.findUnique({
      where: {
        id: wallet.id,
      },
    })) as unknown as WalletRow;

    const availableAfter =
      fresh.availableBalance + amount;

    let txRow: WalletTransactionRow;

    try {
      txRow = (await db.walletTransaction.create({
        data: {
          walletId: fresh.id,
          userId: fresh.userId,
          type,
          status: 'COMPLETED',
          amount,
          currency: normalizedCurrency,
          reference: idempotencyKey,
          idempotencyKey,
        },
      })) as unknown as WalletTransactionRow;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const dup =
          await db.walletTransaction.findUnique({
            where: {
              userId_idempotencyKey: {
                userId,
                idempotencyKey,
              },
            },
          });

        if (dup) {
          return {
            walletId: dup.walletId,
            transactionId: dup.id,
            duplicate: true,
          };
        }
      }

      throw error;
    }

    await db.wallet.update({
      where: {
        id: fresh.id,
      },
      data: {
        availableBalance: availableAfter,
      },
    });

    await db.ledgerEntry.create({
      data: {
        walletId: fresh.id,
        transactionId: txRow.id,
        direction: 'CREDIT',
        amount,
        availableBefore: fresh.availableBalance,
        availableAfter,
        lockedBefore: fresh.lockedBalance,
        lockedAfter: fresh.lockedBalance,
        reason,
      },
    });

    return {
      walletId: fresh.id,
      transactionId: txRow.id,
      duplicate: false,
    };
  }

  // --------------------------------------------------------------------------
  // Manual deposit credit
  // --------------------------------------------------------------------------

  /**
   * Credits an APPROVED manual deposit.
   *
   * Important:
   * - The manual request itself is handled by ManualPaymentService.
   * - This method is the ONLY balance-changing path for the deposit.
   * - The manual request ID is used as the idempotency key.
   * - Therefore approving the same request twice cannot credit twice.
   */
  async creditManualDeposit(
    userId: string,
    amount: number,
    currency: string,
    manualDepositId: string,
    reference?: string,
  ): Promise<{
    transactionId: string;
    wallet: WalletView;
    duplicate: boolean;
  }> {
    const normalizedCurrency =
      this.normalizeCurrency(currency);

    this.assertPositiveAmount(amount);

    const idempotencyKey =
      `MANUAL_DEPOSIT:${manualDepositId}`;

    const existing = await this.findExisting(
      userId,
      idempotencyKey,
    );

    if (existing) {
      const wallet = await this.getOrCreateWallet(
        userId,
        normalizedCurrency,
      );

      return {
        transactionId: existing.id,
        wallet: toWalletView(wallet),
        duplicate: true,
      };
    }

    const wallet = await this.getOrCreateWallet(
      userId,
      normalizedCurrency,
    );

    const tx = await this.mutate(
      wallet,
      {
        availableDelta: amount,
        lockedDelta: 0,
        direction: 'CREDIT',
        amount,
        reason: `MANUAL_DEPOSIT_APPROVED:${manualDepositId}`,
      },
      {
        type: 'DEPOSIT' as WalletTransactionType,
        amount,
        currency: normalizedCurrency,
        idempotencyKey,
        status: 'COMPLETED',
        reference:
          reference?.trim() || manualDepositId,
      },
    );

    const refreshed =
      await this.getOrCreateWallet(
        userId,
        normalizedCurrency,
      );

    await this.audit(
      'MANUAL_DEPOSIT_CREDITED',
      userId,
      'WalletTransaction',
      tx.id,
      {
        manualDepositId,
        amount,
        currency: normalizedCurrency,
        reference:
          reference?.trim() || null,
      },
    );

    return {
      transactionId: tx.id,
      wallet: toWalletView(refreshed),
      duplicate: false,
    };
  }

  // --------------------------------------------------------------------------
  // Admin adjustment
  // --------------------------------------------------------------------------

  /**
   * Applies a signed admin adjustment INSIDE the caller's transaction.
   *
   * Same accounting as every other movement (wallet row lock + one
   * WalletTransaction of type ADJUSTMENT + one append-only LedgerEntry with
   * availableBefore/availableAfter), but transaction-scoped so an adjustment is
   * committed atomically with the business row that authorises it — the
   * referral admin adjustment uses this so the reward row and the money can
   * never disagree.
   *
   * Idempotent on `idempotencyKey` (unique per user), so a retried or
   * double-submitted adjustment posts once. A debit that would take the balance
   * below zero is refused by the ledger engine with the structured
   * INSUFFICIENT_FUNDS error rather than silently clamped.
   */
  async adjustBalanceInTx(
    db: Prisma.TransactionClient,
    userId: string,
    amount: number,
    currency: string,
    idempotencyKey: string,
    reason: string,
  ): Promise<{
    transactionId: string;
    availableBalance: number;
    duplicate: boolean;
  }> {
    const normalizedCurrency = this.normalizeCurrency(currency);
    if (!Number.isInteger(amount) || amount === 0) {
      walletError(
        'INVALID_AMOUNT',
        'Adjustment must be a non-zero integer in minor units',
      );
    }

    const existing = await db.walletTransaction.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });
    if (existing) {
      const current = (await db.wallet.findUnique({
        where: { id: existing.walletId },
      })) as unknown as WalletRow | null;
      return {
        transactionId: existing.id,
        availableBalance: current?.availableBalance ?? 0,
        duplicate: true,
      };
    }

    const wallet = (await this.getOrCreateWalletInTx(
      db,
      userId,
      normalizedCurrency,
    )) as unknown as WalletRow;

    const txRow = await this.mutate(
      wallet,
      {
        availableDelta: amount,
        lockedDelta: 0,
        direction: amount > 0 ? 'CREDIT' : 'DEBIT',
        amount: Math.abs(amount),
        reason: `WALLET_ADJUSTMENT: ${reason}`,
      },
      {
        type: 'ADJUSTMENT' as WalletTransactionType,
        amount,
        currency: normalizedCurrency,
        idempotencyKey,
        status: 'COMPLETED',
      },
      db,
    );

    const refreshed = (await db.wallet.findUnique({
      where: { id: txRow.walletId },
    })) as unknown as WalletRow | null;

    return {
      transactionId: txRow.id,
      availableBalance: refreshed?.availableBalance ?? 0,
      duplicate: false,
    };
  }

  async adjustWallet(
    userId: string,
    input: {
      amount: number;
      currency: string;
      reason: string;
      idempotencyKey: string;
    },
    actorId: string,
  ): Promise<{
    transaction: WalletTransactionView;
    wallet: WalletView;
    duplicate: boolean;
  }> {
    const normalizedCurrency =
      this.normalizeCurrency(input.currency);

    if (
      !Number.isInteger(input.amount) ||
      input.amount === 0
    ) {
      walletError(
        'INVALID_AMOUNT',
        'Adjustment must be a non-zero integer in minor units',
      );
    }

    const reason = input.reason?.trim();

    if (!reason) {
      walletError(
        'VALIDATION_ERROR',
        'Adjustment reason is required',
      );
    }

    const existing = await this.findExisting(
      userId,
      input.idempotencyKey,
    );

    if (existing) {
      const wallet = await this.getOrCreateWallet(
        userId,
        normalizedCurrency,
      );

      return {
        transaction: toTransactionView(existing),
        wallet: toWalletView(wallet),
        duplicate: true,
      };
    }

    const wallet = await this.getOrCreateWallet(
      userId,
      normalizedCurrency,
    );

    const isCredit = input.amount > 0;

    const txRow = await this.mutate(
      wallet,
      {
        availableDelta: input.amount,
        lockedDelta: 0,
        direction: isCredit
          ? 'CREDIT'
          : 'DEBIT',
        amount: Math.abs(input.amount),
        reason: `WALLET_ADJUSTMENT: ${reason}`,
      },
      {
        type: 'ADJUSTMENT' as WalletTransactionType,
        amount: input.amount,
        currency: normalizedCurrency,
        idempotencyKey: input.idempotencyKey,
        status: 'COMPLETED',
      },
    );

    const refreshed =
      await this.getOrCreateWallet(
        userId,
        normalizedCurrency,
      );

    await this.audit(
      'WALLET_ADJUSTMENT',
      actorId,
      'WalletTransaction',
      txRow.id,
      {
        amount: input.amount,
        currency: normalizedCurrency,
        reason,
      },
    );

    return {
      transaction: toTransactionView(txRow),
      wallet: toWalletView(refreshed),
      duplicate: false,
    };
  }

  // --------------------------------------------------------------------------
  // Referral program
  // --------------------------------------------------------------------------

  /**
   * Credits a referral reward to a beneficiary INSIDE the caller's transaction.
   *
   * A referral bonus is REAL wallet value, so it goes through exactly the same
   * accounting as every other movement: this method only ever delegates to the
   * private `mutate()` engine, which takes the wallet row lock, re-reads the
   * fresh balance, refuses to go negative, writes ONE `WalletTransaction`
   * (type REFERRAL_BONUS, status COMPLETED) and ONE append-only `LedgerEntry`
   * recording availableBefore/availableAfter. There is deliberately no code path
   * anywhere that does `balance += bonus`.
   *
   * EXACTLY ONCE, twice over:
   *   1. `WalletTransaction` is unique on (userId, idempotencyKey) — the same
   *      event key can never post twice, even under a race.
   *   2. `mutate()` swallows the P2002 and returns the ORIGINAL row, so a caller
   *      that re-runs a webhook or a settlement gets `duplicate: true` and the
   *      original transaction id instead of a second credit.
   *
   * `idempotencyKey` MUST be derived from the business event (the referral
   * service uses `referral_reward:<referralId>:<recipient>`), never from a
   * client-supplied value.
   */
  async creditReferralBonus(
    db: Prisma.TransactionClient,
    userId: string,
    amount: number,
    currency: string,
    idempotencyKey: string,
    reason: string,
  ): Promise<{
    walletId: string;
    transactionId: string;
    availableBalance: number;
    duplicate: boolean;
  }> {
    const normalizedCurrency = this.normalizeCurrency(currency);

    this.assertPositiveAmount(amount);

    const existing = await db.walletTransaction.findUnique({
      where: {
        userId_idempotencyKey: { userId, idempotencyKey },
      },
    });

    if (existing) {
      const wallet = (await db.wallet.findUnique({
        where: { id: existing.walletId },
      })) as unknown as WalletRow | null;
      return {
        walletId: existing.walletId,
        transactionId: existing.id,
        availableBalance: wallet?.availableBalance ?? 0,
        duplicate: true,
      };
    }

    const wallet = (await this.getOrCreateWalletInTx(
      db,
      userId,
      normalizedCurrency,
    )) as unknown as WalletRow;

    const txRow = await this.mutate(
      wallet,
      {
        availableDelta: Math.abs(amount),
        lockedDelta: 0,
        direction: 'CREDIT',
        amount: Math.abs(amount),
        reason,
      },
      {
        type: 'REFERRAL_BONUS' as WalletTransactionType,
        amount: Math.abs(amount),
        currency: normalizedCurrency,
        idempotencyKey,
        status: 'COMPLETED',
        // Traces the reward back to the referral event that authorised it.
        reference: reason.slice(0, 120),
      },
      db,
    );

    const refreshed = (await db.wallet.findUnique({
      where: { id: txRow.walletId },
    })) as unknown as WalletRow | null;

    return {
      walletId: txRow.walletId,
      transactionId: txRow.id,
      availableBalance: refreshed?.availableBalance ?? 0,
      duplicate: false,
    };
  }

  // --------------------------------------------------------------------------
  // Ledger engine
  // --------------------------------------------------------------------------

  private async mutate(
    wallet: WalletRow,
    mutation: LedgerMutation,
    transaction: {
      type: WalletTransactionType;
      amount: number;
      currency: string;
      idempotencyKey: string;
      status:
        | 'PENDING'
        | 'COMPLETED'
        | 'FAILED'
        | 'CANCELLED'
        | 'PROCESSING';
      reference?: string;
      failureReason?: string;
    },
    /**
     * Optional caller-owned transaction client. When supplied, the mutation
     * runs inside THAT transaction, so a tx-scoped ledger movement stays
     * atomic with the caller's own writes (bet / settlement rows). Omitted
     * (the default) keeps the historical behaviour: own transaction.
     */
    client?: Prisma.TransactionClient,
  ): Promise<WalletTransactionRow> {
    const run = async (db: Prisma.TransactionClient): Promise<WalletTransactionRow> => {
      await db.$queryRaw`
        SELECT id
        FROM "Wallet"
        WHERE id = ${wallet.id}
        FOR UPDATE
      `;

      const fresh =
        (await db.wallet.findUnique({
          where: {
            id: wallet.id,
          },
        })) as unknown as WalletRow;

      if (!fresh) {
        walletError(
          'WALLET_NOT_FOUND',
          'Wallet not found',
          404,
        );
      }

      const availableAfter =
        fresh.availableBalance +
        mutation.availableDelta;

      const lockedAfter =
        fresh.lockedBalance +
        mutation.lockedDelta;

      if (
        availableAfter < 0 ||
        lockedAfter < 0
      ) {
        walletError(
          'INSUFFICIENT_FUNDS',
          'Insufficient available balance',
          400,
          {
            available:
              fresh.availableBalance,
            required:
              Math.abs(
                mutation.availableDelta,
              ),
          },
        );
      }

      let txRow: WalletTransactionRow;

      try {
        txRow =
          (await db.walletTransaction.create({
            data: {
              walletId: fresh.id,
              userId: fresh.userId,
              type: transaction.type,
              status: transaction.status,
              amount: transaction.amount,
              currency: transaction.currency,
              reference:
                transaction.reference ?? null,
              failureReason:
                transaction.failureReason ??
                null,
              idempotencyKey:
                transaction.idempotencyKey,
            },
          })) as unknown as WalletTransactionRow;
      } catch (error) {
        if (
          error instanceof
            Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const dup = await this.findExistingInTx(
            db,
            fresh.userId,
            transaction.idempotencyKey,
          );

          if (dup) {
            return dup;
          }
        }

        throw error;
      }

      await db.wallet.update({
        where: {
          id: fresh.id,
        },
        data: {
          availableBalance:
            availableAfter,
          lockedBalance:
            lockedAfter,
        },
      });

      await db.ledgerEntry.create({
        data: {
          walletId: fresh.id,
          transactionId: txRow.id,
          direction:
            mutation.direction,
          amount:
            mutation.amount,
          availableBefore:
            fresh.availableBalance,
          availableAfter,
          lockedBefore:
            fresh.lockedBalance,
          lockedAfter,
          reason:
            mutation.reason,
        },
      });

      return txRow;
    };
    if (client) return run(client);
    return this.prisma.$transaction(run);
  }

  private async mutateExisting(
    wallet: WalletRow,
    tx: WalletTransactionRow,
    mutation: LedgerMutation,
    status: {
      status:
        | 'COMPLETED'
        | 'FAILED'
        | 'CANCELLED'
        | 'PROCESSING'
        | 'REVERSED';
      reference?: string;
      /**
       * The statuses the transaction must STILL be in for this terminal
       * transition (and therefore its balance + ledger mutation) to be applied
       * at all.
       *
       * This is the exactly-once guard for locked funds (stake reservations and
       * withdrawals): the transition is a conditional UPDATE (`status IN from`)
       * executed under the wallet row lock, so of two racing capture / release /
       * complete calls exactly ONE flips the row and moves money. The loser sees
       * count = 0 and returns the current row WITHOUT touching available /
       * locked and WITHOUT writing a second ledger entry — money can never be
       * captured twice, released twice, or captured after release.
       * Omitted = no precondition (historical behaviour, non-money states).
       */
      from?: WalletTransactionStatusName[];
    },
    /**
     * Optional caller-owned transaction client (see `mutate`). Supplied by the
     * tx-scoped stake operations so a capture/release is committed atomically
     * with the bet/settlement row that owns it.
     */
    client?: Prisma.TransactionClient,
  ): Promise<WalletTransactionRow> {
    const run = async (db: Prisma.TransactionClient): Promise<WalletTransactionRow> => {
      await db.$queryRaw`
        SELECT id
        FROM "Wallet"
        WHERE id = ${wallet.id}
        FOR UPDATE
      `;

      const fresh =
        (await db.wallet.findUnique({
          where: {
            id: wallet.id,
          },
        })) as unknown as WalletRow;

      if (!fresh) {
        walletError(
          'WALLET_NOT_FOUND',
          'Wallet not found',
          404,
        );
      }

      // EXACTLY-ONCE GUARD — only the caller that finds the transaction in an
      // allowed predecessor state may move money. Runs under the wallet row
      // lock taken above, so a racing duplicate is a deterministic no-op.
      const from = status.from;
      const flipped = await db.walletTransaction.updateMany({
        where: {
          id: tx.id,
          ...(from && from.length > 0
            ? { status: { in: from } }
            : {}),
        },
        data: {
          status: status.status,
          ...(status.reference !== undefined
            ? { reference: status.reference }
            : {}),
        },
      });
      if (flipped.count !== 1) {
        const current =
          (await db.walletTransaction.findUnique({
            where: { id: tx.id },
          })) as unknown as WalletTransactionRow | null;
        if (!current) {
          walletError(
            'NOT_FOUND',
            'Wallet transaction not found',
            404,
          );
        }
        // Already terminal: no balance change, no ledger entry, no error.
        return current;
      }

      const availableAfter =
        fresh.availableBalance +
        mutation.availableDelta;

      const lockedAfter =
        fresh.lockedBalance +
        mutation.lockedDelta;

      if (
        availableAfter < 0 ||
        lockedAfter < 0
      ) {
        walletError(
          'INSUFFICIENT_FUNDS',
          'Insufficient available balance',
          400,
        );
      }

      await db.wallet.update({
        where: {
          id: fresh.id,
        },
        data: {
          availableBalance:
            availableAfter,
          lockedBalance:
            lockedAfter,
        },
      });

      // The status was flipped by the guarded conditional UPDATE above, which is
      // the ONLY place the transaction may leave a predecessor state: re-read the
      // authoritative row for the caller.
      const updated =
        (await db.walletTransaction.findUnique({
          where: {
            id: tx.id,
          },
        })) as unknown as WalletTransactionRow;

      await db.ledgerEntry.create({
        data: {
          walletId: fresh.id,
          transactionId: tx.id,
          direction:
            mutation.direction,
          amount:
            mutation.amount,
          availableBefore:
            fresh.availableBalance,
          availableAfter,
          lockedBefore:
            fresh.lockedBalance,
          lockedAfter,
          reason:
            mutation.reason,
        },
      });

      return updated;
    };
    if (client) return run(client);
    return this.prisma.$transaction(run);
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private normalizeCurrency(
    currency: string,
  ): string {
    const normalized =
      String(currency ?? '')
        .trim()
        .toUpperCase();

    this.assertSupportedCurrency(
      normalized,
    );

    return normalized;
  }

  private async findExisting(
    userId: string,
    idempotencyKey: string,
  ): Promise<WalletTransactionRow | null> {
    return this.findExistingInTx(
      this.prisma,
      userId,
      idempotencyKey,
    );
  }

  /**
   * Idempotency lookup inside the caller's transaction — the SAME
   * (userId, idempotencyKey) uniqueness the wallet relies on, read on the
   * caller's connection so a tx-scoped operation sees its own writes.
   */
  private async findExistingInTx(
    db: Prisma.TransactionClient,
    userId: string,
    idempotencyKey: string,
  ): Promise<WalletTransactionRow | null> {
    const row =
      await db.walletTransaction.findUnique(
        {
          where: {
            userId_idempotencyKey: {
              userId,
              idempotencyKey,
            },
          },
        },
      );

    return (
      (row as unknown as WalletTransactionRow) ??
      null
    );
  }

  /**
   * Read/create the wallet inside the caller's transaction (tx-scoped ledger
   * operations). Same contract as `getOrCreateWallet`: at most ONE Wallet per
   * (userId, currency), created audited best-effort in the SAME transaction.
   *
   * Account-domain rule: a NEW customer wallet is never created for a STAFF
   * account (staff have no customer wallet domain). An already-existing wallet
   * is returned untouched — historical data is preserved, never created.
   */
  private async getOrCreateWalletInTx(
    db: Prisma.TransactionClient,
    userId: string,
    currency: string,
  ): Promise<WalletRow> {
    const normalizedCurrency =
      this.normalizeCurrency(currency);

    const existing =
      (await db.wallet.findUnique({
        where: {
          userId_currency: {
            userId,
            currency: normalizedCurrency,
          },
        },
      })) as unknown as WalletRow | null;

    if (existing) {
      return existing;
    }

    await this.assertCustomerWalletAccount(db, userId);

    try {
      const created =
        (await db.wallet.create({
          data: {
            userId,
            currency: normalizedCurrency,
          },
        })) as unknown as WalletRow;

      await this.auditInTx(
        db,
        'WALLET_CREATED',
        userId,
        'Wallet',
        created.id,
        {
          currency:
            normalizedCurrency,
        },
      );

      return created;
    } catch (error) {
      if (
        error instanceof
          Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const retry =
          (await db.wallet.findUnique({
            where: {
              userId_currency: {
                userId,
                currency:
                  normalizedCurrency,
              },
            },
          })) as unknown as WalletRow | null;

        if (retry) {
          return retry;
        }
      }

      throw error;
    }
  }

  /**
   * Account-domain guard shared by every wallet-CREATE path: a STAFF account
   * must never receive a new customer wallet (staff have no customer wallet
   * domain — see Master Fix requirement 10/17). Only fires when no wallet row
   * exists yet, so pre-existing wallets (historical customer data of accounts
   * later reclassified as STAFF) keep working untouched.
   *
   * Accepts either the root client or a transaction client.
   */
  private async assertCustomerWalletAccount(
    db: Prisma.TransactionClient | PrismaService,
    userId: string,
  ): Promise<void> {
    const owner = await db.user.findUnique({
      where: { id: userId },
      select: { accountType: true },
    });
    // Unknown user → let the FK on wallet.userId produce the error, exactly
    // as before this guard existed.
    if (owner?.accountType === 'STAFF') {
      throw new ForbiddenException('Staff accounts do not have customer wallets.');
    }
  }

  private async getOrCreateWallet(
    userId: string,
    currency: string,
  ): Promise<WalletRow> {
    const normalizedCurrency =
      this.normalizeCurrency(currency);

    const existing =
      await this.prisma.wallet.findUnique({
        where: {
          userId_currency: {
            userId,
            currency: normalizedCurrency,
          },
        },
      });

    if (existing) {
      return existing as unknown as WalletRow;
    }

    // Account-domain rule: never PROACTIVELY give a staff account a customer
    // wallet. Existing wallets (historical customer data of accounts later
    // reclassified as STAFF) are still returned above — data is never deleted.
    await this.assertCustomerWalletAccount(this.prisma, userId);

    try {
      const created =
        await this.prisma.wallet.create({
          data: {
            userId,
            currency: normalizedCurrency,
          },
        });

      await this.audit(
        'WALLET_CREATED',
        userId,
        'Wallet',
        created.id,
        {
          currency:
            normalizedCurrency,
        },
      );

      return created as unknown as WalletRow;
    } catch (error) {
      if (
        error instanceof
          Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const retry =
          await this.prisma.wallet.findUnique({
            where: {
              userId_currency: {
                userId,
                currency:
                  normalizedCurrency,
              },
            },
          });

        if (retry) {
          return retry as unknown as WalletRow;
        }
      }

      throw error;
    }
  }

  private assertSupportedCurrency(
    currency: string,
  ): void {
    if (
      !this.config.supportedCurrencies.includes(
        currency,
      )
    ) {
      walletError(
        'UNSUPPORTED_CURRENCY',
        `Currency ${currency} is not supported`,
        400,
        {
          supported:
            this.config
              .supportedCurrencies,
        },
      );
    }
  }

  private assertPositiveAmount(
    amount: number,
  ): void {
    if (
      !Number.isInteger(amount) ||
      amount <= 0
    ) {
      walletError(
        'INVALID_AMOUNT',
        'Amount must be a positive integer in minor units',
      );
    }
  }

  assertAmountInRange(
    amount: number,
    kind: 'deposit' | 'withdrawal',
  ): void {
    this.assertPositiveAmount(amount);

    const min =
      kind === 'deposit'
        ? this.config.minDeposit
        : this.config.minWithdrawal;

    const max =
      kind === 'deposit'
        ? this.config.maxDeposit
        : this.config.maxWithdrawal;

    if (
      amount < min ||
      amount > max
    ) {
      walletError(
        'AMOUNT_OUT_OF_RANGE',
        `Amount must be between ${min} and ${max} minor units`,
        400,
        {
          min,
          max,
        },
      );
    }
  }

  get walletConfig(): WalletConfig {
    return this.config;
  }

  // --------------------------------------------------------------------------
  // Audit
  // --------------------------------------------------------------------------

  async audit(
    action: string,
    actorId: string,
    entityType: string,
    entityId: string,
    newValue: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId,
          actorType: 'USER',
          action,
          entityType,
          entityId,
          oldValue: Prisma.JsonNull,
          newValue:
            newValue as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to write audit log ${action}: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  private async auditInTx(
    db: Prisma.TransactionClient,
    action: string,
    actorId: string,
    entityType: string,
    entityId: string,
    newValue: Record<string, unknown>,
  ): Promise<void> {
    try {
      await db.auditLog.create({
        data: {
          actorId,
          actorType: 'USER',
          action,
          entityType,
          entityId,
          oldValue: Prisma.JsonNull,
          newValue:
            newValue as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to write audit log ${action}: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  // --------------------------------------------------------------------------
  // Transaction helpers
  // --------------------------------------------------------------------------

  async findTransaction(
    userId: string,
    idempotencyKey: string,
  ): Promise<WalletTransactionRow | null> {
    return this.findExisting(
      userId,
      idempotencyKey,
    );
  }

  async createPendingTransaction(
    wallet: WalletRow,
    data: {
      type: WalletTransactionType;
      amount: number;
      currency: string;
      idempotencyKey: string;
    },
  ): Promise<WalletTransactionRow> {
    const normalizedCurrency =
      this.normalizeCurrency(
        data.currency,
      );

    const row =
      await this.prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId: wallet.userId,
          type: data.type,
          status: 'PENDING',
          amount: data.amount,
          currency:
            normalizedCurrency,
          idempotencyKey:
            data.idempotencyKey,
        },
      });

    return row as unknown as WalletTransactionRow;
  }

  async transitionTransaction(
    tx: WalletTransactionRow,
    status:
      | 'FAILED'
      | 'CANCELLED'
      | 'PROCESSING'
      | 'COMPLETED',
    failureReason?: string,
  ): Promise<WalletTransactionRow> {
    const row =
      await this.prisma.walletTransaction.update({
        where: {
          id: tx.id,
        },
        data: {
          status,
          ...(failureReason !==
          undefined
            ? {
                failureReason,
              }
            : {}),
        },
      });

    return row as unknown as WalletTransactionRow;
  }

  async completeTransactionWithLedger(
    tx: WalletTransactionRow,
    wallet: WalletRow,
    mutation: LedgerMutation,
    reference: string,
  ): Promise<WalletTransactionRow> {
    return this.mutateExisting(
      wallet,
      tx,
      mutation,
      {
        status: 'COMPLETED',
        reference,
        // A deposit may have been parked as PROCESSING by the provider; both
        // states may complete, but only ONE caller ever credits.
        from: ['PENDING', 'PROCESSING'],
      },
    );
  }

  // --------------------------------------------------------------------------
  // Withdrawal
  // --------------------------------------------------------------------------

  async reserveWithdrawal(
    wallet: WalletRow,
    input: {
      amount: number;
      currency: string;
      idempotencyKey: string;
    },
  ): Promise<WalletTransactionRow> {
    const normalizedCurrency =
      this.normalizeCurrency(
        input.currency,
      );

    this.assertPositiveAmount(
      input.amount,
    );

    return this.mutate(
      wallet,
      {
        availableDelta:
          -input.amount,
        lockedDelta:
          input.amount,
        direction: 'DEBIT',
        amount:
          input.amount,
        reason:
          'WITHDRAWAL_LOCK',
      },
      {
        type: 'WITHDRAWAL' as WalletTransactionType,
        amount:
          -input.amount,
        currency:
          normalizedCurrency,
        idempotencyKey:
          input.idempotencyKey,
        status: 'PENDING',
      },
    );
  }

  async completeWithdrawal(
    tx: WalletTransactionRow,
    wallet: WalletRow,
    reference: string,
  ): Promise<WalletTransactionRow> {
    const amount =
      Math.abs(tx.amount);

    return this.mutateExisting(
      wallet,
      tx,
      {
        availableDelta: 0,
        lockedDelta: -amount,
        direction: 'DEBIT',
        amount,
        reason:
          'WITHDRAWAL_COMPLETED',
      },
      {
        status: 'COMPLETED',
        reference,
        // Locked withdrawal funds may ONLY leave the wallet once: the guarded
        // transition turns a retry/race into a no-op instead of a second debit.
        from: ['PENDING', 'PROCESSING'],
      },
    );
  }

  async releaseWithdrawal(
    tx: WalletTransactionRow,
    wallet: WalletRow,
    status: 'FAILED' | 'CANCELLED',
    reason: string,
  ): Promise<WalletTransactionRow> {
    const amount =
      Math.abs(tx.amount);

    return this.mutateExisting(
      wallet,
      tx,
      {
        availableDelta:
          amount,
        lockedDelta:
          -amount,
        direction: 'CREDIT',
        amount,
        reason:
          `WITHDRAWAL_RELEASED: ${reason}`,
      },
      {
        status,
        // Exactly-once refund of the reserved funds.
        from: ['PENDING', 'PROCESSING'],
      },
    );
  }

  async reserveManualWithdrawal(
    wallet: WalletRow,
    input: { amount: number; currency: string; reference: string },
  ): Promise<StakeReservation> {
    const normalizedCurrency = this.normalizeCurrency(input.currency);
    this.assertPositiveAmount(input.amount);
    await this.mutate(
      wallet,
      { availableDelta: -input.amount, lockedDelta: input.amount, direction: 'DEBIT', amount: input.amount, reason: `MANUAL_WITHDRAWAL_LOCK: ${input.reference}` },
      { type: 'WITHDRAWAL' as never, amount: -input.amount, currency: normalizedCurrency, idempotencyKey: input.reference, status: 'PENDING' },
    );
    const row = await this.findExisting(wallet.userId, input.reference).catch(() => null);
    return { transactionId: row?.id ?? '', duplicate: false };
  }

  async releaseManualWithdrawal(
    wallet: WalletRow,
    walletTransactionId: string | null,
    amount: number,
    idempotencyKey: string,
  ): Promise<void> {
    const abs = Math.abs(amount);
    const txId = walletTransactionId?.trim() ?? '';
    if (!txId) {
      walletError(
        'WITHDRAWAL_RESERVATION_MISSING',
        'Withdrawal has no reservation to release',
        409,
      );
    }
    const tx = await this.prisma.walletTransaction.findFirst({
      where: { id: txId, userId: wallet.userId },
      select: { id: true, status: true },
    });
    if (!tx) {
      walletError(
        'WITHDRAWAL_RESERVATION_MISSING',
        'Withdrawal reservation not found',
        409,
      );
    }
    // Idempotent: funds already released.
    if (tx.status === 'CANCELLED') {
      return;
    }
    if (tx.status === 'COMPLETED') {
      walletError(
        'WITHDRAWAL_ALREADY_SETTLED',
        'Withdrawal already completed; cannot release',
        409,
      );
    }
    await this.mutateExisting(
      wallet,
      { id: tx.id, userId: wallet.userId } as WalletTransactionRow,
      { availableDelta: abs, lockedDelta: -abs, direction: 'CREDIT', amount: abs, reason: `MANUAL_WITHDRAWAL_RELEASED: ${idempotencyKey}` },
      { status: 'CANCELLED', from: ['PENDING', 'PROCESSING'] },
    );
  }

  async completeManualWithdrawal(
    wallet: WalletRow,
    walletTransactionId: string | null,
    amount: number,
    idempotencyKey: string,
  ): Promise<void> {
    const abs = Math.abs(amount);
    const txId = walletTransactionId?.trim() ?? '';
    if (!txId) {
      walletError(
        'WITHDRAWAL_RESERVATION_MISSING',
        'Withdrawal has no reservation to complete',
        409,
      );
    }
    const tx = await this.prisma.walletTransaction.findFirst({
      where: { id: txId, userId: wallet.userId },
      select: { id: true, status: true },
    });
    if (!tx) {
      walletError(
        'WITHDRAWAL_RESERVATION_MISSING',
        'Withdrawal reservation not found',
        409,
      );
    }
    // Idempotent: funds already settled.
    if (tx.status === 'COMPLETED') {
      return;
    }
    if (tx.status === 'CANCELLED') {
      walletError(
        'WITHDRAWAL_ALREADY_SETTLED',
        'Withdrawal was already released; cannot complete',
        409,
      );
    }
    await this.mutateExisting(
      wallet,
      { id: tx.id, userId: wallet.userId } as WalletTransactionRow,
      { availableDelta: 0, lockedDelta: -abs, direction: 'DEBIT', amount: abs, reason: `MANUAL_WITHDRAWAL_COMPLETED: ${idempotencyKey}` },
      { status: 'COMPLETED', from: ['PENDING', 'PROCESSING'] },
    );
  }
}

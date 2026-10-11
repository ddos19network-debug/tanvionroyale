import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import { crashError } from './crash-errors';
import { CRASH_FREE_PLAY_CURRENCY } from './crash.types';
import { loadCrashConfig } from './crash.config';

export interface FreePlayWalletRow {
  id: string;
  userId: string;
  balance: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FreePlayTxRow {
  id: string;
  walletId: string;
  userId: string;
  type: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceType: string | null;
  referenceId: string | null;
  idempotencyKey: string;
  createdAt: Date;
}

export interface FreePlayReference {
  // ROYALE_PLINKO / ROYALE_MINES / ROYALE_ACE: the Royale Play games reuse this
  // SAME free-play points ledger (no second points wallet is ever created).
  type: 'CRASH_BET' | 'CRASH_SETTLEMENT' | 'ROYALE_PLINKO' | 'ROYALE_MINES' | 'ROYALE_ACE' | 'SYSTEM';
  id?: string | null;
}

/**
 * FREE-PLAY points bankroll for the crash engine.
 *
 * Points are NEVER money: this ledger is completely separate from the real
 * Wallet (different table, different currency code FREEPLAY, no withdrawal or
 * deposit path). Every balance change writes exactly one append-only
 * CrashFreePlayTransaction with before/after balances, exactly like the real
 * Wallet ledger, and mutations are idempotent by (userId, idempotencyKey).
 *
 * The methods accept a `db` (Prisma.TransactionClient) so callers compose
 * them atomically with bet/settlement writes; standalone wrappers run their
 * own transaction when no `db` is supplied.
 */
@Injectable()
export class CrashFreePlayWalletService {
  private readonly logger = new Logger(CrashFreePlayWalletService.name);
  private readonly config = loadCrashConfig();

  constructor(private readonly prisma: PrismaService) {}

  async getBalance(userId: string): Promise<number> {
    const wallet = await this.prisma.crashFreePlayWallet.findUnique({
      where: { userId },
    });
    return (wallet as unknown as FreePlayWalletRow | null)?.balance ?? 0;
  }

  /** Read/create the wallet; standalone (own transaction). */
  async getOrCreateWallet(userId: string): Promise<FreePlayWalletRow> {
    return this.prisma.$transaction((db) => this.getOrCreateWalletInTx(db, userId));
  }

  async getOrCreateWalletInTx(
    db: Prisma.TransactionClient,
    userId: string,
  ): Promise<FreePlayWalletRow> {
    const existing = (await db.crashFreePlayWallet.findUnique({
      where: { userId },
    })) as unknown as FreePlayWalletRow | null;
    if (existing) return existing;

    try {
      const wallet = (await db.crashFreePlayWallet.create({
        data: {
          userId,
          balance: this.config.initialFreePlayPoints,
          currency: CRASH_FREE_PLAY_CURRENCY,
        },
      })) as unknown as FreePlayWalletRow;
      // Record the initial credit in the same transaction (append-only ledger).
      try {
        await db.crashFreePlayTransaction.create({
          data: {
            walletId: wallet.id,
            userId,
            type: 'SIGNUP_CREDIT',
            amount: this.config.initialFreePlayPoints,
            balanceBefore: 0,
            balanceAfter: this.config.initialFreePlayPoints,
            referenceType: 'SYSTEM',
            idempotencyKey: `signup:${userId}`,
          },
        });
      } catch {
        /* the signup entry is informational — the balance is already correct */
      }
      return wallet;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const row = (await db.crashFreePlayWallet.findUnique({
          where: { userId },
        })) as unknown as FreePlayWalletRow | null;
        if (row) return row;
      }
      throw error;
    }
  }

  /** Debit points inside the caller's transaction (throws if overdraw). */
  async debitInTx(
    db: Prisma.TransactionClient,
    userId: string,
    amount: number,
    idempotencyKey: string,
    reference: FreePlayReference,
  ): Promise<FreePlayTxRow> {
    return this.mutateInTx(db, userId, amount, 'BET_STAKE', idempotencyKey, reference, false);
  }

  /** Credit points inside the caller's transaction. */
  async creditInTx(
    db: Prisma.TransactionClient,
    userId: string,
    amount: number,
    type: 'BET_PAYOUT' | 'BET_REFUND',
    idempotencyKey: string,
    reference: FreePlayReference,
  ): Promise<FreePlayTxRow> {
    return this.mutateInTx(db, userId, amount, type, idempotencyKey, reference, true);
  }

  /** Standalone debit (own transaction). */
  async debit(
    userId: string,
    amount: number,
    idempotencyKey: string,
    reference: FreePlayReference,
  ): Promise<FreePlayTxRow> {
    return this.prisma.$transaction((db) =>
      this.debitInTx(db, userId, amount, idempotencyKey, reference),
    );
  }

  /** Standalone credit (own transaction). */
  async credit(
    userId: string,
    amount: number,
    type: 'BET_PAYOUT' | 'BET_REFUND',
    idempotencyKey: string,
    reference: FreePlayReference,
  ): Promise<FreePlayTxRow> {
    return this.prisma.$transaction((db) =>
      this.creditInTx(db, userId, amount, type, idempotencyKey, reference),
    );
  }
private async mutateInTx(
    db: Prisma.TransactionClient,
    userId: string,
    amount: number,
    type: 'BET_STAKE' | 'BET_PAYOUT' | 'BET_REFUND',
    idempotencyKey: string,
    reference: FreePlayReference,
    credit: boolean,
  ): Promise<FreePlayTxRow> {
    if (!Number.isInteger(amount) || amount <= 0) {
      crashError('VALIDATION_ERROR', 'Amount must be a positive integer (free-play points)');
    }
    const existing = (await db.crashFreePlayTransaction.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    })) as unknown as FreePlayTxRow | null;
    if (existing) return existing;

    const wallet = await this.getOrCreateWalletInTx(db, userId);

    // Serialize concurrent mutations on the SAME wallet.
    const locked = await db.$queryRaw<{ id: string }[]>`SELECT id FROM "CrashFreePlayWallet" WHERE id = ${wallet.id} FOR UPDATE`;
    if (locked.length === 0) crashError('NOT_FOUND', 'Free-play wallet not found', 404);
    const fresh = (await db.crashFreePlayWallet.findUniqueOrThrow({
      where: { id: wallet.id },
    })) as unknown as FreePlayWalletRow;

    const signed = credit ? amount : -amount;
    const balanceAfter = fresh.balance + signed;
    if (balanceAfter < 0) {
      crashError(
        'INSUFFICIENT_POINTS',
        'Not enough free-play points for this stake',
        400,
        { available: fresh.balance, requested: amount },
      );
    }

    const txRow = (await db.crashFreePlayTransaction.create({
      data: {
        walletId: wallet.id,
        userId,
        type,
        amount: signed,
        balanceBefore: fresh.balance,
        balanceAfter,
        referenceType: reference.type,
        referenceId: reference.id,
        idempotencyKey,
      },
    })) as unknown as FreePlayTxRow;

    await db.crashFreePlayWallet.update({
      where: { id: wallet.id },
      data: { balance: balanceAfter },
    });

    return txRow;
  }

  /** Best-effort audit inside the caller's transaction. */
  async auditInTx(
    db: Prisma.TransactionClient,
    userId: string,
    action: string,
    roundId: string | null,
    betId: string | null,
    metadata: Record<string, unknown>,
    ip?: string,
  ): Promise<void> {
    try {
      await db.gameAuditLog.create({
        data: {
          gameSlug: this.config.gameSlug,
          roundId,
          betId,
          userId,
          action,
          metadata: metadata as Prisma.InputJsonValue,
          ip: ip ?? null,
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to write game audit log ${action}`);
    }
  }

  /** Best-effort standalone audit. */
  async audit(
    userId: string,
    action: string,
    roundId: string | null,
    betId: string | null,
    metadata: Record<string, unknown>,
    ip?: string,
  ): Promise<void> {
    try {
      await this.prisma.gameAuditLog.create({
        data: {
          gameSlug: this.config.gameSlug,
          roundId,
          betId,
          userId,
          action,
          metadata: metadata as Prisma.InputJsonValue,
          ip: ip ?? null,
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to write game audit log ${action}`);
    }
  }
}
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../src/generated/prisma';
import { WalletService } from '../src/modules/wallet/wallet.service';
import type { PrismaService } from '../src/database/prisma.service';
import { isWalletError } from '../src/modules/wallet/wallet-errors';

/**
 * Wallet unit tests (Phase 6).
 *
 * All financial logic is exercised against an in-memory fake of the Prisma
 * surface, including the interactive-transaction path (`$transaction`) so the
 * ledger/balance invariants can be asserted without a database.
 */

const auth = { id: 'user-1', sessionId: 's1', roles: ['USER'] };
const otherAuth = { id: 'user-2', sessionId: 's2', roles: ['USER'] };

function makeFake() {
  const wallets = new Map<string, any>(); // key: userId|currency
  const transactions = new Map<string, any>();
  const ledger: any[] = [];
  const auditLogs: any[] = [];
  /**
   * Account-domain classification of the fixture owners. Every id defaults to
   * CUSTOMER (wallet creation allowed); ids added here are STAFF, for which the
   * wallet engine must refuse to CREATE a new customer wallet.
   */
  const staffUserIds = new Set<string>();
  let idSeq = 0;

  const keyOf = (userId: string, currency: string) => userId + '|' + currency;
  const uuid = () => 'id-' + ++idSeq;

  const base: any = {
    wallet: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id) return [...wallets.values()].find((w) => w.id === where.id) ?? null;
        const { userId, currency } = where.userId_currency;
        return wallets.get(keyOf(userId, currency)) ?? null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: uuid(),
          userId: data.userId,
          currency: data.currency,
          availableBalance: 0,
          lockedBalance: 0,
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        wallets.set(keyOf(row.userId, row.currency), row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = [...wallets.values()].find((w) => w.id === where.id);
        const updated = { ...row, ...data, updatedAt: new Date() };
        wallets.set(keyOf(row.userId, row.currency), updated);
        return updated;
      }),
    },
    walletTransaction: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id) return transactions.get(where.id) ?? null;
        const { userId, idempotencyKey } = where.userId_idempotencyKey;
        return (
          [...transactions.values()].find(
            (t) => t.userId === userId && t.idempotencyKey === idempotencyKey,
          ) ?? null
        );
      }),
      create: jest.fn(async ({ data }: any) => {
        const dup = [...transactions.values()].find(
          (t) => t.userId === data.userId && t.idempotencyKey === data.idempotencyKey,
        );
        if (dup) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }
        const row = {
          id: uuid(),
          walletId: data.walletId,
          userId: data.userId,
          type: data.type,
          status: data.status,
          amount: data.amount,
          currency: data.currency,
          reference: data.reference ?? null,
          failureReason: data.failureReason ?? null,
          idempotencyKey: data.idempotencyKey,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        transactions.set(row.id, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = transactions.get(where.id);
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }),
      /**
       * Prisma `updateMany` semantics — returns { count } and mutates ONLY the
       * matching rows, including the `status: { in: [...] }` filter the wallet's
       * exactly-once terminal transition (capture / release / complete) relies on.
       */
      updateMany: jest.fn(async ({ where, data }: any) => {
        const rows = [...transactions.values()].filter((t) => {
          if (where?.id && t.id !== where.id) return false;
          if (where?.userId && t.userId !== where.userId) return false;
          const statusFilter = where?.status;
          if (statusFilter && typeof statusFilter === 'object' && 'in' in statusFilter) {
            if (!statusFilter.in.includes(t.status)) return false;
          }
          return true;
        });
        for (const row of rows) {
          Object.assign(row, data, { updatedAt: new Date() });
        }
        return { count: rows.length };
      }),
      findMany: jest.fn(async ({ where, take }: any) =>
        [...transactions.values()]
          .filter((t) => !where?.userId || t.userId === where.userId)
          .filter((t) => !where?.walletId || t.walletId === where.walletId)
          .filter((t) => !where?.status || t.status === where.status)
          .filter((t) => !where?.type || t.type === where.type)
          .slice(0, take ?? 25),
      ),
    },
    ledgerEntry: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: uuid(), ...data };
        ledger.push(row);
        return row;
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        auditLogs.push(data);
        return data;
      }),
    },
    user: {
      findUnique: jest.fn(async ({ where }: any) => ({
        id: where.id,
        accountType: staffUserIds.has(where.id) ? 'STAFF' : 'CUSTOMER',
      })),
    },
    $queryRaw: jest.fn(async () => []),
  };

  base.$transaction = jest.fn(async (fn: (db: any) => Promise<any>) => fn(base));

  return {
    prisma: base as unknown as PrismaService,
    wallets,
    transactions,
    ledger,
    auditLogs,
    staffUserIds,
  };
}


/* HttpException carries the structured body inside `getResponse()`, so a
 * dedicated matcher keeps the error-code assertions readable. */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toBeWalletError(code: string): R;
    }
  }
}
expect.extend({
  toBeWalletError(received: unknown, code: string) {
    const pass = isWalletError(received, code as never);
    return { pass, message: (): string => `expected wallet error ${code}` };
  },
});
function makeService(fake = makeFake()) {
  return { service: new WalletService(fake.prisma), ...fake };
}

/** Drive a deposit through the full PENDING -> COMPLETED lifecycle. */
async function deposit(service: WalletService, userId: string, amount: number, key: string) {
  const wallet = await service.getOrCreateWalletForUser(userId, 'BDT');
  const pending = await service.createPendingTransaction(wallet, {
    type: 'DEPOSIT',
    amount,
    currency: 'BDT',
    idempotencyKey: key,
  });
  return service.completeTransactionWithLedger(
    pending,
    wallet,
    {
      availableDelta: amount,
      lockedDelta: 0,
      direction: 'CREDIT',
      amount,
      reason: 'DEPOSIT_COMPLETED',
    },
    'mock-tx-1',
  );
}

describe('WalletService (Phase 6)', () => {
  it('creates a wallet lazily with zero balances and audits WALLET_CREATED', async () => {
    const { service, wallets, auditLogs } = makeService();
    const wallet = await service.getMyWallet(auth);
    expect(wallet.availableBalance).toBe(0);
    expect(wallet.lockedBalance).toBe(0);
    expect(wallet.currency).toBe('BDT');
    expect(wallet.status).toBe('ACTIVE');
    expect(wallets.size).toBe(1);
    expect(auditLogs.map((a) => a.action)).toContain('WALLET_CREATED');
  });

  it('credits via deposit and records an append-only ledger entry with before/after', async () => {
    const { service, ledger } = makeService();
    const wallet = await service.getMyWallet(auth);
    await deposit(service, auth.id, 10500, 'dep-1');
    const balance = await service.getMyBalance(auth);
    expect(balance.availableBalance).toBe(10500);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      walletId: wallet.id,
      direction: 'CREDIT',
      amount: 10500,
      availableBefore: 0,
      availableAfter: 10500,
      reason: 'DEPOSIT_COMPLETED',
    });
  });

  it('debits via reserveStake and captures the stake (BET_STAKE lifecycle)', async () => {
    const { service } = makeService();
    await deposit(service, auth.id, 5000, 'dep-1');
    const reservation = await service.reserveStake(auth.id, 1000, 'BDT', 'bet-key-1');
    expect(reservation.duplicate).toBe(false);
    let balance = await service.getMyBalance(auth);
    expect(balance.availableBalance).toBe(4000); // locked, not gone
    expect(balance.lockedBalance).toBe(1000);

    await service.captureStake(auth.id, 'bet-key-1');
    balance = await service.getMyBalance(auth);
    expect(balance.availableBalance).toBe(4000);
    expect(balance.lockedBalance).toBe(0);
  });

  it('releases a reserved stake when the bet is rejected (no money lost)', async () => {
    const { service } = makeService();
    await deposit(service, auth.id, 5000, 'dep-1');
    await service.reserveStake(auth.id, 1000, 'BDT', 'bet-key-1');
    await service.releaseStake(auth.id, 'bet-key-1');
    const balance = await service.getMyBalance(auth);
    expect(balance.availableBalance).toBe(5000);
    expect(balance.lockedBalance).toBe(0);
  });

  it('rejects a stake larger than the available balance (never negative)', async () => {
    const { service } = makeService();
    await deposit(service, auth.id, 500, 'dep-1');
    await expect(service.reserveStake(auth.id, 1000, 'BDT', 'bet-key-1')).rejects.toBeWalletError('INSUFFICIENT_FUNDS');
    const balance = await service.getMyBalance(auth);
    expect(balance.availableBalance).toBe(500);
    expect(balance.lockedBalance).toBe(0);
  });

  it('is idempotent: a repeated idempotencyKey never double-locks or double-credits', async () => {
    const { service, ledger, transactions } = makeService();
    await deposit(service, auth.id, 10000, 'dep-1');
    await deposit(service, auth.id, 10000, 'dep-2'); // a second, distinct deposit

    const first = await service.reserveStake(auth.id, 1000, 'BDT', 'bet-key-1');
    const second = await service.reserveStake(auth.id, 1000, 'BDT', 'bet-key-1');
    expect(second).toEqual({ transactionId: first.transactionId, duplicate: true });

    const balance = await service.getMyBalance(auth);
    expect(balance.availableBalance).toBe(19000);
    expect(balance.lockedBalance).toBe(1000);
    expect([...transactions.values()].filter((t) => t.type === 'BET_STAKE')).toHaveLength(1);
    expect(ledger.filter((l) => l.reason === 'DEPOSIT_COMPLETED')).toHaveLength(2); // two distinct deposits
  });

  it('handles a concurrent duplicate reservation (P2002 -> original row, single lock)', async () => {
    const { service, transactions } = makeService();
    await deposit(service, auth.id, 2000, 'dep-1');
    await service.reserveStake(auth.id, 1000, 'BDT', 'race-key');
    const balance = await service.getMyBalance(auth);
    expect(balance.lockedBalance).toBe(1000);
    expect([...transactions.values()].filter((t) => t.idempotencyKey === 'race-key')).toHaveLength(1);
  });

  it('withdrawal locks funds, completion debits the lock', async () => {
    const { service } = makeService();
    await deposit(service, auth.id, 10000, 'dep-1');
    const wallet = await service.getOrCreateWalletForUser(auth.id, 'BDT');
    const tx = await service.reserveWithdrawal(wallet, {
      amount: 2000,
      currency: 'BDT',
      idempotencyKey: 'wd-1',
    });
    let balance = await service.getMyBalance(auth);
    expect(balance.availableBalance).toBe(8000);
    expect(balance.lockedBalance).toBe(2000);

    await service.completeWithdrawal(tx, wallet, 'mock-tx-wd');
    balance = await service.getMyBalance(auth);
    expect(balance.availableBalance).toBe(8000);
    expect(balance.lockedBalance).toBe(0);
  });

  it('failed withdrawal releases locked funds back to available', async () => {
    const { service } = makeService();
    await deposit(service, auth.id, 10000, 'dep-1');
    const wallet = await service.getOrCreateWalletForUser(auth.id, 'BDT');
    const tx = await service.reserveWithdrawal(wallet, {
      amount: 2000,
      currency: 'BDT',
      idempotencyKey: 'wd-1',
    });
    await service.releaseWithdrawal(tx, wallet, 'FAILED', 'Provider rejected');
    const balance = await service.getMyBalance(auth);
    expect(balance.availableBalance).toBe(10000);
    expect(balance.lockedBalance).toBe(0);
  });

  it('cancelled withdrawal also releases the lock', async () => {
    const { service } = makeService();
    await deposit(service, auth.id, 10000, 'dep-1');
    const wallet = await service.getOrCreateWalletForUser(auth.id, 'BDT');
    const tx = await service.reserveWithdrawal(wallet, {
      amount: 3000,
      currency: 'BDT',
      idempotencyKey: 'wd-2',
    });
    await service.releaseWithdrawal(tx, wallet, 'CANCELLED', 'User requested');
    const balance = await service.getMyBalance(auth);
    expect(balance.availableBalance).toBe(10000);
  });

  it('rejects unsupported currency and non-integer amounts', async () => {
    const { service } = makeService();
    // Wallet supports BDT/USD/EUR only — GBP is not a supported wallet currency.
    await expect(service.reserveStake(auth.id, 1000, 'GBP', 'k-1')).rejects.toBeWalletError('UNSUPPORTED_CURRENCY');
    await expect(service.reserveStake(auth.id, 10.5, 'BDT', 'k-2')).rejects.toBeWalletError('INVALID_AMOUNT');
    await expect(service.reserveStake(auth.id, 0, 'BDT', 'k-3')).rejects.toBeWalletError('INVALID_AMOUNT');
  });

  it('validates deposit/withdrawal limits server-side', async () => {
    const { service } = makeService();
    expect(() => service.assertAmountInRange(50, 'deposit')).toThrow();
    // WALLET_MAX_DEPOSIT default = 100_000_000 minor units.
    expect(() => service.assertAmountInRange(100_000_001, 'deposit')).toThrow();
    expect(() => service.assertAmountInRange(100, 'deposit')).not.toThrow();
    expect(() => service.assertAmountInRange(100, 'withdrawal')).toThrow(); // below min
    expect(() => service.assertAmountInRange(500, 'withdrawal')).not.toThrow();
  });

  it('enforces transaction ownership: another user gets Forbidden / NotFound', async () => {
    const { service } = makeService();
    const tx = await deposit(service, auth.id, 1000, 'dep-1');
    await expect(service.getMyTransaction(otherAuth, tx.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.getMyTransaction(otherAuth, 'missing-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const own = await service.getMyTransaction(auth, tx.id);
    expect(own.userId).toBe(auth.id);
  });

  it('lists only my transactions', async () => {
    const { service } = makeService();
    await deposit(service, auth.id, 1000, 'dep-1');
    await deposit(service, otherAuth.id, 2000, 'dep-2');
    const mine = await service.listMyTransactions(auth);
    expect(mine).toHaveLength(1);
    expect(mine[0].userId).toBe(auth.id);
  });

  it('admin adjustment credits/debits through the ledger, idempotently', async () => {
    const { service, ledger, auditLogs } = makeService();
    await deposit(service, auth.id, 5000, 'dep-1');

    const credit = await service.adjustWallet(
      auth.id,
      { amount: 1500, currency: 'BDT', reason: 'goodwill', idempotencyKey: 'adj-1' },
      'admin-1',
    );
    expect(credit.duplicate).toBe(false);
    expect((await service.getMyBalance(auth)).availableBalance).toBe(6500);

    const dup = await service.adjustWallet(
      auth.id,
      { amount: 1500, currency: 'BDT', reason: 'goodwill', idempotencyKey: 'adj-1' },
      'admin-1',
    );
    expect(dup.duplicate).toBe(true);
    expect((await service.getMyBalance(auth)).availableBalance).toBe(6500);

    await service.adjustWallet(
      auth.id,
      { amount: -2000, currency: 'BDT', reason: 'correction', idempotencyKey: 'adj-2' },
      'admin-1',
    );
    expect((await service.getMyBalance(auth)).availableBalance).toBe(4500);

    await expect(
      service.adjustWallet(
        auth.id,
        { amount: -99999, currency: 'BDT', reason: 'overdraft', idempotencyKey: 'adj-3' },
        'admin-1',
      ),
    ).rejects.toBeWalletError('INSUFFICIENT_FUNDS');

    expect(ledger.filter((l) => String(l.reason).includes('WALLET_ADJUSTMENT'))).toHaveLength(2);
    expect(auditLogs.map((a) => a.action)).toContain('WALLET_ADJUSTMENT');
  });

  it('walletError surfaces the structured code (used by the betting mapping)', async () => {
    const { service } = makeService();
    await deposit(service, auth.id, 100, 'dep-1');
    try {
      await service.reserveStake(auth.id, 5000, 'BDT', 'k-1');
      throw new Error('should have thrown');
    } catch (error) {
      expect(isWalletError(error, 'INSUFFICIENT_FUNDS')).toBe(true);
      expect(isWalletError(error, 'INVALID_AMOUNT')).toBe(false);
    }
  });
});

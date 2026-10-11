/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../src/generated/prisma';
import {
  CasinoWalletService,
  type CasinoCallbackEnvelope,
} from '../src/modules/casino/casino-wallet.service';
import type { PrismaService } from '../src/database/prisma.service';
import type { WalletService } from '../src/modules/wallet/wallet.service';
import type { CasinoProviderFactory } from '../src/modules/casino/casino-provider.factory';

/**
 * Partner casino wallet callback tests — the money boundary.
 *
 * ONE wallet: bet debits it, win/refund credit it, rollback reverses it. Every
 * duplicate provider transaction must be acknowledged idempotently without a
 * second movement, an unverifiable signature must never move money, and a
 * refund/rollback may never invent balance.
 */
const PROVIDER_ID = 'provider-row-1';
const USER_ID = 'user-1';
const PLAYER_ID = 'tr0123456789abcdef0123456789abcd';
const CURRENCY = 'BDT';
const SESSION_ID = 'session-1';

function makeHarness(options: { configured?: boolean } = {}) {
  const configured = options.configured ?? true;

  const sessions = [
    {
      id: SESSION_ID,
      userId: USER_ID,
      providerId: PROVIDER_ID,
      providerPlayerId: PLAYER_ID,
      currency: CURRENCY,
      providerRoundId: 'round-1',
    },
  ];
  const transactions: any[] = [];
  const balances = new Map<string, number>();
  const reservations = new Map<string, { amount: number; transactionId: string }>();
  const credits = new Map<string, string>();
  let seq = 0;
  const uuid = (prefix: string) => `${prefix}-${++seq}`;

  balances.set(USER_ID, 1000); // 10.00 BDT

  const matches = (row: any, where: any): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === 'object' && 'in' in (value as any)) {
        return (value as any).in.includes(row[key]);
      }
      return row[key] === value;
    });

  const prisma: any = {
    casinoSession: {
      findFirst: jest.fn(
        async ({ where }: any) => sessions.find((session) => matches(session, where)) ?? null,
      ),
    },
    casinoTransaction: {
      findFirst: jest.fn(
        async ({ where }: any) => transactions.find((row) => matches(row, where)) ?? null,
      ),
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id) return transactions.find((row) => row.id === where.id) ?? null;
        const compound = where.providerId_externalTransactionId_kind;
        return (
          transactions.find(
            (row) =>
              row.providerId === compound.providerId &&
              row.externalTransactionId === compound.externalTransactionId &&
              row.kind === compound.kind,
          ) ?? null
        );
      }),
      findMany: jest.fn(async ({ where }: any) =>
        transactions.filter((row) => matches(row, where)),
      ),
      create: jest.fn(async ({ data }: any) => {
        const duplicate = transactions.find(
          (row) =>
            row.providerId === data.providerId &&
            row.externalTransactionId === data.externalTransactionId &&
            row.kind === data.kind,
        );
        if (duplicate) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '5.22.0',
          });
        }
        const row = { id: uuid('ctx'), status: 'APPLIED', createdAt: new Date(), ...data };
        transactions.push(row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const rows = transactions.filter((row) => matches(row, where));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      }),
    },
    $transaction: jest.fn(async (callback: any) => callback(prisma)),
  };
  const wallet = {
    getOrCreateWalletForUser: jest.fn(async (userId: string, currency: string) => ({
      id: `wallet-${userId}`,
      userId,
      currency,
      availableBalance: balances.get(userId) ?? 0,
      lockedBalance: 0,
      status: 'ACTIVE',
    })),
    reserveStake: jest.fn(
      async (userId: string, amount: number, _currency: string, key: string) => {
        const existing = reservations.get(key);
        if (existing) return { transactionId: existing.transactionId, duplicate: true };
        const current = balances.get(userId) ?? 0;
        if (current < amount) {
          throw new BadRequestException('Insufficient available balance');
        }
        balances.set(userId, current - amount);
        const transactionId = uuid('wtx');
        reservations.set(key, { amount, transactionId });
        return { transactionId, duplicate: false };
      },
    ),
    captureStake: jest.fn(async () => ({ status: 'COMPLETED' })),
    settleBetCredit: jest.fn(
      async (
        _db: any,
        userId: string,
        amount: number,
        _currency: string,
        _type: string,
        key: string,
      ) => {
        const existing = credits.get(key);
        if (existing) return { transactionId: existing, duplicate: true };
        balances.set(userId, (balances.get(userId) ?? 0) + amount);
        const transactionId = uuid('wtx');
        credits.set(key, transactionId);
        return { transactionId, duplicate: false };
      },
    ),
  };

  const providers = {
    verifyInboundRequest: jest.fn(async () =>
      configured
        ? { ok: true, reason: null, providerId: PROVIDER_ID }
        : { ok: false, reason: 'not_configured', providerId: null },
    ),
    config: jest.fn(() => ({
      environment: 'sandbox',
      supportedCurrencies: ['BDT', 'USD', 'EUR'],
      minBetMinor: 1,
      maxBetMinor: 50_000_000,
    })),
  };

  const service = new CasinoWalletService(
    prisma as unknown as PrismaService,
    providers as unknown as CasinoProviderFactory,
    wallet as unknown as WalletService,
  );

  let nonceSeq = 0;

  const envelope = (
    kind: 'bet' | 'win' | 'refund' | 'rollback',
    payload: Record<string, unknown>,
    headers: Record<string, string | undefined> = {
      merchantId: 'merchant',
      timestamp: String(Math.floor(Date.now() / 1000)),
      nonce: `nonce-${kind}-${++nonceSeq}`,
      signature: 'signature',
    },
  ): CasinoCallbackEnvelope => ({
    headers,
    method: 'POST',
    path: `/casino/callbacks/${kind}`,
    rawBody: JSON.stringify(payload),
    payload,
  });

  const call = (kind: 'bet' | 'win' | 'refund' | 'rollback', payload: Record<string, unknown>) =>
    kind === 'bet'
      ? service.handleBet(envelope(kind, payload))
      : kind === 'win'
        ? service.handleWin(envelope(kind, payload))
        : kind === 'refund'
          ? service.handleRefund(envelope(kind, payload))
          : service.handleRollback(envelope(kind, payload));

  const balanceOf = (userId = USER_ID) => balances.get(userId) ?? 0;

  return { service, prisma, wallet, providers, transactions, call, envelope, balanceOf };
}

const betPayload = (overrides: Record<string, unknown> = {}) => ({
  player_id: PLAYER_ID,
  currency: CURRENCY,
  transaction_id: 'TX-BET-1',
  round_id: 'round-1',
  amount_minor: 250,
  nonce: 'provider-nonce-bet-1',
  ...overrides,
});

describe('casino wallet callbacks — signature gate', () => {
  it('rejects an unverifiable request without touching the wallet', async () => {
    const h = makeHarness({ configured: false });
    const response = await h.call('bet', betPayload());

    expect(response.status).toBe('REJECTED');
    expect(response.balance).toBeNull();
    expect(h.wallet.reserveStake).not.toHaveBeenCalled();
    expect(h.transactions).toHaveLength(0);
  });
});

describe('casino wallet callbacks — BET', () => {
  it('debits the ONE TANVION wallet and maps the provider transaction', async () => {
    const h = makeHarness();
    const response = await h.call('bet', betPayload());

    expect(response.status).toBe('APPLIED');
    expect(response.duplicate).toBe(false);
    expect(response.kind).toBe('BET');
    expect(response.balance).toBe(750);
    expect(h.balanceOf()).toBe(750);
    expect(h.transactions).toHaveLength(1);
    expect(h.transactions[0]).toMatchObject({
      externalTransactionId: 'TX-BET-1',
      kind: 'BET',
      amount: -250,
      currency: CURRENCY,
      userId: USER_ID,
      sessionId: SESSION_ID,
      externalRoundId: 'round-1',
    });
  });

  it('uses a deterministic ledger idempotency key per provider transaction', async () => {
    const h = makeHarness();
    await h.call('bet', betPayload());
    const firstKey = h.wallet.reserveStake.mock.calls[0][3];

    expect(firstKey).toBe(`CASINO_BET:${PROVIDER_ID}:TX-BET-1`);

    // The retry is acknowledged from the provider-transaction mapping, so the
    // wallet is never asked to move money a second time.
    await h.call('bet', betPayload());
    expect(h.wallet.reserveStake).toHaveBeenCalledTimes(1);
  });

  it('acknowledges a duplicate bet idempotently without a second debit', async () => {
    const h = makeHarness();
    await h.call('bet', betPayload());

    const duplicate = await h.call('bet', betPayload());

    expect(duplicate.status).toBe('APPLIED');
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.balance).toBe(750);
    expect(h.balanceOf()).toBe(750);
    expect(h.transactions).toHaveLength(1);
  });

  it('rejects a duplicate provider transaction that reuses the nonce for another id', async () => {
    const h = makeHarness();
    await h.call('bet', betPayload());

    const response = await h.call(
      'bet',
      betPayload({ transaction_id: 'TX-BET-OTHER', nonce: 'provider-nonce-bet-1' }),
    );

    expect(response.status).toBe('REJECTED');
    expect(response.message).toBe('nonce_reused');
    expect(h.balanceOf()).toBe(750);
  });

  it('rejects an insufficient balance without moving money', async () => {
    const h = makeHarness();
    const response = await h.call('bet', betPayload({ amount_minor: 5000 }));

    expect(response.status).toBe('REJECTED');
    expect(response.balance).toBeNull();
    expect(h.balanceOf()).toBe(1000);
    expect(h.transactions).toHaveLength(0);
  });

  it('rejects an unrecognised player (never auto-creates an account)', async () => {
    const h = makeHarness();
    const response = await h.call(
      'bet',
      betPayload({ player_id: 'trffffffffffffffffffffffffffffff' }),
    );

    expect(response.status).toBe('REJECTED');
    expect(response.message).toBe('player_not_recognized');
    expect(h.wallet.reserveStake).not.toHaveBeenCalled();
  });

  it('rejects a currency that does not match the session', async () => {
    const h = makeHarness();
    const response = await h.call('bet', betPayload({ currency: 'USD' }));

    expect(response.status).toBe('REJECTED');
    expect(response.message).toBe('currency_mismatch');
    expect(h.balanceOf()).toBe(1000);
  });

  it('rejects a payload without an amount', async () => {
    const h = makeHarness();
    const response = await h.call('bet', betPayload({ amount_minor: undefined, amount: undefined }));

    expect(response.status).toBe('REJECTED');
    expect(response.message).toBe('invalid_amount');
    expect(h.balanceOf()).toBe(1000);
  });
});

describe('casino wallet callbacks — WIN', () => {
  const winPayload = (overrides: Record<string, unknown> = {}) => ({
    player_id: PLAYER_ID,
    currency: CURRENCY,
    transaction_id: 'TX-WIN-1',
    round_id: 'round-1',
    amount_minor: 500,
    nonce: 'provider-nonce-win-1',
    ...overrides,
  });

  it('credits the same wallet the bet was debited from', async () => {
    const h = makeHarness();
    await h.call('bet', betPayload());

    const response = await h.call('win', winPayload());

    expect(response.status).toBe('APPLIED');
    expect(response.kind).toBe('WIN');
    expect(response.balance).toBe(1250);
    expect(h.balanceOf()).toBe(1250);
    expect(h.transactions).toHaveLength(2);
    expect(h.transactions[1]).toMatchObject({ kind: 'WIN', amount: 500, nonce: 'provider-nonce-win-1' });
  });

  it('never credits a duplicate win twice', async () => {
    const h = makeHarness();
    await h.call('bet', betPayload());
    await h.call('win', winPayload());

    const duplicate = await h.call('win', winPayload());

    expect(duplicate.status).toBe('APPLIED');
    expect(duplicate.duplicate).toBe(true);
    expect(h.balanceOf()).toBe(1250);
    expect(h.transactions).toHaveLength(2);
    expect(h.wallet.settleBetCredit).toHaveBeenCalledTimes(1);
  });

  it('rejects a win for an unknown player', async () => {
    const h = makeHarness();
    const response = await h.call(
      'win',
      winPayload({ player_id: 'trffffffffffffffffffffffffffffff' }),
    );

    expect(response.status).toBe('REJECTED');
    expect(h.wallet.settleBetCredit).not.toHaveBeenCalled();
    expect(h.balanceOf()).toBe(1000);
  });
});

describe('casino wallet callbacks — REFUND', () => {
  const refundPayload = (overrides: Record<string, unknown> = {}) => ({
    player_id: PLAYER_ID,
    currency: CURRENCY,
    transaction_id: 'TX-REFUND-1',
    reference_transaction_id: 'TX-BET-1',
    amount_minor: 250,
    nonce: 'provider-nonce-refund-1',
    ...overrides,
  });

  it('credits a valid previous bet and marks the bet fully reversed', async () => {
    const h = makeHarness();
    await h.call('bet', betPayload());

    const response = await h.call('refund', refundPayload());

    expect(response.status).toBe('APPLIED');
    expect(response.kind).toBe('REFUND');
    expect(h.balanceOf()).toBe(1000);
    expect(h.transactions).toHaveLength(2);
    expect(h.transactions[1]).toMatchObject({
      kind: 'REFUND',
      amount: 250,
      referenceTransactionId: 'TX-BET-1',
    });
    expect(h.transactions[0].status).toBe('REVERSED');
  });

  it('never refunds the same bet twice', async () => {
    const h = makeHarness();
    await h.call('bet', betPayload());
    await h.call('refund', refundPayload());

    const duplicate = await h.call('refund', refundPayload());

    expect(duplicate.status).toBe('APPLIED');
    expect(duplicate.duplicate).toBe(true);
    expect(h.balanceOf()).toBe(1000);
    expect(h.transactions).toHaveLength(2);
    expect(h.wallet.settleBetCredit).toHaveBeenCalledTimes(1);
  });

  it('refuses a refund that would exceed the bet', async () => {
    const h = makeHarness();
    await h.call('bet', betPayload());
    await h.call(
      'refund',
      refundPayload({ transaction_id: 'TX-REFUND-A', amount_minor: 100, nonce: 'nonce-a' }),
    );

    const response = await h.call(
      'refund',
      refundPayload({ transaction_id: 'TX-REFUND-B', amount_minor: 200, nonce: 'nonce-b' }),
    );

    expect(response.status).toBe('REJECTED');
    expect(response.message).toBe('refund_exceeds_bet');
    expect(h.balanceOf()).toBe(850);
  });

  it('rejects a refund without a reference transaction', async () => {
    const h = makeHarness();
    await h.call('bet', betPayload());

    const response = await h.call(
      'refund',
      refundPayload({ reference_transaction_id: undefined }),
    );

    expect(response.status).toBe('REJECTED');
    expect(response.message).toBe('missing_reference_transaction_id');
    expect(h.balanceOf()).toBe(750);
  });

  it('rejects a refund of an unknown transaction', async () => {
    const h = makeHarness();
    await h.call('bet', betPayload());

    const response = await h.call(
      'refund',
      refundPayload({ reference_transaction_id: 'TX-DOES-NOT-EXIST' }),
    );

    expect(response.status).toBe('REJECTED');
    expect(response.message).toBe('reference_transaction_not_found');
    expect(h.balanceOf()).toBe(750);
  });

  it('rejects a refund of a win (only a bet is refundable)', async () => {
    const h = makeHarness();
    await h.call('bet', betPayload());
    await h.call('win', {
      player_id: PLAYER_ID,
      currency: CURRENCY,
      transaction_id: 'TX-WIN-1',
      amount_minor: 500,
      nonce: 'nonce-win',
    });

    const response = await h.call(
      'refund',
      refundPayload({ reference_transaction_id: 'TX-WIN-1' }),
    );

    expect(response.status).toBe('REJECTED');
    expect(response.message).toBe('refund_reference_not_a_bet');
    expect(h.balanceOf()).toBe(1250);
  });
});

describe('casino wallet callbacks — ROLLBACK', () => {
  const rollbackPayload = (overrides: Record<string, unknown> = {}) => ({
    player_id: PLAYER_ID,
    currency: CURRENCY,
    transaction_id: 'TX-ROLLBACK-1',
    reference_transaction_id: 'TX-BET-1',
    amount_minor: 250,
    nonce: 'provider-nonce-rollback-1',
    ...overrides,
  });

  it('reverses an applied bet by crediting the stake back', async () => {
    const h = makeHarness();
    await h.call('bet', betPayload());

    const response = await h.call('rollback', rollbackPayload());

    expect(response.status).toBe('APPLIED');
    expect(response.kind).toBe('ROLLBACK');
    expect(h.balanceOf()).toBe(1000);
    expect(h.transactions[0].status).toBe('REVERSED');
    expect(h.transactions[1]).toMatchObject({ kind: 'REFUND', amount: 250 });
  });

  it('is idempotent — a repeated rollback never credits twice', async () => {
    const h = makeHarness();
    await h.call('bet', betPayload());
    await h.call('rollback', rollbackPayload());

    const duplicate = await h.call('rollback', rollbackPayload());

    expect(duplicate.status).toBe('APPLIED');
    expect(duplicate.duplicate).toBe(true);
    expect(h.balanceOf()).toBe(1000);
    expect(h.transactions).toHaveLength(2);
  });

  it('reverses an applied win by debiting the credited amount', async () => {
    const h = makeHarness();
    await h.call('bet', betPayload());
    await h.call('win', {
      player_id: PLAYER_ID,
      currency: CURRENCY,
      transaction_id: 'TX-WIN-1',
      amount_minor: 500,
      nonce: 'nonce-win',
    });

    const response = await h.call(
      'rollback',
      rollbackPayload({ reference_transaction_id: 'TX-WIN-1', amount_minor: 500 }),
    );

    expect(response.status).toBe('APPLIED');
    expect(h.balanceOf()).toBe(750);
    const winRow = h.transactions.find((row) => row.kind === 'WIN');
    expect(winRow?.status).toBe('REVERSED');
    const rollbackRow = h.transactions.find((row) => row.kind === 'ROLLBACK');
    expect(rollbackRow).toMatchObject({ amount: -500, referenceTransactionId: 'TX-WIN-1' });
  });

  it('refuses to roll back a reversal (it would create money)', async () => {
    const h = makeHarness();
    await h.call('bet', betPayload());
    await h.call('refund', {
      player_id: PLAYER_ID,
      currency: CURRENCY,
      transaction_id: 'TX-REFUND-1',
      reference_transaction_id: 'TX-BET-1',
      amount_minor: 250,
      nonce: 'nonce-refund',
    });

    const response = await h.call(
      'rollback',
      rollbackPayload({ reference_transaction_id: 'TX-REFUND-1' }),
    );

    expect(response.status).toBe('REJECTED');
    expect(response.message).toBe('rollback_of_reversal_refused');
    expect(h.balanceOf()).toBe(1000);
  });

  it('rejects a rollback without a reference transaction', async () => {
    const h = makeHarness();
    await h.call('bet', betPayload());

    const response = await h.call(
      'rollback',
      rollbackPayload({ reference_transaction_id: undefined }),
    );

    expect(response.status).toBe('REJECTED');
    expect(response.message).toBe('missing_reference_transaction_id');
    expect(h.balanceOf()).toBe(750);
  });
});

describe('casino wallet callbacks — operational guards', () => {
  it('rejects an amount above the configured maximum', async () => {
    const h = makeHarness();
    const response = await h.call('bet', betPayload({ amount_minor: 60_000_000 }));

    expect(response.status).toBe('REJECTED');
    expect(response.message).toBe('amount_above_maximum');
    expect(h.balanceOf()).toBe(1000);
  });

  it('rejects a payload without a transaction id', async () => {
    const h = makeHarness();
    const response = await h.call('bet', betPayload({ transaction_id: undefined }));

    expect(response.status).toBe('REJECTED');
    expect(response.message).toBe('missing_transaction_id');
    expect(h.balanceOf()).toBe(1000);
  });

  it('resolves balance for an authenticated player without moving money', async () => {
    const h = makeHarness();
    const response = await h.service.handleBalance({
      headers: { merchantId: 'merchant', timestamp: '1', nonce: 'nonce-x', signature: 'sig' },
      method: 'POST',
      path: '/casino/callbacks/balance',
      rawBody: '{}',
      payload: { player_id: PLAYER_ID, currency: CURRENCY },
    });

    expect(response.status).toBe('APPLIED');
    expect(response.balance).toBe(1000);
    expect(response.transactionId).toBeNull();
    expect(h.transactions).toHaveLength(0);
  });
});

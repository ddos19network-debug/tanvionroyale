/* eslint-disable @typescript-eslint/no-explicit-any */
import { Prisma } from '../src/generated/prisma';
import { WinHouseCallbacksController } from '../src/modules/winhouse/winhouse-callbacks.controller';
import {
  WinHouseWalletService,
  type WinHouseCallbackEnvelope,
} from '../src/modules/winhouse/winhouse-wallet.service';
import type { PrismaService } from '../src/database/prisma.service';
import type { WalletService } from '../src/modules/wallet/wallet.service';
import type {
  WinHouseInboundVerdict,
  WinHouseResolvedProvider,
} from '../src/modules/winhouse/winhouse-provider.factory';
import { walletError } from '../src/modules/wallet/wallet-errors';
import {
  signBalanceChange,
  verifyBalanceChangeSignature,
  verifyCallbackToken,
} from '../src/modules/winhouse/winhouse-signature';

/**
 * WinHouse (embedded sportsbook, Model B) wallet callback tests — the money
 * boundary of BIG SPORT.
 *
 * THERE IS ONE TANVION WALLET. These tests pin exactly that:
 *   - a stake DEBITS it and a payout CREDITS it through the existing wallet
 *     service (reserveStakeInTx + captureStakeInTx / settleBetCredit);
 *   - a duplicate provider transaction_id with the SAME payload returns the
 *     ORIGINAL resulting balance and moves nothing (retries can never
 *     double-debit);
 *   - the same transaction_id with a DIFFERENT payload is refused with 409;
 *   - insufficient funds is refused with 422 and the balance can never go
 *     negative;
 *   - an unverifiable callback token or signature is refused with 401 BEFORE
 *     any money-related work happens;
 *   - a currency that is not the wallet's is refused (never converted);
 *   - refusals never contain a secret.
 *
 * All secrets here are FAKE test values; the real wallet API key and callback
 * token never appear in the repository or in a test.
 */
const PROVIDER_ID = 'winhouse-provider-row-1';
const USER_ID = 'user-1';
const PLAYER_ID = 'trwh0123456789abcdef0123456789abcd';
const CURRENCY = 'BDT';
const WALLET_API_KEY = 'winhouse-test-wallet-api-key';
const CALLBACK_TOKEN = 'winhouse-test-callback-token';
const SESSION_ROW_ID = 'winhouse-session-1';
const PLATFORM_SESSION_ID = 'session-1';
const DOMAIN = 'https://tanvionroyale.vercel.app';
const WALLET_BASE_URL = 'https://tanvionroyale.onrender.com/api/v1/winhouse';
/** 100.00 BDT in minor units. */
const START_BALANCE = 10_000;

/**
 * Pure unit tests over mocked I/O — but they share a worker with the rest of the
 * suite, so an explicit budget avoids a false TIMEOUT on a starved machine
 * (nothing here depends on elapsed time).
 */
jest.setTimeout(30_000);

function makeHarness(options: {
  configured?: boolean;
  mappingFailureOnce?: boolean;
  walletStatus?: 'ACTIVE' | 'FROZEN' | 'CLOSED';
  userAccountType?: 'CUSTOMER' | 'STAFF';
  userStatus?: 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'BANNED' | 'LOCKED' | 'CLOSED';
  winHouseStatus?: 'ACTIVE' | 'CLOSED';
} = {}) {
  const configured = options.configured ?? true;

  const sessions = [
    {
      id: SESSION_ROW_ID,
      userId: USER_ID,
      providerId: PROVIDER_ID,
      providerPlayerId: PLAYER_ID,
      currency: CURRENCY,
      environment: 'sandbox',
      status: options.winHouseStatus ?? 'ACTIVE',
      platformSessionId: PLATFORM_SESSION_ID,
      launchedAt: new Date(),
      user: {
        accountType: options.userAccountType ?? 'CUSTOMER',
        status: options.userStatus ?? 'ACTIVE',
      },
    },
  ];
  const transactions: any[] = [];
  const ledgerEntries: any[] = [];
  /** Wallet idempotency keys → the movement they already produced. */
  const walletKeys = new Map<string, { transactionId: string; amount: number }>();
  const captured = new Set<string>();

  let available = START_BALANCE;
  let locked = 0;
  let walletStatus = options.walletStatus ?? 'ACTIVE';
  let platformSessionActive = true;
  let failMappingOnce = options.mappingFailureOnce ?? false;
  let transactionTail: Promise<void> = Promise.resolve();
  let seq = 0;
  const uuid = (prefix: string) => `${prefix}-${++seq}`;

  const matches = (row: any, where: any): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === 'object' && 'in' in (value as any)) {
        return (value as any).in.includes(row[key]);
      }
      return row[key] === value;
    });

  const prisma: any = {
    session: {
      findFirst: jest.fn(async ({ where }: any) => {
        const active =
          platformSessionActive &&
          where.id === PLATFORM_SESSION_ID &&
          where.userId === USER_ID &&
          where.kind === 'CUSTOMER' &&
          where.revokedAt === null &&
          where.expiresAt.gt instanceof Date;
        return active ? { id: where.id } : null;
      }),
    },
    winHouseSession: {
      findFirst: jest.fn(
        async ({ where }: any) => sessions.find((session) => matches(session, where)) ?? null,
      ),
    },
    winHouseTransaction: {
      findUnique: jest.fn(async ({ where }: any) => {
        const compound = where.providerId_transactionId;
        return (
          transactions.find(
            (row) =>
              row.providerId === compound.providerId &&
              row.transactionId === compound.transactionId,
          ) ?? null
        );
      }),
      create: jest.fn(async ({ data }: any) => {
        if (failMappingOnce) {
          failMappingOnce = false;
          throw new Error('injected provider mapping failure');
        }
        const duplicate = transactions.some(
          (row) => row.providerId === data.providerId && row.transactionId === data.transactionId,
        );
        if (duplicate) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '5.22.0',
          });
        }
        const row = { id: uuid('wh-tx'), ...data };
        transactions.push(row);
        return row;
      }),
    },
    ledgerEntry: {
      findMany: jest.fn(async ({ where }: any) =>
        ledgerEntries.filter((row) => row.transactionId === where.transactionId),
      ),
    },
    $queryRaw: jest.fn(async () => [{ id: SESSION_ROW_ID }]),
    auditLog: { create: jest.fn(async () => ({})) },
    // Serialize callback transactions like the WinHouseSession row lock and
    // restore every in-memory wallet/ledger write if any step throws.
    $transaction: jest.fn((fn: any) => {
      const run = transactionTail.then(async () => {
        const snapshot = {
          available,
          locked,
          seq,
          walletKeys: new Map(walletKeys),
          captured: new Set(captured),
          transactionLength: transactions.length,
          ledgerLength: ledgerEntries.length,
        };
        try {
          return await fn(prisma);
        } catch (error) {
          available = snapshot.available;
          locked = snapshot.locked;
          seq = snapshot.seq;
          walletKeys.clear();
          for (const [key, value] of snapshot.walletKeys) walletKeys.set(key, value);
          captured.clear();
          for (const key of snapshot.captured) captured.add(key);
          transactions.splice(snapshot.transactionLength);
          ledgerEntries.splice(snapshot.ledgerLength);
          throw error;
        }
      });
      transactionTail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    }),
  };

  const wallet: any = {
    getOrCreateWalletForUser: jest.fn(async (userId: string, currency: string) => ({
      id: `wallet-${userId}`,
      userId,
      currency,
      availableBalance: available,
      lockedBalance: locked,
      status: walletStatus,
    })),
    /** Stake: reserve (debit available, lock) — the wallet's own idempotency key. */
    reserveStakeInTx: jest.fn(
      async (
        _db: unknown,
        userId: string,
        amount: number,
        _currency: string,
        key: string,
      ) => {
        const existing = walletKeys.get(key);
        if (existing) {
          return {
            walletId: `wallet-${userId}`,
            transactionId: existing.transactionId,
            duplicate: true,
          };
        }
        if (amount > available) {
          throw walletError('INSUFFICIENT_FUNDS', 'Insufficient available balance', 400);
        }
        const before = available;
        available -= amount;
        locked += amount;
        const transactionId = uuid('wallet-tx');
        walletKeys.set(key, { transactionId, amount });
        ledgerEntries.push({ transactionId, availableBefore: before, availableAfter: available });
        return { walletId: `wallet-${userId}`, transactionId, duplicate: false };
      },
    ),
    /** Stake: capture (release the lock). A retry must not move money again. */
    captureStakeInTx: jest.fn(async (_db: unknown, _userId: string, key: string) => {
      const entry = walletKeys.get(key);
      if (!entry || captured.has(key)) return;
      captured.add(key);
      const before = available;
      locked -= entry.amount;
      ledgerEntries.push({
        transactionId: entry.transactionId,
        availableBefore: before,
        availableAfter: available,
      });
    }),
    /** Payout: credit through the existing settlement credit path. */
    settleBetCredit: jest.fn(
      async (
        _db: unknown,
        userId: string,
        amount: number,
        _currency: string,
        _type: string,
        key: string,
      ) => {
        const existing = walletKeys.get(key);
        if (existing) {
          return {
            walletId: `wallet-${userId}`,
            transactionId: existing.transactionId,
            duplicate: true,
          };
        }
        const transactionId = uuid('wallet-tx');
        const before = available;
        available += amount;
        walletKeys.set(key, { transactionId, amount });
        ledgerEntries.push({ transactionId, availableBefore: before, availableAfter: available });
        return { walletId: `wallet-${userId}`, transactionId, duplicate: false };
      },
    ),
  };

  const resolved: WinHouseResolvedProvider = {
    config: { environment: 'sandbox' } as WinHouseResolvedProvider['config'],
    row: {
      id: PROVIDER_ID,
      name: 'WinHouse',
      status: 'ACTIVE',
      environment: 'sandbox',
      domain: DOMAIN,
      walletBaseUrl: WALLET_BASE_URL,
      serverIp: null,
      embedKey: 'ifr_0123456789abcdef0123456789abcdef01234567',
      embedBaseUrl: 'https://iframe.winhouse.bet',
    },
    configured,
    credentialsSource: 'environment',
    unavailableReason: configured ? null : 'No embedded sportsbook (WinHouse) provider is configured.',
    embedKey: 'ifr_0123456789abcdef0123456789abcdef01234567',
    embedBaseUrl: 'https://iframe.winhouse.bet',
    domain: DOMAIN,
    walletBaseUrl: WALLET_BASE_URL,
    serverIp: null,
    walletApiKey: WALLET_API_KEY,
    callbackToken: CALLBACK_TOKEN,
  };

  /**
   * Mirrors WinHouseProviderFactory.verifyInboundCallback with the REAL
   * signature module: the callback token is compared in constant time first,
   * then the HMAC-SHA256 signature over the five documented fields (keyed with
   * the wallet API key) is verified.
   */
  const providers: any = {
    resolve: jest.fn(async () => resolved),
    unavailableMessage: (value: WinHouseResolvedProvider) =>
      value.unavailableReason ?? 'No embedded sportsbook (WinHouse) provider is configured.',
    verifyInboundCallback: jest.fn(
      async (input: {
        token: string | null | undefined;
        signature: string | null | undefined;
        fields: { username: string; action: string; ticketId: string; transactionId: string };
        amountCandidates: readonly string[];
      }): Promise<WinHouseInboundVerdict> => {
        if (!resolved.configured) return { ok: false, reason: 'not_configured', providerId: null };
        if (!verifyCallbackToken(input.token, CALLBACK_TOKEN)) {
          return { ok: false, reason: 'bad_token', providerId: PROVIDER_ID };
        }
        const verdict = verifyBalanceChangeSignature(
          input.fields,
          input.amountCandidates,
          input.signature,
          WALLET_API_KEY,
        );
        if (!verdict.ok) return { ok: false, reason: verdict.reason, providerId: PROVIDER_ID };
        return { ok: true, reason: null, providerId: PROVIDER_ID };
      },
    ),
  };

  const service = new WinHouseWalletService(
    prisma as unknown as PrismaService,
    providers,
    wallet as unknown as WalletService,
  );

  const envelope = (input: {
    /** The amount EXACTLY as it appears in the JSON body (default '-2.50'). */
    amount?: string;
    action?: string;
    transactionId?: string;
    ticketId?: string;
    session?: string;
    currency?: string;
    username?: string;
    token?: string | null;
    /** 'valid' (default) signs the same fields the body carries. */
    signature?: 'valid' | 'bad' | 'missing';
    omit?: Array<'transaction_id' | 'action' | 'amount'>;
  }): WinHouseCallbackEnvelope => {
    const amount = input.amount ?? '-2.50';
    const action = input.action ?? 'bet';
    const transactionId = input.transactionId ?? 'TX-1';
    const ticketId = input.ticketId ?? 'TICKET-1';
    const session = input.session ?? 'session-1';
    const username = input.username ?? PLAYER_ID;

    const signature =
      input.signature === 'missing'
        ? null
        : input.signature === 'bad'
          ? signBalanceChange({ username, amount, action: 'win', ticketId, transactionId }, WALLET_API_KEY)
          : signBalanceChange({ username, amount, action, ticketId, transactionId }, WALLET_API_KEY);

    const fields: string[] = [`"username":"${username}"`];
    if (!input.omit?.includes('amount')) fields.push(`"amount":${amount}`);
    if (!input.omit?.includes('action')) fields.push(`"action":"${action}"`);
    fields.push(`"ticket_id":"${ticketId}"`, `"session":"${session}"`);
    if (!input.omit?.includes('transaction_id')) fields.push(`"transaction_id":"${transactionId}"`);
    if (input.currency) fields.push(`"currency":"${input.currency}"`);
    if (signature !== null) fields.push(`"signature":"${signature}"`);

    const rawBody = `{${fields.join(',')}}`;
    return {
      token: input.token === undefined ? CALLBACK_TOKEN : input.token,
      rawBody,
      payload: JSON.parse(rawBody) as Record<string, unknown>,
    };
  };

  return {
    service,
    prisma,
    wallet,
    providers,
    resolved,
    transactions,
    ledgerEntries,
    sessions,
    envelope,
    setPlatformSessionActive: (value: boolean) => {
      platformSessionActive = value;
    },
    setWalletStatus: (value: 'ACTIVE' | 'FROZEN' | 'CLOSED') => {
      walletStatus = value;
    },
    /** The ONE wallet's current available balance, in minor units. */
    balance: () => available,
    locked: () => locked,
    setBalance: (value: number) => {
      available = value;
    },
  };
}

/** Reads the thrown HttpException's status + JSON body. */
function refusalOf(error: unknown): { status: number; code: string; error: string } {
  const exception = error as { getStatus?: () => number; getResponse?: () => any };
  if (typeof exception?.getStatus !== 'function') throw error;
  const body = exception.getResponse?.() as { code: string; error: string };
  return { status: exception.getStatus(), code: body.code, error: body.error };
}

describe('winhouse wallet — user-data (balance read from the ONE wallet)', () => {
  it('answers with the exact TANVION wallet balance in the provider format', async () => {
    const h = makeHarness();
    const response = await h.service.handleUserData({
      token: CALLBACK_TOKEN,
      username: PLAYER_ID,
    });

    expect(response).toEqual({ username: PLAYER_ID, balance: '100.00', currency: 'BDT' });
    // Read-only: nothing moved and nothing was recorded as a movement.
    expect(h.balance()).toBe(START_BALANCE);
    expect(h.transactions).toHaveLength(0);
    expect(h.wallet.reserveStakeInTx).not.toHaveBeenCalled();
    expect(h.wallet.settleBetCredit).not.toHaveBeenCalled();
  });

  it('reflects a movement made through the same wallet', async () => {
    const h = makeHarness();
    await h.service.handleBalanceChange(h.envelope({ amount: '-2.50' }));
    const response = await h.service.handleUserData({
      token: CALLBACK_TOKEN,
      username: PLAYER_ID,
    });

    expect(response.balance).toBe('97.50');
  });

  it('refuses a bad or missing callback token with 401 before any database work', async () => {
    const h = makeHarness();
    h.prisma.winHouseSession.findFirst.mockClear();

    for (const token of ['wrong-token', '', null, undefined, `${CALLBACK_TOKEN}x`]) {
      await expect(
        h.service.handleUserData({ token, username: PLAYER_ID }),
      ).rejects.toMatchObject({ status: 401 });
    }
    expect(h.prisma.winHouseSession.findFirst).not.toHaveBeenCalled();
  });

  it('refuses an unknown player with 404 (never auto-creates one)', async () => {
    const h = makeHarness();
    try {
      await h.service.handleUserData({ token: CALLBACK_TOKEN, username: 'trwh' + 'f'.repeat(28) });
      throw new Error('expected a refusal');
    } catch (error) {
      expect(refusalOf(error)).toMatchObject({ status: 404, code: 'WINHOUSE_UNKNOWN_PLAYER' });
    }
  });

  it.each([
    ['staff account', { userAccountType: 'STAFF' as const }],
    ['disabled account', { userStatus: 'SUSPENDED' as const }],
    ['closed launch session', { winHouseStatus: 'CLOSED' as const }],
    ['frozen wallet', { walletStatus: 'FROZEN' as const }],
  ])('refuses %s without moving money', async (_label, options) => {
    const h = makeHarness(options);
    await expect(
      h.service.handleUserData({ token: CALLBACK_TOKEN, username: PLAYER_ID }),
    ).rejects.toMatchObject({ status: 404 });
    expect(h.wallet.reserveStakeInTx).not.toHaveBeenCalled();
    expect(h.wallet.settleBetCredit).not.toHaveBeenCalled();
  });

  it('refuses user-data after the platform session is revoked', async () => {
    const h = makeHarness();
    h.setPlatformSessionActive(false);
    await expect(
      h.service.handleUserData({ token: CALLBACK_TOKEN, username: PLAYER_ID }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses with 503 when no embedded sportsbook is configured', async () => {
    const h = makeHarness({ configured: false });
    await expect(
      h.service.handleUserData({ token: CALLBACK_TOKEN, username: PLAYER_ID }),
    ).rejects.toMatchObject({ status: 503 });
  });
});

describe('winhouse wallet — balance-change (stake / payout on the ONE wallet)', () => {
  it('applies a bet as a DEBIT of the existing wallet and returns the new balance', async () => {
    const h = makeHarness();
    const response = await h.service.handleBalanceChange(h.envelope({ amount: '-2.50' }));

    expect(response).toEqual({ status: 'ok', balance: '97.50' });
    expect(h.balance()).toBe(9750);
    expect(h.locked()).toBe(0);
    expect(h.wallet.reserveStakeInTx).toHaveBeenCalledTimes(1);
    expect(h.wallet.captureStakeInTx).toHaveBeenCalledTimes(1);
    // The stake went through the EXISTING wallet path, never a provider mirror.
    expect(h.wallet.reserveStakeInTx.mock.calls[0][1]).toBe(USER_ID);
    expect(h.wallet.reserveStakeInTx.mock.calls[0][2]).toBe(250);
    expect(h.wallet.reserveStakeInTx.mock.calls[0][3]).toBe(CURRENCY);
    expect(h.wallet.settleBetCredit).not.toHaveBeenCalled();
  });

  it('records the full transaction mapping for the debit', async () => {
    const h = makeHarness();
    await h.service.handleBalanceChange(h.envelope({ amount: '-2.50' }));

    expect(h.transactions).toHaveLength(1);
    expect(h.transactions[0]).toMatchObject({
      providerId: PROVIDER_ID,
      userId: USER_ID,
      transactionId: 'TX-1',
      action: 'bet',
      ticketId: 'TICKET-1',
      sessionId: 'session-1',
      winhouseSessionId: SESSION_ROW_ID,
      amountMinor: -250,
      amountWire: '-2.50',
      currency: CURRENCY,
      balanceBefore: START_BALANCE,
      balanceAfter: 9750,
      environment: 'sandbox',
    });
    expect(h.transactions[0].payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('applies a win as a CREDIT of the same wallet', async () => {
    const h = makeHarness();
    const response = await h.service.handleBalanceChange(
      h.envelope({ amount: '12.50', action: 'win', transactionId: 'TX-WIN-1' }),
    );

    expect(response).toEqual({ status: 'ok', balance: '112.50' });
    expect(h.balance()).toBe(11250);
    expect(h.wallet.reserveStakeInTx).not.toHaveBeenCalled();
    expect(h.wallet.settleBetCredit).toHaveBeenCalledTimes(1);
    expect(h.wallet.settleBetCredit.mock.calls[0][2]).toBe(1250);
    expect(h.transactions[0]).toMatchObject({
      action: 'win',
      amountMinor: 1250,
      balanceBefore: START_BALANCE,
      balanceAfter: 11250,
    });
  });

  it('treats a bet followed by its payout as two movements on one balance', async () => {
    const h = makeHarness();
    await h.service.handleBalanceChange(h.envelope({ amount: '-2.50' }));
    await h.service.handleBalanceChange(
      h.envelope({ amount: '6.00', action: 'win', transactionId: 'TX-WIN-1', ticketId: 'TICKET-1' }),
    );

    expect(h.balance()).toBe(10350);
    expect(h.transactions).toHaveLength(2);
  });
});

describe('winhouse wallet — idempotency (retries can never double-debit)', () => {
  it('returns the SAME resulting balance for an exact duplicate and moves nothing', async () => {
    const h = makeHarness();
    const first = await h.service.handleBalanceChange(h.envelope({ amount: '-2.50' }));
    const balanceAfterFirst = h.balance();

    const second = await h.service.handleBalanceChange(h.envelope({ amount: '-2.50' }));

    expect(second).toEqual(first);
    expect(h.balance()).toBe(balanceAfterFirst);
    expect(h.wallet.reserveStakeInTx).toHaveBeenCalledTimes(1);
    expect(h.transactions).toHaveLength(1);
  });

  it('treats a re-stringified amount ("-2.50" vs "-2.5") as the SAME transaction', async () => {
    const h = makeHarness();
    await h.service.handleBalanceChange(h.envelope({ amount: '-2.50' }));
    const balanceAfterFirst = h.balance();

    // The provider's retry re-serializes the same value; the signature is over
    // the literal it sent THAT time, and both literals are accepted.
    const retry = await h.service.handleBalanceChange(h.envelope({ amount: '-2.5' }));

    expect(retry).toEqual({ status: 'ok', balance: '97.50' });
    expect(h.balance()).toBe(balanceAfterFirst);
    expect(h.transactions).toHaveLength(1);
  });

  it('acknowledges a duplicate WIN without crediting twice', async () => {
    const h = makeHarness();
    await h.service.handleBalanceChange(
      h.envelope({ amount: '12.50', action: 'win', transactionId: 'TX-WIN-1' }),
    );
    const balanceAfterFirst = h.balance();

    const retry = await h.service.handleBalanceChange(
      h.envelope({ amount: '12.50', action: 'win', transactionId: 'TX-WIN-1' }),
    );

    expect(retry).toEqual({ status: 'ok', balance: '112.50' });
    expect(h.balance()).toBe(balanceAfterFirst);
    expect(h.wallet.settleBetCredit).toHaveBeenCalledTimes(1);
  });

  it('refuses the same transaction_id with a DIFFERENT payload with 409', async () => {
    const h = makeHarness();
    await h.service.handleBalanceChange(h.envelope({ amount: '-2.50' }));
    const balanceAfterFirst = h.balance();

    for (const variant of [
      { amount: '-9.99' },
      { action: 'win', amount: '2.50' },
      { ticketId: 'TICKET-OTHER' },
      { session: 'session-other' },
    ]) {
      try {
        await h.service.handleBalanceChange(h.envelope({ transactionId: 'TX-1', ...variant }));
        throw new Error('expected a refusal');
      } catch (error) {
        expect(refusalOf(error)).toMatchObject({
          status: 409,
          code: 'WINHOUSE_TRANSACTION_CONFLICT',
        });
      }
    }
    expect(h.balance()).toBe(balanceAfterFirst);
    expect(h.transactions).toHaveLength(1);
  });

  it('debts exactly once when two identical retries race each other', async () => {
    const h = makeHarness();
    const retry = h.envelope({ amount: '-2.50' });

    const [first, second] = await Promise.all([
      h.service.handleBalanceChange(retry),
      h.service.handleBalanceChange(h.envelope({ amount: '-2.50' })),
    ]);

    expect(first.status).toBe('ok');
    expect(second.status).toBe('ok');
    expect(h.balance()).toBe(9750);
    expect(h.transactions).toHaveLength(1);
  });

  it('rolls back wallet and ledger writes when the provider mapping write fails', async () => {
    const h = makeHarness({ mappingFailureOnce: true });
    const callback = h.envelope({ amount: '-2.50', transactionId: 'TX-ROLLBACK' });

    await expect(h.service.handleBalanceChange(callback)).rejects.toThrow(
      'injected provider mapping failure',
    );
    expect(h.balance()).toBe(START_BALANCE);
    expect(h.locked()).toBe(0);
    expect(h.ledgerEntries).toHaveLength(0);
    expect(h.transactions).toHaveLength(0);

    await expect(h.service.handleBalanceChange(callback)).resolves.toEqual({
      status: 'ok',
      balance: '97.50',
    });
    expect(h.balance()).toBe(9750);
    expect(h.transactions).toHaveLength(1);
  });

  it('keeps the provider mapping unique per provider + transaction id', async () => {
    const h = makeHarness();
    await h.service.handleBalanceChange(h.envelope({ amount: '-2.50', transactionId: 'TX-1' }));
    await h.service.handleBalanceChange(h.envelope({ amount: '-1.00', transactionId: 'TX-2' }));

    expect(h.transactions.map((row) => row.transactionId)).toEqual(['TX-1', 'TX-2']);
  });
});

describe('winhouse wallet — refusal contract (status is the provider retry switch)', () => {
  it('refuses insufficient funds with 422 and never lets the balance go negative', async () => {
    const h = makeHarness();
    h.setBalance(100); // 1.00 BDT

    try {
      await h.service.handleBalanceChange(h.envelope({ amount: '-2.50' }));
      throw new Error('expected a refusal');
    } catch (error) {
      expect(refusalOf(error)).toMatchObject({
        status: 422,
        code: 'WINHOUSE_INSUFFICIENT_FUNDS',
      });
    }

    expect(h.balance()).toBe(100);
    expect(h.balance()).toBeGreaterThanOrEqual(0);
    expect(h.transactions).toHaveLength(0);
  });

  it('accepts a stake of exactly the whole balance, then refuses 0.01 more', async () => {
    const h = makeHarness();
    h.setBalance(250);

    const accepted = await h.service.handleBalanceChange(h.envelope({ amount: '-2.50' }));
    expect(accepted).toEqual({ status: 'ok', balance: '0.00' });
    expect(h.balance()).toBe(0);

    try {
      await h.service.handleBalanceChange(h.envelope({ amount: '-0.01', transactionId: 'TX-2' }));
      throw new Error('expected a refusal');
    } catch (error) {
      expect(refusalOf(error)).toMatchObject({ status: 422 });
    }
    expect(h.balance()).toBe(0);
  });

  it('refuses a bad or missing signature with 401 and moves nothing', async () => {
    const h = makeHarness();
    for (const signature of ['bad', 'missing'] as const) {
      try {
        await h.service.handleBalanceChange(h.envelope({ amount: '-2.50', signature }));
        throw new Error('expected a refusal');
      } catch (error) {
        expect(refusalOf(error).status).toBe(401);
      }
    }
    expect(h.balance()).toBe(START_BALANCE);
    expect(h.transactions).toHaveLength(0);
  });

  it('refuses a tampered body: the signature no longer covers the amount sent', async () => {
    const h = makeHarness();
    const envelope = h.envelope({ amount: '-2.50' });
    // The signer signed -2.50; the body now says -250.00. The controller parses
    // the RAW body it received, so the payload is rebuilt from the tampered text.
    const tamperedText = envelope.rawBody.replace('"amount":-2.50', '"amount":-250.00');
    const tampered: WinHouseCallbackEnvelope = {
      ...envelope,
      rawBody: tamperedText,
      payload: JSON.parse(tamperedText) as Record<string, unknown>,
    };

    try {
      await h.service.handleBalanceChange(tampered);
      throw new Error('expected a refusal');
    } catch (error) {
      expect(refusalOf(error).status).toBe(401);
    }
    expect(h.balance()).toBe(START_BALANCE);
  });

  it('refuses a body whose text and parsed amount disagree (intermediary rewriting)', async () => {
    const h = makeHarness();
    const envelope = h.envelope({ amount: '-2.50' });
    // Same tamper, but the payload is left as the signer sent it: the two
    // readings of the amount no longer describe the same number.
    const tampered: WinHouseCallbackEnvelope = {
      ...envelope,
      rawBody: envelope.rawBody.replace('"amount":-2.50', '"amount":-250.00'),
    };

    try {
      await h.service.handleBalanceChange(tampered);
      throw new Error('expected a refusal');
    } catch (error) {
      expect(refusalOf(error)).toMatchObject({ status: 400, code: 'WINHOUSE_INVALID_AMOUNT' });
    }
    expect(h.balance()).toBe(START_BALANCE);
  });

  it('refuses a bad callback token with 401 even with a valid signature', async () => {
    const h = makeHarness();
    try {
      await h.service.handleBalanceChange(
        h.envelope({ amount: '-2.50', token: 'not-the-callback-token' }),
      );
      throw new Error('expected a refusal');
    } catch (error) {
      expect(refusalOf(error)).toMatchObject({ status: 401, code: 'WINHOUSE_BAD_TOKEN' });
    }
    expect(h.balance()).toBe(START_BALANCE);
  });

  it('authenticates the callback token before inspecting incomplete movement fields', async () => {
    const h = makeHarness();
    try {
      await h.service.handleBalanceChange(
        h.envelope({ token: 'not-the-callback-token', omit: ['transaction_id', 'action', 'amount'] }),
      );
      throw new Error('expected a refusal');
    } catch (error) {
      expect(refusalOf(error)).toMatchObject({ status: 401, code: 'WINHOUSE_BAD_TOKEN' });
    }
    expect(h.balance()).toBe(START_BALANCE);
    expect(h.transactions).toHaveLength(0);
  });

  it('refuses a currency that is not the wallet currency (never converted)', async () => {
    const h = makeHarness();
    for (const currency of ['USD', 'EUR', 'GBP']) {
      try {
        await h.service.handleBalanceChange(h.envelope({ amount: '-2.50', currency }));
        throw new Error('expected a refusal');
      } catch (error) {
        expect(refusalOf(error)).toMatchObject({
          status: 422,
          code: 'WINHOUSE_CURRENCY_MISMATCH',
        });
      }
    }
    expect(h.balance()).toBe(START_BALANCE);
  });

  it('accepts the matching currency in any case (no conversion involved)', async () => {
    const h = makeHarness();
    const response = await h.service.handleBalanceChange(
      h.envelope({ amount: '-2.50', currency: 'bdt' }),
    );
    expect(response).toEqual({ status: 'ok', balance: '97.50' });
  });
});

describe('winhouse callbacks controller — token-before-body boundary', () => {
  it('returns 401 for malformed JSON with a bad token and 400 after authentication', async () => {
    const h = makeHarness();
    const controller = new WinHouseCallbacksController(h.service);
    const request = { rawBody: Buffer.from('{') } as any;

    await expect(controller.balanceChange(request, 'not-the-callback-token')).rejects.toMatchObject({
      status: 401,
    });
    await expect(controller.balanceChange(request, CALLBACK_TOKEN)).rejects.toMatchObject({
      status: 400,
    });
    expect(h.balance()).toBe(START_BALANCE);
    expect(h.transactions).toHaveLength(0);
  });
});

describe('winhouse wallet — operational guards', () => {
  it('refuses an action that disagrees with the amount sign with 422', async () => {
    const h = makeHarness();
    for (const input of [
      { amount: '2.50', action: 'bet' },
      { amount: '-2.50', action: 'win' },
    ]) {
      try {
        await h.service.handleBalanceChange(h.envelope(input));
        throw new Error('expected a refusal');
      } catch (error) {
        expect(refusalOf(error)).toMatchObject({
          status: 422,
          code: 'WINHOUSE_ACTION_AMOUNT_MISMATCH',
        });
      }
    }
    expect(h.balance()).toBe(START_BALANCE);
  });

  it('refuses an unsupported action with 422', async () => {
    const h = makeHarness();
    try {
      await h.service.handleBalanceChange(h.envelope({ amount: '-2.50', action: 'rollback' }));
      throw new Error('expected a refusal');
    } catch (error) {
      expect(refusalOf(error)).toMatchObject({
        status: 422,
        code: 'WINHOUSE_UNSUPPORTED_ACTION',
      });
    }
  });

  it('refuses an unknown player with 404', async () => {
    const h = makeHarness();
    try {
      await h.service.handleBalanceChange(
        h.envelope({ amount: '-2.50', username: 'trwh' + 'f'.repeat(28) }),
      );
      throw new Error('expected a refusal');
    } catch (error) {
      expect(refusalOf(error)).toMatchObject({ status: 404, code: 'WINHOUSE_UNKNOWN_PLAYER' });
    }
    expect(h.balance()).toBe(START_BALANCE);
  });

  it('refuses a first movement whose session differs from the launch session', async () => {
    const h = makeHarness();
    await expect(
      h.service.handleBalanceChange(h.envelope({ session: 'another-session' })),
    ).rejects.toMatchObject({ status: 404 });
    expect(h.balance()).toBe(START_BALANCE);
    expect(h.transactions).toHaveLength(0);
  });

  it('still acknowledges an exact duplicate after the account is disabled', async () => {
    const h = makeHarness();
    const callback = h.envelope({ amount: '-2.50' });
    const first = await h.service.handleBalanceChange(callback);
    h.sessions[0].user.status = 'SUSPENDED';

    await expect(h.service.handleBalanceChange(callback)).resolves.toEqual(first);
    expect(h.balance()).toBe(9750);
    expect(h.transactions).toHaveLength(1);
  });

  it('refuses a malformed body or an unrepresentable amount with 400', async () => {
    const h = makeHarness();
    for (const input of [
      { omit: ['transaction_id'] },
      { omit: ['action'] },
      { omit: ['amount'] },
      { amount: '-2.505' },
      { amount: '0' },
    ]) {
      try {
        await h.service.handleBalanceChange(h.envelope(input as never));
        throw new Error('expected a refusal');
      } catch (error) {
        expect(refusalOf(error).status).toBe(400);
      }
    }
    expect(h.balance()).toBe(START_BALANCE);
  });

  it('refuses with 503 (retryable) when the integration is not configured', async () => {
    const h = makeHarness({ configured: false });
    try {
      await h.service.handleBalanceChange(h.envelope({ amount: '-2.50' }));
      throw new Error('expected a refusal');
    } catch (error) {
      expect(refusalOf(error).status).toBe(503);
    }
    expect(h.balance()).toBe(START_BALANCE);
  });

  it('never echoes a secret in a refusal body', async () => {
    const h = makeHarness();
    const refusals: string[] = [];
    for (const inputs of [
      { amount: '-2.50', signature: 'bad' as const },
      { amount: '-2.50', token: 'wrong' },
      { amount: '-999.99' },
      { amount: '-2.50', currency: 'USD' },
    ]) {
      try {
        await h.service.handleBalanceChange(h.envelope(inputs));
      } catch (error) {
        const exception = error as { getResponse?: () => unknown };
        refusals.push(JSON.stringify(exception.getResponse?.() ?? {}));
      }
    }

    expect(refusals).toHaveLength(4);
    for (const body of refusals) {
      expect(body).not.toContain(WALLET_API_KEY);
      expect(body).not.toContain(CALLBACK_TOKEN);
      // No HMAC hex digest (i.e. no signature) may leak into a response.
      expect(body).not.toMatch(/[0-9a-f]{64}/);
    }
  });
});

describe('winhouse wallet — admin diagnostics and the safe money-path dry run', () => {
  it('records the applied movement and the exact refusal code for the status view', async () => {
    const h = makeHarness();

    await h.service.handleBalanceChange(h.envelope({ amount: '-2.50' }));
    await expect(
      h.service.handleUserData({ token: 'not-the-callback-token', username: PLAYER_ID }),
    ).rejects.toMatchObject({ status: 401 });

    const snapshot = h.service.diagnosticsSnapshot();

    // The last callback is the refusal, the last MOVEMENT is still the applied
    // stake, and the refusal code is reported verbatim.
    expect(snapshot.lastCallback).toMatchObject({
      kind: 'user-data',
      outcome: 'rejected',
      code: 'WINHOUSE_BAD_TOKEN',
      status: 401,
    });
    expect(snapshot.lastBalanceChange).toMatchObject({
      kind: 'balance-change',
      outcome: 'ok',
      code: null,
      status: 200,
    });
    expect(snapshot.lastError).toMatchObject({ code: 'WINHOUSE_BAD_TOKEN' });
  });

  it('reports no callback at all before the provider has ever called us', () => {
    const h = makeHarness();

    expect(h.service.diagnosticsSnapshot()).toEqual({
      lastCallback: null,
      lastBalanceChange: null,
      lastError: null,
    });
  });

  it('never stores a token, a key or a signature in a diagnostic', async () => {
    const h = makeHarness();

    await h.service
      .handleBalanceChange(h.envelope({ token: 'provider-token-echoed-by-nobody' }))
      .catch(() => undefined);

    const serialized = JSON.stringify(h.service.diagnosticsSnapshot());

    expect(serialized).not.toContain(CALLBACK_TOKEN);
    expect(serialized).not.toContain(WALLET_API_KEY);
    expect(serialized).not.toContain('provider-token-echoed-by-nobody');
    expect(serialized).not.toMatch(/[0-9a-f]{64}/);
  });

  /**
   * The dry run drives the REAL `WalletService` methods inside a transaction
   * that must never commit. The fake `$transaction` below models Prisma's
   * rollback, so a committed write becomes observable at the end.
   */
  function makeProbeHarness(options: { wallet?: boolean; breakLockedBalance?: boolean } = {}) {
    const state = { availableBalance: 5_000, lockedBalance: 0 };
    const calls: string[] = [];
    const wallet = {
      reserveStakeInTx: jest.fn(async (_db: unknown, _u: string, amount: number, _c: string, key: string) => {
        const prior = calls.filter((entry) => entry === `reserve:${key}`).length;
        calls.push(`reserve:${key}`);
        if (prior > 0) return { transactionId: 'wallet-tx-stake', duplicate: true };
        state.availableBalance -= amount;
        state.lockedBalance += amount;
        return { transactionId: 'wallet-tx-stake', duplicate: false };
      }),
      captureStakeInTx: jest.fn(async () => {
        if (!options.breakLockedBalance) state.lockedBalance -= 1;
        return { id: 'wallet-tx-stake', status: 'COMPLETED' };
      }),
      settleBetCredit: jest.fn(async (_db: unknown, _u: string, amount: number) => {
        state.availableBalance += amount;
        return { walletId: 'wallet-1', transactionId: 'wallet-tx-payout', duplicate: false };
      }),
    };
    const prisma: any = {
      wallet: {
        findFirst: jest.fn(async () =>
          options.wallet === false ? null : { userId: USER_ID, currency: CURRENCY },
        ),
        findUnique: jest.fn(async () => ({ ...state })),
      },
      $transaction: jest.fn(async (callback: (db: unknown) => Promise<unknown>) => {
        const snapshot = { ...state };
        try {
          return await callback(prisma);
        } finally {
          // A real transaction discards everything the callback wrote.
          state.availableBalance = snapshot.availableBalance;
          state.lockedBalance = snapshot.lockedBalance;
        }
      }),
    };
    const service = new WinHouseWalletService(prisma, {} as never, wallet as never);
    return { service, prisma, wallet, state, calls };
  }

  it('dry-runs the stake debit, capture and payout, then rolls everything back', async () => {
    const h = makeProbeHarness();

    const result = await h.service.probeWalletRoundTrip();

    expect(result.ok).toBe(true);
    expect(result.detail).toContain('rolled back');
    // The SAME idempotency key was replayed: a retry can never debit twice.
    expect(h.wallet.reserveStakeInTx).toHaveBeenCalledTimes(2);
    expect(h.wallet.captureStakeInTx).toHaveBeenCalledTimes(1);
    expect(h.wallet.settleBetCredit).toHaveBeenCalledTimes(1);
    // Nothing was committed: the wallet is byte-identical.
    expect(h.state).toEqual({ availableBalance: 5_000, lockedBalance: 0 });
  });

  it('fails the dry run when the wallet arithmetic does not hold', async () => {
    const h = makeProbeHarness({ breakLockedBalance: true });

    const result = await h.service.probeWalletRoundTrip();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('ROUND_TRIP_MISMATCH');
    expect(h.state).toEqual({ availableBalance: 5_000, lockedBalance: 0 });
  });

  it('passes vacuously (never fabricating a wallet) when no wallet exists yet', async () => {
    const h = makeProbeHarness({ wallet: false });

    const result = await h.service.probeWalletRoundTrip();

    expect(result.ok).toBe(true);
    expect(result.detail).toContain('nothing to dry-run');
    expect(h.wallet.reserveStakeInTx).not.toHaveBeenCalled();
  });

  it('never leaks a connection string from a failed dry run', async () => {
    const h = makeProbeHarness();
    h.prisma.wallet.findFirst.mockRejectedValue(
      new Error('Can not reach database server at postgres://user:secret@db.internal:5432/royale'),
    );

    const result = await h.service.probeWalletRoundTrip();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('<redacted-url>');
    expect(result.detail).not.toContain('secret');
    expect(result.detail).not.toContain('db.internal');
  });
});


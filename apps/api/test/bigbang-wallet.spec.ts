/* eslint-disable @typescript-eslint/no-explicit-any */
import { Prisma } from '../src/generated/prisma';
import { walletError } from '../src/modules/wallet/wallet-errors';
import { buildBigBangHmac } from '../src/modules/bigbang/bigbang-signature';
import {
  BigBangWalletService,
  type BigBangCallbackEnvelope,
} from '../src/modules/bigbang/bigbang-wallet.service';
import { BigBangCallbacksController } from '../src/modules/bigbang/bigbang-callbacks.controller';
import { BIGBANG_DEFAULT_BASE_URL } from '../src/modules/bigbang/bigbang.config';
import type { PrismaService } from '../src/database/prisma.service';
import type { WalletService } from '../src/modules/wallet/wallet.service';
import type { CasinoProviderFactory } from '../src/modules/casino/casino-provider.factory';

/**
 * BigBang seamless-wallet callback tests — the money boundary.
 *
 * ONE wallet: a negative amount debits it, a positive amount credits it, 0 is
 * the provider's documented round close and moves nothing. The API key and the
 * HMAC signature are verified BEFORE any database access, the provider
 * transaction id makes a retry idempotent, and insufficient balance is answered
 * exactly as BigBang documents (HTTP 400 `{ "error": "insufficient balance" }`).
 */
const PROVIDER_ID = 'provider-row-1';
const USER_ID = 'user-1';
const PLAYER_ID = 'tr0123456789abcdef0123456789abcd';
const CURRENCY = 'BDT';
const SESSION_ID = 'casino-session-1';
const API_KEY = 'bigbang-sandbox-key-never-logged';
const START_BALANCE = 1000; // 10.00 BDT
const GAME = 'SGHotHotFruit';
const GAME_CATEGORY = 'Habanero';
const ENVIRONMENT = 'sandbox';

type Resolution =
  | 'ok'
  | 'not_configured'
  | 'provider_disabled'
  | 'environment_mismatch'
  | 'invalid_base_url'
  | 'credentials_missing';

interface HarnessOptions {
  resolution?: Resolution;
  knownPlayer?: boolean;
  accountType?: 'CUSTOMER' | 'STAFF';
  userStatus?: string;
  sessionStatus?: 'ACTIVE' | 'CLOSED';
  sessionEnvironment?: string;
  walletStatus?: 'ACTIVE' | 'FROZEN';
  /** Simulates a concurrent retry that commits first (unique-index violation). */
  conflictOnce?: boolean;
}

function refusalOf(error: unknown): { status: number; code: string; error: string } {
  const exception = error as { getStatus?: () => number; getResponse?: () => any };
  if (typeof exception?.getStatus !== 'function') throw error;
  const body = exception.getResponse?.() as { code: string; error: string };
  return { status: exception.getStatus(), code: body.code, error: body.error };
}

function makeHarness(options: HarnessOptions = {}) {
  const state = {
    resolution: (options.resolution ?? 'ok') as Resolution,
    knownPlayer: options.knownPlayer ?? true,
    accountType: options.accountType ?? 'CUSTOMER',
    userStatus: options.userStatus ?? 'ACTIVE',
    sessionStatus: (options.sessionStatus ?? 'ACTIVE') as 'ACTIVE' | 'CLOSED',
    sessionEnvironment: options.sessionEnvironment ?? ENVIRONMENT,
    walletStatus: options.walletStatus ?? 'ACTIVE',
  };

  const balances = new Map<string, number>([[USER_ID, START_BALANCE]]);
  const transactions: any[] = [];
  const ledgerEntries: any[] = [];
  const reservations = new Map<string, string>();
  const credits = new Map<string, string>();
  let seq = 0;
  let conflictPending = options.conflictOnce === true;
  const uuid = (prefix: string) => `${prefix}-${++seq}`;

  const prisma: any = {
    casinoSession: {
      findFirst: jest.fn(async () =>
        state.knownPlayer
          ? {
              id: SESSION_ID,
              userId: USER_ID,
              currency: CURRENCY,
              environment: state.sessionEnvironment,
              status: state.sessionStatus,
              user: { accountType: state.accountType, status: state.userStatus },
            }
          : null,
      ),
    },
    bigBangTransaction: {
      findUnique: jest.fn(async ({ where }: any) => {
        const compound = where?.providerId_transactionId;
        if (!compound) return null;
        return (
          transactions.find(
            (row) =>
              row.providerId === compound.providerId &&
              row.transactionId === compound.transactionId,
          ) ?? null
        );
      }),
      create: jest.fn(async ({ data }: any) => {
        if (conflictPending) {
          // Another connection committed the same provider transaction first.
          conflictPending = false;
          transactions.push({ id: uuid('bbtx-concurrent'), ...data });
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '5.22.0',
          });
        }
        const duplicate = transactions.find(
          (row) =>
            row.providerId === data.providerId && row.transactionId === data.transactionId,
        );
        if (duplicate) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '5.22.0',
          });
        }
        const row = { id: uuid('bbtx'), createdAt: new Date(), ...data };
        transactions.push(row);
        return row;
      }),
    },
    ledgerEntry: {
      findMany: jest.fn(async ({ where }: any) =>
        ledgerEntries.filter((entry) => entry.transactionId === where.transactionId),
      ),
    },
    auditLog: { create: jest.fn(async () => ({})) },
    $queryRaw: jest.fn(async () => []),
    $transaction: jest.fn(async (callback: any) => callback(prisma)),
  };

  const wallet = {
    getOrCreateWalletForUser: jest.fn(async (userId: string, currency: string) => ({
      id: `wallet-${userId}`,
      userId,
      currency,
      availableBalance: balances.get(userId) ?? 0,
      lockedBalance: 0,
      status: state.walletStatus,
    })),
    reserveStakeInTx: jest.fn(
      async (_db: any, userId: string, amount: number, _currency: string, key: string) => {
        const existing = reservations.get(key);
        if (existing) return { transactionId: existing, duplicate: true };
        const current = balances.get(userId) ?? 0;
        if (current < amount) {
          walletError('INSUFFICIENT_FUNDS', 'Insufficient available balance', 400);
        }
        balances.set(userId, current - amount);
        const transactionId = uuid('wtx');
        reservations.set(key, transactionId);
        ledgerEntries.push({
          transactionId,
          availableBefore: current,
          availableAfter: current - amount,
        });
        return { transactionId, duplicate: false };
      },
    ),
    captureStakeInTx: jest.fn(async () => ({ status: 'COMPLETED' })),
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
        if (existing) {
          return { walletId: `wallet-${userId}`, transactionId: existing, duplicate: true };
        }
        const current = balances.get(userId) ?? 0;
        balances.set(userId, current + amount);
        const transactionId = uuid('wtx');
        credits.set(key, transactionId);
        ledgerEntries.push({
          transactionId,
          availableBefore: current,
          availableAfter: current + amount,
        });
        return { walletId: `wallet-${userId}`, transactionId, duplicate: false };
      },
    ),
  };

  const providers = {
    resolveBigBang: jest.fn(async () =>
      state.resolution === 'ok'
        ? {
            ok: true,
            credentials: {
              row: {
                id: PROVIDER_ID,
                name: 'BIGBANG',
                providerCode: 'BIGBANG',
                baseUrl: BIGBANG_DEFAULT_BASE_URL,
                status: 'ACTIVE',
                environment: ENVIRONMENT,
                apiVersion: 'v1',
              },
              apiKey: API_KEY,
              environment: ENVIRONMENT,
            },
          }
        : { ok: false, reason: state.resolution, providerId: PROVIDER_ID },
    ),
  };

  const service = new BigBangWalletService(
    prisma as unknown as PrismaService,
    providers as unknown as CasinoProviderFactory,
    wallet as unknown as WalletService,
  );

  const envelope = (
    overrides: Record<string, unknown> = {},
    envelopeOptions: {
      apiKey?: string | null;
      /** The amount spelling the provider SIGNED. */
      signedAmount?: string;
      /** A different literal spelling placed in the raw JSON body. */
      rawAmount?: string;
      rawBody?: string;
      signature?: string | null;
      omit?: readonly string[];
    } = {},
  ): BigBangCallbackEnvelope => {
    const payload: Record<string, unknown> = {
      username: PLAYER_ID,
      amount: -2.5,
      game: GAME,
      game_category: GAME_CATEGORY,
      transaction_id: 'TX-BB-1',
      round_id: 'round-bb-1',
      type: 'bet',
      round_end: false,
      game_id: 4821,
      provider_id: 'Habanero',
      currency: CURRENCY,
      ...overrides,
    };
    for (const key of envelopeOptions.omit ?? []) delete payload[key];

    const signature =
      envelopeOptions.signature === undefined
        ? buildBigBangHmac(API_KEY, {
            username: String(payload.username ?? ''),
            amount: envelopeOptions.signedAmount ?? String(payload.amount),
            game: String(payload.game ?? ''),
            game_category: String(payload.game_category ?? ''),
            transaction_id: String(payload.transaction_id ?? ''),
          })
        : envelopeOptions.signature;
    const body = { ...payload, signature };
    let rawBody = envelopeOptions.rawBody ?? JSON.stringify(body);
    if (envelopeOptions.rawBody === undefined && envelopeOptions.rawAmount !== undefined) {
      rawBody = rawBody.replace(
        `"amount":${JSON.stringify(payload.amount)}`,
        `"amount":${envelopeOptions.rawAmount}`,
      );
    }

    return {
      apiKey: envelopeOptions.apiKey === undefined ? API_KEY : envelopeOptions.apiKey,
      rawBody,
      payload: body,
    };
  };

  return {
    service,
    prisma,
    wallet,
    providers,
    transactions,
    envelope,
    state,
    balance: () => balances.get(USER_ID) ?? 0,
  };
}

/** Asserts that `run()` was refused with a specific status (and optional code). */
async function expectRefusal(
  run: () => Promise<unknown>,
  expected: { status: number; code?: string; error?: string },
): Promise<void> {
  try {
    await run();
  } catch (error) {
    expect(refusalOf(error)).toMatchObject(expected);
    return;
  }
  throw new Error('expected a refusal but the call succeeded');
}

describe('bigbang user_data callback', () => {
  it('answers the documented shape with the canonical wallet balance', async () => {
    const h = makeHarness();

    const response = await h.service.handleUserData({ apiKey: API_KEY, username: PLAYER_ID });

    expect(response).toEqual({ username: PLAYER_ID, balance: '10.00', currency: 'BDT' });
    // The API key is never echoed back to the provider.
    expect(JSON.stringify(response)).not.toContain(API_KEY);
  });

  it('fails safely (503) when BigBang is not usable in this environment', async () => {
    for (const resolution of [
      'not_configured',
      'provider_disabled',
      'environment_mismatch',
      'invalid_base_url',
      'credentials_missing',
    ] as const) {
      const h = makeHarness({ resolution });
      await expectRefusal(
        () => h.service.handleUserData({ apiKey: API_KEY, username: PLAYER_ID }),
        { status: 503, code: 'BIGBANG_NOT_CONFIGURED' },
      );
      expect(h.wallet.getOrCreateWalletForUser).not.toHaveBeenCalled();
    }
  });

  it('answers 404 for an unknown player', async () => {
    const h = makeHarness({ knownPlayer: false });

    await expectRefusal(
      () => h.service.handleUserData({ apiKey: API_KEY, username: 'trffffffffffffffffffffffffffffff' }),
      { status: 404, code: 'BIGBANG_UNKNOWN_PLAYER' },
    );
    expect(h.wallet.getOrCreateWalletForUser).not.toHaveBeenCalled();
  });

  it('answers 404 for a missing username', async () => {
    const h = makeHarness();

    await expectRefusal(() => h.service.handleUserData({ apiKey: API_KEY, username: '  ' }), {
      status: 404,
      code: 'BIGBANG_UNKNOWN_PLAYER',
    });
  });

  it.each([
    ['staff account', { accountType: 'STAFF' as const }],
    ['suspended account', { userStatus: 'SUSPENDED' }],
    ['pending account', { userStatus: 'PENDING' }],
    ['banned account', { userStatus: 'BANNED' }],
    ['closed launch session', { sessionStatus: 'CLOSED' as const }],
    ['environment mismatch', { sessionEnvironment: 'production' }],
  ])('refuses an ineligible player (%s)', async (_label, options) => {
    const h = makeHarness(options as HarnessOptions);

    await expectRefusal(
      () => h.service.handleUserData({ apiKey: API_KEY, username: PLAYER_ID }),
      { status: 404, code: 'BIGBANG_UNKNOWN_PLAYER' },
    );
    expect(h.wallet.getOrCreateWalletForUser).not.toHaveBeenCalled();
  });

  it('refuses an FROZEN canonical wallet', async () => {
    const h = makeHarness({ walletStatus: 'FROZEN' });

    await expectRefusal(
      () => h.service.handleUserData({ apiKey: API_KEY, username: PLAYER_ID }),
      { status: 404, code: 'BIGBANG_UNKNOWN_PLAYER' },
    );
  });
});

describe('bigbang callback authentication', () => {
  it.each([[null], [''], ['not-the-key'], [`${API_KEY}x`]])(
    'rejects a missing/invalid API key (%p) before any database access',
    async (apiKey) => {
      const h = makeHarness();

      await expectRefusal(
        () => h.service.handleUserData({ apiKey: apiKey as string | null, username: PLAYER_ID }),
        { status: 401, code: 'BIGBANG_BAD_API_KEY' },
      );
      expect(h.prisma.casinoSession.findFirst).not.toHaveBeenCalled();
      expect(h.wallet.getOrCreateWalletForUser).not.toHaveBeenCalled();
    },
  );

  it('rejects a missing/invalid API key on a movement as well', async () => {
    const h = makeHarness();

    await expectRefusal(
      () => h.service.handleBalanceChange(h.envelope({ transaction_id: 'TX-KEY-1' }, { apiKey: 'bad' })),
      { status: 401, code: 'BIGBANG_BAD_API_KEY' },
    );
    expect(h.transactions).toHaveLength(0);
    expect(h.balance()).toBe(START_BALANCE);
  });
});

describe('bigbang balance_change signature', () => {
  it('applies a correctly signed debit', async () => {
    const h = makeHarness();

    const response = await h.service.handleBalanceChange(h.envelope());

    expect(response).toEqual({ status: 'ok', balance: '7.50' });
    expect(h.balance()).toBe(START_BALANCE - 250);
  });

  it('rejects an invalid HMAC without touching the wallet', async () => {
    const h = makeHarness();

    await expectRefusal(
      () => h.service.handleBalanceChange(h.envelope({}, { signature: 'a'.repeat(64) })),
      { status: 401, code: 'BIGBANG_BAD_SIGNATURE' },
    );
    expect(h.wallet.reserveStakeInTx).not.toHaveBeenCalled();
    expect(h.wallet.settleBetCredit).not.toHaveBeenCalled();
    expect(h.transactions).toHaveLength(0);
    expect(h.balance()).toBe(START_BALANCE);
  });

  it('rejects a tampered amount (signature no longer matches)', async () => {
    const h = makeHarness();

    // The provider signed -2.50; the body now carries -9.99.
    await expectRefusal(
      () => h.service.handleBalanceChange(h.envelope({ amount: -9.99 }, { signedAmount: '-2.50' })),
      { status: 401, code: 'BIGBANG_BAD_SIGNATURE' },
    );
    expect(h.balance()).toBe(START_BALANCE);
  });

  it('rejects a missing signature', async () => {
    const h = makeHarness();

    await expectRefusal(() => h.service.handleBalanceChange(h.envelope({}, { signature: null })), {
      status: 401,
      code: 'BIGBANG_MISSING_SIGNATURE',
    });
    expect(h.balance()).toBe(START_BALANCE);
  });

  it('verifies the HMAC against the EXACT raw amount spelling and persists it', async () => {
    const h = makeHarness();

    // The wire says "-2.50"; the signature is over that literal spelling.
    const response = await h.service.handleBalanceChange(
      h.envelope({}, { rawAmount: '-2.50', signedAmount: '-2.50' }),
    );

    expect(response.balance).toBe('7.50');
    expect(h.transactions[0].amountWire).toBe('-2.50');
    expect(h.transactions[0].amountMinor).toBe(-250);
  });

  it('also accepts the shortest JavaScript spelling the reference implementation signs', async () => {
    const h = makeHarness();

    // "-2.50" on the wire, signed as String(-2.5) === "-2.5" (same number).
    const response = await h.service.handleBalanceChange(
      h.envelope({}, { rawAmount: '-2.50', signedAmount: '-2.5' }),
    );

    expect(response.balance).toBe('7.50');
    expect(h.transactions[0].amountWire).toBe('-2.50');
  });

  it('never verifies a signature over a DIFFERENT numeric value', async () => {
    const h = makeHarness();

    // The literal and the parsed value disagree → the body was altered.
    await expectRefusal(
      () =>
        h.service.handleBalanceChange(h.envelope({}, { rawAmount: '-2.50', signedAmount: '-3.5' })),
      { status: 401, code: 'BIGBANG_BAD_SIGNATURE' },
    );
    expect(h.balance()).toBe(START_BALANCE);
  });
});

describe('bigbang balance_change movements', () => {
  it('debits the ONE wallet for a negative amount (with the canonical ledger key)', async () => {
    const h = makeHarness();

    const response = await h.service.handleBalanceChange(h.envelope());

    expect(response).toEqual({ status: 'ok', balance: '7.50' });
    expect(h.wallet.reserveStakeInTx).toHaveBeenCalledTimes(1);
    expect(h.wallet.captureStakeInTx).toHaveBeenCalledTimes(1);
    expect(h.wallet.reserveStakeInTx.mock.calls[0][2]).toBe(250);
    expect(h.wallet.reserveStakeInTx.mock.calls[0][4]).toBe(`BIGBANG:${PROVIDER_ID}:TX-BB-1`);
  });

  it('credits the ONE wallet for a positive amount', async () => {
    const h = makeHarness();

    const response = await h.service.handleBalanceChange(
      h.envelope({ amount: 2.5, type: 'win', round_end: true }),
    );

    expect(response).toEqual({ status: 'ok', balance: '12.50' });
    expect(h.balance()).toBe(START_BALANCE + 250);
    expect(h.wallet.settleBetCredit).toHaveBeenCalledTimes(1);
    expect(h.wallet.settleBetCredit.mock.calls[0][4]).toBe('BET_PAYOUT');
  });

  it('types a refund credit as BET_REFUND', async () => {
    const h = makeHarness();

    await h.service.handleBalanceChange(h.envelope({ amount: 2.5, type: 'refund' }));

    expect(h.wallet.settleBetCredit.mock.calls[0][4]).toBe('BET_REFUND');
  });

  it('accepts amount 0 (the documented round close) and moves nothing', async () => {
    const h = makeHarness();

    const response = await h.service.handleBalanceChange(h.envelope({ amount: 0, type: 'round' }));

    expect(response).toEqual({ status: 'ok', balance: '10.00' });
    expect(h.wallet.reserveStakeInTx).not.toHaveBeenCalled();
    expect(h.wallet.settleBetCredit).not.toHaveBeenCalled();
    expect(h.transactions).toHaveLength(1);
    expect(h.transactions[0].amountMinor).toBe(0);
    expect(h.transactions[0].walletTransactionId).toBeNull();
    expect(h.transactions[0].balanceBefore).toBe(START_BALANCE);
    expect(h.transactions[0].balanceAfter).toBe(START_BALANCE);
  });

  it('answers insufficient funds with HTTP 400 { error: "insufficient balance" }', async () => {
    const h = makeHarness();

    await expectRefusal(
      () =>
        h.service.handleBalanceChange(h.envelope({ amount: -99.99 }, { signedAmount: '-99.99' })),
      { status: 400, code: 'BIGBANG_INSUFFICIENT_FUNDS', error: 'insufficient balance' },
    );
    // Nothing is partially created and the balance is untouched.
    expect(h.transactions).toHaveLength(0);
    expect(h.balance()).toBe(START_BALANCE);
  });

  it('refuses a currency that is not the wallet currency', async () => {
    const h = makeHarness();

    await expectRefusal(() => h.service.handleBalanceChange(h.envelope({ currency: 'USD' })), {
      status: 422,
      code: 'BIGBANG_CURRENCY_MISMATCH',
    });
    expect(h.balance()).toBe(START_BALANCE);
  });

  it('accepts the wallet currency regardless of case', async () => {
    const h = makeHarness();

    const response = await h.service.handleBalanceChange(h.envelope({ currency: 'bdt' }));

    expect(response.balance).toBe('7.50');
  });

  it('refuses an unknown player on a movement', async () => {
    const h = makeHarness({ knownPlayer: false });

    await expectRefusal(() => h.service.handleBalanceChange(h.envelope()), {
      status: 404,
      code: 'BIGBANG_UNKNOWN_PLAYER',
    });
    expect(h.balance()).toBe(START_BALANCE);
  });

  it('refuses a STAFF account on a movement', async () => {
    const h = makeHarness({ accountType: 'STAFF' });

    await expectRefusal(() => h.service.handleBalanceChange(h.envelope()), {
      status: 404,
      code: 'BIGBANG_UNKNOWN_PLAYER',
    });
    expect(h.balance()).toBe(START_BALANCE);
  });

  it.each(['username', 'game', 'game_category', 'transaction_id'])(
    'refuses a callback without %s',
    async (field) => {
      const h = makeHarness();

      await expectRefusal(
        () => h.service.handleBalanceChange(h.envelope({}, { omit: [field] })),
        { status: 400, code: 'BIGBANG_MALFORMED_BODY' },
      );
      expect(h.transactions).toHaveLength(0);
    },
  );

  it('refuses an unreadable amount', async () => {
    const h = makeHarness();

    await expectRefusal(
      () =>
        h.service.handleBalanceChange(
          h.envelope({ amount: 'not-a-number' }, { signedAmount: 'not-a-number' }),
        ),
      { status: 400, code: 'BIGBANG_INVALID_AMOUNT' },
    );
    expect(h.transactions).toHaveLength(0);
  });

  it('refuses an amount with sub-cent precision in the wallet currency', async () => {
    const h = makeHarness();

    await expectRefusal(
      () =>
        h.service.handleBalanceChange(h.envelope({ amount: 1.005 }, { signedAmount: '1.005' })),
      { status: 400, code: 'BIGBANG_INVALID_AMOUNT' },
    );
    expect(h.transactions).toHaveLength(0);
  });
});

describe('bigbang provider transaction persistence', () => {
  it('persists every documented callback field on the first movement', async () => {
    const h = makeHarness();

    await h.service.handleBalanceChange(
      h.envelope({
        round_id: 'round-9',
        type: 'bet',
        round_end: false,
        game_id: 4821,
        provider_id: 'Habanero',
      }),
    );

    const row = h.transactions[0];
    expect(row).toMatchObject({
      providerId: PROVIDER_ID,
      userId: USER_ID,
      sessionId: SESSION_ID,
      transactionId: 'TX-BB-1',
      amountMinor: -250,
      amountWire: '-2.5',
      currency: CURRENCY,
      game: GAME,
      gameCategory: GAME_CATEGORY,
      gameId: '4821',
      providerExternalId: 'Habanero',
      roundId: 'round-9',
      roundType: 'bet',
      roundEnd: false,
      balanceBefore: START_BALANCE,
      balanceAfter: 750,
      environment: ENVIRONMENT,
      sandbox: false,
    });
    expect(row.walletTransactionId).toBe('wtx-1');
    expect(row.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    // The API key is never persisted with a movement.
    expect(Object.keys(row)).not.toContain('apiKey');
    expect(JSON.stringify(row)).not.toContain(API_KEY);
  });

  it('persists the sandbox flag', async () => {
    const h = makeHarness();

    await h.service.handleBalanceChange(h.envelope({ sandbox: true }));

    expect(h.transactions[0].sandbox).toBe(true);
  });

  it('persists the round fields, including the legacy round_type alias', async () => {
    const h = makeHarness();

    await h.service.handleBalanceChange(
      h.envelope({ round_id: 'round-42', round_type: 'win', round_end: 'true' }, { omit: ['type'] }),
    );

    expect(h.transactions[0]).toMatchObject({
      roundId: 'round-42',
      roundType: 'win',
      roundEnd: true,
    });
  });

  it('stores a deterministic payload hash over the PARSED movement', async () => {
    const spaced = makeHarness();
    await spaced.service.handleBalanceChange(
      spaced.envelope({}, { rawAmount: '-2.50', signedAmount: '-2.50' }),
    );
    const shortest = makeHarness();
    await shortest.service.handleBalanceChange(
      shortest.envelope({}, { rawAmount: '-2.5', signedAmount: '-2.5' }),
    );
    const credited = makeHarness();
    await credited.service.handleBalanceChange(
      credited.envelope({ amount: 2.5, type: 'win' }, { signedAmount: '2.5' }),
    );

    // "-2.50" (wire) and "-2.5" hash identically: a re-stringified retry is the
    // SAME transaction. A different movement is not.
    expect(spaced.transactions[0].payloadHash).toBe(shortest.transactions[0].payloadHash);
    expect(credited.transactions[0].payloadHash).not.toBe(spaced.transactions[0].payloadHash);
  });
});

describe('bigbang idempotency', () => {
  it('acknowledges a duplicate debit without a second movement', async () => {
    const h = makeHarness();
    await h.service.handleBalanceChange(h.envelope());

    const duplicate = await h.service.handleBalanceChange(h.envelope());

    expect(duplicate).toEqual({ status: 'ok', balance: '7.50', duplicate: true });
    expect(h.transactions).toHaveLength(1);
    expect(h.wallet.reserveStakeInTx).toHaveBeenCalledTimes(1);
    expect(h.balance()).toBe(750);
  });

  it('acknowledges a duplicate credit without a second movement', async () => {
    const h = makeHarness();
    const payload = { amount: 2.5, type: 'win' };
    await h.service.handleBalanceChange(h.envelope(payload, { signedAmount: '2.5' }));

    const duplicate = await h.service.handleBalanceChange(
      h.envelope(payload, { signedAmount: '2.5' }),
    );

    expect(duplicate).toEqual({ status: 'ok', balance: '12.50', duplicate: true });
    expect(h.wallet.settleBetCredit).toHaveBeenCalledTimes(1);
    expect(h.balance()).toBe(START_BALANCE + 250);
  });

  it('treats a re-stringified retry as the same transaction', async () => {
    const h = makeHarness();
    await h.service.handleBalanceChange(
      h.envelope({}, { rawAmount: '-2.50', signedAmount: '-2.50' }),
    );

    const duplicate = await h.service.handleBalanceChange(
      h.envelope({ amount: -2.5 }, { rawAmount: '-2.5', signedAmount: '-2.5' }),
    );

    expect(duplicate.duplicate).toBe(true);
    expect(h.transactions).toHaveLength(1);
    expect(h.balance()).toBe(750);
  });

  it('rejects the same transaction_id reused for a different movement (409)', async () => {
    const h = makeHarness();
    await h.service.handleBalanceChange(h.envelope());

    await expectRefusal(
      () => h.service.handleBalanceChange(h.envelope({ amount: 5 }, { signedAmount: '5' })),
      { status: 409, code: 'BIGBANG_TRANSACTION_CONFLICT' },
    );
    expect(h.transactions).toHaveLength(1);
    expect(h.balance()).toBe(750);
  });

  it('protects against concurrent duplicates through the unique index', async () => {
    const h = makeHarness({ conflictOnce: true });

    const response = await h.service.handleBalanceChange(h.envelope());

    expect(response).toEqual({ status: 'ok', balance: '7.50', duplicate: true });
    expect(h.transactions).toHaveLength(1);
    // The movement was applied exactly once even though two callbacks raced.
    expect(h.wallet.reserveStakeInTx).toHaveBeenCalledTimes(1);
    expect(h.balance()).toBe(750);
  });

  it('acknowledges a duplicate even when the player is no longer eligible', async () => {
    const h = makeHarness();
    await h.service.handleBalanceChange(h.envelope());
    h.state.sessionStatus = 'CLOSED';
    h.state.userStatus = 'SUSPENDED';

    const duplicate = await h.service.handleBalanceChange(h.envelope());

    expect(duplicate.duplicate).toBe(true);
    expect(h.balance()).toBe(750);
  });

  it('refuses a NEW movement once the session is no longer active', async () => {
    const h = makeHarness();
    await h.service.handleBalanceChange(h.envelope());
    h.state.sessionStatus = 'CLOSED';

    await expectRefusal(
      () => h.service.handleBalanceChange(h.envelope({ transaction_id: 'TX-BB-2' })),
      { status: 404, code: 'BIGBANG_UNKNOWN_PLAYER' },
    );
    expect(h.transactions).toHaveLength(1);
  });
});

describe('bigbang callbacks controller', () => {
  it('serves the documented user_data route with the X-API-Key header', async () => {
    const h = makeHarness();
    const controller = new BigBangCallbacksController(h.service);

    const response = await controller.userData({ 'x-api-key': API_KEY }, PLAYER_ID);

    expect(response).toEqual({ username: PLAYER_ID, balance: '10.00', currency: 'BDT' });
  });

  it('refuses user_data without the header', async () => {
    const h = makeHarness();
    const controller = new BigBangCallbacksController(h.service);

    await expectRefusal(() => controller.userData({}, PLAYER_ID), {
      status: 401,
      code: 'BIGBANG_BAD_API_KEY',
    });
  });

  it('parses the EXACT raw body, preserving the signed amount spelling', async () => {
    const h = makeHarness();
    const controller = new BigBangCallbacksController(h.service);
    const inbound = h.envelope({}, { rawAmount: '-2.50', signedAmount: '-2.50' });
    const request = { rawBody: Buffer.from(inbound.rawBody, 'utf8') } as any;

    const response = await controller.balanceChange(request, { 'x-api-key': API_KEY });

    expect(response.balance).toBe('7.50');
    expect(h.transactions[0].amountWire).toBe('-2.50');
  });

  it('answers 400 for a malformed body only AFTER authenticating the caller', async () => {
    const h = makeHarness();
    const controller = new BigBangCallbacksController(h.service);
    const request = { rawBody: Buffer.from('{', 'utf8') } as any;

    await expectRefusal(() => controller.balanceChange(request, { 'x-api-key': 'bad' }), {
      status: 401,
      code: 'BIGBANG_BAD_API_KEY',
    });
    await expectRefusal(() => controller.balanceChange(request, { 'x-api-key': API_KEY }), {
      status: 400,
      code: 'BIGBANG_MALFORMED_BODY',
    });
  });

  it('treats a missing raw body as malformed instead of moving money', async () => {
    const h = makeHarness();
    const controller = new BigBangCallbacksController(h.service);

    await expectRefusal(() => controller.balanceChange({} as any, { 'x-api-key': API_KEY }), {
      status: 400,
      code: 'BIGBANG_MALFORMED_BODY',
    });
    expect(h.transactions).toHaveLength(0);
  });
});

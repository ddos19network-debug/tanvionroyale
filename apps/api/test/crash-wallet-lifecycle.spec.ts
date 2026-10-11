/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * TANVION ROYALE — crash REAL_MONEY wallet lifecycle regression tests (Phase 2).
 *
 * One stake, one reservation, exactly ONE terminal outcome — whichever way a bet
 * ends, and no matter how often a request or a scheduler tick is retried:
 *
 *   reserveStakeInTx -> CASHED_OUT : captureStakeInTx + BET_PAYOUT credit
 *                    -> LOST       : captureStakeInTx (stake consumed)
 *                    -> REFUNDED   : releaseStakeInTx (locked -> available)
 *
 * These tests run the REAL WalletService (ledger engine included) and the REAL
 * CrashService / CrashRoundEngine against an in-memory Prisma double with
 * transaction ROLLBACK semantics, so the assertions are about ACTUAL balances,
 * WalletTransaction states and append-only LedgerEntry rows — not about mock
 * call counts.
 *
 * Covered (Phase 2 brief): A cash-out, B loss, C void, D duplicate cash-out,
 * E cash-out vs crash, F cash-out vs void, G duplicate settlement retry,
 * H duplicate release retry, I reservation state transitions, J lockedBalance
 * cleanup, K no FREE_PLAY wallet access from REAL_MONEY, L no REAL_MONEY wallet
 * access from FREE_PLAY, M the REAL_MONEY gate stays fail-closed.
 *
 * REAL_MONEY is only ever exercised through an INJECTED config (exactly like the
 * Phase 1 regression tests) — the production gate itself is asserted to stay
 * closed, and no fake operator adapter is registered anywhere.
 */

import { Prisma } from '../src/generated/prisma';
import { WalletService } from '../src/modules/wallet/wallet.service';
import { CrashService } from '../src/modules/crash/crash.service';
import { CrashRoundEngine } from '../src/modules/crash/crash-round-engine';
import { loadCrashConfig, type CrashMode } from '../src/modules/crash/crash.config';
import type { AuthenticatedUser } from '../src/common/types/authenticated-user';

jest.setTimeout(30_000);

const USER_ID = 'user-1';
const CURRENCY = 'BDT';
/** 100.00 BDT in minor units. */
const START_BALANCE = 10_000;
/** 20.00 BDT stake. */
const STAKE = 2_000;
const BET_KEY = 'crash-bet-key-1';
const ROUND_ID = 'round-1';
const ROUND_NUMBER = 7;

/** Pinned server clock so the authoritative cash-out multiplier is deterministic. */
const NOW = 1_800_000_000_000;
/** The round started 3s ago, crashes in 57s ⇒ elapsed/total = 1/20. */
const ROUND_STARTED_AGO_MS = 3_000;
const CRASH_POINT = 2;
const CRASH_AT_MS = NOW + 57_000;
/** cashoutMultiplierAt = floor(round2(2 ^ (3000/60000)) * 100) / 100 = 1.04. */
const CASHOUT_MULTIPLIER = 1.04;
/** Gross payout = floor(stake * multiplier) — the crash payout model. */
const CASHOUT_PAYOUT = Math.floor(STAKE * CASHOUT_MULTIPLIER);

const auth = { id: USER_ID, sessionId: 's1', roles: ['USER'] } as unknown as AuthenticatedUser;

/** Production env that configures EVERYTHING except an implemented adapter. */
const PRODUCTION_REAL_MONEY_ENV = {
  NODE_ENV: 'production',
  CRASH_MODE: 'REAL_MONEY',
  CRASH_REAL_MONEY_ALLOWED: 'true',
  OPERATOR_PROVIDER: 'operator-http',
  PAYMENT_PROVIDER: 'generic-http',
  PAYMENT_PROVIDER_URL: 'https://payments.example.test',
  PAYMENT_PROVIDER_KEY: 'test-payment-key',
} as unknown as NodeJS.ProcessEnv;

function uniqueViolation(): never {
  throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

interface HarnessOptions {
  mode?: CrashMode;
  balance?: number;
  roundStatus?: 'BETTING_OPEN' | 'RUNNING';
}

/** Freezes the server clock so the authoritative multiplier is deterministic. */
function freezeClock(): jest.SpyInstance {
  return jest.spyOn(Date, 'now').mockReturnValue(NOW);
}

afterEach(() => {
  jest.restoreAllMocks();
});

/**
 * In-memory Prisma double with `$transaction` ROLLBACK semantics (maps and
 * arrays are restored in place on error), so atomicity claims can be tested for
 * real: a failed transaction must leave no reserved stake behind.
 */
function makeHarness(options: HarnessOptions = {}) {
  const mode = options.mode ?? 'REAL_MONEY';
  const balance = options.balance ?? START_BALANCE;

  const wallets = new Map<string, any>();
  const walletTransactions: any[] = [];
  const ledgerEntries: any[] = [];
  const bets: any[] = [];
  const settlements: any[] = [];
  const rounds: any[] = [];
  const gameAuditLogs: any[] = [];
  const auditLogs: any[] = [];
  const freePlayCalls: string[] = [];
  let seq = 0;
  const uuid = (prefix: string) => `${prefix}-${++seq}`;

  wallets.set(`${USER_ID}|${CURRENCY}`, {
    id: 'wallet-1',
    userId: USER_ID,
    currency: CURRENCY,
    availableBalance: balance,
    lockedBalance: 0,
    status: 'ACTIVE',
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
  });

  rounds.push({
    id: ROUND_ID,
    gameSlug: 'sky-rocket',
    mode,
    status: options.roundStatus ?? 'RUNNING',
    roundNumber: ROUND_NUMBER,
    serverSeedHash: 'a'.repeat(64),
    serverSeed: null,
    crashPointSeedEnc: null,
    clientSeed: 'c'.repeat(32),
    nonce: 1,
    algorithmVersion: 'v1',
    crashSource: 'CONFIGURED',
    sequenceMode: null,
    sequenceIndex: null,
    crashPointConfigured: CRASH_POINT,
    startAt: new Date(NOW - ROUND_STARTED_AGO_MS),
    bettingCloseAt: new Date(NOW + 60_000),
    crashAt: null,
    crashMultiplier: null,
    crashedAt: null,
    settledAt: null,
    bettingClosedAt: null,
    createdAt: new Date(NOW),
  });

  const roundRow = () => rounds[0];
  const walletState = () => {
    const row = wallets.get(`${USER_ID}|${CURRENCY}`);
    return { available: row.availableBalance, locked: row.lockedBalance };
  };
  const movements = (reason: string) => ledgerEntries.filter((entry) => entry.reason === reason);
  const transactions = (type?: string) =>
    walletTransactions.filter((tx) => !type || tx.type === type);
  const reservation = (key = BET_KEY) =>
    walletTransactions.find((tx) => tx.type === 'BET_STAKE' && tx.idempotencyKey === key);
  const betOf = (key = BET_KEY) => bets.find((bet) => bet.idempotencyKey === key);
  const betById = (id: string) => bets.find((bet) => bet.id === id);

  const withRelations = (bet: any, include?: any) => {
    if (!bet) return null;
    if (!include) return bet;
    const out: any = { ...bet };
    if (include.round) out.round = { roundNumber: roundRow().roundNumber };
    if (include.settlement) out.settlement = settlements.find((s) => s.betId === bet.id) ?? null;
    return out;
  };

  const prisma: any = {};

  prisma.wallet = {
    // Prisma returns SNAPSHOTS, never live objects: the ledger records
    // "before" values that must not be affected by the following update.
    findUnique: jest.fn(async ({ where }: any) => {
      const row = where.id
        ? [...wallets.values()].find((w) => w.id === where.id)
        : wallets.get(`${where.userId_currency.userId}|${where.userId_currency.currency}`);
      return row ? { ...row } : null;
    }),
    create: jest.fn(async ({ data }: any) => {
      if (wallets.has(`${data.userId}|${data.currency}`)) uniqueViolation();
      const row = {
        id: uuid('wallet'),
        status: 'ACTIVE',
        availableBalance: 0,
        lockedBalance: 0,
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
        ...data,
      };
      wallets.set(`${row.userId}|${row.currency}`, row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = [...wallets.values()].find((w) => w.id === where.id);
      Object.assign(row, data, { updatedAt: new Date(NOW) });
      return row;
    }),
  };

  prisma.walletTransaction = {
    findUnique: jest.fn(async ({ where }: any) => {
      let row: any = null;
      if (where.id) {
        row = walletTransactions.find((t) => t.id === where.id);
      } else {
        const key = where.userId_idempotencyKey;
        row = walletTransactions.find(
          (t) => t.userId === key.userId && t.idempotencyKey === key.idempotencyKey,
        );
      }
      return row ? { ...row } : null;
    }),
    create: jest.fn(async ({ data }: any) => {
      if (
        walletTransactions.some(
          (t) => t.userId === data.userId && t.idempotencyKey === data.idempotencyKey,
        )
      ) {
        uniqueViolation();
      }
      const row = {
        id: uuid('wtx'),
        reference: null,
        failureReason: null,
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
        ...data,
      };
      walletTransactions.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = walletTransactions.find((t) => t.id === where.id);
      Object.assign(row, data, { updatedAt: new Date(NOW) });
      return row;
    }),
    /** Prisma `updateMany` semantics — the conditional-transition filter included. */
    updateMany: jest.fn(async ({ where, data }: any) => {
      const rows = walletTransactions.filter((t) => {
        if (where.id && t.id !== where.id) return false;
        const filter = where.status;
        if (typeof filter === 'string' && t.status !== filter) return false;
        if (filter && typeof filter === 'object' && 'in' in filter && !filter.in.includes(t.status)) {
          return false;
        }
        return true;
      });
      for (const row of rows) Object.assign(row, data, { updatedAt: new Date(NOW) });
      return { count: rows.length };
    }),
    findMany: jest.fn(async () => walletTransactions.map((t) => ({ ...t }))),
  };

  prisma.ledgerEntry = {
    create: jest.fn(async ({ data }: any) => {
      const row = { id: uuid('ledger'), createdAt: new Date(NOW), ...data };
      ledgerEntries.push(row);
      return row;
    }),
    findMany: jest.fn(async () => ledgerEntries.map((e) => ({ ...e }))),
  };

  prisma.auditLog = {
    create: jest.fn(async ({ data }: any) => {
      auditLogs.push(data);
      return data;
    }),
  };

  prisma.user = {
    findUnique: jest.fn(async () => ({ status: 'ACTIVE', kycStatus: 'VERIFIED' })),
  };

  prisma.crashRound = {
    findFirst: jest.fn(async ({ where }: any) => {
      const rows = rounds.filter((r) => {
        if (where?.id && r.id !== where.id) return false;
        if (where?.status?.in && !where.status.in.includes(r.status)) return false;
        if (where?.gameSlug && r.gameSlug !== where.gameSlug) return false;
        return true;
      });
      return rows.sort((a, b) => b.roundNumber - a.roundNumber)[0] ?? null;
    }),
    findUnique: jest.fn(async ({ where }: any) => {
      const row = rounds.find((r) => r.id === where.id);
      return row ? { ...row } : null;
    }),
    findUniqueOrThrow: jest.fn(async ({ where }: any) => {
      const row = rounds.find((r) => r.id === where.id);
      if (!row) throw new Error('CrashRound not found');
      return { ...row };
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: uuid('round'), ...data };
      rounds.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rounds.find(
        (r) => r.id === where.id && (!where.status || r.status === where.status),
      );
      if (!row) {
        throw new Prisma.PrismaClientKnownRequestError('Record to update not found', {
          code: 'P2025',
          clientVersion: 'test',
        });
      }
      Object.assign(row, data);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const rows = rounds.filter(
        (r) => r.id === where.id && (!where.status || r.status === where.status),
      );
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
    }),
  };

  prisma.crashBet = {
    findUnique: jest.fn(async ({ where, include }: any) => {
      let bet: any = null;
      if (where.id) {
        bet = bets.find((b) => b.id === where.id);
      } else if (where.userId_idempotencyKey) {
        const key = where.userId_idempotencyKey;
        bet = bets.find(
          (b) => b.userId === key.userId && b.idempotencyKey === key.idempotencyKey,
        );
      }
      const found = withRelations(bet, include);
      return found ? { ...found } : null;
    }),
    findFirst: jest.fn(async ({ where }: any) => {
      const bet = bets.find(
        (b) =>
          (!where?.roundId || b.roundId === where.roundId) &&
          (!where?.userId || b.userId === where.userId),
      );
      const found = withRelations(bet, where?.include);
      return found ? { ...found } : null;
    }),
    findMany: jest.fn(async ({ where }: any) =>
      bets
        .filter((b) => (!where?.roundId || b.roundId === where.roundId))
        .filter((b) => (!where?.status || b.status === where.status))
        .map((b) => ({ ...b })),
    ),
    create: jest.fn(async ({ data }: any) => {
      if (
        bets.some((b) => b.userId === data.userId && b.idempotencyKey === data.idempotencyKey)
      ) {
        uniqueViolation();
      }
      const row = {
        id: uuid('bet'),
        cashoutMultiplier: null,
        payout: null,
        cashoutAt: null,
        settledAt: null,
        transactionId: null,
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
        ...data,
      };
      bets.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = bets.find(
        (b) => b.id === where.id && (!where.status || b.status === where.status),
      );
      if (!row) {
        throw new Prisma.PrismaClientKnownRequestError('Record to update not found', {
          code: 'P2025',
          clientVersion: 'test',
        });
      }
      Object.assign(row, data, { updatedAt: new Date(NOW) });
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const rows = bets.filter(
        (b) => b.id === where.id && (!where.status || b.status === where.status),
      );
      for (const row of rows) Object.assign(row, data, { updatedAt: new Date(NOW) });
      return { count: rows.length };
    }),
  };

  prisma.crashSettlement = {
    create: jest.fn(async ({ data }: any) => {
      if (settlements.some((s) => s.betId === data.betId)) uniqueViolation();
      const row = { id: uuid('settlement'), createdAt: new Date(NOW), ...data };
      settlements.push(row);
      return row;
    }),
    findUnique: jest.fn(async ({ where }: any) =>
      settlements.find((s) => s.betId === where.betId) ?? null,
    ),
    findMany: jest.fn(async () => [...settlements]),
  };

  prisma.gameAuditLog = {
    create: jest.fn(async ({ data }: any) => {
      gameAuditLogs.push(data);
      return data;
    }),
  };
  // FREE-PLAY tables — recording doubles so REAL_MONEY isolation is provable.
  prisma.crashFreePlayWallet = {
    findUnique: jest.fn(async () => {
      freePlayCalls.push('crashFreePlayWallet.findUnique');
      return null;
    }),
    create: jest.fn(async () => {
      freePlayCalls.push('crashFreePlayWallet.create');
      return {};
    }),
    update: jest.fn(async () => {
      freePlayCalls.push('crashFreePlayWallet.update');
      return {};
    }),
  };

  prisma.crashFreePlayTransaction = {
    findUnique: jest.fn(async () => {
      freePlayCalls.push('crashFreePlayTransaction.findUnique');
      return null;
    }),
    create: jest.fn(async () => {
      freePlayCalls.push('crashFreePlayTransaction.create');
      return {};
    }),
  };

  prisma.$queryRaw = jest.fn(async () => []);
  prisma.$executeRaw = jest.fn(async () => 0);

  // Interactive transaction with ROLLBACK: the caller's writes are undone when
  // the callback throws, exactly like Postgres + Prisma.
  prisma.$transaction = jest.fn(async (fn: any) => {
    const snapshot = {
      wallets: [...wallets].map(([key, value]) => [key, { ...value }]) as [string, any][],
      walletTransactions: walletTransactions.map((row) => ({ ...row })),
      ledgerEntries: ledgerEntries.map((row) => ({ ...row })),
      bets: bets.map((row) => ({ ...row })),
      settlements: settlements.map((row) => ({ ...row })),
      rounds: rounds.map((row) => ({ ...row })),
    };
    const restoreInPlace = (target: any[], source: any[]) => {
      target.length = 0;
      target.push(...source);
    };
    try {
      return await fn(prisma);
    } catch (error) {
      wallets.clear();
      for (const [key, value] of snapshot.wallets) wallets.set(key, value);
      restoreInPlace(walletTransactions, snapshot.walletTransactions);
      restoreInPlace(ledgerEntries, snapshot.ledgerEntries);
      restoreInPlace(bets, snapshot.bets);
      restoreInPlace(settlements, snapshot.settlements);
      restoreInPlace(rounds, snapshot.rounds);
      throw error;
    }
  });

  const freeWallet: any = {
    getOrCreateWalletInTx: jest.fn(async () => ({
      id: 'fp-wallet',
      userId: USER_ID,
      balance: 100_000,
    })),
    getOrCreateWallet: jest.fn(async () => ({ id: 'fp-wallet', userId: USER_ID, balance: 100_000 })),
    debitInTx: jest.fn(async () => ({ id: 'fp-debit' })),
    creditInTx: jest.fn(async () => ({ id: 'fp-credit' })),
    credit: jest.fn(async () => ({ id: 'fp-credit' })),
  };
  const events: any = { emit: jest.fn() };
  const sequence: any = {
    consumeForNewRound: jest.fn(async () => null),
    getPublicView: jest.fn(async () => ({
      active: false,
      mode: 'PROVABLY_FAIR',
      lastIndex: null,
      label: null,
    })),
  };

  const wallet = new WalletService(prisma);
  const engine = new CrashRoundEngine(prisma, freeWallet, wallet, events, sequence);
  (engine as any).config = {
    ...(engine as any).config,
    mode,
    currency: CURRENCY,
    gameSlug: 'sky-rocket',
    enabled: false,
  };
  const crash = new CrashService(prisma, engine, events, freeWallet, wallet, sequence);
  (crash as any).config = {
    ...(crash as any).config,
    mode,
    currency: CURRENCY,
    realMoneyAvailable: mode === 'REAL_MONEY',
    enabled: true,
  };

  /** Puts the round into RUNNING with authoritative engine timing. */
  const startRunning = (crashAtMs = CRASH_AT_MS) => {
    roundRow().status = 'RUNNING';
    (engine as any).running.set(ROUND_ID, {
      crashMultiplier: CRASH_POINT,
      crashAtMs,
    });
  };

  const placeBet = (key = BET_KEY) =>
    crash.placeBet(auth, { stake: STAKE, clientRequestId: key } as never);
  const cashOut = (betId: string, key = 'cashout-1') =>
    crash.cashOut(auth, betId, { clientRequestId: key } as never);
  const crashRound = () => (engine as any).maybeCrashInTx(prisma, roundRow(), NOW);
  const voidRound = () => (engine as any).voidRoundSafely(roundRow());

  return {
    prisma,
    wallet,
    engine,
    crash,
    freeWallet,
    events,
    roundRow,
    walletState,
    movements,
    transactions,
    reservation,
    betOf,
    betById,
    startRunning,
    placeBet,
    cashOut,
    crashRound,
    voidRound,
    ledgerEntries,
    walletTransactions,
    bets,
    settlements,
    gameAuditLogs,
    auditLogs,
    freePlayCalls,
  };
}

type Harness = ReturnType<typeof makeHarness>;




// ---------------------------------------------------------------------------
// A. REAL_MONEY cash-out lifecycle
// ---------------------------------------------------------------------------

describe('A: REAL_MONEY cash-out lifecycle (reserve -> capture -> payout)', () => {
  it('A: reserves the stake, captures it, credits the payout once and leaves nothing locked', async () => {
    freezeClock();
    const h = makeHarness({ roundStatus: 'BETTING_OPEN' });

    const placed = await h.placeBet();
    expect(placed.status).toBe('ACTIVE');
    // RESERVED: available -= stake, locked += stake, ONE PENDING BET_STAKE tx.
    expect(h.walletState()).toEqual({ available: START_BALANCE - STAKE, locked: STAKE });
    expect(h.reservation()).toMatchObject({
      type: 'BET_STAKE',
      amount: -STAKE,
      status: 'PENDING',
      idempotencyKey: BET_KEY,
    });
    expect(h.betOf().transactionId).toBe(h.reservation().id);
    expect(h.movements('BET_STAKE_RESERVED')).toHaveLength(1);

    h.startRunning();
    const cashed = await h.cashOut(placed.id);

    // CASHED_OUT: the stake is captured and the GROSS payout credited.
    expect(cashed.status).toBe('CASHED_OUT');
    expect(cashed.cashoutMultiplier).toBe(CASHOUT_MULTIPLIER);
    expect(cashed.payout).toBe(CASHOUT_PAYOUT);
    expect(h.walletState()).toEqual({
      available: START_BALANCE - STAKE + CASHOUT_PAYOUT,
      locked: 0,
    });

    // Exactly one capture: the lock is consumed, available unchanged.
    const capture = h.movements('BET_STAKE_CAPTURED');
    expect(capture).toHaveLength(1);
    expect(capture[0]).toMatchObject({
      direction: 'DEBIT',
      amount: STAKE,
      availableBefore: START_BALANCE - STAKE,
      availableAfter: START_BALANCE - STAKE,
      lockedBefore: STAKE,
      lockedAfter: 0,
    });

    // Exactly one payout credit, ledger-consistent by construction.
    const payoutEntry = h.movements('CRASH_CASHOUT');
    expect(payoutEntry).toHaveLength(1);
    expect(payoutEntry[0]).toMatchObject({
      direction: 'CREDIT',
      amount: CASHOUT_PAYOUT,
      availableBefore: START_BALANCE - STAKE,
      availableAfter: START_BALANCE - STAKE + CASHOUT_PAYOUT,
      lockedBefore: 0,
      lockedAfter: 0,
    });
    expect(h.ledgerEntries).toHaveLength(3);

    const payouts = h.transactions('BET_PAYOUT');
    expect(payouts).toHaveLength(1);
    expect(payouts[0]).toMatchObject({
      status: 'COMPLETED',
      amount: CASHOUT_PAYOUT,
      idempotencyKey: `win:${BET_KEY}`,
    });
    expect(h.reservation().status).toBe('COMPLETED');
    expect(h.settlements).toHaveLength(1);
    expect(h.settlements[0]).toMatchObject({
      result: 'CASHED_OUT',
      payout: CASHOUT_PAYOUT,
      transactionId: h.reservation().id,
    });
    expect(h.betOf().status).toBe('CASHED_OUT');

    // Isolation: a REAL_MONEY win never touches the FREE_PLAY bankroll.
    expect(h.freePlayCalls).toHaveLength(0);
    expect(h.freeWallet.creditInTx).not.toHaveBeenCalled();
  });

  it('A: a failed placement rolls the reservation back (no locked funds without a bet)', async () => {
    freezeClock();
    const h = makeHarness({ roundStatus: 'BETTING_OPEN' });
    h.prisma.crashBet.create.mockImplementationOnce(async () => {
      throw new Error('bet insert failed');
    });

    await expect(h.placeBet()).rejects.toThrow('bet insert failed');

    expect(h.walletState()).toEqual({ available: START_BALANCE, locked: 0 });
    expect(h.walletTransactions).toHaveLength(0);
    expect(h.ledgerEntries).toHaveLength(0);
    expect(h.bets).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// B. REAL_MONEY loss lifecycle
// ---------------------------------------------------------------------------

describe('B: REAL_MONEY loss lifecycle (reserve -> capture, never refund)', () => {
  it('B: consumes the reserved stake when the round crashes and refunds nothing', async () => {
    freezeClock();
    const h = makeHarness({ roundStatus: 'BETTING_OPEN' });
    await h.placeBet();
    expect(h.walletState().locked).toBe(STAKE);

    h.startRunning(NOW - 1); // the pre-determined crash point is already reached
    await h.crashRound();

    expect(h.walletState()).toEqual({ available: START_BALANCE - STAKE, locked: 0 });
    expect(h.reservation().status).toBe('COMPLETED');
    expect(h.movements('BET_STAKE_RESERVED')).toHaveLength(1);
    expect(h.movements('BET_STAKE_CAPTURED')).toHaveLength(1);
    expect(h.movements('BET_STAKE_RELEASED')).toHaveLength(0);
    expect(h.transactions('BET_PAYOUT')).toHaveLength(0);
    expect(h.transactions('BET_REFUND')).toHaveLength(0);
    expect(h.ledgerEntries).toHaveLength(2);

    expect(h.betOf().status).toBe('LOST');
    expect(h.settlements).toHaveLength(1);
    expect(h.settlements[0]).toMatchObject({
      result: 'LOST',
      stake: STAKE,
      payout: 0,
      transactionId: h.reservation().id,
    });
    expect(h.roundRow().status).toBe('SETTLED');
    expect(h.freePlayCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// C. REAL_MONEY void lifecycle
// ---------------------------------------------------------------------------

describe('C: REAL_MONEY void lifecycle (reserve -> release, no credit at all)', () => {
  it('C: releases the reservation back to the exact pre-bet balances', async () => {
    freezeClock();
    const h = makeHarness({ roundStatus: 'BETTING_OPEN' });
    await h.placeBet();

    h.startRunning();
    await h.voidRound();

    expect(h.walletState()).toEqual({ available: START_BALANCE, locked: 0 });
    expect(h.reservation().status).toBe('REVERSED');
    const released = h.movements('BET_STAKE_RELEASED');
    expect(released).toHaveLength(1);
    expect(released[0]).toMatchObject({
      direction: 'CREDIT',
      amount: STAKE,
      availableBefore: START_BALANCE - STAKE,
      availableAfter: START_BALANCE,
      lockedBefore: STAKE,
      lockedAfter: 0,
    });
    expect(h.transactions('BET_PAYOUT')).toHaveLength(0);
    expect(h.transactions('BET_REFUND')).toHaveLength(0);
    expect(h.ledgerEntries).toHaveLength(2);
    expect(h.betOf().status).toBe('REFUNDED');
    expect(h.settlements).toHaveLength(0);
    expect(h.freePlayCalls).toHaveLength(0);
  });
});


// ---------------------------------------------------------------------------
// D. Duplicate cash-out / duplicate placement
// ---------------------------------------------------------------------------

describe('D: duplicate cash-out can never pay twice', () => {
  it('D: a repeated cash-out returns the same result and moves no money again', async () => {
    freezeClock();
    const h = makeHarness({ roundStatus: 'BETTING_OPEN' });
    const placed = await h.placeBet();
    h.startRunning();

    const first = await h.cashOut(placed.id, 'cashout-1');
    const afterFirst = h.walletState();
    const ledgerAfterFirst = h.ledgerEntries.length;

    const second = await h.cashOut(placed.id, 'cashout-1');
    const third = await h.cashOut(placed.id, 'cashout-2');

    expect(second.payout).toBe(first.payout);
    expect(third.status).toBe('CASHED_OUT');
    expect(h.walletState()).toEqual(afterFirst);
    expect(h.ledgerEntries).toHaveLength(ledgerAfterFirst);
    expect(h.transactions('BET_PAYOUT')).toHaveLength(1);
    expect(h.movements('BET_STAKE_CAPTURED')).toHaveLength(1);
    expect(h.settlements).toHaveLength(1);
  });

  it('D: a retried placement is idempotent — one reservation, one bet, one debit', async () => {
    freezeClock();
    const h = makeHarness({ roundStatus: 'BETTING_OPEN' });

    const first = await h.placeBet(BET_KEY);
    const second = await h.placeBet(BET_KEY);

    expect(second.id).toBe(first.id);
    expect(h.bets).toHaveLength(1);
    expect(h.reservation()).toMatchObject({ status: 'PENDING' });
    expect(h.walletTransactions).toHaveLength(1);
    expect(h.movements('BET_STAKE_RESERVED')).toHaveLength(1);
    expect(h.walletState()).toEqual({ available: START_BALANCE - STAKE, locked: STAKE });
  });
});

// ---------------------------------------------------------------------------
// E. Cash-out vs crash race
// ---------------------------------------------------------------------------

describe('E: cash-out vs crash race is deterministic', () => {
  it('E: when the cash-out wins the crash settlement moves no money at all', async () => {
    freezeClock();
    const h = makeHarness({ roundStatus: 'BETTING_OPEN' });
    const placed = await h.placeBet();
    h.startRunning();
    await h.cashOut(placed.id);
    const afterCashout = h.walletState();
    const ledgerAfterCashout = h.ledgerEntries.length;

    // The round crashes "after" the accepted cash-out.
    h.startRunning(NOW - 1);
    await h.crashRound();

    expect(h.walletState()).toEqual(afterCashout);
    expect(h.ledgerEntries).toHaveLength(ledgerAfterCashout);
    expect(h.betOf().status).toBe('CASHED_OUT');
    expect(h.settlements.filter((s) => s.result === 'LOST')).toHaveLength(0);
    expect(h.transactions('BET_PAYOUT')).toHaveLength(1);
    expect(h.movements('BET_STAKE_CAPTURED')).toHaveLength(1);
    expect(h.roundRow().status).toBe('SETTLED');
  });

  it('E: when the crash wins a later cash-out pays nothing and re-captures nothing', async () => {
    freezeClock();
    const h = makeHarness({ roundStatus: 'BETTING_OPEN' });
    const placed = await h.placeBet();
    h.startRunning(NOW - 1);
    await h.crashRound();
    const afterCrash = h.walletState();
    const ledgerAfterCrash = h.ledgerEntries.length;

    const late = await h.cashOut(placed.id);

    expect(late.status).toBe('LOST');
    expect(late.payout).toBeNull();
    expect(h.walletState()).toEqual(afterCrash);
    expect(h.ledgerEntries).toHaveLength(ledgerAfterCrash);
    expect(h.transactions('BET_PAYOUT')).toHaveLength(0);
    expect(h.movements('BET_STAKE_CAPTURED')).toHaveLength(1);
    expect(h.movements('BET_STAKE_RELEASED')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// F. Cash-out vs void race
// ---------------------------------------------------------------------------

describe('F: cash-out vs void race is deterministic', () => {
  it('F: a void never releases an already captured (cashed-out) stake', async () => {
    freezeClock();
    const h = makeHarness({ roundStatus: 'BETTING_OPEN' });
    const placed = await h.placeBet();
    h.startRunning();
    await h.cashOut(placed.id);
    const afterCashout = h.walletState();

    await h.voidRound();

    expect(h.walletState()).toEqual(afterCashout);
    expect(h.reservation().status).toBe('COMPLETED');
    expect(h.movements('BET_STAKE_RELEASED')).toHaveLength(0);
    expect(h.betOf().status).toBe('CASHED_OUT');
  });

  it('F: a void after a crash never releases a consumed (lost) stake', async () => {
    freezeClock();
    const h = makeHarness({ roundStatus: 'BETTING_OPEN' });
    await h.placeBet();
    h.startRunning(NOW - 1);
    await h.crashRound();
    const afterCrash = h.walletState();

    await h.voidRound();

    expect(h.walletState()).toEqual(afterCrash);
    expect(h.reservation().status).toBe('COMPLETED');
    expect(h.movements('BET_STAKE_RELEASED')).toHaveLength(0);
    expect(h.betOf().status).toBe('LOST');
  });
});


// ---------------------------------------------------------------------------
// G. Duplicate settlement retry (scheduler tick re-runs)
// ---------------------------------------------------------------------------

describe('G: a retried crash settlement moves no money twice', () => {
  it('G: re-entering the crash transition cannot capture the stake a second time', async () => {
    freezeClock();
    const h = makeHarness({ roundStatus: 'BETTING_OPEN' });
    await h.placeBet();
    h.startRunning(NOW - 1);
    await h.crashRound();

    const afterCrash = h.walletState();
    const ledgerAfterCrash = h.ledgerEntries.length;

    // (1) The same tick is replayed against a round that already left RUNNING:
    //     the guarded round transition refuses it, so nothing is written at all.
    h.startRunning(NOW - 1);
    h.roundRow().status = 'SETTLED';
    await expect(h.crashRound()).rejects.toThrow();
    expect(h.walletState()).toEqual(afterCrash);
    expect(h.ledgerEntries).toHaveLength(ledgerAfterCrash);

    // (2) A genuine re-entry: the round is RUNNING again but the bet is already
    //     settled, so the ACTIVE-bet query is empty — no second loss is booked.
    h.roundRow().status = 'RUNNING';
    h.startRunning(NOW - 1);
    await h.crashRound();

    expect(h.walletState()).toEqual(afterCrash);
    expect(h.ledgerEntries).toHaveLength(ledgerAfterCrash);
    expect(h.movements('BET_STAKE_CAPTURED')).toHaveLength(1);
    expect(h.transactions('BET_PAYOUT')).toHaveLength(0);
    expect(h.settlements.filter((s) => s.result === 'LOST')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// H. Duplicate release retry (void / recovery re-runs)
// ---------------------------------------------------------------------------

describe('H: a retried void never releases the stake twice', () => {
  it('H: the second void is a no-op — balances and ledger stay put', async () => {
    freezeClock();
    const h = makeHarness({ roundStatus: 'BETTING_OPEN' });
    await h.placeBet();
    h.startRunning();
    await h.voidRound();

    const afterVoid = h.walletState();
    const ledgerAfterVoid = h.ledgerEntries.length;

    await h.voidRound();

    expect(h.walletState()).toEqual(afterVoid);
    expect(h.walletState()).toEqual({ available: START_BALANCE, locked: 0 });
    expect(h.ledgerEntries).toHaveLength(ledgerAfterVoid);
    expect(h.movements('BET_STAKE_RELEASED')).toHaveLength(1);
    expect(h.reservation().status).toBe('REVERSED');
  });

  it('H: a void retried after the reservation was captured releases nothing', async () => {
    freezeClock();
    const h = makeHarness({ roundStatus: 'BETTING_OPEN' });
    const placed = await h.placeBet();
    h.startRunning();
    await h.cashOut(placed.id);

    // The bet is no longer ACTIVE, so the void loop never even sees it…
    await h.voidRound();
    expect(h.movements('BET_STAKE_RELEASED')).toHaveLength(0);

    // …and a direct release call on the captured reservation is a no-op too.
    await h.wallet.releaseStake(USER_ID, BET_KEY);
    expect(h.walletState()).toEqual({
      available: START_BALANCE - STAKE + CASHOUT_PAYOUT,
      locked: 0,
    });
    expect(h.movements('BET_STAKE_RELEASED')).toHaveLength(0);
    expect(h.reservation().status).toBe('COMPLETED');
  });
});

// ---------------------------------------------------------------------------
// I. Canonical reservation state machine (real WalletService, no crash engine)
// ---------------------------------------------------------------------------

describe('I: the canonical stake reservation is exactly-once', () => {
  it('I: capture twice consumes the lock once', async () => {
    const h = makeHarness({});
    await h.wallet.reserveStake(USER_ID, STAKE, CURRENCY, 'k-1');
    expect(h.walletState()).toEqual({ available: START_BALANCE - STAKE, locked: STAKE });

    await h.wallet.captureStake(USER_ID, 'k-1');
    await h.wallet.captureStake(USER_ID, 'k-1');

    expect(h.walletState()).toEqual({ available: START_BALANCE - STAKE, locked: 0 });
    expect(h.movements('BET_STAKE_CAPTURED')).toHaveLength(1);
    expect(h.reservation('k-1').status).toBe('COMPLETED');
  });

  it('I: release twice refunds the lock once', async () => {
    const h = makeHarness({});
    await h.wallet.reserveStake(USER_ID, STAKE, CURRENCY, 'k-1');

    await h.wallet.releaseStake(USER_ID, 'k-1');
    await h.wallet.releaseStake(USER_ID, 'k-1');

    expect(h.walletState()).toEqual({ available: START_BALANCE, locked: 0 });
    expect(h.movements('BET_STAKE_RELEASED')).toHaveLength(1);
    expect(h.reservation('k-1').status).toBe('REVERSED');
  });

  it('I: a released stake can never be captured, a captured stake never released', async () => {
    const released = makeHarness({});
    await released.wallet.reserveStake(USER_ID, STAKE, CURRENCY, 'k-1');
    await released.wallet.releaseStake(USER_ID, 'k-1');
    await released.wallet.captureStake(USER_ID, 'k-1');

    expect(released.walletState()).toEqual({ available: START_BALANCE, locked: 0 });
    expect(released.movements('BET_STAKE_CAPTURED')).toHaveLength(0);
    expect(released.reservation('k-1').status).toBe('REVERSED');

    const captured = makeHarness({});
    await captured.wallet.reserveStake(USER_ID, STAKE, CURRENCY, 'k-2');
    await captured.wallet.captureStake(USER_ID, 'k-2');
    await captured.wallet.releaseStake(USER_ID, 'k-2');

    expect(captured.walletState()).toEqual({ available: START_BALANCE - STAKE, locked: 0 });
    expect(captured.movements('BET_STAKE_RELEASED')).toHaveLength(0);
    expect(captured.reservation('k-2').status).toBe('COMPLETED');
  });

  it('I: capturing a stake that was never reserved is refused (no free payout)', async () => {
    const h = makeHarness({});

    await expect(h.wallet.captureStake(USER_ID, 'never-reserved')).rejects.toMatchObject({
      status: 404,
    });

    expect(h.walletState()).toEqual({ available: START_BALANCE, locked: 0 });
    expect(h.ledgerEntries).toHaveLength(0);
    expect(h.walletTransactions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// J. lockedBalance cleanup / wallet invariants on EVERY terminal path
// ---------------------------------------------------------------------------

describe('J: lockedBalance is always cleaned up and available never goes negative', () => {
  it('J: every terminal path ends with locked = 0 and a terminal reservation', async () => {
    const paths: Array<{ name: string; run: (h: Harness) => Promise<void>; available: number }> = [
      {
        name: 'cash-out (win)',
        available: START_BALANCE - STAKE + CASHOUT_PAYOUT,
        run: async (h) => {
          const placed = await h.placeBet();
          h.startRunning();
          await h.cashOut(placed.id);
        },
      },
      {
        name: 'crash (loss)',
        available: START_BALANCE - STAKE,
        run: async (h) => {
          await h.placeBet();
          h.startRunning(NOW - 1);
          await h.crashRound();
        },
      },
      {
        name: 'void (refund)',
        available: START_BALANCE,
        run: async (h) => {
          await h.placeBet();
          h.startRunning();
          await h.voidRound();
        },
      },
    ];

    for (const path of paths) {
      freezeClock();
      const h = makeHarness({ roundStatus: 'BETTING_OPEN' });
      await path.run(h);
      jest.restoreAllMocks();

      const state = h.walletState();
      expect({ path: path.name, ...state }).toEqual({
        path: path.name,
        available: path.available,
        locked: 0,
      });
      expect(state.available).toBeGreaterThanOrEqual(0);
      expect(state.locked).toBeGreaterThanOrEqual(0);

      // Exactly ONE reservation, and it must be in a terminal state —
      // never PENDING-forever, never COMPLETED + REVERSED at the same time.
      expect(h.walletTransactions.filter((tx) => tx.type === 'BET_STAKE')).toHaveLength(1);
      expect(h.reservation().status).not.toBe('PENDING');
      expect(h.walletTransactions.filter((tx) => tx.status === 'PENDING')).toHaveLength(0);

      // Every ledger entry is internally consistent (available/locked >= 0).
      for (const entry of h.ledgerEntries) {
        expect(entry.availableBefore).toBeGreaterThanOrEqual(0);
        expect(entry.availableAfter).toBeGreaterThanOrEqual(0);
        expect(entry.lockedBefore).toBeGreaterThanOrEqual(0);
        expect(entry.lockedAfter).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// K/L. Wallet isolation between the two modes
// ---------------------------------------------------------------------------

describe('K: REAL_MONEY never touches the FREE_PLAY bankroll', () => {
  it('K: a full REAL_MONEY win uses only the real Wallet, never points', async () => {
    freezeClock();
    const h = makeHarness({ roundStatus: 'BETTING_OPEN' });
    const placed = await h.placeBet();
    h.startRunning();
    await h.cashOut(placed.id);

    expect(h.freePlayCalls).toHaveLength(0);
    expect(h.freeWallet.getOrCreateWalletInTx).not.toHaveBeenCalled();
    expect(h.freeWallet.debitInTx).not.toHaveBeenCalled();
    expect(h.freeWallet.creditInTx).not.toHaveBeenCalled();
    expect(h.freeWallet.credit).not.toHaveBeenCalled();

    // …and the bet really is a real-money bet holding a real reservation.
    expect(h.betOf().mode).toBe('REAL_MONEY');
    expect(h.betOf().currency).toBe(CURRENCY);
    expect(h.betOf().transactionId).toBe(h.reservation().id);
  });
});

describe('L: FREE_PLAY never touches the real Wallet or its ledger', () => {
  it('L: free-play placement + cash-out move points only', async () => {
    freezeClock();
    const h = makeHarness({ mode: 'FREE_PLAY', roundStatus: 'BETTING_OPEN' });

    const placed = await h.placeBet();
    expect(placed.mode).toBe('FREE_PLAY');
    h.startRunning();
    await h.cashOut(placed.id);

    expect(h.freeWallet.debitInTx).toHaveBeenCalledTimes(1);
    expect(h.freeWallet.creditInTx).toHaveBeenCalledTimes(1);
    expect(h.walletTransactions).toHaveLength(0);
    expect(h.ledgerEntries).toHaveLength(0);
    expect(h.walletState()).toEqual({ available: START_BALANCE, locked: 0 });
    // points stay points: FREEPLAY currency, no wallet transaction anchor.
    expect(h.betOf().currency).toBe('FREEPLAY');
    expect(h.betOf().transactionId).toBeNull();
  });

  it('L: free-play loss and void never touch the real Wallet either', async () => {
    freezeClock();
    const loss = makeHarness({ mode: 'FREE_PLAY', roundStatus: 'BETTING_OPEN' });
    await loss.placeBet('fp-loss');
    loss.startRunning(NOW - 1);
    await loss.crashRound();

    const voided = makeHarness({ mode: 'FREE_PLAY', roundStatus: 'BETTING_OPEN' });
    await voided.placeBet('fp-void');
    voided.startRunning();
    await voided.voidRound();

    for (const h of [loss, voided]) {
      expect(h.walletTransactions).toHaveLength(0);
      expect(h.ledgerEntries).toHaveLength(0);
      expect(h.walletState()).toEqual({ available: START_BALANCE, locked: 0 });
    }
    expect(loss.freeWallet.credit).not.toHaveBeenCalled(); // a loss refunds nothing
    expect(voided.freeWallet.credit).toHaveBeenCalledTimes(1); // a void refunds points
  });
});

// ---------------------------------------------------------------------------
// M. The REAL_MONEY gate stays fail-closed
// ---------------------------------------------------------------------------

describe('M: the REAL_MONEY gate remains fail-closed', () => {
  it('M: a production REAL_MONEY env with no implemented adapter stays FREE_PLAY', () => {
    const config = loadCrashConfig(PRODUCTION_REAL_MONEY_ENV);

    expect(config.mode).toBe('FREE_PLAY');
    expect(config.realMoneyAvailable).toBe(false);
    expect(config.realMoneyReason).toMatch(/no real adapter is implemented/i);
  });

  it('M: that fail-closed config can never drive real-money wallet movements', async () => {
    freezeClock();
    const h = makeHarness({ roundStatus: 'BETTING_OPEN' });
    (h.crash as any).config = {
      ...(h.crash as any).config,
      ...loadCrashConfig(PRODUCTION_REAL_MONEY_ENV),
    };

    const placed = await h.placeBet();
    h.startRunning();
    await h.cashOut(placed.id);

    expect((h.crash as any).config.mode).toBe('FREE_PLAY');
    expect(placed.mode).toBe('FREE_PLAY');
    // No reservation, no capture, no payout — the real Wallet is untouched.
    expect(h.walletTransactions).toHaveLength(0);
    expect(h.ledgerEntries).toHaveLength(0);
    expect(h.walletState()).toEqual({ available: START_BALANCE, locked: 0 });
  });
});


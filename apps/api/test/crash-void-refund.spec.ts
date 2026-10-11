/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * MUST-FIX #2 regression tests — a VOIDED round refunds through the wallet of
 * the mode that is actually active:
 *
 *   C. FREE_PLAY: refunds credit CrashFreePlayWallet ONLY — WalletService is
 *      never called, no WalletTransaction / LedgerEntry is ever written.
 *   D. REAL_MONEY: the stake RESERVATION is released through the canonical
 *      WalletService.releaseStake(...) operation (the inverse of the
 *      reserveStake that placement performed) — keyed by the bet's own
 *      idempotency key, so a retried tick cannot refund twice.
 *   E. REAL_MONEY refunds can never create a FREEPLAY transaction/credit — a
 *      void must not hand out free-play points for a real-money stake.
 *
 * The mode is switched on the instance exactly as a future activation would
 * (the REAL_MONEY gate itself is un-satisfiable today — see
 * crash-real-money-gate.spec.ts), so the REAL_MONEY branch is exercised without
 * weakening the production gate.
 */

import { loadCrashConfig, type CrashConfig, type CrashMode } from '../src/modules/crash/crash.config';
import { CrashRoundEngine } from '../src/modules/crash/crash-round-engine';

jest.setTimeout(30_000);

const ROUND_ID = 'round-1';
const ROUND_NUMBER = 42;
const USER_ID = 'user-1';
const BET_ID = 'bet-1';
const BET_KEY = 'bet-idempotency-key-1';
const STAKE = 2500;

type Harness = ReturnType<typeof makeEngine>;

function makeEngine(
  options: {
    mode?: CrashMode;
    bets?: Array<{ id: string; userId: string; stake: number; idempotencyKey: string }>;
  } = {},
) {
  const bets = (
    options.bets ?? [{ id: BET_ID, userId: USER_ID, stake: STAKE, idempotencyKey: BET_KEY }]
  ).map((bet) => ({ ...bet, status: 'ACTIVE' }));

  const round = {
    id: ROUND_ID,
    gameSlug: 'sky-rocket',
    mode: 'FREE_PLAY',
    status: 'RUNNING',
    roundNumber: ROUND_NUMBER,
    startAt: new Date(),
    bettingCloseAt: new Date(),
    crashMultiplier: null,
    crashSource: 'CONFIGURED',
    crashPointConfigured: 2.5,
    crashPointSeedEnc: null,
    clientSeed: 'c'.repeat(32),
    nonce: 1,
  };

  const prisma: any = {
    crashRound: {
      findUniqueOrThrow: jest.fn(async () => round),
      findFirst: jest.fn(async () => round),
      update: jest.fn(async () => round),
      create: jest.fn(),
    },
    crashBet: {
      findMany: jest.fn(async () => bets),
      update: jest.fn(async () => ({})),
    },
    // REAL wallet tables — must stay untouched in FREE_PLAY.
    wallet: { update: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
    walletTransaction: { create: jest.fn(async () => ({ id: 'wtx-1' })) },
    ledgerEntry: { create: jest.fn(async () => ({ id: 'ledger-1' })) },
    // FREE-PLAY tables — reached only through CrashFreePlayWalletService.
    crashFreePlayWallet: { update: jest.fn(async () => ({})) },
    crashFreePlayTransaction: { create: jest.fn(async () => ({ id: 'fptx-1' })) },
    $transaction: jest.fn(async (fn: any) => (typeof fn === 'function' ? fn(prisma) : undefined)),
  };

  const freeWallet: any = {
    credit: jest.fn(async () => ({ id: 'fptx-credit' })),
    creditInTx: jest.fn(async () => ({ id: 'fptx-credit-tx' })),
    debitInTx: jest.fn(),
    getOrCreateWalletInTx: jest.fn(),
  };
  const wallet: any = {
    reserveStake: jest.fn(async () => ({ transactionId: 'wtx-reserve', duplicate: false })),
    captureStake: jest.fn(async () => undefined),
    releaseStake: jest.fn(async () => undefined),
    settleBetCredit: jest.fn(async () => ({
      walletId: 'wallet-1',
      transactionId: 'wtx-settle',
      duplicate: false,
    })),
  };
  const events: any = { emit: jest.fn() };
  const sequence: any = { consumeForNewRound: jest.fn(async () => null) };

  const engine = new CrashRoundEngine(prisma, freeWallet, wallet, events, sequence);
  if (options.mode) {
    (engine as any).config = { ...(engine as any).config, mode: options.mode } as CrashConfig;
  }

  return { engine, prisma, freeWallet, wallet, events, round, bets };
}

/** Runs the real void path (private by design — it is engine-internal). */
function voidRoundSafely(h: Harness): Promise<void> {
  return (h.engine as any).voidRoundSafely(h.round);
}

describe('FREE_PLAY void refund — free-play points only (C)', () => {
  it('C: credits CrashFreePlayWallet with the staked points and touches no real wallet', async () => {
    const h = makeEngine({ mode: 'FREE_PLAY' });
    await voidRoundSafely(h);

    expect(h.freeWallet.credit).toHaveBeenCalledTimes(1);
    expect(h.freeWallet.credit).toHaveBeenCalledWith(USER_ID, STAKE, 'BET_REFUND', `refund:${BET_KEY}`, {
      type: 'CRASH_SETTLEMENT',
      id: BET_ID,
    });

    // WalletService isolation: nothing on the real-money path is invoked.
    expect(h.wallet.releaseStake).not.toHaveBeenCalled();
    expect(h.wallet.settleBetCredit).not.toHaveBeenCalled();
    expect(h.wallet.reserveStake).not.toHaveBeenCalled();
    expect(h.wallet.captureStake).not.toHaveBeenCalled();

    // …and no real wallet ledger rows can be created by a FREE_PLAY void.
    expect(h.prisma.walletTransaction.create).not.toHaveBeenCalled();
    expect(h.prisma.ledgerEntry.create).not.toHaveBeenCalled();
    expect(h.prisma.wallet.update).not.toHaveBeenCalled();

    // The bet is settled as REFUNDED, and the round is finalized.
    expect(h.prisma.crashBet.update).toHaveBeenCalledWith({
      where: { id: BET_ID },
      data: { status: 'REFUNDED', settledAt: expect.any(Date) },
    });
    expect(h.prisma.crashRound.update).toHaveBeenCalledWith({
      where: { id: ROUND_ID, status: 'RUNNING' },
      data: { status: 'SETTLED', settledAt: expect.any(Date) },
    });
  });

  it('C: refunds every unsettled bet exactly once, keyed by each bet idempotency key', async () => {
    const h = makeEngine({
      mode: 'FREE_PLAY',
      bets: [
        { id: 'bet-1', userId: 'user-1', stake: 1000, idempotencyKey: 'key-1' },
        { id: 'bet-2', userId: 'user-2', stake: 2500, idempotencyKey: 'key-2' },
      ],
    });
    await voidRoundSafely(h);

    expect(h.freeWallet.credit).toHaveBeenCalledTimes(2);
    expect(h.freeWallet.credit.mock.calls.map((call: any[]) => call[3])).toEqual([
      'refund:key-1',
      'refund:key-2',
    ]);
    expect(h.wallet.releaseStake).not.toHaveBeenCalled();
    expect(h.wallet.settleBetCredit).not.toHaveBeenCalled();
  });
});


describe('REAL_MONEY void refund — canonical reservation release (D/E)', () => {
  it('D: releases the PENDING stake reservation via WalletService.releaseStake', async () => {
    const h = makeEngine({ mode: 'REAL_MONEY' });
    await voidRoundSafely(h);

    expect(h.wallet.releaseStake).toHaveBeenCalledTimes(1);
    // Same key the stake was reserved under — the exact inverse operation.
    expect(h.wallet.releaseStake).toHaveBeenCalledWith(USER_ID, BET_KEY);
  });

  it('D: is idempotent — a retried void re-uses the SAME reservation key', async () => {
    const h = makeEngine({ mode: 'REAL_MONEY' });
    await voidRoundSafely(h);
    await voidRoundSafely(h);

    const keys = h.wallet.releaseStake.mock.calls.map((call: any[]) => call[1]);
    expect(keys).toEqual([BET_KEY, BET_KEY]);
    // No fresh/derived refund key is ever invented (that would risk a double
    // credit): the reservation itself carries the idempotency.
    expect(keys.every((key: string) => key === BET_KEY)).toBe(true);
  });

  it('E: REAL_MONEY void refund can never create a FREEPLAY transaction', async () => {
    const h = makeEngine({ mode: 'REAL_MONEY' });
    await voidRoundSafely(h);

    expect(h.freeWallet.credit).not.toHaveBeenCalled();
    expect(h.freeWallet.creditInTx).not.toHaveBeenCalled();
    expect(h.prisma.crashFreePlayTransaction.create).not.toHaveBeenCalled();
    expect(h.prisma.crashFreePlayWallet.update).not.toHaveBeenCalled();
  });

  it('E: posts no BET_REFUND credit (the locked reservation is released, never double-credited)', async () => {
    const h = makeEngine({ mode: 'REAL_MONEY' });
    await voidRoundSafely(h);

    expect(h.wallet.settleBetCredit).not.toHaveBeenCalled();
    expect(h.wallet.captureStake).not.toHaveBeenCalled();
    expect(h.wallet.reserveStake).not.toHaveBeenCalled();
  });

  it('E: releases one reservation per unsettled bet', async () => {
    const h = makeEngine({
      mode: 'REAL_MONEY',
      bets: [
        { id: 'bet-1', userId: 'user-1', stake: 1000, idempotencyKey: 'key-1' },
        { id: 'bet-2', userId: 'user-2', stake: 2500, idempotencyKey: 'key-2' },
      ],
    });
    await voidRoundSafely(h);

    expect(h.wallet.releaseStake.mock.calls).toEqual([
      ['user-1', 'key-1'],
      ['user-2', 'key-2'],
    ]);
    expect(h.freeWallet.credit).not.toHaveBeenCalled();
  });
});

describe('mode cannot drift — REAL_MONEY still needs the implemented adapter', () => {
  it('the engine defaults to FREE_PLAY and its void path stays free-play', () => {
    const h = makeEngine();
    expect((h.engine as any).config.mode).toBe('FREE_PLAY');
    const config = loadCrashConfig({
      NODE_ENV: 'production',
      CRASH_MODE: 'REAL_MONEY',
      CRASH_REAL_MONEY_ALLOWED: 'true',
      OPERATOR_PROVIDER: 'operator-http',
    } as NodeJS.ProcessEnv);
    expect(config.mode).toBe('FREE_PLAY');
    expect(config.realMoneyAvailable).toBe(false);
  });
});


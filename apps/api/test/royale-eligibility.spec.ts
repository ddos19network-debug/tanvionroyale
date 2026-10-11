/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * TANVION ROYALE — REAL_MONEY eligibility gate tests (Task 1 / audit F1,F2,F4)
 * plus the FREE_PLAY carve-out.
 *
 * These run the REAL RoyalePlinkoService / RoyaleMinesService (and therefore the
 * REAL RoyaleEligibilityService + ResponsibleGamblingService) against the
 * in-memory Prisma double, so assertions are about ACTUAL rows: a rejected
 * REAL_MONEY stake must leave NO round, NO wallet transaction and NO ledger row.
 *
 * The production fail-closed gate itself is asserted separately in
 * royale-real-money-gate.spec.ts and stays closed; here REAL_MONEY is reached
 * by injecting a config object (exactly like the crash/plinko/mines specs).
 */

import { HttpException } from '@nestjs/common';
import { WalletService } from '../src/modules/wallet/wallet.service';
import { CrashFreePlayWalletService } from '../src/modules/crash/crash-freeplay-wallet.service';
import { RoyalePlinkoService } from '../src/modules/royale/royale-plinko.service';
import { RoyaleMinesService } from '../src/modules/royale/royale-mines.service';
import type { RoyaleConfig } from '../src/modules/royale/royale.config';
import { loadRoyaleConfig, resolveRoyaleRealMoney } from '../src/modules/royale/royale.config';
import { createInMemoryDb, seedUser, type InMemoryDb } from './royale-helpers';
import type { AuthenticatedUser } from '../src/common/types/authenticated-user';

jest.setTimeout(30_000);

const USER = { id: 'u-elig', sessionId: 's1', roles: ['USER'] } as unknown as AuthenticatedUser;
const CURRENCY = 'BDT';
const STAKE = 2_000;
const START = 100_000;
const GRID = 25;
const MINES = 3;

function freeConfig(): RoyaleConfig {
  return loadRoyaleConfig({ NODE_ENV: 'test', ROYALE_MODE: 'FREE_PLAY' } as NodeJS.ProcessEnv);
}
function realConfig(base = freeConfig()): RoyaleConfig {
  return { ...base, mode: 'REAL_MONEY', currency: CURRENCY };
}

function bodyCode(err: unknown): { code?: string; status?: number } {
  if (!(err instanceof HttpException)) return {};
  const body = err.getResponse() as any;
  return { code: body?.code, status: err.getStatus() };
}

/** Wire REAL services to one in-memory DB + injected config. */
function makeServices(db: InMemoryDb, cfg: RoyaleConfig) {
  const prisma = db as any;
  const wallet = new WalletService(prisma);
  const free = new CrashFreePlayWalletService(prisma);
  const plinko = new RoyalePlinkoService(prisma, wallet, free);
  const mines = new RoyaleMinesService(prisma, wallet, free);
  (plinko as any).config = cfg;
  (mines as any).config = cfg;
  return { wallet, free, plinko, mines };
}

/** Seed the user (with optional eligibility overrides) + a funded REAL wallet. */
function fundReal(
  db: InMemoryDb,
  cfg: RoyaleConfig,
  overrides: Record<string, unknown> = {},
  userId = USER.id,
) {
  seedUser(db, userId, 'CUSTOMER', overrides);
  db.rows('wallet').push({
    id: `w-${userId}`,
    userId,
    currency: cfg.currency,
    availableBalance: START,
    lockedBalance: 0,
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function fundFree(db: InMemoryDb, userId = USER.id, amount = START) {
  db.rows('crashFreePlayWallet').push({
    id: `fw-${userId}`,
    userId,
    balance: amount,
    currency: 'FREEPLAY',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/** Assert NOTHING money-related happened for the user. */
function expectNoMoneyMoved(db: InMemoryDb) {
  expect(db.rows('royalePlinkoRound')).toHaveLength(0);
  expect(db.rows('royaleMinesRound')).toHaveLength(0);
  expect(db.rows('royaleSettlement')).toHaveLength(0);
  expect(db.rows('walletTransaction')).toHaveLength(0);
  expect(db.rows('ledgerEntry')).toHaveLength(0);
  const w = db.rows('wallet')[0];
  expect(w.availableBalance).toBe(START);
  expect(w.lockedBalance).toBe(0);
}

function underageDob(): Date {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 17); // 17 years old -> under 18
  return d;
}

function pushExclusion(db: InMemoryDb, id: string): void {
  db.rows('selfExclusion').push({
    id,
    userId: USER.id,
    type: 'PERMANENT',
    startsAt: new Date(Date.now() - 60_000),
    endsAt: null,
    reason: null,
    revokedAt: null,
    createdAt: new Date(),
  });
}


describe('Royale REAL_MONEY eligibility gate — rejections leave NO money rows (F1/F2/F4)', () => {
  it('rejects a non-ACTIVE account with ROYALE_ACCOUNT_NOT_ACTIVE (403)', async () => {
    const cfg = realConfig();
    const db = createInMemoryDb();
    const { plinko } = makeServices(db, cfg);
    fundReal(db, cfg, { status: 'SUSPENDED' });

    try {
      await plinko.drop(USER, { stake: STAKE, rows: 12, risk: 'MEDIUM' } as any);
      throw new Error('expected a rejection');
    } catch (err) {
      expect(bodyCode(err)).toMatchObject({ code: 'ROYALE_ACCOUNT_NOT_ACTIVE', status: 403 });
    }
    expectNoMoneyMoved(db);
  });

  it('rejects unverified KYC with ROYALE_KYC_REQUIRED (403)', async () => {
    const cfg = realConfig();
    const db = createInMemoryDb();
    const { plinko } = makeServices(db, cfg);
    fundReal(db, cfg, { kycStatus: 'NOT_STARTED' });

    try {
      await plinko.drop(USER, { stake: STAKE, rows: 12, risk: 'MEDIUM' } as any);
      throw new Error('expected a rejection');
    } catch (err) {
      expect(bodyCode(err)).toMatchObject({ code: 'ROYALE_KYC_REQUIRED', status: 403 });
    }
    expectNoMoneyMoved(db);
  });

  it('rejects a MISSING date of birth with ROYALE_AGE_RESTRICTED (403)', async () => {
    const cfg = realConfig();
    const db = createInMemoryDb();
    const { plinko } = makeServices(db, cfg);
    fundReal(db, cfg, { dateOfBirth: null });

    try {
      await plinko.drop(USER, { stake: STAKE, rows: 12, risk: 'MEDIUM' } as any);
      throw new Error('expected a rejection');
    } catch (err) {
      expect(bodyCode(err)).toMatchObject({ code: 'ROYALE_AGE_RESTRICTED', status: 403 });
    }
    expectNoMoneyMoved(db);
  });

  it('rejects an UNDER-18 user with ROYALE_AGE_RESTRICTED (403)', async () => {
    const cfg = realConfig();
    const db = createInMemoryDb();
    const { plinko } = makeServices(db, cfg);
    fundReal(db, cfg, { dateOfBirth: underageDob() });

    try {
      await plinko.drop(USER, { stake: STAKE, rows: 12, risk: 'MEDIUM' } as any);
      throw new Error('expected a rejection');
    } catch (err) {
      expect(bodyCode(err)).toMatchObject({ code: 'ROYALE_AGE_RESTRICTED', status: 403 });
    }
    expectNoMoneyMoved(db);
  });

  it('rejects a self-excluded user with ROYALE_SELF_EXCLUDED (403)', async () => {
    const cfg = realConfig();
    const db = createInMemoryDb();
    const { plinko } = makeServices(db, cfg);
    fundReal(db, cfg); // otherwise fully eligible
    pushExclusion(db, 'ex-1');

    try {
      await plinko.drop(USER, { stake: STAKE, rows: 12, risk: 'MEDIUM' } as any);
      throw new Error('expected a rejection');
    } catch (err) {
      expect(bodyCode(err)).toMatchObject({ code: 'ROYALE_SELF_EXCLUDED', status: 403 });
    }
    expectNoMoneyMoved(db);
  });

  it('rejects a stake above the per-bet limit with ROYALE_LIMIT_EXCEEDED (403)', async () => {
    const cfg = realConfig();
    const db = createInMemoryDb();
    const { plinko, mines } = makeServices(db, cfg);
    fundReal(db, cfg); // otherwise fully eligible
    db.rows('playLimit').push({
      id: 'lim-1',
      userId: USER.id,
      kind: 'STAKE_PER_BET',
      period: 'DAILY',
      amount: 1_000, // < STAKE
      currency: CURRENCY,
      effectiveFrom: new Date(),
      pendingAmount: null,
      pendingEffectiveAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    for (const attempt of [
      () => plinko.drop(USER, { stake: STAKE, rows: 12, risk: 'MEDIUM' } as any),
      () => mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any),
    ]) {
      try {
        await attempt();
        throw new Error('expected a rejection');
      } catch (err) {
        expect(bodyCode(err)).toMatchObject({ code: 'ROYALE_LIMIT_EXCEEDED', status: 403 });
      }
    }
    expectNoMoneyMoved(db);
  });

  it('Mines start rejects ineligible users before any reservation too', async () => {
    const cfg = realConfig();
    const db = createInMemoryDb();
    const { mines } = makeServices(db, cfg);
    fundReal(db, cfg, { kycStatus: 'REJECTED' });

    try {
      await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);
      throw new Error('expected a rejection');
    } catch (err) {
      expect(bodyCode(err)).toMatchObject({ code: 'ROYALE_KYC_REQUIRED', status: 403 });
    }
    expectNoMoneyMoved(db);
  });
});

describe('Royale REAL_MONEY eligibility gate — eligible user passes (wallet intact)', () => {
  it('a fully eligible ACTIVE + VERIFIED + adult user settles a real drop', async () => {
    const cfg = realConfig();
    const db = createInMemoryDb();
    const { plinko } = makeServices(db, cfg);
    fundReal(db, cfg); // defaults: ACTIVE, VERIFIED, adult DOB, no exclusion/limits

    const round = await plinko.drop(USER, { stake: STAKE, rows: 12, risk: 'MEDIUM' } as any);
    expect(round.mode).toBe('REAL_MONEY');
    expect(round.transactionId).not.toBeNull();
    expect(db.rows('royalePlinkoRound')).toHaveLength(1);
    const w = db.rows('wallet')[0];
    expect(w.lockedBalance).toBe(0);
    expect(w.availableBalance).toBe(START - STAKE + round.payout);
  });
});

describe('Royale FREE_PLAY is unaffected by KYC / age / limits (F1/F2/F4 carve-out)', () => {
  it('a user with NO KYC, under-18 and self-excluded still plays FREE_PLAY', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { plinko, mines } = makeServices(db, cfg);
    fundFree(db);
    // Deliberately ineligible for real money:
    seedUser(db, USER.id, 'CUSTOMER', {
      kycStatus: 'NOT_STARTED',
      dateOfBirth: underageDob(),
      status: 'ACTIVE',
    });
    pushExclusion(db, 'ex-free');

    const round = await plinko.drop(USER, { stake: STAKE, rows: 12, risk: 'MEDIUM' } as any);
    expect(round.mode).toBe('FREE_PLAY');
    expect(round.transactionId).toBeNull();
    expect(db.rows('royalePlinkoRound')).toHaveLength(1);

    const minesRound = await mines.start(USER, {
      stake: STAKE,
      gridSize: GRID,
      minesCount: MINES,
    } as any);
    expect(minesRound.mode).toBe('FREE_PLAY');
    expect(db.rows('royaleMinesRound')).toHaveLength(1);

    // FREE_PLAY uses the points ledger only — the real wallet is untouched.
    expect(db.rows('walletTransaction')).toHaveLength(0);
    expect(db.rows('ledgerEntry')).toHaveLength(0);
  });
});

describe('Royale REAL_MONEY gate still closed (E1 / no adapter)', () => {
  it('resolveRoyaleRealMoney().available === false even for a named provider', () => {
    const verdict = resolveRoyaleRealMoney({
      NODE_ENV: 'production',
      ROYALE_MODE: 'REAL_MONEY',
      ROYALE_REAL_MONEY_ALLOWED: 'true',
      OPERATOR_PROVIDER: 'operator-http',
      PAYMENT_PROVIDER: 'generic-http',
      PAYMENT_PROVIDER_URL: 'https://payments.example.test',
      PAYMENT_PROVIDER_KEY: 'k',
    } as NodeJS.ProcessEnv);
    expect(verdict.available).toBe(false);
    expect(verdict.reason).toMatch(/no real adapter is implemented/i);
  });
});

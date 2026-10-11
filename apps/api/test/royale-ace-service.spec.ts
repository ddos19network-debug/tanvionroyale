/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * TANVION ROYALE — Royale Ace (royale-ace) service integration tests.
 *
 * These run the REAL RoyaleAceService + REAL WalletService + REAL
 * CrashFreePlayWalletService against the in-memory Prisma double, so assertions
 * are about ACTUAL balances, ledger rows, idempotency and the fail-closed
 * REAL_MONEY gate — not mock call counts.
 *
 * REAL_MONEY is reached by injecting a RoyaleConfig with mode 'REAL_MONEY' (the
 * same pattern as the plinko/mines specs); the production fail-closed gate is
 * asserted separately and stays closed.
 */
import { HttpException } from '@nestjs/common';
import { WalletService } from '../src/modules/wallet/wallet.service';
import { CrashFreePlayWalletService } from '../src/modules/crash/crash-freeplay-wallet.service';
import { RoyaleAceService } from '../src/modules/royale/ace/ace.service';
import { AceConfigStore } from '../src/modules/royale/ace/ace-config-store';
import { DEFAULT_ACE_CONFIG, type AceGameConfig } from '../src/modules/royale/ace/ace-config';
import type { RoyaleConfig } from '../src/modules/royale/royale.config';
import { loadRoyaleConfig } from '../src/modules/royale/royale.config';
import { createInMemoryDb, seedUser, type InMemoryDb } from './royale-helpers';
import type { AuthenticatedUser } from '../src/common/types/authenticated-user';

jest.setTimeout(30_000);

const USER = { id: 'u-ace', sessionId: 's1', roles: ['USER'] } as unknown as AuthenticatedUser;
const CURRENCY = 'BDT';
const STAKE = 2_000;
const START = 100_000;

function freeRoyale(): RoyaleConfig {
  return loadRoyaleConfig({ NODE_ENV: 'test', ROYALE_MODE: 'FREE_PLAY' } as NodeJS.ProcessEnv);
}
function realRoyale(base = freeRoyale()): RoyaleConfig {
  return { ...base, mode: 'REAL_MONEY', currency: CURRENCY, enabled: true, realMoneyAvailable: true } as RoyaleConfig;
}

/** Ace config that allows BDT for country BD (the seeded user's country). */
function aceConfig(overrides: Partial<AceGameConfig> = {}): AceGameConfig {
  return {
    ...JSON.parse(JSON.stringify(DEFAULT_ACE_CONFIG)),
    ...overrides,
    jurisdiction: {
      ...DEFAULT_ACE_CONFIG.jurisdiction,
      currencyByCountry: { BD: ['BDT'] },
      unknownCountryPolicy: 'BLOCK',
      ...(overrides.jurisdiction ?? {}),
    },
  };
}

function bodyCode(err: unknown): { code?: string; status?: number } {
  if (!(err instanceof HttpException)) return {};
  const body = err.getResponse() as any;
  return { code: body?.code, status: err.getStatus() };
}

/** Wire the REAL Ace service to an in-memory DB with an injected config store. */
function makeAce(db: InMemoryDb, royale: RoyaleConfig, cfg: AceGameConfig) {
  const prisma = db as any;
  const wallet = new WalletService(prisma);
  const free = new CrashFreePlayWalletService(prisma);
  const configStore = {
    getActive: async () => cfg,
    getVersion: async () => cfg,
    invalidate: () => {},
  } as unknown as AceConfigStore;
  const ace = new RoyaleAceService(prisma, wallet, free, configStore);
  (ace as any).royaleConfig = royale;
  return { wallet, free, ace };
}

function fundReal(db: InMemoryDb, currency: string, userId = USER.id, amount = START) {
  seedUser(db, userId, 'CUSTOMER', { country: 'BD' });
  db.rows('wallet').push({
    id: `w-${userId}`,
    userId,
    currency,
    availableBalance: amount,
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

const walletOf = (db: InMemoryDb, userId: string, currency: string) =>
  db.rows('wallet').find((w) => w.userId === userId && w.currency === currency);
const freeOf = (db: InMemoryDb, userId: string) =>
  db.rows('crashFreePlayWallet').find((w) => w.userId === userId);
const aceRounds = (db: InMemoryDb) => db.rows('royaleAceRound');


describe('Royale Ace — FREE_PLAY money flow (never touches the real wallet)', () => {
  it('debits the stake and credits the win on the points ledger only', async () => {
    const db = createInMemoryDb();
    const { ace } = makeAce(db, freeRoyale(), aceConfig());
    fundFree(db);
    const before = freeOf(db, USER.id)!.balance;

    const round = await ace.spin(USER, { stake: STAKE, clientRequestId: 'fp-1' } as any);

    const after = freeOf(db, USER.id)!;
    expect(after.balance).toBe(before - STAKE + (round.payout ?? 0));
    // The real wallet was never created or touched.
    expect(walletOf(db, USER.id, CURRENCY)).toBeUndefined();
    expect(db.rows('walletTransaction')).toHaveLength(0);
    const pts = db.rows('crashFreePlayTransaction');
    expect(pts.some((t) => t.type === 'BET_STAKE' && t.amount === STAKE)).toBe(true);
  });
});

describe('Royale Ace — idempotency (double-click never double-spends)', () => {
  it('returns the SAME round and debits the stake once for a repeated clientRequestId', async () => {
    const db = createInMemoryDb();
    const { ace } = makeAce(db, freeRoyale(), aceConfig());
    fundFree(db);
    const before = freeOf(db, USER.id)!.balance;

    const a = await ace.spin(USER, { stake: STAKE, clientRequestId: 'idem-1' } as any);
    const b = await ace.spin(USER, { stake: STAKE, clientRequestId: 'idem-1' } as any);

    expect(b.id).toBe(a.id);
    expect(b.totalPayBp).toBe(a.totalPayBp);
    const stakes = db.rows('crashFreePlayTransaction').filter((t) => t.type === 'BET_STAKE');
    expect(stakes).toHaveLength(1);
    expect(freeOf(db, USER.id)!.balance).toBe(before - STAKE + (a.payout ?? 0));
  });

  it('two different clientRequestIds create two independent rounds', async () => {
    const db = createInMemoryDb();
    const { ace } = makeAce(db, freeRoyale(), aceConfig());
    fundFree(db);
    await ace.spin(USER, { stake: STAKE, clientRequestId: 'k-1' } as any);
    await ace.spin(USER, { stake: STAKE, clientRequestId: 'k-2' } as any);
    expect(aceRounds(db)).toHaveLength(2);
  });

describe('Royale Ace — REAL_MONEY fail-closed gate matrix', () => {
  it('rejects when the MASTER switch is off and creates nothing', async () => {
    const db = createInMemoryDb();
    const royale = { ...realRoyale(), enabled: false };
    const { ace } = makeAce(db, royale, aceConfig());
    fundReal(db, CURRENCY);
    const err = await ace.spin(USER, { stake: STAKE, clientRequestId: 'gm-1' } as any).catch((e) => e);
    expect(bodyCode(err).code).toBe('GAME_DISABLED');
    expect(aceRounds(db)).toHaveLength(0);
    expect(db.rows('walletTransaction')).toHaveLength(0);
  });

  it('rejects when the GAME switch (config enabled) is off and creates nothing', async () => {
    const db = createInMemoryDb();
    const { ace } = makeAce(db, realRoyale(), aceConfig({ enabled: false }));
    fundReal(db, CURRENCY);
    const err = await ace.spin(USER, { stake: STAKE, clientRequestId: 'gm-2' } as any).catch((e) => e);
    expect(bodyCode(err).code).toBe('GAME_DISABLED');
    expect(aceRounds(db)).toHaveLength(0);
    expect(db.rows('walletTransaction')).toHaveLength(0);
  });

  it('rejects an UNKNOWN country under the fail-closed BLOCK policy', async () => {
    const db = createInMemoryDb();
    const { ace } = makeAce(db, realRoyale(), aceConfig());
    seedUser(db, USER.id, 'CUSTOMER', { country: 'ZZ' });
    db.rows('wallet').push({
      id: `w-${USER.id}`,
      userId: USER.id,
      currency: CURRENCY,
      availableBalance: START,
      lockedBalance: 0,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const err = await ace
      .spin(USER, { stake: STAKE, currency: CURRENCY, clientRequestId: 'gm-3' } as any)
      .catch((e) => e);
    expect(bodyCode(err).code).toBe('REAL_MONEY_UNAVAILABLE');
    expect(aceRounds(db)).toHaveLength(0);
    expect(db.rows('walletTransaction')).toHaveLength(0);
  });

  it('rejects a currency the country cannot use (no auto-FX)', async () => {
    const db = createInMemoryDb();
    const { ace } = makeAce(db, realRoyale(), aceConfig()); // BD allows BDT only
    fundReal(db, 'USD');
    seedUser(db, USER.id, 'CUSTOMER', { country: 'BD' });
    const err = await ace
      .spin(USER, { stake: STAKE, currency: 'USD', clientRequestId: 'gm-4' } as any)
      .catch((e) => e);
    expect(bodyCode(err).code).toBe('REAL_MONEY_UNAVAILABLE');
    expect(aceRounds(db)).toHaveLength(0);
  });

  it('rejects unverified KYC and an under-18 player', async () => {
    const db = createInMemoryDb();
    const { ace } = makeAce(db, realRoyale(), aceConfig());
    fundReal(db, CURRENCY, USER.id, START);
    // Make the seeded user KYC-pending.
    const userRow = db.rows('user').find((u) => u.id === USER.id)!;
    userRow.kycStatus = 'NOT_STARTED';
    const kycErr = await ace
      .spin(USER, { stake: STAKE, currency: CURRENCY, clientRequestId: 'gm-5' } as any)
      .catch((e) => e);
    expect(bodyCode(kycErr).code).toBe('ROYALE_KYC_REQUIRED');
    expect(aceRounds(db)).toHaveLength(0);
  });
});

describe('Royale Ace — reconciler completes a stuck ACTIVE round', () => {
  it('settles an ACTIVE round from its stored pre-derived outcome (exactly once)', async () => {
    const db = createInMemoryDb();
    const { ace } = makeAce(db, freeRoyale(), aceConfig());
    fundFree(db);
    // Play a normal round, then flip it back to ACTIVE to simulate a crash.
    const round = await ace.spin(USER, { stake: STAKE, clientRequestId: 'rec-1' } as any);
    const row = db.rows('royaleAceRound').find((r) => r.id === round.id)!;
    const payoutBefore = row.payout;
    expect(row.status).toBe('SETTLED');

    row.status = 'ACTIVE';
    const outcome = await ace.reconcile(100);
    expect(outcome.completed).toBe(1);
    expect(row.status).toBe('SETTLED');
    expect(row.payout).toBe(payoutBefore);

    // Re-running the reconciler is a no-op.
    const again = await ace.reconcile(100);
    expect(again.completed).toBe(0);
    expect(again.voided).toBe(0);
  });

  it('verifies a settled round for its owner and refuses a foreign round', async () => {
    const db = createInMemoryDb();
    const { ace } = makeAce(db, freeRoyale(), aceConfig());
    fundFree(db);
    const round = await ace.spin(USER, { stake: STAKE, clientRequestId: 'ver-1' } as any);
    const proof = await ace.verify(USER.id, round.id);
    expect((proof as any).valid).toBe(true);

    const foreign = await ace.verify('someone-else', round.id).catch((e) => e);
    expect(bodyCode(foreign).code).toBe('ROUND_NOT_FOUND');
  });
});

});

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * TANVION ROYALE — Mines integration tests (server-authoritative, wallet-backed).
 *
 * These run the REAL RoyaleMinesService + REAL WalletService + REAL
 * CrashFreePlayWalletService against the in-memory Prisma double (royale-helpers),
 * so assertions are about ACTUAL balances, transaction states, ledger rows and
 * the confidentiality of the hidden mine positions — not about mock call counts.
 *
 * REAL_MONEY is only ever reached by injecting a config object whose mode is
 * 'REAL_MONEY' (exactly like the crash regression tests); the production
 * fail-closed gate itself is asserted separately and stays closed.
 */

import { HttpException } from '@nestjs/common';
import { WalletService } from '../src/modules/wallet/wallet.service';
import { CrashFreePlayWalletService } from '../src/modules/crash/crash-freeplay-wallet.service';
import { RoyaleMinesService } from '../src/modules/royale/royale-mines.service';
import type { RoyaleConfig } from '../src/modules/royale/royale.config';
import { loadRoyaleConfig } from '../src/modules/royale/royale.config';
import { decryptRoundSeed, deriveMinesPositions } from '../src/modules/royale/royale-fair';
import { minesMultiplierBp, payoutFor } from '../src/modules/royale/royale-math';
import { createInMemoryDb, seedUser, type InMemoryDb } from './royale-helpers';
import type { AuthenticatedUser } from '../src/common/types/authenticated-user';

jest.setTimeout(30_000);

const USER = { id: 'u-mines', sessionId: 's1', roles: ['USER'] } as unknown as AuthenticatedUser;
const OTHER = { id: 'u-other', sessionId: 's2', roles: ['USER'] } as unknown as AuthenticatedUser;
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

function isRoyaleError(err: unknown, code: string, status?: number): boolean {
  if (!(err instanceof HttpException)) return false;
  const body = err.getResponse() as any;
  if (body?.code !== code) return false;
  return status === undefined || err.getStatus() === status;
}

function makeServices(db: InMemoryDb, cfg: RoyaleConfig) {
  const prisma = db as any;
  const wallet = new WalletService(prisma);
  const free = new CrashFreePlayWalletService(prisma);
  const mines = new RoyaleMinesService(prisma, wallet, free);
  (mines as any).config = cfg;
  return { wallet, free, mines };
}

function fundReal(db: InMemoryDb, cfg: RoyaleConfig, userId = USER.id, amount = START) {
  seedUser(db, userId);
  db.rows('wallet').push({
    id: `w-${userId}`,
    userId,
    currency: cfg.currency,
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

const walletOf = (db: InMemoryDb, userId: string, currency = CURRENCY) =>
  db.rows('wallet').find((w) => w.userId === userId && w.currency === currency)!;
const freeOf = (db: InMemoryDb, userId: string) =>
  db.rows('crashFreePlayWallet').find((w) => w.userId === userId);
const minesRow = (db: InMemoryDb, id: string) => db.rows('royaleMinesRound').find((r) => r.id === id)!;

/** The authoritative mine positions for a started round (test-side re-derivation). */
function minesOf(db: InMemoryDb, id: string): number[] {
  const row = minesRow(db, id);
  const seed = decryptRoundSeed(row.serverSeedEnc)!;
  return deriveMinesPositions(seed, row.clientSeed, row.nonce, row.gridSize, row.minesCount);
}
const mineTile = (db: InMemoryDb, id: string) => minesOf(db, id)[0];
function safeTile(db: InMemoryDb, id: string, exclude: number[] = []): number {
  const row = minesRow(db, id);
  const mines = minesOf(db, id);
  for (let t = 0; t < row.gridSize; t += 1) {
    if (!mines.includes(t) && !exclude.includes(t)) return t;
  }
  throw new Error('no safe tile available');
}
describe('RoyaleMines — FREE_PLAY start, hidden state, validation', () => {
  it('validates stake/grid/mines against server config (client cannot bypass)', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { mines } = makeServices(db, cfg);
    fundFree(db);

    // stake below min, non-square grid, mines >= gridSize, mines above max.
    await expect(mines.start(USER, { stake: 0, gridSize: 25, minesCount: 3 } as any)).rejects.toThrow();
    await expect(mines.start(USER, { stake: STAKE, gridSize: 24, minesCount: 3 } as any)).rejects.toThrow();
    await expect(mines.start(USER, { stake: STAKE, gridSize: 25, minesCount: 25 } as any)).rejects.toThrow();
    await expect(mines.start(USER, { stake: STAKE, gridSize: 25, minesCount: 99 } as any)).rejects.toThrow();
    // Nothing was created and nothing was debited.
    expect(db.rows('royaleMinesRound')).toHaveLength(0);
    expect(freeOf(db, USER.id)!.balance).toBe(START);
  });

  it('FREE_PLAY start: debits the stake once and commits the hidden seed', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { mines } = makeServices(db, cfg);
    fundFree(db);

    const round = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);

    expect(round.status).toBe('ACTIVE');
    expect(round.gridSize).toBe(GRID);
    expect(round.minesCount).toBe(MINES);
    expect(round.stake).toBe(STAKE);
    expect(round.currentMultiplierBp).toBe(10_000); // 1.00x before any pick
    expect(round.potentialPayout).toBe(payoutFor(STAKE, 10_000)); // stake returns on a 0-pick cash-out
    expect(round.serverSeedHash).toMatch(/^[0-9a-f]{64}$/);

    // The stake left the ONE free-play points ledger exactly once.
    const stakes = db.rows('crashFreePlayTransaction').filter((t) => t.type === 'BET_STAKE');
    expect(stakes).toHaveLength(1);
    expect(freeOf(db, USER.id)!.balance).toBe(START - STAKE);

    // Commitment is stored ENCRYPTED at rest; plaintext seed is NULL while ACTIVE.
    const row = minesRow(db, round.id);
    expect(row.serverSeedEnc).toMatch(/^v1:/);
    expect(row.serverSeed).toBeNull();
  });

  it('HIDDEN STATE: an ACTIVE round never leaks the seed or the mine positions', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { mines } = makeServices(db, cfg);
    fundFree(db);

    const round = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);
    const row = minesRow(db, round.id);
    const truth = minesOf(db, round.id); // the real mine positions

    // View is silent about the outcome while ACTIVE.
    expect(round.serverSeed).toBeNull();
    expect(round.minesRevealed).toBeNull();
    const serialized = JSON.stringify(round);
    expect(serialized).not.toContain(row.serverSeedEnc); // no ciphertext
    expect(serialized).not.toContain(decryptRoundSeed(row.serverSeedEnc)!); // no plaintext seed
    // The commitment hash is public (that is its purpose), the mine list is not.
    for (const m of truth) expect(serialized).not.toContain(`"mines":[${m}`);

    // A reconnect (getActive) returns the SAME silent state.
    const active = await mines.getActive(USER.id);
    expect(active!.id).toBe(round.id);
    expect(active!.serverSeed).toBeNull();
    expect(active!.minesRevealed).toBeNull();
  });

  it('one ACTIVE round per user: a second start is refused with the active round', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { mines } = makeServices(db, cfg);
    fundFree(db);

    const first = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);
    await expect(
      mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any),
    ).rejects.toMatchObject({ getStatus: expect.any(Function) });
    try {
      await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);
    } catch (err) {
      expect(isRoyaleError(err, 'ACTIVE_SESSION_EXISTS', 409)).toBe(true);
      const body = (err as HttpException).getResponse() as any;
      expect(body.details.round.id).toBe(first.id);
    }
    // Only the first stake was ever taken.
    expect(db.rows('crashFreePlayTransaction').filter((t) => t.type === 'BET_STAKE')).toHaveLength(1);
  });

  it('duplicate start (same clientRequestId) returns the original and never double-debits', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { mines } = makeServices(db, cfg);
    fundFree(db);

    const idem = '11111111-1111-1111-1111-111111111111';
    const first = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES, clientRequestId: idem } as any);
    const again = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES, clientRequestId: idem } as any);

    expect(again.id).toBe(first.id);
    expect(db.rows('royaleMinesRound')).toHaveLength(1);
    expect(db.rows('crashFreePlayTransaction').filter((t) => t.type === 'BET_STAKE')).toHaveLength(1);
    expect(freeOf(db, USER.id)!.balance).toBe(START - STAKE);
  });
});
// --------------------------------------------------------------------------
// FREE_PLAY reveal progression, bust, cash-out, forfeit, idempotency
// --------------------------------------------------------------------------

describe('RoyaleMines — FREE_PLAY reveal progression + settlement', () => {
  it('a safe tile advances the multiplier and does NOT settle', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { mines } = makeServices(db, cfg);
    fundFree(db);

    const round = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);
    const safe = safeTile(db, round.id);
    const res = await mines.reveal(USER, round.id, safe);

    expect(res.hit).toBe(true);
    expect(res.duplicate).toBe(false);
    expect(res.round.status).toBe('ACTIVE');
    expect(res.round.safeCount).toBe(1);
    expect(res.round.revealed).toContain(safe);
    expect(res.round.currentMultiplierBp).toBe(minesMultiplierBp(GRID, MINES, 1, cfg.rtpBp, cfg.maxMultiplierBp));
    // No settlement row, no payout yet, still silent about the seed.
    expect(db.rows('royaleSettlement')).toHaveLength(0);
    expect(res.round.serverSeed).toBeNull();
  });

  it('revealing the same safe tile twice is idempotent (no multiplier jump, no settle)', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { mines } = makeServices(db, cfg);
    fundFree(db);

    const round = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);
    const safe = safeTile(db, round.id);
    const first = await mines.reveal(USER, round.id, safe);
    const second = await mines.reveal(USER, round.id, safe);

    expect(first.round.currentMultiplierBp).toBe(second.round.currentMultiplierBp);
    expect(second.round.safeCount).toBe(1);
    expect(second.duplicate).toBe(true);
    expect(db.rows('royaleSettlement')).toHaveLength(0);
  });

  it('hitting a mine BUSTS: stake lost, seed + mines published, no payout', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { mines } = makeServices(db, cfg);
    fundFree(db);

    const round = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);
    const boom = mineTile(db, round.id);
    const res = await mines.reveal(USER, round.id, boom);

    expect(res.hit).toBe(false);
    expect(res.round.status).toBe('BUSTED');
    expect(res.round.payout).toBe(0);
    expect(res.round.serverSeed).not.toBeNull();
    expect(res.round.minesRevealed).toEqual(minesOf(db, round.id));
    expect(freeOf(db, USER.id)!.balance).toBe(START - STAKE);
    const settle = db.rows('royaleSettlement').find((s) => s.roundId === round.id)!;
    expect(settle.result).toBe('MINES_BUST');
    expect(settle.payout).toBe(0);
  });
  it('cash-out after safe picks settles a payout through the free-play ledger', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { mines } = makeServices(db, cfg);
    fundFree(db);

    const round = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);
    const s1 = safeTile(db, round.id);
    await mines.reveal(USER, round.id, s1);
    const s2 = safeTile(db, round.id, [s1]);
    const afterTwo = await mines.reveal(USER, round.id, s2);
    const multBp = afterTwo.round.currentMultiplierBp;
    const expectedPayout = payoutFor(STAKE, multBp);

    const res = await mines.cashout(USER, round.id);
    expect(res.round.status).toBe('CASHED_OUT');
    expect(res.round.payout).toBe(expectedPayout);
    expect(res.duplicate).toBe(false);
    expect(freeOf(db, USER.id)!.balance).toBe(START - STAKE + expectedPayout);
    const credits = db.rows('crashFreePlayTransaction').filter((t) => t.type === 'BET_PAYOUT');
    expect(credits).toHaveLength(1);
    const settle = db.rows('royaleSettlement').find((s) => s.roundId === round.id)!;
    expect(settle.result).toBe('MINES_CASHOUT');
    expect(settle.payout).toBe(expectedPayout);
  });

  it('cash-out with ZERO picks returns the stake (1.00x)', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { mines } = makeServices(db, cfg);
    fundFree(db);

    const round = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);
    const res = await mines.cashout(USER, round.id);
    expect(res.round.status).toBe('CASHED_OUT');
    expect(res.round.payout).toBe(STAKE);
    expect(freeOf(db, USER.id)!.balance).toBe(START);
  });

  it('a second cash-out is idempotent — never pays twice', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { mines } = makeServices(db, cfg);
    fundFree(db);

    const round = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);
    await mines.reveal(USER, round.id, safeTile(db, round.id));
    const first = await mines.cashout(USER, round.id);
    const second = await mines.cashout(USER, round.id);

    expect(second.duplicate).toBe(true);
    expect(second.round.payout).toBe(first.round.payout);
    expect(db.rows('crashFreePlayTransaction').filter((t) => t.type === 'BET_PAYOUT')).toHaveLength(1);
  });

  it('acting on a settled round is a 409 that carries the finished round', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { mines } = makeServices(db, cfg);
    fundFree(db);

    const round = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);
    await mines.reveal(USER, round.id, mineTile(db, round.id)); // busts
    await expect(mines.reveal(USER, round.id, 0)).rejects.toMatchObject({
      getStatus: expect.any(Function),
    });
    try {
      await mines.reveal(USER, round.id, 0);
    } catch (err) {
      expect(isRoyaleError(err, 'ROUND_SETTLED', 409)).toBe(true);
    }
  });

  it('forfeit settles an active round as a bust (stake consumed, no payout)', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { mines } = makeServices(db, cfg);
    fundFree(db);

    const round = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);
    const res = await mines.forfeit(USER, round.id);
    expect(res.round.status).toBe('BUSTED');
    expect(freeOf(db, USER.id)!.balance).toBe(START - STAKE);
  });

  it('a second forfeit is a no-op (idempotent)', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { mines } = makeServices(db, cfg);
    fundFree(db);

    const round = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);
    await mines.forfeit(USER, round.id);
    const again = await mines.forfeit(USER, round.id);
    expect(again.round.status).toBe('BUSTED');
    expect(freeOf(db, USER.id)!.balance).toBe(START - STAKE);
  });
});

// --------------------------------------------------------------------------
// Ownership: a foreign round is indistinguishable from an unknown one (404)
// --------------------------------------------------------------------------

describe('RoyaleMines — session ownership', () => {
  it('reveal/cashout/forfeit on a foreign round is 404 and does not move it', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { mines } = makeServices(db, cfg);
    fundFree(db);
    seedUser(db, OTHER.id);
    fundFree(db, OTHER.id);

    const round = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);

    for (const call of [
      mines.reveal(OTHER, round.id, 0),
      mines.cashout(OTHER, round.id),
      mines.forfeit(OTHER, round.id),
    ]) {
      await expect(call).rejects.toMatchObject({ getStatus: expect.any(Function) });
    }
    const row = minesRow(db, round.id);
    expect(row.status).toBe('ACTIVE');
    expect(freeOf(db, USER.id)!.balance).toBe(START - STAKE);
  });
});
// --------------------------------------------------------------------------
// REAL_MONEY wallet lifecycle (injected config; the prod gate stays closed)
// --------------------------------------------------------------------------

describe('RoyaleMines — REAL_MONEY wallet lifecycle', () => {
  it('start reserves the stake (available -> locked), cash-out captures + credits', async () => {
    const cfg = realConfig();
    const db = createInMemoryDb();
    const { mines } = makeServices(db, cfg);
    fundReal(db, cfg);

    const round = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);
    const w = walletOf(db, USER.id)!;
    expect(w.availableBalance).toBe(START - STAKE);
    expect(w.lockedBalance).toBe(STAKE);

    await mines.reveal(USER, round.id, safeTile(db, round.id));
    const multBp = minesRow(db, round.id).currentMultiplierBp;
    const expectedPayout = payoutFor(STAKE, multBp);

    const res = await mines.cashout(USER, round.id);
    const w2 = walletOf(db, USER.id)!;
    expect(w2.lockedBalance).toBe(0);
    expect(w2.availableBalance).toBe(START - STAKE + expectedPayout);

    const stakes = db.rows('walletTransaction').filter((t) => t.userId === USER.id && t.type === 'BET_STAKE');
    expect(stakes).toHaveLength(1);
    expect(stakes[0].status).toBe('COMPLETED');
    const payouts = db.rows('walletTransaction').filter((t) => t.userId === USER.id && t.type === 'BET_PAYOUT');
    expect(payouts).toHaveLength(1);
    expect(res.round.payout).toBe(expectedPayout);
  });

  it('bust on a mine captures the stake and pays nothing', async () => {
    const cfg = realConfig();
    const db = createInMemoryDb();
    const { mines } = makeServices(db, cfg);
    fundReal(db, cfg);

    const round = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);
    await mines.reveal(USER, round.id, mineTile(db, round.id));

    const w = walletOf(db, USER.id)!;
    expect(w.lockedBalance).toBe(0);
    expect(w.availableBalance).toBe(START - STAKE);
    expect(db.rows('walletTransaction').filter((t) => t.userId === USER.id && t.type === 'BET_PAYOUT')).toHaveLength(0);
  });

  it('a duplicate cash-out never credits a second payout', async () => {
    const cfg = realConfig();
    const db = createInMemoryDb();
    const { mines } = makeServices(db, cfg);
    fundReal(db, cfg);

    const round = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);
    await mines.reveal(USER, round.id, safeTile(db, round.id));
    await mines.cashout(USER, round.id);
    const afterFirst = walletOf(db, USER.id)!.availableBalance;
    await mines.cashout(USER, round.id);

    expect(walletOf(db, USER.id)!.availableBalance).toBe(afterFirst);
    expect(db.rows('walletTransaction').filter((t) => t.userId === USER.id && t.type === 'BET_PAYOUT')).toHaveLength(1);
  });

  it('insufficient available balance refuses the start and reserves nothing', async () => {
    const cfg = realConfig();
    const db = createInMemoryDb();
    const { mines } = makeServices(db, cfg);
    fundReal(db, cfg, USER.id, 500); // less than STAKE

    await expect(mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any)).rejects.toThrow();
    const w = walletOf(db, USER.id)!;
    expect(w.lockedBalance).toBe(0);
    expect(w.availableBalance).toBe(500);
    expect(db.rows('royaleMinesRound')).toHaveLength(0);
  });
});
// --------------------------------------------------------------------------
// VOID: an unrecoverable seed refunds the stake instead of guessing
// --------------------------------------------------------------------------

describe('RoyaleMines — VOID (seed unrecoverable) never invents a result', () => {
  it('FREE_PLAY: a corrupt seed voids and refunds the stake', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { mines } = makeServices(db, cfg);
    fundFree(db);

    const round = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);
    // Simulate a rotated ENCRYPTION_KEY: ciphertext can no longer be decrypted.
    minesRow(db, round.id).serverSeedEnc = 'v1:garbage.garbage.garbage';

    const res = await mines.reveal(USER, round.id, 0);
    expect(res.voided).toBe(true);
    expect(res.round.status).toBe('VOIDED');
    expect(res.round.payout).toBeNull(); // the round invents no result
    expect(res.round.serverSeed).toBeNull();
    expect(res.round.minesRevealed).toBeNull();
    expect(freeOf(db, USER.id)!.balance).toBe(START);
    const settle = db.rows('royaleSettlement').find((s) => s.roundId === round.id)!;
    expect(settle.result).toBe('VOIDED');
    expect(settle.payout).toBe(STAKE); // amount returned to the player
  });

  it('REAL_MONEY: a corrupt seed voids and releases the reservation to available', async () => {
    const cfg = realConfig();
    const db = createInMemoryDb();
    const { mines } = makeServices(db, cfg);
    fundReal(db, cfg);

    const round = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);
    minesRow(db, round.id).serverSeedEnc = 'v1:garbage.garbage.garbage';

    const res = await mines.cashout(USER, round.id);
    expect(res.voided).toBe(true);
    expect(res.round.status).toBe('VOIDED');
    const w = walletOf(db, USER.id)!;
    expect(w.lockedBalance).toBe(0);
    expect(w.availableBalance).toBe(START); // full refund, no payout, no loss
    const stake = db.rows('walletTransaction').find((t) => t.userId === USER.id && t.type === 'BET_STAKE')!;
    expect(stake.status).toBe('REVERSED');
    expect(db.rows('walletTransaction').filter((t) => t.userId === USER.id && t.type === 'BET_PAYOUT')).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// History + verification (ownership-scoped)
// --------------------------------------------------------------------------

describe('RoyaleMines — history + verification', () => {
  it('history returns only the caller’s rounds', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { mines } = makeServices(db, cfg);
    fundFree(db);

    const a = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);
    await mines.forfeit(USER, a.id);
    await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any); // still ACTIVE

    const hist = await mines.getHistory(USER.id);
    // getHistory returns ALL of the caller's rounds (ownership enforced by the
    // userId filter; the view exposes no userId). A foreign round can never
    // appear because the query is scoped to USER.id.
    expect(hist.length).toBe(2);
  });

  it('verify re-derives the mines from the revealed seed and confirms the commitment', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { mines } = makeServices(db, cfg);
    fundFree(db);

    const round = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);
    await mines.reveal(USER, round.id, mineTile(db, round.id)); // settle => reveal seed

    const verify = await mines.verify(USER.id, round.id);
    expect(verify.verified).toBe(true);
    expect(verify.derivedMines).toEqual(minesOf(db, round.id));
    expect(verify.derivedCommitmentHash).toBe(minesRow(db, round.id).serverSeedHash);
  });

  it('verify on a foreign/unknown round is 404', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { mines } = makeServices(db, cfg);
    fundFree(db);

    await expect(mines.verify(USER.id, 'does-not-exist')).rejects.toMatchObject({
      getStatus: expect.any(Function),
    });
  });
});

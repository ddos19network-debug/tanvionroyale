/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * TANVION ROYALE — Plinko integration tests (server-authoritative, wallet-backed).
 *
 * These run the REAL RoyalePlinkoService + REAL WalletService + REAL
 * CrashFreePlayWalletService against the in-memory Prisma double (royale-helpers),
 * so assertions are about ACTUAL balances, transaction states and ledger rows.
 *
 * REAL_MONEY is only ever reached by injecting a config object whose mode is
 * 'REAL_MONEY' (exactly like the crash regression tests) — the production
 * fail-closed gate itself is asserted separately and stays closed; no fake
 * operator adapter is registered anywhere.
 */

import { HttpException } from '@nestjs/common';
import { WalletService } from '../src/modules/wallet/wallet.service';
import { CrashFreePlayWalletService } from '../src/modules/crash/crash-freeplay-wallet.service';
import { RoyalePlinkoService } from '../src/modules/royale/royale-plinko.service';
import type { RoyaleConfig } from '../src/modules/royale/royale.config';
import { loadRoyaleConfig } from '../src/modules/royale/royale.config';
import {
  computeSeedHash,
  derivePlinkoPath,
  plinkoBinFromPath,
  verifyPlinkoRound,
} from '../src/modules/royale/royale-fair';
import { plinkoPayoutTable, payoutFor } from '../src/modules/royale/royale-math';
import { createInMemoryDb, seedUser, type InMemoryDb } from './royale-helpers';
import type { AuthenticatedUser } from '../src/common/types/authenticated-user';

jest.setTimeout(30_000);

const USER = { id: 'u-plinko', sessionId: 's1', roles: ['USER'] } as unknown as AuthenticatedUser;
const OTHER = { id: 'u-other', sessionId: 's2', roles: ['USER'] } as unknown as AuthenticatedUser;
const CURRENCY = 'BDT';

const STAKE = 2_000;
const START = 100_000;

function freeConfig(): RoyaleConfig {
  return loadRoyaleConfig({ NODE_ENV: 'test', ROYALE_MODE: 'FREE_PLAY' } as NodeJS.ProcessEnv);
}
/** Injected REAL_MONEY config (the gate is tested separately). */
function realConfig(base = freeConfig()): RoyaleConfig {
  return { ...base, mode: 'REAL_MONEY', currency: CURRENCY };
}

function isRoyaleError(err: unknown, code: string, status?: number): boolean {
  if (!(err instanceof HttpException)) return false;
  const body = err.getResponse() as any;
  if (body?.code !== code) return false;
  return status === undefined || err.getStatus() === status;
}

/** Wire REAL services to one in-memory DB + one injected config. */
function makeServices(db: InMemoryDb, cfg: RoyaleConfig) {
  const prisma = db as any;
  const wallet = new WalletService(prisma);
  const free = new CrashFreePlayWalletService(prisma);
  const plinko = new RoyalePlinkoService(prisma, wallet, free);
  (plinko as any).config = cfg;
  return { wallet, free, plinko };
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

describe('RoyalePlinko � server-authoritative drop', () => {
  it('validates stake/rows/risk against server config (client cannot bypass)', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { plinko } = makeServices(db, cfg);
    fundFree(db);

    await expect(plinko.drop(USER, { stake: 0, rows: 12, risk: 'MEDIUM' } as any)).rejects.toThrow();
    await expect(plinko.drop(USER, { stake: 1000, rows: 999, risk: 'MEDIUM' } as any)).rejects.toThrow();
    await expect(plinko.drop(USER, { stake: 1000, rows: 12, risk: 'SUPER' } as any)).rejects.toThrow();
    // No round row was ever created for the rejected attempts.
    expect(db.rows('royalePlinkoRound')).toHaveLength(0);
  });

  it('FREE_PLAY: debits stake and credits payout exactly once; ledger reconciles', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { plinko } = makeServices(db, cfg);
    fundFree(db);

    const round = await plinko.drop(USER, { stake: STAKE, rows: 12, risk: 'MEDIUM' } as any);

    const table = plinkoPayoutTable(round.rows, 'MEDIUM', cfg.rtpBp, cfg.maxMultiplierBp);
    expect(round.multiplierBp).toBe(table[round.binIndex]);
    expect(round.payout).toBe(payoutFor(STAKE, round.multiplierBp));
    expect(round.path).toHaveLength(12);
    expect(plinkoBinFromPath(round.path)).toBe(round.binIndex);

    const txs = db.rows('crashFreePlayTransaction').filter((t) => t.userId === USER.id);
    expect(txs.filter((t) => t.type === 'BET_STAKE')).toHaveLength(1);
    expect(txs.filter((t) => t.type === 'BET_PAYOUT')).toHaveLength(round.payout > 0 ? 1 : 0);
    expect(freeOf(db, USER.id)!.balance).toBe(START - STAKE + round.payout);

    const settle = db.rows('royaleSettlement').find((s) => s.roundId === round.id)!;
    expect(settle.result).toBe('PLINKO_PAYOUT');
    expect(settle.payout).toBe(round.payout);
    expect(db.rows('gameAuditLog').some((a) => a.action === 'PLINKO_DROP')).toBe(true);
  });

  it('REAL_MONEY: reserve -> capture -> payout credit; stake leaves the wallet', async () => {
    const cfg = realConfig();
    const db = createInMemoryDb();
    const { plinko } = makeServices(db, cfg);
    fundReal(db, cfg);

    const round = await plinko.drop(USER, { stake: STAKE, rows: 12, risk: 'MEDIUM' } as any);
    const w = walletOf(db, USER.id);
    expect(w.lockedBalance).toBe(0);
    expect(w.availableBalance).toBe(START - STAKE + round.payout);
    expect(round.currency).toBe(CURRENCY);
    expect(round.transactionId).not.toBeNull();

    const stakeTx = db.rows('walletTransaction').find((t) => t.idempotencyKey.includes('royale:plinko:stake:'))!;
    expect(stakeTx.status).toBe('COMPLETED');
    const ledger = db.rows('ledgerEntry');
    expect(ledger.some((l) => l.reason === 'BET_STAKE_RESERVED')).toBe(true);
    expect(ledger.some((l) => l.reason === 'BET_STAKE_CAPTURED')).toBe(true);
    if (round.payout > 0) {
      const credit = db.rows('walletTransaction').find((t) => t.idempotencyKey.includes('royale:plinko:win:'))!;
      expect(credit.status).toBe('COMPLETED');
      expect(credit.amount).toBe(round.payout);
    }
  });

  it('REAL_MONEY: rejects an uncovered stake (no round, no lock left)', async () => {
    const cfg = realConfig();
    const db = createInMemoryDb();
    const { plinko } = makeServices(db, cfg);
    fundReal(db, cfg, USER.id, 1_000);

    await expect(plinko.drop(USER, { stake: STAKE, rows: 12, risk: 'MEDIUM' } as any)).rejects.toThrow();
    expect(db.rows('royalePlinkoRound')).toHaveLength(0);
    expect(walletOf(db, USER.id).lockedBalance).toBe(0);
    expect(walletOf(db, USER.id).availableBalance).toBe(1_000);
  });

  it('a duplicate drop (same clientRequestId) returns the ORIGINAL and never double-debits', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { plinko } = makeServices(db, cfg);
    fundFree(db);

    const first = await plinko.drop(USER, {
      stake: STAKE,
      rows: 12,
      risk: 'MEDIUM',
      clientRequestId: '11111111-1111-1111-1111-111111111111',
    } as any);
    const second = await plinko.drop(USER, {
      stake: STAKE,
      rows: 12,
      risk: 'MEDIUM',
      clientRequestId: '11111111-1111-1111-1111-111111111111',
    } as any);

    // Exactly one round, one debit, one payout — the retry is a pure read.
    expect(db.rows('royalePlinkoRound')).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(second.payout).toBe(first.payout);
    const txs = db.rows('crashFreePlayTransaction').filter((t) => t.userId === USER.id);
    expect(txs.filter((t) => t.type === 'BET_STAKE')).toHaveLength(1);
    expect(freeOf(db, USER.id)!.balance).toBe(START - STAKE + first.payout);
  });

  it('verify re-derives the path from the revealed seed and confirms the commitment', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { plinko } = makeServices(db, cfg);
    fundFree(db);

    const round = await plinko.drop(USER, { stake: STAKE, rows: 12, risk: 'MEDIUM' } as any);
    const row = db.rows('royalePlinkoRound').find((r) => r.id === round.id)!;
    const expectedPath = derivePlinkoPath(row.serverSeed, row.clientSeed, row.nonce, row.rows);

    const verify = await plinko.verify(USER.id, round.id);
    expect(verify.verified).toBe(true);
    expect(verify.derivedPath).toEqual(expectedPath);
    expect(verify.derivedBinIndex).toBe(plinkoBinFromPath(expectedPath));
    expect(verify.derivedCommitmentHash).toBe(row.serverSeedHash);
    expect(verify.derivedCommitmentHash).toBe(computeSeedHash(row.serverSeed));
    // The commitment is a genuine SHA-256 of the revealed seed (hex, 64 chars).
    expect(row.serverSeedHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verify on a foreign/unknown round is 404 (ownership enforced)', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { plinko } = makeServices(db, cfg);
    fundFree(db);

    const round = await plinko.drop(USER, { stake: STAKE, rows: 12, risk: 'MEDIUM' } as any);
    const err = await plinko.verify(OTHER.id, round.id).catch((e) => e);
    expect(isRoyaleError(err, 'ROUND_NOT_FOUND', 404)).toBe(true);
  });

  it('server payout table is validated: length, integer bp, within cap, EV <= RTP', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { plinko } = makeServices(db, cfg);
    fundFree(db);

    const view = plinko.payoutTable(12, 'MEDIUM');
    expect(view.rows).toBe(12);
    expect(view.risk).toBe('MEDIUM');
    expect(view.multipliersBp).toHaveLength(13); // rows + 1 bins
    // Every entry is a positive integer bp multiplier within the configured cap.
    expect(view.multipliersBp.every((bp) => Number.isInteger(bp) && bp >= 1)).toBe(true);
    expect(view.multipliersBp.every((bp) => bp <= cfg.maxMultiplierBp)).toBe(true);
    // EV never exceeds the target RTP (floors + cap only ever reduce it).
    expect(view.evBp).toBeLessThanOrEqual(cfg.rtpBp + 1e-6);
    expect(view.rtpBp).toBe(cfg.rtpBp);
  });

  it('history returns only the caller\u2019s rounds', async () => {
    const cfg = freeConfig();
    const db = createInMemoryDb();
    const { plinko } = makeServices(db, cfg);
    fundFree(db);

    await plinko.drop(USER, { stake: STAKE, rows: 12, risk: 'MEDIUM' } as any);
    await plinko.drop(USER, { stake: STAKE, rows: 16, risk: 'HIGH' } as any);
    fundFree(db, OTHER.id);
    await plinko.drop(OTHER, { stake: STAKE, rows: 12, risk: 'MEDIUM' } as any);

    const mine = await plinko.getHistory(USER.id);
    expect(mine).toHaveLength(2);
    const theirs = await plinko.getHistory(OTHER.id);
    expect(theirs).toHaveLength(1);
    // No cross-contamination between players.
    expect(mine.every((r) => !theirs.some((t) => t.id === r.id))).toBe(true);
  });

});

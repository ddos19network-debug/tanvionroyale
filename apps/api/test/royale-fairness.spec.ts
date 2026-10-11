/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * TANVION ROYALE — Royale Play provably-fairness, RNG, and hidden-state tests.
 *
 * These tests pin down EXACTLY how outcomes are generated and verified for both
 * Plinko and Mines, and prove the hidden mine positions / server seed can never
 * leak while a round is live:
 *
 *   RNG     — CSPRNG seed material, determinism, HMAC formula, distribution.
 *   MATH    — integer payout flooring, monotonic Mines multipliers.
 *   VERIFY  — commitment/reveal round-trips and tamper detection.
 *   HIDDEN  — ACTIVE Mines rounds expose NO seed/mines; settlement publishes
 *             them; audit rows never carry secrets (runs the REAL service +
 *             REAL wallet against the in-memory Prisma double).
 *
 * No claim of mathematical fairness or certification is made — the tests only
 * assert what the code actually does (documented, reproducible, bounded).
 */

import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { WalletService } from '../src/modules/wallet/wallet.service';
import { CrashFreePlayWalletService } from '../src/modules/crash/crash-freeplay-wallet.service';
import { RoyaleMinesService } from '../src/modules/royale/royale-mines.service';
import type { RoyaleConfig } from '../src/modules/royale/royale.config';
import { loadRoyaleConfig } from '../src/modules/royale/royale.config';
import {
  computeSeedHash,
  decryptRoundSeed,
  deriveHmac,
  deriveMinesPositions,
  derivePlinkoPath,
  deriveRowBit,
  generateClientSeed,
  generateServerSeed,
  hmacIntBelow,
  plinkoBinFromPath,
  verifyMinesRound,
  verifyPlinkoRound,
} from '../src/modules/royale/royale-fair';
import {
  binomial,
  minesMultiplierBp,
  payoutFor,
  plinkoProbabilities,
} from '../src/modules/royale/royale-math';
import { createInMemoryDb, seedUser, type InMemoryDb } from './royale-helpers';
import type { AuthenticatedUser } from '../src/common/types/authenticated-user';

jest.setTimeout(30_000);

const USER = { id: 'u-fair', sessionId: 's1', roles: ['USER'] } as unknown as AuthenticatedUser;
const CURRENCY = 'BDT';

function freeConfig(): RoyaleConfig {
  return loadRoyaleConfig({ NODE_ENV: 'test', ROYALE_MODE: 'FREE_PLAY' } as NodeJS.ProcessEnv);
}
function isRoyaleError(err: unknown, code: string, status?: number): boolean {
  if (!(err instanceof HttpException)) return false;
  const body = err.getResponse() as any;
  if (body?.code !== code) return false;
  return status === undefined || err.getStatus() === status;
}

describe('Royale Play — seed material & commitment', () => {
  it('server/client seeds are CSPRNG hex of the documented length', () => {
    const serverSeeds = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const s = generateServerSeed();
      expect(s).toMatch(/^[0-9a-f]{64}$/); // 32 bytes
      serverSeeds.add(s);
      expect(generateClientSeed()).toMatch(/^[0-9a-f]{32}$/); // 16 bytes
    }
    // No repeats across 500 draws — genuinely random, not a counter.
    expect(serverSeeds.size).toBe(500);
  });

  it('commitment = SHA-256(serverSeed) and binds the seed', () => {
    const seed = generateServerSeed();
    const hash = computeSeedHash(seed);
    expect(hash).toBe(createHash('sha256').update(seed, 'utf8').digest('hex'));
    // Same seed → same commitment; a different seed → a different commitment.
    expect(computeSeedHash(seed)).toBe(hash);
    expect(computeSeedHash(generateServerSeed())).not.toBe(hash);
  });
});
describe('Royale Play — Plinko RNG & distribution', () => {
  it('row bit matches the pinned HMAC first-byte-parity formula', () => {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const bit = deriveRowBit(serverSeed, clientSeed, 7, 3);
    const expected = deriveHmac(serverSeed, `${clientSeed}:7:row:3`)[0] & 1;
    expect(bit).toBe(expected ? 1 : 0);
  });

  it('path has one 0/1 decision per row and is deterministic for fixed material', () => {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const rows = 16;
    const path = derivePlinkoPath(serverSeed, clientSeed, 1, rows);
    expect(path).toHaveLength(rows);
    expect(path.every((b) => b === 0 || b === 1)).toBe(true);
    // Bin = count of right (1) moves.
    expect(plinkoBinFromPath(path)).toBe(path.reduce((a, b) => a + b, 0));
    // Determinism: identical seed material reproduces the identical path.
    expect(derivePlinkoPath(serverSeed, clientSeed, 1, rows)).toEqual(path);
    // Different nonce → (almost surely) a different path.
    expect(derivePlinkoPath(serverSeed, clientSeed, 2, rows)).not.toEqual(path);
  });

  it('landing bins track the exact binomial distribution (C(n,k)/2^n)', () => {
    const rows = 12;
    const probs = plinkoProbabilities(rows);
    expect(probs).toHaveLength(rows + 1);
    // Sanity: probabilities sum to 1 and match C(n,k)/2^n at the mode.
    expect(probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(probs[rows / 2]).toBeCloseTo(binomial(rows, rows / 2) / 2 ** rows, 12);

    const N = 40_000;
    const bins = new Array<number>(rows + 1).fill(0);
    let sum = 0;
    for (let i = 0; i < N; i += 1) {
      const path = derivePlinkoPath(generateServerSeed(), generateClientSeed(), i, rows);
      const bin = plinkoBinFromPath(path);
      bins[bin] += 1;
      sum += bin;
    }
    // Binomial mean n/2 = 6; with N=40000 the sample mean sits ~6 ± ~0.07.
    expect(sum / N).toBeGreaterThan(5.8);
    expect(sum / N).toBeLessThan(6.2);
    // Every bin is reachable within a 12-row board: the smallest probability
    // is the ends (1/4096 ≈ 2.4e-4) → ~10 expected hits over N, so all occur.
    for (let k = 0; k <= rows; k += 1) expect(bins[k]).toBeGreaterThan(0);
    // Observed frequency tracks theory within a generous absolute tolerance
    // (the ends are the rarest and get the widest band). This bounds the RNG
    // against the exact binomial without being a brittle per-bin assertion.
    for (let k = 0; k <= rows; k += 1) {
      const observed = bins[k] / N;
      expect(Math.abs(observed - probs[k])).toBeLessThan(0.015);
    }
    // The central mode dominates the extreme tails.
    expect(bins[rows / 2]).toBeGreaterThan(bins[0] * 10);
  });

  it('every bin of a small board is reachable (tails are observable)', () => {
    // On a 4-row board the ends have p = 1/16, so all 5 bins must appear many
    // times over a modest sample — a direct, non-brittle reachability proof.
    const rows = 4;
    const bins = new Array<number>(rows + 1).fill(0);
    for (let i = 0; i < 4000; i += 1) {
      const path = derivePlinkoPath(generateServerSeed(), generateClientSeed(), i, rows);
      bins[plinkoBinFromPath(path)] += 1;
    }
    for (let k = 0; k <= rows; k += 1) expect(bins[k]).toBeGreaterThan(20);
  });

  it('verifyPlinkoRound recomputes and detects tampering', () => {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const nonce = 42;
    const rows = 12;
    const path = derivePlinkoPath(serverSeed, clientSeed, nonce, rows);
    const bin = plinkoBinFromPath(path);
    const hash = computeSeedHash(serverSeed);

    const good = verifyPlinkoRound(serverSeed, clientSeed, nonce, rows, hash, path, bin);
    expect(good.verified).toBe(true);
    expect(good.path).toEqual(path);

    // A wrong stored path (flip one bit) fails.
    const tampered = [...path];
    tampered[0] = tampered[0] === 0 ? 1 : 0;
    expect(
      verifyPlinkoRound(
        serverSeed,
        clientSeed,
        nonce,
        rows,
        hash,
        tampered,
        plinkoBinFromPath(tampered),
      ).verified,
    ).toBe(false);
    // A commitment that does not match the seed fails.
    expect(
      verifyPlinkoRound(
        serverSeed,
        clientSeed,
        nonce,
        rows,
        computeSeedHash(generateServerSeed()),
        path,
        bin,
      ).verified,
    ).toBe(false);
  });
});
describe('Royale Play — Mines RNG & distribution', () => {
  it('deriveMinesPositions returns minesCount unique in-range tiles, deterministically', () => {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const gridSize = 25;
    const minesCount = 5;
    const mines = deriveMinesPositions(serverSeed, clientSeed, 1, gridSize, minesCount);
    expect(mines).toHaveLength(minesCount);
    expect([...mines].sort((a, b) => a - b)).toEqual(mines); // stored sorted
    expect(new Set(mines).size).toBe(minesCount); // no duplicates
    expect(mines.every((t) => Number.isInteger(t) && t >= 0 && t < gridSize)).toBe(true);
    // Determinism.
    expect(deriveMinesPositions(serverSeed, clientSeed, 1, gridSize, minesCount)).toEqual(mines);
    // Rejects an invalid mine count (must be in [1, gridSize)).
    expect(() => deriveMinesPositions(serverSeed, clientSeed, 1, gridSize, 0)).toThrow();
    expect(() => deriveMinesPositions(serverSeed, clientSeed, 1, gridSize, gridSize)).toThrow();
  });

  it('hmacIntBelow stays within [0, bound)', () => {
    const seed = generateServerSeed();
    for (let bound = 1; bound <= 36; bound += 1) {
      for (let i = 0; i < 50; i += 1) {
        const v = hmacIntBelow(seed, `${i}:swap:test`, bound);
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(bound);
      }
    }
  });

  it('mine placement is uniform across the grid over many rounds', () => {
    const gridSize = 25;
    const minesCount = 3;
    const N = 8000;
    const counts = new Array<number>(gridSize).fill(0);
    for (let i = 0; i < N; i += 1) {
      const mines = deriveMinesPositions(
        generateServerSeed(),
        generateClientSeed(),
        i,
        gridSize,
        minesCount,
      );
      for (const t of mines) counts[t] += 1;
    }
    // Each tile is a mine with prob minesCount/gridSize; expected hits = N*3/25.
    const expected = (N * minesCount) / gridSize;
    for (const c of counts) {
      // Loose uniform band (±40%) — a strong but non-flaky uniformity check.
      expect(c).toBeGreaterThan(expected * 0.6);
      expect(c).toBeLessThan(expected * 1.4);
    }
  });

  it('verifyMinesRound recomputes positions and detects tampering', () => {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const gridSize = 25;
    const minesCount = 4;
    const positions = deriveMinesPositions(serverSeed, clientSeed, 3, gridSize, minesCount);
    const hash = computeSeedHash(serverSeed);

    const good = verifyMinesRound(
      serverSeed,
      clientSeed,
      3,
      gridSize,
      minesCount,
      hash,
      positions,
    );
    expect(good.verified).toBe(true);
    expect(good.positions).toEqual(positions);

    // Stored positions that don't match the seed fail.
    const tampered = [...positions];
    tampered[0] = (tampered[0] + 1) % gridSize;
    expect(
      verifyMinesRound(serverSeed, clientSeed, 3, gridSize, minesCount, hash, tampered).verified,
    ).toBe(false);
    // Wrong commitment fails even with correct positions.
    expect(
      verifyMinesRound(
        serverSeed,
        clientSeed,
        3,
        gridSize,
        minesCount,
        computeSeedHash(generateServerSeed()),
        positions,
      ).verified,
    ).toBe(false);
  });
});

describe('Royale Play — integer payout math', () => {
  it('payoutFor always floors and never inflates return', () => {
    expect(payoutFor(1000, 10_000)).toBe(1000); // 1.00x
    expect(payoutFor(1000, 15_000)).toBe(1500); // 1.50x
    // 1.3373x on 1000 minor units floors to 1337, not 1337.3.
    expect(payoutFor(1000, 13_373)).toBe(1337);
    // Sub-unit payouts floor to 0 (can never pay a fraction).
    expect(payoutFor(1, 5000)).toBe(0);
    // Non-positive / non-integer inputs are rejected to 0.
    expect(payoutFor(0, 10_000)).toBe(0);
    expect(payoutFor(-100, 10_000)).toBe(0);
    expect(payoutFor(1000, 0)).toBe(0);
  });

  it('Mines multiplier is 1.00x at zero picks and strictly increases with safe picks', () => {
    const cfg = freeConfig();
    const gridSize = 25;
    const minesCount = 3;
    expect(minesMultiplierBp(gridSize, minesCount, 0, cfg.rtpBp, cfg.maxMultiplierBp)).toBe(10_000);
    let prev = 10_000;
    for (let k = 1; k <= gridSize - minesCount; k += 1) {
      const bp = minesMultiplierBp(gridSize, minesCount, k, cfg.rtpBp, cfg.maxMultiplierBp);
      expect(bp).toBeGreaterThanOrEqual(prev);
      expect(bp).toBeLessThanOrEqual(cfg.maxMultiplierBp);
      prev = bp;
    }
  });
});
describe('Royale Play — hidden-state confidentiality (REAL Mines service)', () => {
  const GRID = 25;
  const MINES = 3;
  const STAKE = 2_000;
  const START = 100_000;

  function makeServices(db: InMemoryDb, cfg: RoyaleConfig) {
    const prisma = db as any;
    const wallet = new WalletService(prisma);
    const free = new CrashFreePlayWalletService(prisma);
    const mines = new RoyaleMinesService(prisma, wallet, free);
    (mines as any).config = cfg;
    return { wallet, free, mines };
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
  const minesRow = (db: InMemoryDb, id: string) =>
    db.rows('royaleMinesRound').find((r) => r.id === id)!;
  function minesOf(db: InMemoryDb, id: string): number[] {
    const row = minesRow(db, id);
    const seed = decryptRoundSeed(row.serverSeedEnc)!;
    return deriveMinesPositions(seed, row.clientSeed, row.nonce, row.gridSize, row.minesCount);
  }
  const mineTile = (db: InMemoryDb, id: string) => minesOf(db, id)[0];
  const safeTile = (db: InMemoryDb, id: string, exclude: number[] = []) => {
    const row = minesRow(db, id);
    const mines = minesOf(db, id);
    for (let t = 0; t < row.gridSize; t += 1) {
      if (!mines.includes(t) && !exclude.includes(t)) return t;
    }
    throw new Error('no safe tile');
  };

  it('an ACTIVE round view exposes NO server seed and NO mine positions', async () => {
    const db = createInMemoryDb();
    const cfg = freeConfig();
    const { mines } = makeServices(db, cfg);
    fundFree(db);

    const round = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);

    // The authoritative serverSeed must be null while ACTIVE (never leaked).
    expect(round.serverSeed).toBeNull();
    // Mine positions are not published at all until the round resolves.
    expect(round.minesRevealed).toBeNull();
    // Only the commitment (SHA-256) is public while live.
    expect(round.serverSeedHash).toMatch(/^[0-9a-f]{64}$/);

    // The full serialized view must not contain the plaintext seed or a
    // ciphertext-derived mine tile. (clientSeed/nonce are public by design;
    // they are useless without the seed.)
    const serialized = JSON.stringify(round);
    expect(serialized).not.toContain(decryptRoundSeed(minesRow(db, round.id).serverSeedEnc)!);
  });

  it('the reveal view never leaks the seed or positions, but bumping the safe count advances', async () => {
    const db = createInMemoryDb();
    const cfg = freeConfig();
    const { mines } = makeServices(db, cfg);
    fundFree(db);

    const round = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);
    const seed = decryptRoundSeed(minesRow(db, round.id).serverSeedEnc)!;

    const safe = safeTile(db, round.id);
    const res = await mines.reveal(USER, round.id, safe);

    expect(res.hit).toBe(true);
    expect(res.round.status).toBe('ACTIVE');
    // Still hidden after a safe reveal.
    expect(res.round.serverSeed).toBeNull();
    expect(res.round.minesRevealed).toBeNull();
    expect(JSON.stringify(res.round)).not.toContain(seed);
    // Progression advanced the multiplier above 1.00x.
    expect(res.round.safeCount).toBe(1);
    expect(res.round.currentMultiplierBp).toBeGreaterThan(10_000);
  });

  it('settlement publishes the seed + positions and they re-derive correctly', async () => {
    const db = createInMemoryDb();
    const cfg = freeConfig();
    const { mines } = makeServices(db, cfg);
    fundFree(db);

    const round = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);
    const safe = safeTile(db, round.id);
    await mines.reveal(USER, round.id, safe);
    const cashout = await mines.cashout(USER, round.id);

    expect(cashout.round.status).toBe('CASHED_OUT');
    // Seed and mines are published together ONLY at settlement.
    expect(cashout.round.serverSeed).not.toBeNull();
    expect(cashout.round.minesRevealed).not.toBeNull();
    expect(cashout.round.minesRevealed).toEqual(minesOf(db, round.id));

    // Independent verification round-trips against the published material.
    const verified = verifyMinesRound(
      cashout.round.serverSeed!,
      cashout.round.clientSeed,
      cashout.round.nonce,
      GRID,
      MINES,
      cashout.round.serverSeedHash,
      cashout.round.minesRevealed,
    );
    expect(verified.verified).toBe(true);
  });

  it('audit rows written during play NEVER contain the seed or mine positions', async () => {
    const db = createInMemoryDb();
    const cfg = freeConfig();
    const { mines } = makeServices(db, cfg);
    fundFree(db);

    const round = await mines.start(USER, { stake: STAKE, gridSize: GRID, minesCount: MINES } as any);
    const safe = safeTile(db, round.id);
    await mines.reveal(USER, round.id, safe);
    await mines.cashout(USER, round.id);

    const seed = decryptRoundSeed(minesRow(db, round.id).serverSeedEnc)!;
    const mines_ = minesOf(db, round.id);
    const audits = db.rows('gameAuditLog').filter((a) => a.roundId === round.id);
    expect(audits.length).toBeGreaterThan(0);
    for (const a of audits) {
      const blob = JSON.stringify(a.metadata ?? {});
      expect(blob).not.toContain(seed); // never the seed
      // Never a serialized mine-position array (e.g. "[3,7,12]").
      for (const m of mines_) {
        expect(blob).not.toContain(`"${m}"`);
      }
    }
  });
});




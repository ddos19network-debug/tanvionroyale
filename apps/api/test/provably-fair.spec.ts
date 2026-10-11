/**
 * Unit tests for the provably-fair randomness core (CSPRNG + HMAC commit/reveal).
 */

import { createHmac } from 'node:crypto';
import {
  computeSeedHash,
  crashFromHash,
  deriveCrashMultiplier,
  deriveRoundHash,
  generateClientSeed,
  generateServerSeed,
} from '../src/modules/crash/provably-fair';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

describe('provably-fair', () => {
  it('generates CSPRNG seeds of the documented lengths', () => {
    const server = generateServerSeed();
    const client = generateClientSeed();
    expect(server).toMatch(/^[0-9a-f]{64}$/);
    expect(client).toMatch(/^[0-9a-f]{32}$/);
    expect(server).not.toBe(generateServerSeed());
  });

  it('commits with SHA-256 before revealing', () => {
    const seed = generateServerSeed();
    const hash = computeSeedHash(seed);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(computeSeedHash(seed)).toBe(hash);
    expect(computeSeedHash(`${seed}x`)).not.toBe(hash);
  });

  it('derives the round hash with the documented HMAC-SHA256 formula', () => {
    const serverSeed = 'aa'.repeat(32);
    const clientSeed = 'bb'.repeat(16);
    const nonce = 7;
    const expected = createHmac('sha256', serverSeed)
      .update(`${clientSeed}:${nonce}`, 'utf8')
      .digest('hex');
    expect(deriveRoundHash(serverSeed, clientSeed, nonce)).toBe(expected);
  });

  it('is deterministic for identical seed material', () => {
    const s = '11'.repeat(32);
    const c = '22'.repeat(16);
    expect(deriveCrashMultiplier(s, c, 1)).toBe(deriveCrashMultiplier(s, c, 1));
  });

  it('changes with the seed or nonce', () => {
    const s = '11'.repeat(32);
    const c = '22'.repeat(16);
    const outcomes = new Set<number>([
      deriveCrashMultiplier(s, c, 1),
      deriveCrashMultiplier(s, c, 2),
      deriveCrashMultiplier(s, c, 3),
      deriveCrashMultiplier('99'.repeat(32), c, 1),
    ]);
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it('never returns below 1.00x and respects the practical cap', () => {
    for (let i = 0; i < 500; i += 1) {
      const m = deriveCrashMultiplier(generateServerSeed(), generateClientSeed(), i + 1);
      expect(m).toBeGreaterThanOrEqual(1.0);
      expect(m).toBeLessThanOrEqual(10_000);
      expect(Number.isFinite(m)).toBe(true);
    }
  });

  it('maps the documented formula 0.99/(1-r) deterministically from a digest', () => {
    const hash = 'ab'.repeat(32);
    const bytes = Buffer.from(hash, 'hex');
    const mask = (1n << 52n) - 1n;
    const r = Number(bytes.readBigUInt64BE(0) & mask) / Number(1n << 52n);
    const raw = 0.99 / (1 - r);
    const expected = raw >= 1 ? round2(Math.min(10_000, raw)) : crashFromHash(hash);
    expect(crashFromHash(hash)).toBe(expected);
  });
});

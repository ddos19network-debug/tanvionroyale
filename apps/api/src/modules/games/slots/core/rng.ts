/**
 * RNG abstraction for the shared slot core.
 *
 * Production: CryptoRng (node:crypto randomInt — no Math.random ever).
 * Simulation/tests: SeededRng (splitmix64 — fast, deterministic, same distribution).
 */

import { randomInt } from 'node:crypto';

/** Uniform integer in [0, bound) with no modulo bias. */
export interface Rng {
  int(bound: number): number;
}

/** Production RNG — uses node:crypto. Never Math.random(). */
export class CryptoRng implements Rng {
  int(bound: number): number {
    if (!Number.isInteger(bound) || bound <= 0) {
      throw new Error(`CryptoRng.int: bound must be a positive integer, got ${String(bound)}`);
    }
    if (bound === 1) return 0;
    return randomInt(0, bound);
  }
}

/** Fast seeded PRNG (splitmix64). Simulation / tests ONLY — never real money. */
export class SeededRng implements Rng {
  private state: bigint;

  constructor(seed: string | bigint | number) {
    if (typeof seed === 'bigint') {
      this.state = seed;
    } else if (typeof seed === 'number') {
      this.state = BigInt(Math.trunc(seed));
    } else {
      this.state = SeededRng.hashString(seed);
    }
    if (this.state === 0n) this.state = 0x9e3779b97f4a7c15n;
  }

  private static hashString(s: string): bigint {
    let h = 0xcbf29ce484222325n;
    for (let i = 0; i < s.length; i++) {
      h ^= BigInt(s.charCodeAt(i));
      h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    return h;
  }

  private next64(): bigint {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
    return z ^ (z >> 31n);
  }

  /** Uniform in [0, bound) via rejection sampling — no modulo bias. */
  int(bound: number): number {
    if (!Number.isInteger(bound) || bound <= 0) {
      throw new Error(`SeededRng.int: bound must be a positive integer, got ${String(bound)}`);
    }
    if (bound === 1) return 0;
    const limit = Number(BigInt.asUintN(48, 0xffffffffffffn));
    const zone = Math.floor(limit / bound) * bound;
    for (;;) {
      const candidate = Number(BigInt.asUintN(48, this.next64() >> 16n));
      if (candidate < zone) return candidate % bound;
    }
  }
}

/** Pick a weighted entry from an array using the given RNG. */
export function weightedPick<T extends { weight: number }>(rng: Rng, entries: readonly T[]): T {
  if (entries.length === 0) throw new Error('weightedPick: empty array');
  let total = 0;
  for (const e of entries) total += e.weight;
  if (total <= 0) throw new Error('weightedPick: total weight must be > 0');
  const r = rng.int(total);
  let running = 0;
  for (const e of entries) {
    running += e.weight;
    if (r < running) return e;
  }
  return entries[entries.length - 1];
}

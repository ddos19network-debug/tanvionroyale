/**
 * Unit tests for the crash multiplier mathematics (server-authoritative clock).
 */

import {
  cashoutMultiplierAt,
  cashoutPayout,
  crashDurationMs,
  multiplierAt,
  round2,
  MIN_MULTIPLIER,
} from '../src/modules/crash/crash-math';

const timing = { startAtMs: 1_000, crashAtMs: 11_000, crashMultiplier: 4.0 };

describe('crash-math', () => {
  it('starts at 1.00x before the round begins', () => {
    expect(multiplierAt(timing, timing.startAtMs - 500)).toBe(1.0);
    expect(multiplierAt(timing, timing.startAtMs)).toBe(1.0);
  });

  it('is strictly non-decreasing while running and bounded by the crash point', () => {
    let prev = MIN_MULTIPLIER;
    for (let t = timing.startAtMs; t <= timing.crashAtMs; t += 100) {
      const m = multiplierAt(timing, t);
      expect(m).toBeGreaterThanOrEqual(prev);
      expect(m).toBeLessThanOrEqual(timing.crashMultiplier);
      prev = m;
    }
  });

  it('reaches exactly the crash point at crashAt and never exceeds it', () => {
    expect(multiplierAt(timing, timing.crashAtMs)).toBe(4.0);
    expect(multiplierAt(timing, timing.crashAtMs + 60_000)).toBe(4.0);
  });

  it('is monotonic in the crash point for a fixed elapsed fraction', () => {
    const half = (timing.startAtMs + timing.crashAtMs) / 2;
    const low = multiplierAt({ ...timing, crashMultiplier: 2 }, half);
    const high = multiplierAt({ ...timing, crashMultiplier: 8 }, half);
    expect(high).toBeGreaterThan(low);
  });

  it('rounds to 2dp', () => {
    expect(round2(1.005)).toBe(1.0);
    expect(round2(2.675)).toBe(2.68);
  });

  it('floors the cash-out multiplier so the server never overpays', () => {
    const t = timing.startAtMs + 0.55 * (timing.crashAtMs - timing.startAtMs);
    expect(cashoutMultiplierAt(timing, t)).toBeLessThanOrEqual(multiplierAt(timing, t));
  });

  it('pays stake × accepted multiplier, floored to integer minor units', () => {
    expect(cashoutPayout(100, 2.0)).toBe(200);
    expect(cashoutPayout(333, 1.99)).toBe(662);
  });

  it('scales round duration logarithmically with the crash point', () => {
    const fast = crashDurationMs(1.01);
    const mid = crashDurationMs(2);
    const slow = crashDurationMs(100);
    expect(fast).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(fast);
    expect(slow).toBeGreaterThan(mid);
  });
});

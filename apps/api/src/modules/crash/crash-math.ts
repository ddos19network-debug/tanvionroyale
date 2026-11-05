/**
 * TANVION ROYALE crash multiplier mathematics.
 *
 * The server controls every clock value. The multiplier is a pure function of
 * the persisted round timestamps and the pre-determined crash point:
 *
 *   multiplier(now) = crashPoint ^ (elapsed / elapsedToCrash)   (exponential)
 *
 * so the displayed multiplier approaches the crash point asymptotically and
 * equals it exactly at `crashAt`. The frontend may interpolate BETWEEN the
 * server's authoritative snapshots for smoothness, but the server always
 * computes the value the cash-out is accepted at.
 */

export const MIN_MULTIPLIER = 1.0;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * How long a round with this crash point runs (ms) before it crashes.
 * Calibrated to official Aviator pacing (steady, suspenseful, realistic flight).
 *   - 1.50x takes ~7.6s
 *   - 2.00x takes ~9.5s
 *   - 5.00x takes ~15.5s
 *   - 10.0x takes ~20.0s
 */
export function crashDurationMs(
  crashMultiplier: number,
  baseMs = 1000,
  perDecadeMs = 16500,
): number {
  const safe = Math.max(MIN_MULTIPLIER, crashMultiplier);
  return baseMs + Math.log10(safe) * perDecadeMs;
}

export interface CrashTimingInput {
  startAtMs: number;
  crashAtMs: number;
  crashMultiplier: number;
}

/**
 * Authoritative current multiplier (2dp). Server-only — the caller decides
 * when it is safe to use `nowMs` (the server's own clock, never the client).
 */
export function multiplierAt(input: CrashTimingInput, nowMs: number): number {
  const { startAtMs, crashAtMs, crashMultiplier } = input;
  const elapsed = nowMs - startAtMs;
  const total = crashAtMs - startAtMs;
  if (total <= 0) return round2(crashMultiplier);
  if (elapsed <= 0) return MIN_MULTIPLIER;
  const ratio = Math.min(1, elapsed / total);
  if (ratio >= 1) return round2(crashMultiplier);
  // Pacing: r^1.65 ensures 1x -> 2x -> 5x climbs slowly, calmly, and smoothly
  // (taking ~55% of the round), and then accelerates rapidly from 5x to 100x+ as time progresses.
  const curvedRatio = Math.pow(ratio, 1.65);
  return round2(Math.pow(crashMultiplier, curvedRatio));
}

/**
 * The multiplier a cash-out is settled at: the authoritative multiplier
 * floored to 2dp, so the server NEVER pays more than it displays.
 */
export function cashoutMultiplierAt(input: CrashTimingInput, nowMs: number): number {
  const m = multiplierAt(input, nowMs);
  return Math.floor(m * 100) / 100;
}

/** Integer payout in the same minor-unit/points scale as the stake. */
export function cashoutPayout(stake: number, acceptedMultiplier: number): number {
  return Math.floor(stake * acceptedMultiplier);
}
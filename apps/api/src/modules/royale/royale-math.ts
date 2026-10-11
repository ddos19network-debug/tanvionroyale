/**
 * TANVION ROYALE — Royale Play payout mathematics (Plinko + Mines).
 *
 * ALL money math is integer: stakes/payouts are minor units, multipliers are
 * BASIS POINTS (bp) where 10000 bp = 1.00x. Payouts ALWAYS floor:
 *
 *   payout = floor(stake * multiplierBp / 10000)
 *
 * Flooring can only pay out LESS than the exact product, so rounding never
 * inflates the return-to-player (RTP). Every table/multiplier is additionally
 * clamped to `maxMultiplierBp` (also only ever reduces payouts).
 *
 * ----------------------------------------------------------------------------
 * PLINKO TABLE (rows n, risk skew a, target RTP r, cap c):
 *   p_k  = C(n,k) / 2^n                    (exact landing probabilities)
 *   S    = sum_k p_k^(1-a)                 (note: for a=1, S = n+1 exactly)
 *   f    = (r/10000) / S                   (normalizer so pre-rounding EV = r)
 *   bp_k = min(c, floor(10000 * f * p_k^(-a)))
 *   EV(bp) = sum_k p_k * bp_k / 10000 <= r/10000   (floors + cap only reduce)
 * Risk skew: LOW a=0.8 (flatter, center pays more), MEDIUM a=1.0 (binomial-
 * fair shape), HIGH a=1.25 (edges pay more, center pays less).
 *
 * ----------------------------------------------------------------------------
 * MINES (grid g, mines m, safe picks k, target RTP r):
 *   P(survive k) = prod_{i=0..k-1} (g-m-i)/(g-i)
 *   multiplier    = r * 1/P(survive k) = (r/10000) * prod (g-i)/(g-m-i)
 *   bp_k = min(c, floor( r * A / B )),  A = prod_{i<k}(g-i), B = prod_{i<k}(g-m-i)
 * (computed with BigInt — exact, no float drift). k=0 cash-out is defined as
 * exactly 1.00x (10000 bp): the stake returns untouched when no tile is picked.
 * The sequence is strictly increasing in k, and EV of cashing out after k
 * safe picks equals r/10000 before flooring (flooring only reduces it).
 */

export const BASIS_POINTS = 10_000;

export type PlinkoRisk = 'LOW' | 'MEDIUM' | 'HIGH';

/** Risk skew exponent `a` (see module docs). */
export const RISK_SKEW: Record<PlinkoRisk, number> = {
  LOW: 0.8,
  MEDIUM: 1.0,
  HIGH: 1.25,
};

/** Exact binomial coefficient C(n, k) — n <= 32 stays well inside 2^53. */
export function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= kk; i += 1) {
    result = (result * (n - kk + i)) / i;
  }
  return Math.round(result);
}

/** Exact landing probabilities p_k = C(n,k)/2^n for a board with `rows` rows. */
export function plinkoProbabilities(rows: number): number[] {
  const total = 2 ** rows;
  const out: number[] = [];
  for (let k = 0; k <= rows; k += 1) out.push(binomial(rows, k) / total);
  return out;
}

/**
 * The validated payout table (bp per bin, length rows+1) for a board config.
 * Every entry is an integer bp multiplier in (0, maxBp].
 */
export function plinkoPayoutTable(
  rows: number,
  risk: PlinkoRisk,
  rtpBp: number,
  maxBp: number,
): number[] {
  const probs = plinkoProbabilities(rows);
  const a = RISK_SKEW[risk];
  let normalizer = 0;
  for (const p of probs) normalizer += p ** (1 - a);
  const f = rtpBp / normalizer; // bp scale: EV target is rtpBp (pre-floor)
  return probs.map((p) => {
    const raw = f * p ** -a;
    return Math.max(1, Math.min(maxBp, Math.floor(raw)));
  });
}

/** Achieved EV of a table, in bp (float): sum_k p_k * bp_k. */
export function plinkoTableEvBp(rows: number, table: readonly number[]): number {
  const probs = plinkoProbabilities(rows);
  let ev = 0;
  for (let k = 0; k < probs.length; k += 1) ev += probs[k] * (table[k] ?? 0);
  return ev;
}

/**
 * Mines multiplier in bp after `safeCount` safe picks (exact BigInt math).
 * k=0 returns exactly 10000 bp (1.00x) by definition — see module docs.
 */
export function minesMultiplierBp(
  gridSize: number,
  minesCount: number,
  safeCount: number,
  rtpBp: number,
  maxBp: number,
): number {
  if (safeCount < 0 || safeCount > gridSize - minesCount) {
    throw new Error('safeCount out of range for this grid');
  }
  if (safeCount === 0) return BASIS_POINTS;
  let a = 1n;
  let b = 1n;
  for (let i = 0; i < safeCount; i += 1) {
    a *= BigInt(gridSize - i);
    b *= BigInt(gridSize - minesCount - i);
  }
  if (b === 0n) throw new Error('invalid mines configuration');
  const exact = (BigInt(rtpBp) * a) / b; // floor — never overpays
  const capped = exact > BigInt(maxBp) ? BigInt(maxBp) : exact;
  const value = Number(capped);
  return value < 1 ? 1 : value;
}

/** Integer payout for a stake at a bp multiplier — ALWAYS floors. */
export function payoutFor(stake: number, multiplierBp: number): number {
  if (!Number.isInteger(stake) || stake <= 0) return 0;
  if (!Number.isInteger(multiplierBp) || multiplierBp <= 0) return 0;
  return Math.floor((stake * multiplierBp) / BASIS_POINTS);
}

// ---------------------------------------------------------------------------
// Server-side validation (board config, row count, payout table, mines grid,
// stakes). Everything returns a normalized value or throws a plain Error the
// service converts into a structured Royale error.
// ---------------------------------------------------------------------------

export function validateStake(stake: number, minStake: number, maxStake: number): number {
  if (!Number.isInteger(stake) || stake < minStake || stake > maxStake) {
    throw new Error(
      `Stake must be an integer between ${minStake} and ${maxStake} (minor units)`,
    );
  }
  return stake;
}

export function validatePlinkoRows(rows: number, minRows: number, maxRows: number): number {
  if (!Number.isInteger(rows) || rows < minRows || rows > maxRows) {
    throw new Error(`Rows must be an integer between ${minRows} and ${maxRows}`);
  }
  return rows;
}

export function validatePlinkoRisk(risk: string): PlinkoRisk {
  if (risk !== 'LOW' && risk !== 'MEDIUM' && risk !== 'HIGH') {
    throw new Error('Risk must be one of LOW, MEDIUM, HIGH');
  }
  return risk;
}

export interface MinesBoardConfig {
  gridSize: number;
  minesCount: number;
}

export function validateMinesBoard(
  gridSize: number,
  minesCount: number,
  allowedGrids: readonly number[],
  minMines: number,
  maxMines: number,
): MinesBoardConfig {
  if (!allowedGrids.includes(gridSize)) {
    throw new Error(`Grid size must be one of: ${allowedGrids.join(', ')}`);
  }
  const effectiveMax = Math.min(maxMines, gridSize - 1); // always >= 1 safe tile
  if (!Number.isInteger(minesCount) || minesCount < minMines || minesCount > effectiveMax) {
    throw new Error(`Mines must be an integer between ${minMines} and ${effectiveMax}`);
  }
  return { gridSize, minesCount };
}

/** A payout-table sanity verdict used by config endpoints and tests. */
export interface TableCheck {
  valid: boolean;
  evBp: number;
  rtpBp: number;
  maxEntryBp: number;
  reason: string;
}

export function checkPlinkoTable(
  rows: number,
  table: readonly number[],
  rtpBp: number,
  maxBp: number,
): TableCheck {
  const evBp = plinkoTableEvBp(rows, table);
  const maxEntryBp = table.reduce((m, v) => Math.max(m, v), 0);
  if (table.length !== rows + 1) {
    return { valid: false, evBp, rtpBp, maxEntryBp, reason: 'table length mismatch' };
  }
  if (table.some((v) => !Number.isInteger(v) || v < 1)) {
    return { valid: false, evBp, rtpBp, maxEntryBp, reason: 'non-positive entry' };
  }
  if (maxEntryBp > maxBp) {
    return { valid: false, evBp, rtpBp, maxEntryBp, reason: 'entry exceeds cap' };
  }
  if (evBp > rtpBp + 1e-6) {
    return { valid: false, evBp, rtpBp, maxEntryBp, reason: 'EV exceeds target RTP' };
  }
  return { valid: true, evBp, rtpBp, maxEntryBp, reason: 'ok' };
}

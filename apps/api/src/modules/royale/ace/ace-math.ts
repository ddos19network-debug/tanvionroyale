/**
 * TANVION ROYALE â€” "Royale Ace" (royale-ace) game mathematics (PURE, no I/O).
 *
 * 5 reels x 4 rows, 1024 ways to win (left-to-right, adjacent reels, same
 * symbol; WILD substitutes for every paying symbol but never for SCATTER).
 * Winning symbols are removed, survivors drop down and new symbols fall in
 * from above; the cascade repeats until nothing wins, and each consecutive
 * cascade raises the multiplier along a configurable ladder.
 *
 * Everything here is a deterministic function of
 *   (config, AceRandomSource)
 * so the very same round can be re-derived from the revealed seeds by
 * `verifyAceSpin` (see ace-fair.ts) â€” the client never decides anything.
 *
 * Money conventions (identical to royale-math.ts):
 *   - payouts are integer MINOR UNITS, multipliers are BASIS POINTS (10000 bp
 *     = 1.00x) and every payout FLOORS, so rounding can only ever reduce the
 *     return-to-player.
 */

import { BASIS_POINTS } from '../royale-math';
import {
  ACE_PAY_SYMBOLS,
  ACE_REELS,
  ACE_ROWS,
  type AceBaseSymbol,
  type AceGameConfig,
  type AcePaySymbol,
  type AceStripEntry,
} from './ace-config';

// ---------------------------------------------------------------------------
// Randomness source â€” the ONLY place random numbers enter the game logic
// ---------------------------------------------------------------------------

/**
 * Game logic depends ONLY on this interface, so a certified external RNG can be
 * swapped in (required by several regulators / test labs, which do not accept
 * an HMAC provably-fair stream alone for slots) without touching a single line
 * of game math. Implementations:
 *   - `HmacRandomStream`   (ace-fair.ts) â€” provably-fair HMAC-SHA256 stream
 *   - `SeededRandomStream` (ace-sim.ts)  â€” fast seeded CSPRNG, simulation only
 */
export interface AceRandomSource {
  /**
   * Uniform integer in [0, bound) with NO modulo bias (rejection sampling).
   * `bound` must be a positive integer.
   */
  nextIntBelow(bound: number): number;
  /** Weighted draw from a reel strip. */
  pickFromStrip(strip: readonly AceStripEntry[]): AceStripEntry;
}

// ---------------------------------------------------------------------------
// Grid model
// ---------------------------------------------------------------------------

/** One reel position. `golden` marks the GOLDEN card variant. */
export interface AceCell {
  symbol: AceBaseSymbol;
  golden: boolean;
}

/** A reel/row coordinate â€” reel 0..4 left to right, row 0..3 top to bottom. */
export interface AceCellRef {
  reel: number;
  row: number;
}

/** The visible 5x4 grid: `grid[reel][row]`. */
export type AceGrid = AceCell[][];

export const WILD_CELL: AceCell = { symbol: 'WILD', golden: false };

export function emptyGrid(): AceGrid {
  return Array.from({ length: ACE_REELS }, () => Array.from({ length: ACE_ROWS }, () => WILD_CELL));
}

export function cloneGrid(grid: AceGrid): AceGrid {
  return grid.map((column) => column.map((cell) => ({ symbol: cell.symbol, golden: cell.golden })));
}

/** Stable string key for a cell reference. */
export function cellKey(ref: AceCellRef): string {
  return `${ref.reel}:${ref.row}`;
}

/** `true` when the cell matches `symbol` (a WILD matches every paying symbol). */
export function cellMatches(cell: AceCell, symbol: AcePaySymbol): boolean {
  return cell.symbol === symbol || cell.symbol === 'WILD';
}

// ---------------------------------------------------------------------------
// Ways-to-win evaluation
// ---------------------------------------------------------------------------

export interface AceWinGroup {
  symbol: AcePaySymbol;
  /** How many consecutive reels (from reel 0) the run covers â€” 3, 4 or 5. */
  runLength: number;
  /** Number of ways (product of the matching cells on each reel of the run). */
  ways: number;
  /** Every cell that takes part in this win (also used for cascade removal). */
  cells: AceCellRef[];
  /** Payout for this group in bp of stake, BEFORE the cascade multiplier. */
  payBp: number;
}

/**
 * 1024-ways evaluation. A symbol must appear (or be substituted by a WILD) on
 * reel 0 and on every consecutive reel up to the run length. Only runs of 3+
 * reels pay. Several symbols can win simultaneously (WILDs are shared).
 */
export function evaluateWays(grid: AceGrid, config: AceGameConfig): AceWinGroup[] {
  const groups: AceWinGroup[] = [];
  // A short/ragged grid can only come from a bug or a tampered payload: never
  // pay for rows that do not exist.
  const rowsIn = (reel: number): number => grid[reel]?.length ?? 0;
  for (const symbol of ACE_PAY_SYMBOLS) {
    const counts: number[] = [];
    for (let reel = 0; reel < ACE_REELS; reel += 1) {
      let count = 0;
      for (let row = 0; row < Math.min(ACE_ROWS, rowsIn(reel)); row += 1) {
        if (cellMatches(grid[reel][row], symbol)) count += 1;
      }
      counts.push(count);
    }
    if (counts[0] === 0) continue; // a ways run must start on reel 0
    let runLength = 0;
    while (runLength < ACE_REELS && counts[runLength] > 0) runLength += 1;
    if (runLength < 3) continue;

    let ways = 1;
    const cells: AceCellRef[] = [];
    for (let reel = 0; reel < runLength; reel += 1) {
      ways *= counts[reel];
      for (let row = 0; row < ACE_ROWS; row += 1) {
        if (cellMatches(grid[reel][row], symbol)) cells.push({ reel, row });
      }
    }
    // Defensive: a config that skipped validation must never pay out of bounds.
    const perWayBp = config.paytableBp[symbol]?.[runLength] ?? 0;
    groups.push({
      symbol,
      runLength,
      ways,
      cells,
      payBp: ways * perWayBp,
    });
  }
  return groups;
}

/** Total bp of stake won by a set of groups (before the cascade multiplier). */
export function winGroupsPayBp(groups: readonly AceWinGroup[]): number {
  return groups.reduce((sum, group) => sum + group.payBp, 0);
}

/** Every distinct cell taking part in any winning combination. */
export function winningCells(groups: readonly AceWinGroup[]): AceCellRef[] {
  const seen = new Map<string, AceCellRef>();
  for (const group of groups) {
    for (const ref of group.cells) seen.set(cellKey(ref), ref);
  }
  return [...seen.values()].sort((a, b) => a.reel - b.reel || a.row - b.row);
}

/**
 * GOLDEN cells that took part in a win. They are removed with the rest of the
 * winning symbols and re-enter the grid as WILDs on the next cascade.
 */
export function goldenWinningCells(
  grid: AceGrid,
  groups: readonly AceWinGroup[],
  config: AceGameConfig,
): AceCellRef[] {
  if (!config.goldenToWild) return [];
  const winners = new Set(winningCells(groups).map(cellKey));
  const golden: AceCellRef[] = [];
  for (const key of winners) {
    const parts = key.split(':');
    const reel = Number.parseInt(parts[0], 10);
    const row = Number.parseInt(parts[1], 10);
    if (grid[reel][row].golden) golden.push({ reel, row });
  }
  return golden.sort((a, b) => a.reel - b.reel || a.row - b.row);
}

/** SCATTER count anywhere on the grid (WILD never substitutes for SCATTER). */
export function countScatters(grid: AceGrid): number {
  let count = 0;
  for (let reel = 0; reel < ACE_REELS; reel += 1) {
    for (let row = 0; row < ACE_ROWS; row += 1) {
      if (grid[reel][row].symbol === 'SCATTER') count += 1;
    }
  }
  return count;
}

/** Ladder multiplier in bp for a 1-based cascade step (last entry repeats). */
export function ladderMultiplierBp(ladder: readonly number[], cascadeStep: number): number {
  const index = Math.min(Math.max(cascadeStep, 1), ladder.length) - 1;
  return ladder[index];
}

/** Whole-group scatter pay in bp of stake (last table entry repeats). */
export function scatterPayBp(config: AceGameConfig, scatterCount: number): number {
  const table = config.scatterPayBp;
  if (scatterCount < 3 || table.length === 0) return 0;
  const index = Math.min(scatterCount, table.length - 1);
  return table[index];
}

/** Free spins awarded for a scatter count (0 when the count does not trigger). */
export function freeSpinsAwarded(config: AceGameConfig, scatterCount: number): number {
  if (scatterCount < 3) return 0;
  const table = config.freeSpins.awardByScatterCount;
  if (table.length <= 3) return 0;
  const index = Math.min(scatterCount, table.length - 1);
  return table[index];
}

/** Convert a bp multiplier + stake into an integer payout (ALWAYS floors). */
export function payoutForBp(stake: number, multiplierBp: number): number {
  if (!Number.isInteger(stake) || stake <= 0) return 0;
  if (!Number.isInteger(multiplierBp) || multiplierBp <= 0) return 0;
  return Math.floor((stake * multiplierBp) / BASIS_POINTS);
}

export { BASIS_POINTS };

// ---------------------------------------------------------------------------
// Cascade engine â€” the server generates the ENTIRE spin result up front
// ---------------------------------------------------------------------------

/** One cascade step of a spin (or of a free spin). */
export interface AceCascadeStep {
  /** 1-based cascade index inside this spin (1 = the initial drop). */
  index: number;
  /** Grid BEFORE this step's wins were removed (what the client animates). */
  grid: AceGrid;
  /** Winning combinations found on `grid`. */
  wins: AceWinGroup[];
  /** Cells removed after this step (sorted by reel, then row). */
  removed: AceCellRef[];
  /**
   * GOLDEN cards that were part of a win on this step and therefore become
   * WILDs on the NEXT step (empty when `goldenToWild` is off).
   */
  goldenToWild: AceCellRef[];
  /** Cascade multiplier applied to this step's way wins, in bp. */
  multiplierBp: number;
  /** Pay for this step in bp of stake (way wins x multiplier + scatter pay). */
  payBp: number;
  /** Way-win pay only, in bp of stake (before the multiplier). */
  wayPayBp: number;
  /** Scatter pay only, in bp of stake (never multiplied by the ladder). */
  scatterPayBp: number;
  /** Scatters visible on this step's grid. */
  scatterCount: number;
  /** TRUE on the very first step of a spin that lands 3+ scatters. */
  scatterTriggered: boolean;
}

/** One complete spin: base game OR one free spin (identical structure). */
export interface AceSpinResult {
  /** Ordered cascade steps, at least one (the initial drop). */
  steps: AceCascadeStep[];
  /** Total win of this spin in bp of stake (all cascade steps combined). */
  totalPayBp: number;
  /** Highest cascade multiplier reached, in bp. */
  maxMultiplierBp: number;
  /** Number of WINNING cascade drops (0 = a completely dead spin). */
  cascadeDepth: number;
  /** Total number of grid drops the engine evaluated (winners + final loser). */
  dropCount: number;
  /** Scatters on the initial drop of this spin. */
  scatterCount: number;
  /** Free spins awarded by this spin's initial drop (0 for most spins). */
  freeSpinsAwarded: number;
}

/** Summary of a whole round (base spin + every free spin). */
export interface AceRoundResult {
  /** The base-game spin (always exactly one). */
  baseSpin: AceSpinResult;
  /** Every free spin played, in order. */
  freeSpins: AceSpinResult[];
  /** Total win in bp of stake across the whole round. */
  totalPayBp: number;
  /** Highest cascade multiplier reached anywhere in the round, in bp. */
  maxMultiplierBp: number;
  /** Total number of free spins played (may exceed the award after retriggers). */
  freeSpinsPlayed: number;
  /** TRUE when at least one retrigger happened. */
  retriggered: boolean;
  /** TRUE when the per-round win cap clipped the win. */
  capped: boolean;
}

/** Draw a fresh random cell from a reel strip. */
export function drawCell(random: AceRandomSource, reel: number, config: AceGameConfig): AceCell {
  const entry = random.pickFromStrip(config.strips[reel]);
  return { symbol: entry.symbol, golden: entry.golden };
}

/** Draw a complete fresh grid (reel by reel, top row to bottom row). */
export function drawGrid(random: AceRandomSource, config: AceGameConfig): AceGrid {
  const grid: AceGrid = [];
  for (let reel = 0; reel < ACE_REELS; reel += 1) {
    const column: AceCell[] = [];
    for (let row = 0; row < ACE_ROWS; row += 1) column.push(drawCell(random, reel, config));
    grid.push(column);
  }
  return grid;
}

/**
 * Play ONE complete spin (base game or a free spin) and return every cascade
 * step. The result is a pure function of (random, config, ladder) â€” calling it
 * twice with the same stream produces byte-identical output, which is exactly
 * what the verifier asserts.
 *
 * `ladder` is `config.baseLadderBp` for the base game and
 * `config.freeSpinLadderBp` inside the feature.
 */
export function playSpin(
  random: AceRandomSource,
  config: AceGameConfig,
  ladder: readonly number[],
): AceSpinResult {
  let grid = drawGrid(random, config);
  const steps: AceCascadeStep[] = [];
  let totalPayBp = 0;
  let maxMultiplierBp = 0;
  let winningDrops = 0;
  let scatterCount = 0;
  let awarded = 0;

  for (let index = 1; index <= config.maxCascadeStepsPerSpin; index += 1) {
    const multiplierBp = ladderMultiplierBp(ladder, index);
    const wins = evaluateWays(grid, config);
    const scatters = countScatters(grid);
    const wayPayBp = winGroupsPayBp(wins);
    // Scatter pay is only awarded on the initial drop of a spin and is NEVER
    // multiplied by the cascade ladder.
    const scatterPay = index === 1 ? scatterPayBp(config, scatters) : 0;
    const ladderedBp = Math.floor((wayPayBp * multiplierBp) / BASIS_POINTS);
    const payBp = ladderedBp + scatterPay;
    const removed = winningCells(wins);
    const golden = goldenWinningCells(grid, wins, config);

    steps.push({
      index,
      grid: cloneGrid(grid),
      wins,
      removed,
      goldenToWild: golden,
      multiplierBp,
      payBp,
      wayPayBp,
      scatterPayBp: scatterPay,
      scatterCount: scatters,
      scatterTriggered: index === 1 && scatters >= 3,
    });

    totalPayBp += payBp;
    maxMultiplierBp = Math.max(maxMultiplierBp, multiplierBp);
    if (removed.length > 0) winningDrops += 1;

    if (index === 1) {
      scatterCount = scatters;
      awarded = freeSpinsAwarded(config, scatters);
    }

    if (removed.length === 0) break; // nothing left to cascade
    // GOLDEN winners come back as WILDs in the very cells they occupied.
    grid = applyCascade(random, grid, removed, golden, config);
  }

  return {
    steps,
    totalPayBp,
    maxMultiplierBp,
    cascadeDepth: winningDrops,
    dropCount: steps.length,
    scatterCount,
    freeSpinsAwarded: awarded,
  };
}

/**
 * Play a FULL round: one base spin, then the awarded free spins, then any
 * retriggers, all bounded by `freeSpins.maxSpinsPerRound`.
 *
 * Free spins are part of the SAME round: the stake is debited once and the
 * total (capped) win is credited once at settlement.
 */
export function playRound(
  random: AceRandomSource,
  config: AceGameConfig,
  maxWinBp: number,
): AceRoundResult {
  const baseSpin = playSpin(random, config, config.baseLadderBp);
  const freeSpins: AceSpinResult[] = [];

  let remaining = baseSpin.freeSpinsAwarded;
  let totalPayBp = baseSpin.totalPayBp;
  let maxMultiplierBp = baseSpin.maxMultiplierBp;
  let retriggered = false;

  // Free spins are a queue, so a retrigger mid-feature extends the queue.
  for (let played = 0; remaining > 0 && played < config.freeSpins.maxSpinsPerRound; played += 1) {
    remaining -= 1;
    const spin = playSpin(random, config, config.freeSpinLadderBp);
    freeSpins.push(spin);
    totalPayBp += spin.totalPayBp;
    maxMultiplierBp = Math.max(maxMultiplierBp, spin.maxMultiplierBp);
    if (spin.freeSpinsAwarded > 0) {
      if (config.freeSpins.retriggerUsesAwardTable) remaining += spin.freeSpinsAwarded;
      retriggered = true;
    }
  }

  const capped = totalPayBp > maxWinBp;
  if (capped) totalPayBp = maxWinBp;

  return {
    baseSpin,
    freeSpins,
    totalPayBp,
    maxMultiplierBp,
    freeSpinsPlayed: freeSpins.length,
    retriggered,
    capped,
  };
}

/**
 * Apply one cascade: remove `removed` cells, drop survivors down, refill from
 * the top and turn every `goldenRefill` position into a WILD.
 *
 * Refill order is deterministic and documented (it is what the verifier
 * re-derives): per reel, survivors are packed to the BOTTOM in their previous
 * top-to-bottom order, and new cells fill the freed rows from the TOP down.
 */
export function applyCascade(
  random: AceRandomSource,
  grid: AceGrid,
  removed: readonly AceCellRef[],
  goldenRefill: readonly AceCellRef[],
  config: AceGameConfig,
): AceGrid {
  const removedKeys = new Set(removed.map(cellKey));
  const wildKeys = new Set(goldenRefill.map(cellKey));
  const next: AceGrid = [];
  for (let reel = 0; reel < ACE_REELS; reel += 1) {
    const survivors: AceCell[] = [];
    for (let row = 0; row < ACE_ROWS; row += 1) {
      if (!removedKeys.has(`${reel}:${row}`)) {
        survivors.push({ symbol: grid[reel][row].symbol, golden: grid[reel][row].golden });
      }
    }
    const column: AceCell[] = [];
    const missing = ACE_ROWS - survivors.length;
    for (let row = 0; row < missing; row += 1) {
      column.push(
        wildKeys.has(`${reel}:${row}`) ? { ...WILD_CELL } : drawCell(random, reel, config),
      );
    }
    for (const cell of survivors) column.push(cell);
    next.push(column);
  }
  return next;
}


// ---------------------------------------------------------------------------
// Strip statistics (used by the simulator / tuning helper)
// ---------------------------------------------------------------------------

/** Per-reel symbol weights for reporting and tuning. */
export interface AceStripStats {
  reel: number;
  totalWeight: number;
  symbolWeight: Record<AceBaseSymbol, number>;
  goldenWeight: Record<AcePaySymbol, number>;
  wildWeight: number;
  scatterWeight: number;
}

const ZERO_SYMBOL_WEIGHTS = (): Record<AceBaseSymbol, number> => ({
  SPADE: 0, HEART: 0, DIAMOND: 0, CLUB: 0, J: 0, Q: 0, K: 0, A: 0, WILD: 0, SCATTER: 0,
});

const ZERO_GOLDEN_WEIGHTS = (): Record<AcePaySymbol, number> => ({
  SPADE: 0, HEART: 0, DIAMOND: 0, CLUB: 0, J: 0, Q: 0, K: 0, A: 0,
});

export function stripStats(reel: number, strip: readonly AceStripEntry[]): AceStripStats {
  const symbolWeight = ZERO_SYMBOL_WEIGHTS();
  const goldenWeight = ZERO_GOLDEN_WEIGHTS();
  let totalWeight = 0;
  let wildWeight = 0;
  let scatterWeight = 0;
  for (const entry of strip) {
    totalWeight += entry.weight;
    symbolWeight[entry.symbol] += entry.weight;
    if (entry.symbol === 'WILD') wildWeight += entry.weight;
    if (entry.symbol === 'SCATTER') scatterWeight += entry.weight;
    if (entry.golden && entry.symbol !== 'WILD' && entry.symbol !== 'SCATTER') {
      goldenWeight[entry.symbol] += entry.weight;
    }
  }
  return { reel, totalWeight, symbolWeight, goldenWeight, wildWeight, scatterWeight };
}

/**
 * Scale every non-scatter, non-wild entry of a reel strip by `factor` (min 1)
 * so the tuning helper can retune base-game hit frequency without touching
 * WILD / SCATTER / GOLDEN weights.
 */
export function scaleStrip(
  strip: readonly AceStripEntry[],
  factor: number,
): AceStripEntry[] {
  return strip.map((entry) => {
    if (entry.golden || entry.symbol === 'WILD' || entry.symbol === 'SCATTER') return { ...entry };
    return { ...entry, weight: Math.max(1, Math.round(entry.weight * factor)) };
  });
}



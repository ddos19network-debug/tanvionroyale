/**
 * Core slot types — shared by all 10 Royale Play games.
 *
 * Grid orientation: grid[row][col], row 0 at top, col 0 at left.
 * Payouts: integer basis points of the total stake (10000 bp = 1× stake).
 */

import type { SlotSymbolId, SlotWinLine, SlotCascadeStep, SlotFreeSpinsResult } from '@tanvion-royale/types';
export type { SlotSymbolId };

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

export type Grid = SlotSymbolId[][];

export function emptyGrid(rows: number, cols: number, fill: SlotSymbolId = ''): Grid {
  return Array.from({ length: rows }, () => Array(cols).fill(fill));
}

export function cloneGrid(g: Grid): Grid {
  return g.map((row) => [...row]);
}

// ---------------------------------------------------------------------------
// Symbol strip entry
// ---------------------------------------------------------------------------

export interface StripEntry {
  symbolId: SlotSymbolId;
  weight: number;
}

// ---------------------------------------------------------------------------
// Win structures (re-export from types with internal helpers)
// ---------------------------------------------------------------------------

export type { SlotWinLine as WinLine, SlotCascadeStep as CascadeStep, SlotFreeSpinsResult as FreeSpinsResult };

// ---------------------------------------------------------------------------
// Round result — the whole round returned in one response
// ---------------------------------------------------------------------------

export interface RoundResult {
  baseGrid: Grid;
  baseSteps: SlotCascadeStep[];
  freeSpins: SlotFreeSpinsResult;
  /** Uncapped total win across base + free spins, in bp of stake. */
  totalPayBpUncapped: number;
  /** Capped total win (≤ maxWinBp). */
  totalPayBp: number;
  capped: boolean;
  /** Payout = floor(stake * totalPayBp / 10_000). */
  payout: number;
  /** Feature-specific round-level metadata (meter states, etc.) */
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Game configuration interface
// ---------------------------------------------------------------------------

/** Win model for a game. */
export type WinModel = 'paylines' | 'ways' | 'cluster';

export interface PaylineDefinition {
  /** Array of row indexes per reel (length === reels). */
  rows: number[];
}

export interface SymbolDef {
  id: SlotSymbolId;
  name: string;
  tier: 'high' | 'low' | 'wild' | 'scatter' | 'bonus';
  glyph: string;
  asset?: string;
}

export interface FreeSpinConfig {
  triggerSymbol: SlotSymbolId;
  triggerCount: number;
  awarded: number;
  retriggerCount: number;
  retriggerAwarded: number;
  maxSpinsPerRound: number;
}

/** Config for one slot game. */
export interface SlotGameConfig {
  slug: string;
  title: string;
  version: number;
  winModel: WinModel;
  reels: number;
  rows: number;
  symbols: SymbolDef[];
  wildId: SlotSymbolId;
  scatterId: SlotSymbolId;
  /** Payline definitions (paylines mode only). */
  paylines?: PaylineDefinition[];
  /** Minimum cluster size (cluster mode only). */
  minClusterSize?: number;
  /**
   * Paytable: symbolId → payBp array indexed by count (index 0 unused).
   * For paylines: pay per line in bp of total stake (auto-divided by lineCount).
   * For ways: pay per way-combination in bp.
   * For cluster: pay per cluster-size bucket.
   */
  paytableBp: Record<SlotSymbolId, number[]>;
  /** Reel strips: one per reel [base game, free-spin override?]. */
  strips: StripEntry[][];
  /** Free-spin strips (optional — same as base if omitted). */
  freeSpinStrips?: StripEntry[][];
  /** Cascade multiplier ladder (bp, 1-indexed, last repeats). */
  baseLadderBp: number[];
  /** Free-spin cascade multiplier ladder. */
  freeSpinLadderBp: number[];
  freeSpins: FreeSpinConfig;
  /** Hard per-round win cap in bp. */
  maxWinBp: number;
  /** Allowed stake levels (integer points). */
  stakeLevels: number[];
  maxCascadeStepsPerSpin: number;
  /** Feature flags. */
  features: Record<string, boolean>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BASIS_POINTS = 10_000;
export const STAKE_LEVELS = [10, 20, 50, 100, 200, 500, 1000] as const;

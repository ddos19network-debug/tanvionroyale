/**
 * round.ts — derive a COMPLETE round (base + cascades + free spins) up-front.
 *
 * This pure function is the heart of the shared slot core. It is called once
 * per spin, produces a fully-deterministic result from the RNG, and returns
 * everything the client needs to animate the round. The same function is used
 * by the production server and the simulation CLI.
 *
 * Games with custom signature features (Pharaoh expanding wild, Neon respin,
 * Steampunk meter, etc.) pass a `GameHooks` object that intercepts specific
 * points in the derivation. Games that don't need hooks pass `{}`.
 */

import type { Rng } from './rng';
import { drawGrid, stripsFor } from './reel-strips';
import { ladderMultiplierBp, applyCascade, countSymbol } from './cascade';
import { evaluatePaylines, paylineWinningPositions } from './evaluate-paylines';
import { evaluateWays, waysWinningPositions } from './evaluate-ways';
import { evaluateClusters, clusterWinsToWinLines, clusterWinningPositions } from './evaluate-cluster';
import { countScatters, freeSpinsAwarded, retriggerSpins } from './features/scatter-free-spins';
import { applyCap } from './caps';
import type { Grid, SlotGameConfig, RoundResult, SlotSymbolId } from './types';
import type { SlotCascadeStep, SlotWinLine, SlotFreeSpinsResult, SlotFreeSpinEntry } from '@tanvion-royale/types';
import { BASIS_POINTS } from './types';

// ---------------------------------------------------------------------------
// Game hooks interface
// ---------------------------------------------------------------------------

export interface SpinContext {
  rng: Rng;
  config: SlotGameConfig;
  inFreeSpins: boolean;
  spinIndex: number; // 0 = base, 1+ = free spin index
  /** Mutable state carried across the whole round (meters, persisted wilds, etc.) */
  roundState: RoundState;
}

export interface RoundState {
  /** Pharaoh: curse meter (0–10). */
  curseMeter?: number;
  /** Steampunk: steam pressure (0–100). */
  steamPressure?: number;
  /** Samurai: Bushido multiplier (×1 start, +1 per winning free spin, cap ×10). */
  bushidoMultiplier?: number;
  /** Frozen/Mystic: positions of persistently sticky wilds. */
  stickyWilds?: Array<{ row: number; col: number }>;
  /** Generic key-value for other game state. */
  [key: string]: unknown;
}

export interface GameHooks {
  /**
   * Called BEFORE the initial grid is drawn for each spin.
   * Returns optional symbol overrides to inject into specific positions.
   */
  beforeDraw?: (ctx: SpinContext) => Array<{ row: number; col: number; symbolId: SlotSymbolId }>;

  /**
   * Called AFTER wins are found on a cascade step, BEFORE removal.
   * Hook may modify the win list or add extra removals.
   */
  onWins?: (
    ctx: SpinContext,
    grid: Grid,
    wins: SlotWinLine[],
    stepIndex: number,
  ) => { extraRemoved?: Array<{ row: number; col: number }>; extraMeta?: Record<string, unknown> };

  /**
   * Called AFTER a cascade is applied (new grid available), BEFORE evaluation.
   * Returns optional cells to force-set (e.g. sticky wilds, expanding wilds).
   */
  afterCascade?: (
    ctx: SpinContext,
    grid: Grid,
    stepIndex: number,
  ) => Array<{ row: number; col: number; symbolId: SlotSymbolId }>;

  /**
   * Called when scatter triggers free spins. May override the number awarded.
   */
  onFreeSpinTrigger?: (ctx: SpinContext, scatterCount: number, baseAwarded: number) => number;

  /**
   * Called at the start of each free spin. Returns symbol overrides.
   */
  beforeFreeSpin?: (ctx: SpinContext) => Array<{ row: number; col: number; symbolId: SlotSymbolId }>;

  /**
   * Called after the entire round (base + free spins) is derived.
   * May add round-level metadata.
   */
  afterRound?: (ctx: SpinContext) => Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyOverrides(grid: Grid, overrides: Array<{ row: number; col: number; symbolId: SlotSymbolId }>): Grid {
  const g = grid.map((row) => [...row]);
  for (const { row, col, symbolId } of overrides) {
    if (row >= 0 && row < g.length && col >= 0 && col < (g[0]?.length ?? 0)) {
      g[row][col] = symbolId;
    }
  }
  return g;
}

function evaluateWins(grid: Grid, config: SlotGameConfig, multiplierBp: number): SlotWinLine[] {
  switch (config.winModel) {
    case 'paylines':
      return evaluatePaylines(grid, config, multiplierBp);
    case 'ways':
      return evaluateWays(grid, config, multiplierBp);
    case 'cluster': {
      const clusters = evaluateClusters(grid, config, multiplierBp);
      return clusterWinsToWinLines(clusters);
    }
    default:
      return [];
  }
}

function getWinningPositions(
  wins: SlotWinLine[],
  grid: Grid,
  config: SlotGameConfig,
): Array<{ row: number; col: number }> {
  switch (config.winModel) {
    case 'paylines':
      return paylineWinningPositions(wins, config.paylines ?? [], config.reels);
    case 'ways':
      return waysWinningPositions(wins);
    case 'cluster':
      return wins.flatMap((w) => w.positions ?? []);
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Core spin derivation
// ---------------------------------------------------------------------------

function deriveOneSpin(
  rng: Rng,
  config: SlotGameConfig,
  ladder: readonly number[],
  ctx: SpinContext,
  hooks: GameHooks,
  isFreeSpin: boolean,
): { baseGrid: Grid; steps: SlotCascadeStep[]; totalPayBp: number; scatterCount: number; freeSpinsTriggered: number } {
  const strips = stripsFor(config, isFreeSpin);

  // --- Initial draw ---
  let grid = drawGrid(rng, strips, config.rows);

  // Before-draw overrides (e.g. Pharaoh curse spin, sticky wilds)
  const beforeOverrides = isFreeSpin
    ? (hooks.beforeFreeSpin?.(ctx) ?? [])
    : (hooks.beforeDraw?.(ctx) ?? []);
  if (beforeOverrides.length > 0) {
    grid = applyOverrides(grid, beforeOverrides);
  }

  const baseGrid = grid.map((row) => [...row]);
  const steps: SlotCascadeStep[] = [];
  let totalPayBp = 0;
  let stepScatterCount = 0;
  let stepFsTriggered = 0;

  for (let stepIdx = 1; stepIdx <= config.maxCascadeStepsPerSpin; stepIdx++) {
    const multiplierBp = ladderMultiplierBp(ladder, stepIdx);

    // After-cascade hook (inject sticky/expanding wilds BEFORE evaluation)
    if (stepIdx > 1) {
      const afterOverrides = hooks.afterCascade?.(ctx, grid, stepIdx) ?? [];
      if (afterOverrides.length > 0) {
        grid = applyOverrides(grid, afterOverrides);
      }
    }

    let wins = evaluateWins(grid, config, multiplierBp);

    // Count scatters on first step (before cascade)
    if (stepIdx === 1) {
      stepScatterCount = countScatters(grid, config.scatterId);
      const baseAwarded = freeSpinsAwarded(config, stepScatterCount);
      stepFsTriggered = hooks.onFreeSpinTrigger
        ? hooks.onFreeSpinTrigger(ctx, stepScatterCount, baseAwarded)
        : baseAwarded;
    }

    // onWins hook
    let extraRemoved: Array<{ row: number; col: number }> = [];
    let extraMeta: Record<string, unknown> = {};
    if (wins.length > 0 && hooks.onWins) {
      const r = hooks.onWins(ctx, grid, wins, stepIdx);
      if (r.extraRemoved) extraRemoved = r.extraRemoved;
      if (r.extraMeta) extraMeta = r.extraMeta;
    }

    const removed = [...getWinningPositions(wins, grid, config), ...extraRemoved];
    const stepPayBp = wins.reduce((s, w) => s + w.payBp, 0);

    steps.push({
      kind: 'CASCADE',
      gridAfter: grid.map((row) => [...row]),
      wins,
      multiplierBp,
      stepPayBp,
      meta: Object.keys(extraMeta).length > 0 ? extraMeta : undefined,
    });

    totalPayBp += stepPayBp;

    if (removed.length === 0) break; // no win this step — cascade ends

    // Apply cascade
    grid = applyCascade(rng, grid, removed, strips);
  }

  return { baseGrid, steps, totalPayBp, scatterCount: stepScatterCount, freeSpinsTriggered: stepFsTriggered };
}

// ---------------------------------------------------------------------------
// Full round derivation
// ---------------------------------------------------------------------------

export function deriveRound(
  rng: Rng,
  config: SlotGameConfig,
  stake: number,
  hooks: GameHooks = {},
): RoundResult {
  const roundState: RoundState = {};
  const ctx: SpinContext = { rng, config, inFreeSpins: false, spinIndex: 0, roundState };

  // --- Base spin ---
  const base = deriveOneSpin(rng, config, config.baseLadderBp, ctx, hooks, false);

  // --- Free spins ---
  const freeSpinEntries: SlotFreeSpinEntry[] = [];
  let totalFsPayBp = 0;
  let retriggers = 0;
  let remaining = base.freeSpinsTriggered;

  if (remaining > 0) {
    ctx.inFreeSpins = true;
    let played = 0;
    while (remaining > 0 && played < config.freeSpins.maxSpinsPerRound) {
      remaining--;
      played++;
      ctx.spinIndex = played;
      const fs = deriveOneSpin(rng, config, config.freeSpinLadderBp, ctx, hooks, true);
      freeSpinEntries.push({
        baseGrid: fs.baseGrid,
        steps: fs.steps,
        spinPayBp: fs.totalPayBp,
      });
      totalFsPayBp += fs.totalPayBp;
      // Retrigger check
      const extra = retriggerSpins(config, fs.scatterCount);
      if (extra > 0) {
        remaining += extra;
        retriggers++;
      }
    }
  }

  const freeSpins: SlotFreeSpinsResult = {
    triggered: base.freeSpinsTriggered > 0,
    awarded: base.freeSpinsTriggered,
    retriggers,
    spins: freeSpinEntries,
    totalPayBp: totalFsPayBp,
  };

  const totalPayBpUncapped = base.totalPayBp + totalFsPayBp;
  const { capped, totalPayBp, payout } = applyCap(totalPayBpUncapped, stake, config.maxWinBp);

  // After-round hook for round metadata
  const extraMeta = hooks.afterRound?.(ctx) ?? {};

  return {
    baseGrid: base.baseGrid,
    baseSteps: base.steps,
    freeSpins,
    totalPayBpUncapped,
    totalPayBp,
    capped,
    payout,
    meta: Object.keys(extraMeta).length > 0 ? extraMeta : undefined,
  };
}

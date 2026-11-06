/**
 * Cascade / tumble engine — remove winning cells, apply gravity, refill.
 *
 * Wilds that are NOT part of any win STAY on the board (Atlantis regression fix).
 * Gravity: surviving symbols in each column fall to the bottom; new symbols
 * fill from the top.
 */

import type { Rng } from './rng';
import { drawSymbol } from './reel-strips';
import type { Grid, StripEntry, SlotSymbolId } from './types';

/**
 * Apply one cascade step:
 *   1. Mark `removed` positions as empty.
 *   2. Per column: surviving symbols fall to the bottom.
 *   3. Refill empty top cells from the strip.
 *
 * Returns the new grid.
 */
export function applyCascade(
  rng: Rng,
  grid: Grid,
  removed: ReadonlyArray<{ row: number; col: number }>,
  strips: readonly StripEntry[][],
): Grid {
  const rows = grid.length;
  const cols = grid[0].length;
  const removedSet = new Set(removed.map((p) => `${p.row},${p.col}`));

  const result: Grid = Array.from({ length: rows }, () => Array(cols).fill(''));

  for (let c = 0; c < cols; c++) {
    // Collect survivors top-to-bottom
    const survivors: SlotSymbolId[] = [];
    for (let r = 0; r < rows; r++) {
      if (!removedSet.has(`${r},${c}`)) {
        survivors.push(grid[r][c]);
      }
    }
    // Fill: new symbols at top, survivors at bottom
    const missing = rows - survivors.length;
    const newCells: SlotSymbolId[] = Array.from({ length: missing }, () =>
      drawSymbol(rng, strips[c]),
    );
    const column = [...newCells, ...survivors];
    for (let r = 0; r < rows; r++) {
      result[r][c] = column[r] ?? drawSymbol(rng, strips[c]);
    }
  }

  return result;
}

/** Ladder multiplier in bp for a 1-based cascade step (last entry repeats). */
export function ladderMultiplierBp(ladder: readonly number[], step: number): number {
  const idx = Math.min(Math.max(step, 1), ladder.length) - 1;
  return ladder[idx];
}

/** Count how many times a given symbol appears anywhere on the grid. */
export function countSymbol(grid: Grid, symbolId: SlotSymbolId): number {
  let count = 0;
  for (const row of grid) for (const s of row) if (s === symbolId) count++;
  return count;
}

/** All positions of a symbol on the grid. */
export function symbolPositions(
  grid: Grid,
  symbolId: SlotSymbolId,
): Array<{ row: number; col: number }> {
  const out: Array<{ row: number; col: number }> = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] === symbolId) out.push({ row: r, col: c });
    }
  }
  return out;
}

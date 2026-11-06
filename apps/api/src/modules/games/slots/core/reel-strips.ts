/**
 * Reel strip utilities — draw random symbols from weighted strips.
 */

import type { Rng } from './rng';
import { weightedPick } from './rng';
import type { StripEntry, Grid, SlotSymbolId } from './types';
import type { SlotGameConfig } from './types';

/** Draw one symbol from a reel strip. */
export function drawSymbol(rng: Rng, strip: readonly StripEntry[]): SlotSymbolId {
  return weightedPick(rng, strip).symbolId;
}

/** Draw a full grid (rows × cols) from the given strips (one per column/reel). */
export function drawGrid(
  rng: Rng,
  strips: readonly StripEntry[][],
  rows: number,
): Grid {
  const cols = strips.length;
  const grid: Grid = [];
  for (let r = 0; r < rows; r++) {
    const row: SlotSymbolId[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(drawSymbol(rng, strips[c]));
    }
    grid.push(row);
  }
  return grid;
}

/** Choose the appropriate strips (base vs free-spin). */
export function stripsFor(config: SlotGameConfig, freeSpins: boolean): StripEntry[][] {
  if (freeSpins && config.freeSpinStrips) return config.freeSpinStrips;
  return config.strips;
}

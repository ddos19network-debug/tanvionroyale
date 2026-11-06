/**
 * Scatter detection and free-spin triggering.
 */

import type { Grid, SlotSymbolId, SlotGameConfig } from '../types';

/** Count scatter symbols anywhere on the grid. */
export function countScatters(grid: Grid, scatterId: SlotSymbolId): number {
  let count = 0;
  for (const row of grid) for (const s of row) if (s === scatterId) count++;
  return count;
}

/** Free spins awarded for a scatter count (0 if below trigger threshold). */
export function freeSpinsAwarded(config: SlotGameConfig, scatterCount: number): number {
  const { freeSpins } = config;
  if (scatterCount < freeSpins.triggerCount) return 0;
  return freeSpins.awarded;
}

/** Additional free spins for a retrigger. */
export function retriggerSpins(config: SlotGameConfig, scatterCount: number): number {
  const { freeSpins } = config;
  if (scatterCount < freeSpins.retriggerCount) return 0;
  return freeSpins.retriggerAwarded;
}

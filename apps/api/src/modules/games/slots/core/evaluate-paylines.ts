/**
 * Payline evaluation — 25/30/40 fixed paylines, left-to-right, 3+ of a kind.
 * Wild substitutes for every paying symbol but never scatter/bonus.
 */

import type { Grid, SlotSymbolId, SlotGameConfig } from './types';
import { BASIS_POINTS } from './types';
import type { SlotWinLine } from '@tanvion-royale/types';

export function evaluatePaylines(
  grid: Grid,
  config: SlotGameConfig,
  cascadeMultiplierBp: number,
): SlotWinLine[] {
  const { paylines, paytableBp, wildId, scatterId, reels, rows } = config;
  if (!paylines || paylines.length === 0) return [];

  const wins: SlotWinLine[] = [];

  for (let li = 0; li < paylines.length; li++) {
    const line = paylines[li];
    if (line.rows.length !== reels) continue;

    // Extract the symbol on this payline for each reel
    const syms: SlotSymbolId[] = line.rows.map((r, c) => {
      if (r < 0 || r >= rows || c >= reels) return '';
      return grid[r][c] ?? '';
    });

    // Find the leftmost non-wild, non-scatter symbol (the "anchor")
    let anchorSym: SlotSymbolId | null = null;
    for (const s of syms) {
      if (s !== wildId && s !== scatterId && s !== '') {
        anchorSym = s;
        break;
      }
    }
    if (!anchorSym) continue; // all wilds = no payline win (scatter pays separately)

    // Count consecutive matching cells from the left
    let count = 0;
    for (let r = 0; r < reels; r++) {
      const s = syms[r];
      if (s === wildId || s === anchorSym) {
        count++;
      } else {
        break;
      }
    }

    if (count < 3) continue;

    const payArr = paytableBp[anchorSym];
    if (!payArr) continue;
    const basepayBp = payArr[count] ?? 0;
    if (basepayBp <= 0) continue;

    const payBp = Math.floor((basepayBp * cascadeMultiplierBp) / BASIS_POINTS);

    wins.push({
      symbolId: anchorSym,
      lineIndex: li,
      count,
      basepayBp,
      multiplierBp: cascadeMultiplierBp,
      payBp,
    });
  }

  return wins;
}

/** Sum bp of all wins. */
export function totalWinBp(wins: readonly SlotWinLine[]): number {
  return wins.reduce((s, w) => s + w.payBp, 0);
}

/** All (row,col) positions involved in winning paylines. */
export function paylineWinningPositions(
  wins: readonly SlotWinLine[],
  paylines: { rows: number[] }[],
  reels: number,
): Array<{ row: number; col: number }> {
  const seen = new Set<string>();
  const out: Array<{ row: number; col: number }> = [];
  for (const w of wins) {
    if (w.lineIndex === undefined) continue;
    const line = paylines[w.lineIndex];
    if (!line) continue;
    for (let c = 0; c < w.count && c < reels; c++) {
      const r = line.rows[c];
      const key = `${r},${c}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ row: r, col: c });
      }
    }
  }
  return out;
}

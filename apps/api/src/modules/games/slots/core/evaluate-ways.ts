/**
 * Ways-to-win evaluation — 1024 / 3125 / 4096 ways.
 * Left-to-right, 3+ consecutive reels, wild substitution.
 */

import type { Grid, SlotSymbolId, SlotGameConfig } from './types';
import { BASIS_POINTS } from './types';
import type { SlotWinLine } from '@tanvion-royale/types';

export function evaluateWays(
  grid: Grid,
  config: SlotGameConfig,
  cascadeMultiplierBp: number,
): SlotWinLine[] {
  const { wildId, scatterId, paytableBp, reels, rows } = config;
  const wins: SlotWinLine[] = [];

  // Gather unique paying symbols on reel 0
  const paySymbols = new Set<SlotSymbolId>();
  for (let r = 0; r < rows; r++) {
    const s = grid[r][0];
    if (s && s !== wildId && s !== scatterId) paySymbols.add(s);
  }
  // Also consider symbols where reel 0 is ALL wilds (pure-wild ways — skip them, wilds don't self-win)
  // Per rules: a ways win requires the anchor symbol to exist on reel 0 (even if matched by wild elsewhere)
  // Wild on reel 0 qualifies any symbol that appears starting on reel 1? No — standard ways: match from reel 0.
  // If reel 0 has only wilds, there's no anchor; skip.

  for (const sym of paySymbols) {
    // Count how many cells on each reel match sym (or are wild)
    const counts: number[] = [];
    const positions: Array<Array<{ row: number; col: number }>> = [];

    let valid = true;
    for (let c = 0; c < reels; c++) {
      let cnt = 0;
      const reelPos: Array<{ row: number; col: number }> = [];
      for (let r = 0; r < rows; r++) {
        const s = grid[r][c];
        if (s === sym || s === wildId) {
          cnt++;
          reelPos.push({ row: r, col: c });
        }
      }
      if (cnt === 0) {
        // Run ends here
        break;
      }
      counts.push(cnt);
      positions.push(reelPos);
    }

    const runLength = counts.length;
    if (runLength < 3) continue;

    // Ways = product of match counts
    let ways = 1;
    for (const c of counts) ways *= c;

    const payArr = paytableBp[sym];
    if (!payArr) continue;
    const basepayBp = payArr[runLength] ?? 0;
    if (basepayBp <= 0) continue;

    // Total pay = basepayBp * ways, then multiplier
    const totalBaseBp = basepayBp * ways;
    const payBp = Math.floor((totalBaseBp * cascadeMultiplierBp) / BASIS_POINTS);

    const allPositions = positions.flat();

    wins.push({
      symbolId: sym,
      ways,
      positions: allPositions,
      count: runLength,
      basepayBp: totalBaseBp,
      multiplierBp: cascadeMultiplierBp,
      payBp,
    });
  }

  return wins;
}

/** Deduplicated winning positions from ways wins. */
export function waysWinningPositions(wins: readonly SlotWinLine[]): Array<{ row: number; col: number }> {
  const seen = new Set<string>();
  const out: Array<{ row: number; col: number }> = [];
  for (const w of wins) {
    for (const p of w.positions ?? []) {
      const key = `${p.row},${p.col}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(p);
      }
    }
  }
  return out;
}

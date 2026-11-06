/**
 * Cluster evaluation — orthogonal (4-directional) adjacency cluster pays.
 * Wild joins any cluster but is NEVER the cluster anchor.
 * Scatter/bonus symbols are skipped (never clustered).
 */

import type { Grid, SlotSymbolId, SlotGameConfig } from './types';
import { BASIS_POINTS } from './types';
import type { SlotWinLine } from '@tanvion-royale/types';

export interface ClusterWin {
  symbolId: SlotSymbolId;
  size: number;
  positions: Array<{ row: number; col: number }>;
  basepayBp: number;
  multiplierBp: number;
  payBp: number;
}

/** Look up the cluster pay from the paytable. Last entry repeats for larger clusters. */
function clusterPayBp(
  paytableBp: Record<SlotSymbolId, number[]>,
  symbolId: SlotSymbolId,
  size: number,
): number {
  const arr = paytableBp[symbolId];
  if (!arr || arr.length === 0) return 0;
  const idx = Math.min(size, arr.length - 1);
  return arr[idx] ?? 0;
}

export function evaluateClusters(
  grid: Grid,
  config: SlotGameConfig,
  cascadeMultiplierBp: number,
): ClusterWin[] {
  const { wildId, scatterId, paytableBp, reels: cols, rows, minClusterSize = 5 } = config;
  const specialIds = new Set([scatterId]);
  // bonus symbols that shouldn't cluster
  const skipIds = specialIds;

  const visited: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false));
  const wins: ClusterWin[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (visited[r][c]) continue;
      const sym = grid[r][c];
      if (skipIds.has(sym) || sym === wildId) continue;

      // BFS to find the connected cluster (same symbol + adjacent wilds)
      const cells: Array<{ row: number; col: number }> = [];
      const queue: Array<{ row: number; col: number }> = [{ row: r, col: c }];
      visited[r][c] = true;

      while (queue.length > 0) {
        const cur = queue.shift()!;
        cells.push(cur);
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nr = cur.row + dr;
          const nc = cur.col + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          if (visited[nr][nc]) continue;
          const ns = grid[nr][nc];
          // Wilds join the cluster (but their visited flag prevents double-join)
          if (ns === wildId || ns === sym) {
            visited[nr][nc] = true;
            queue.push({ row: nr, col: nc });
          }
        }
      }

      if (cells.length < minClusterSize) continue;

      const basepayBp = clusterPayBp(paytableBp, sym, cells.length);
      if (basepayBp <= 0) continue;

      const payBp = Math.floor((basepayBp * cascadeMultiplierBp) / BASIS_POINTS);

      wins.push({
        symbolId: sym,
        size: cells.length,
        positions: cells,
        basepayBp,
        multiplierBp: cascadeMultiplierBp,
        payBp,
      });
    }
  }

  return wins;
}

/** Convert ClusterWin[] to SlotWinLine[] for the response. */
export function clusterWinsToWinLines(wins: ClusterWin[]): import('@tanvion-royale/types').SlotWinLine[] {
  return wins.map((w) => ({
    symbolId: w.symbolId,
    positions: w.positions,
    count: w.size,
    basepayBp: w.basepayBp,
    multiplierBp: w.multiplierBp,
    payBp: w.payBp,
  }));
}

/** All winning positions from cluster wins (deduplicated). */
export function clusterWinningPositions(wins: ClusterWin[]): Array<{ row: number; col: number }> {
  const seen = new Set<string>();
  const out: Array<{ row: number; col: number }> = [];
  for (const w of wins) {
    for (const p of w.positions) {
      const key = `${p.row},${p.col}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(p);
      }
    }
  }
  return out;
}

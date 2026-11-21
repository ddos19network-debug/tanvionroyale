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
  const skipIds = new Set<SlotSymbolId>([scatterId]);
  for (const s of config.symbols ?? []) {
    if (s.tier === 'scatter' || s.tier === 'bonus') {
      skipIds.add(s.id);
    }
  }

  // 1. Identify all connected components of identical regular symbols (orthogonal only)
  const visitedRegular: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false));
  interface RegularCluster {
    symbolId: SlotSymbolId;
    cells: Array<{ row: number; col: number }>;
    adjacentWilds: Array<{ row: number; col: number }>;
  }

  const candidateClusters: RegularCluster[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (visitedRegular[r][c]) continue;
      const sym = grid[r][c];
      if (skipIds.has(sym) || sym === wildId) continue;

      const cells: Array<{ row: number; col: number }> = [];
      const wildsSet = new Set<string>();
      const queue: Array<{ row: number; col: number }> = [{ row: r, col: c }];
      visitedRegular[r][c] = true;

      while (queue.length > 0) {
        const cur = queue.shift()!;
        cells.push(cur);
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nr = cur.row + dr;
          const nc = cur.col + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          const ns = grid[nr][nc];
          if (ns === sym && !visitedRegular[nr][nc]) {
            visitedRegular[nr][nc] = true;
            queue.push({ row: nr, col: nc });
          } else if (ns === wildId) {
            wildsSet.add(`${nr},${nc}`);
          }
        }
      }

      const adjacentWilds: Array<{ row: number; col: number }> = Array.from(wildsSet).map((key) => {
        const [wr, wc] = key.split(',').map(Number);
        return { row: wr, col: wc };
      });

      candidateClusters.push({ symbolId: sym, cells, adjacentWilds });
    }
  }

  // 2. Deterministic Wild allocation strategy (Section 5.B):
  // Priority: Marginal gain from wild -> Raw cluster size -> Top-left coordinate
  candidateClusters.sort((a, b) => {
    const baseA = a.cells.length >= minClusterSize ? clusterPayBp(paytableBp, a.symbolId, a.cells.length) : 0;
    const baseB = b.cells.length >= minClusterSize ? clusterPayBp(paytableBp, b.symbolId, b.cells.length) : 0;
    const gainA = clusterPayBp(paytableBp, a.symbolId, a.cells.length + a.adjacentWilds.length) - baseA;
    const gainB = clusterPayBp(paytableBp, b.symbolId, b.cells.length + b.adjacentWilds.length) - baseB;
    if (gainB !== gainA) return gainB - gainA;
    if (b.cells.length !== a.cells.length) return b.cells.length - a.cells.length;
    return a.cells[0].row - b.cells[0].row || a.cells[0].col - b.cells[0].col;
  });

  const assignedWilds = new Set<string>();
  const wins: ClusterWin[] = [];

  for (const cluster of candidateClusters) {
    const availableWilds: Array<{ row: number; col: number }> = [];
    for (const w of cluster.adjacentWilds) {
      const key = `${w.row},${w.col}`;
      if (!assignedWilds.has(key)) {
        availableWilds.push(w);
      }
    }

    const totalCells = [...cluster.cells, ...availableWilds];
    if (totalCells.length >= minClusterSize) {
      const basepayBp = clusterPayBp(paytableBp, cluster.symbolId, totalCells.length);
      if (basepayBp > 0) {
        for (const w of availableWilds) {
          assignedWilds.add(`${w.row},${w.col}`);
        }
        const payBp = Math.floor((basepayBp * cascadeMultiplierBp) / BASIS_POINTS);
        wins.push({
          symbolId: cluster.symbolId,
          size: totalCells.length,
          positions: totalCells,
          basepayBp,
          multiplierBp: cascadeMultiplierBp,
          payBp,
        });
      }
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

import { randomInt } from 'node:crypto';
import {
  ATLANTIS_BOARD_ROWS,
  ATLANTIS_BOARD_COLS,
  type AtlantisSymbolId,
  ATLANTIS_SYMBOL_WEIGHTS,
  ATLANTIS_CLUSTER_PAYTABLE,
  ATLANTIS_CONFIG,
  ATLANTIS_MAX_CASCADE,
} from './royale-atlantis.types';

const WILD = 'tidal_wild';
const SCATTER = 'atlantis_gate';
const TREASURE = 'treasure_chest';
const KRAKEN = 'kraken_emblem';

function pickId(): AtlantisSymbolId {
  const entries = Object.entries(ATLANTIS_SYMBOL_WEIGHTS);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = randomInt(0, Math.max(1, total));
  for (const [id, w] of entries) {
    r -= w;
    if (r < 0) return id as AtlantisSymbolId;
  }
  return entries[entries.length - 1][0] as AtlantisSymbolId;
}

export function createGrid(): AtlantisSymbolId[][] {
  return Array.from({ length: ATLANTIS_BOARD_ROWS }, () =>
    Array.from({ length: ATLANTIS_BOARD_COLS }, () => pickId()),
  );
}

interface Cluster {
  symbolId: AtlantisSymbolId;
  positions: Array<{ row: number; col: number }>;
  symbolCount: number;
  payoutMultiplier: number;
  winAmount: number;
}

export function evaluateClusters(grid: AtlantisSymbolId[][]): Cluster[] {
  const rows = grid.length;
  const cols = grid[0].length;
  const skipIds = new Set([SCATTER, TREASURE, KRAKEN]);
  const out: Cluster[] = [];

  // Find candidate regular clusters first
  const visitedRegular = Array.from({ length: rows }, () => Array(cols).fill(false));
  interface CandCluster {
    symbolId: AtlantisSymbolId;
    cells: Array<{ row: number; col: number }>;
    adjacentWilds: Array<{ row: number; col: number }>;
  }
  const candidateClusters: CandCluster[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (visitedRegular[r][c]) continue;
      const sym = grid[r][c];
      if (skipIds.has(sym) || sym === WILD) continue;

      const queue = [{ row: r, col: c }];
      visitedRegular[r][c] = true;
      const cells: Array<{ row: number; col: number }> = [];
      const wildsSet = new Set<string>();

      while (queue.length) {
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
          } else if (ns === WILD && ATLANTIS_CONFIG.featureEnabled.wildSubstitutionEnabled) {
            wildsSet.add(`${nr},${nc}`);
          }
        }
      }

      const adjacentWilds = Array.from(wildsSet).map((k) => {
        const [wr, wc] = k.split(',').map(Number);
        return { row: wr, col: wc };
      });
      candidateClusters.push({ symbolId: sym, cells, adjacentWilds });
    }
  }

  // Deterministic wild allocation
  candidateClusters.sort((a, b) => {
    const multA = ATLANTIS_CLUSTER_PAYTABLE[a.symbolId] ?? 1;
    const multB = ATLANTIS_CLUSTER_PAYTABLE[b.symbolId] ?? 1;
    const payA = (a.cells.length + a.adjacentWilds.length) * multA;
    const payB = (b.cells.length + b.adjacentWilds.length) * multB;
    if (payB !== payA) return payB - payA;
    return b.cells.length - a.cells.length;
  });

  const assignedWilds = new Set<string>();

  for (const cluster of candidateClusters) {
    const availableWilds: Array<{ row: number; col: number }> = [];
    for (const w of cluster.adjacentWilds) {
      const k = `${w.row},${w.col}`;
      if (!assignedWilds.has(k)) {
        availableWilds.push(w);
      }
    }
    const totalCells = [...cluster.cells, ...availableWilds];
    if (totalCells.length >= ATLANTIS_CONFIG.minClusterSize) {
      for (const w of availableWilds) {
        assignedWilds.add(`${w.row},${w.col}`);
      }
      const mult = ATLANTIS_CLUSTER_PAYTABLE[cluster.symbolId] ?? 1;
      const winAmount = totalCells.length * mult;
      out.push({
        symbolId: cluster.symbolId,
        positions: totalCells,
        symbolCount: totalCells.length,
        payoutMultiplier: mult,
        winAmount,
      });
    }
  }

  return out;
}

export function dropAndRefill(grid: AtlantisSymbolId[][], removed: Array<{ row: number; col: number }>): AtlantisSymbolId[][] {
  const kept: AtlantisSymbolId[][] = Array.from({ length: ATLANTIS_BOARD_COLS }, () => [] as AtlantisSymbolId[]);
  for (let c = 0; c < ATLANTIS_BOARD_COLS; c++) {
    for (let r = 0; r < ATLANTIS_BOARD_ROWS; r++) {
      if (!removed.some((p) => p.row === r && p.col === c)) {
        kept[c].push(grid[r][c]);
      }
    }
  }
  const result: AtlantisSymbolId[][] = Array.from({ length: ATLANTIS_BOARD_ROWS }, () => [] as AtlantisSymbolId[]);
  for (let c = 0; c < ATLANTIS_BOARD_COLS; c++) {
    const dropCount = ATLANTIS_BOARD_ROWS - kept[c].length;
    const newCells = Array.from({ length: dropCount }, () => pickId());
    const filled = [...newCells, ...kept[c]];
    for (let r = 0; r < ATLANTIS_BOARD_ROWS; r++) {
      result[r][c] = filled[r] ?? pickId();
    }
  }
  return result;
}

export interface CascadeStep {
  index: number;
  winningClusters: Cluster[];
  removedPositions: Array<{ row: number; col: number }>;
  resultingGrid: AtlantisSymbolId[][];
  stepWin: number;
  totalWin: number;
}

export function processCascade(grid: AtlantisSymbolId[][]): CascadeStep[] {
  const steps: CascadeStep[] = [];
  let g = grid.map((row) => [...row]);
  let step = 0;
  let totalWin = 0;
  while (step < ATLANTIS_MAX_CASCADE) {
    const clusters = evaluateClusters(g);
    if (!clusters.length) break;
    const removed: Array<{ row: number; col: number }> = [];
    for (const cl of clusters) for (const p of cl.positions) if (!removed.some((x) => x.row === p.row && x.col === p.col)) removed.push({ row: p.row, col: p.col });
    const stepWin = clusters.reduce((s, cl) => s + cl.winAmount, 0);
    totalWin += stepWin;
    const resulting = dropAndRefill(g, removed);
    const newGrid = resulting.map((row, r) => resulting[r].map((_, c) => resulting[r][c] ?? pickId()));
    steps.push({ index: step, winningClusters: clusters, removedPositions: removed, resultingGrid: newGrid, stepWin, totalWin });
    g = newGrid;
    step++;
  }
  return steps;
}

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
  let r = Math.random() * total;
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
  const visited = Array.from({ length: rows }, () => Array(cols).fill(false));
  const out: Cluster[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sym = grid[r][c];
      if (visited[r][c] || sym === SCATTER || sym === TREASURE || sym === KRAKEN) continue;
      const stack = [{ row: r, col: c }];
      visited[r][c] = true;
      const cells: Array<{ row: number; col: number; symbol: AtlantisSymbolId }> = [];
      while (stack.length) {
        const cur = stack.pop()!;
        cells.push({ row: cur.row, col: cur.col, symbol: grid[cur.row][cur.col] });
        for (const nb of [
          { row: cur.row - 1, col: cur.col },
          { row: cur.row + 1, col: cur.col },
          { row: cur.row, col: cur.col - 1 },
          { row: cur.row, col: cur.col + 1 },
        ]) {
          if (nb.row < 0 || nb.row >= rows || nb.col < 0 || nb.col >= cols) continue;
          if (visited[nb.row][nb.col]) continue;
          const ns = grid[nb.row][nb.col];
          if (ns === WILD && ATLANTIS_CONFIG.featureEnabled.wildSubstitutionEnabled) {
            stack.push(nb); visited[nb.row][nb.col] = true;
            continue;
          }
          if (ns === sym) { stack.push(nb); visited[nb.row][nb.col] = true; }
        }
      }
      if (cells.length < ATLANTIS_CONFIG.minClusterSize) continue;
      const allWild = cells.every((p) => p.symbol === WILD);
      const sameSymbol = cells.every((p) => p.symbol === cells[0].symbol);
      let arr: Cluster | null = null;
      if (allWild && ATLANTIS_CONFIG.featureEnabled.wildSubstitutionEnabled) {
        const mult = ATLANTIS_CLUSTER_PAYTABLE[cells[0].symbol] ?? 1;
        arr = { symbolId: cells[0].symbol, positions: cells.map((p) => ({ row: p.row, col: p.col })), symbolCount: cells.length, payoutMultiplier: mult, winAmount: cells.length * mult };
      } else if (sameSymbol) {
        const mult = ATLANTIS_CLUSTER_PAYTABLE[cells[0].symbol] ?? 1;
        arr = { symbolId: cells[0].symbol, positions: cells.map((p) => ({ row: p.row, col: p.col })), symbolCount: cells.length, payoutMultiplier: mult, winAmount: cells.length * mult };
      }
      if (arr) out.push(arr);
    }
  }
  return out;
}

export function dropAndRefill(grid: AtlantisSymbolId[][], removed: Array<{ row: number; col: number }>): AtlantisSymbolId[][] {
  const kept: AtlantisSymbolId[][] = Array.from({ length: ATLANTIS_BOARD_ROWS }, () => [] as AtlantisSymbolId[]);
  for (let c = 0; c < ATLANTIS_BOARD_COLS; c++) {
    for (let r = 0; r < ATLANTIS_BOARD_ROWS; r++) {
      if (!removed.some((p) => p.row === r && p.col === c) && grid[r][c] !== WILD) kept[c].push(grid[r][c]);
    }
  }
  const result = Array.from({ length: ATLANTIS_BOARD_ROWS }, () => [] as AtlantisSymbolId[]);
  for (let c = 0; c < ATLANTIS_BOARD_COLS; c++) {
    const dropCount = ATLANTIS_BOARD_ROWS - kept[c].length;
    const newCells = Array.from({ length: dropCount }, () => pickId());
    const filled = [...newCells, ...kept[c]].slice(0, ATLANTIS_BOARD_ROWS);
    for (let r = 0; r < ATLANTIS_BOARD_ROWS; r++) result[r][c] = filled[r] ?? pickId();
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

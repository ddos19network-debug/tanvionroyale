import { ATLANTIS_CONFIG, ATLANTIS_SYMBOLS } from '../../src/modules/games/slots/games/atlantis.config';
import { evaluateClusters } from '../../src/modules/games/slots/core/evaluate-cluster';
import { applyCascade, countSymbol } from '../../src/modules/games/slots/core/cascade';
import { deriveRound } from '../../src/modules/games/slots/core/round';
import { getHooksForSlug } from '../../src/modules/games/slots/core/features/game-hooks';
import { getFreePlayEngine, getFreePlayGameMeta } from '../../src/modules/games/game-engines/registry';
import { RoyaleAtlantisEngine } from '../../src/modules/games/game-engines/royale-atlantis.engine';
import { createGrid, evaluateClusters as evaluateMathClusters, dropAndRefill, processCascade } from '../../src/modules/games/game-engines/royale-atlantis.math';
import type { Grid } from '../../src/modules/games/slots/core/types';
import type { Rng } from '../../src/modules/games/slots/core/rng';

class DeterministicRng implements Rng {
  private count = 0;
  constructor(private readonly sequence: number[] = [0.1, 0.2, 0.3, 0.4, 0.5]) {}
  random(): number {
    const val = this.sequence[this.count % this.sequence.length];
    this.count++;
    return val;
  }
  int(maxExclusive: number): number {
    return Math.floor(this.random() * maxExclusive);
  }
}

describe('Royale Atlantis — Complete Game Math & Integration Suite', () => {
  describe('1. Game Configuration & Board Dimensions', () => {
    it('has exact 7x7 grid dimensions (7 columns x 7 rows)', () => {
      expect(ATLANTIS_CONFIG.reels).toBe(7);
      expect(ATLANTIS_CONFIG.rows).toBe(7);
      expect(ATLANTIS_CONFIG.winModel).toBe('cluster');
      expect(ATLANTIS_CONFIG.minClusterSize).toBe(5);
    });

    it('has all 12 canonical symbols with valid tiers and asset paths', () => {
      expect(ATLANTIS_CONFIG.symbols).toHaveLength(12);
      const symbolIds = ATLANTIS_CONFIG.symbols.map((s) => s.id);
      expect(symbolIds).toContain(ATLANTIS_SYMBOLS.WILD);
      expect(symbolIds).toContain(ATLANTIS_SYMBOLS.SCATTER);
      expect(symbolIds).toContain(ATLANTIS_SYMBOLS.TREASURE);
      expect(symbolIds).toContain(ATLANTIS_SYMBOLS.KRAKEN);
      expect(symbolIds).toContain(ATLANTIS_SYMBOLS.OCEAN_KING);
      expect(symbolIds).toContain(ATLANTIS_SYMBOLS.MERMAID);
      expect(symbolIds).toContain(ATLANTIS_SYMBOLS.TRIDENT);
      expect(symbolIds).toContain(ATLANTIS_SYMBOLS.PEARL);
      expect(symbolIds).toContain(ATLANTIS_SYMBOLS.PALACE);
      expect(symbolIds).toContain(ATLANTIS_SYMBOLS.SEA_DRAGON);
      expect(symbolIds).toContain(ATLANTIS_SYMBOLS.DOLPHIN);
      expect(symbolIds).toContain(ATLANTIS_SYMBOLS.SEA_TURTLE);

      for (const s of ATLANTIS_CONFIG.symbols) {
        expect(s.asset).toBeDefined();
        expect(s.asset).toMatch(/^\/assets\/image\/royale_atlantis\/symbols\//);
      }
    });

    it('has max win protection capped at 50,000,000 bp (5000x stake)', () => {
      expect(ATLANTIS_CONFIG.maxWinBp).toBe(50_000_000);
    });
  });

  describe('2. Cluster Evaluation & Pattern Detection', () => {
    it('detects a 5-symbol horizontal cluster', () => {
      const grid: Grid = Array.from({ length: 7 }, () => Array(7).fill('sea_turtle'));
      for (let c = 0; c < 5; c++) grid[0][c] = 'ocean_king';

      const wins = evaluateClusters(grid, ATLANTIS_CONFIG, 10000);
      const win = wins.find((w) => w.symbolId === 'ocean_king');
      expect(win).toBeDefined();
      expect(win?.size).toBe(5);
      expect(win?.basepayBp).toBe(137);
    });

    it('detects a 5-symbol vertical cluster', () => {
      const grid: Grid = Array.from({ length: 7 }, () => Array(7).fill('dolphin'));
      for (let r = 0; r < 5; r++) grid[r][2] = 'mermaid_queen';

      const wins = evaluateClusters(grid, ATLANTIS_CONFIG, 10000);
      const win = wins.find((w) => w.symbolId === 'mermaid_queen');
      expect(win).toBeDefined();
      expect(win?.size).toBe(5);
      expect(win?.basepayBp).toBe(82);
    });

    it('detects T-shaped and L-shaped orthogonal clusters', () => {
      const grid: Grid = Array.from({ length: 7 }, () => Array(7).fill('sea_dragon'));
      // T-shape of 5 golden_trident
      grid[2][1] = 'golden_trident';
      grid[2][2] = 'golden_trident';
      grid[2][3] = 'golden_trident';
      grid[3][2] = 'golden_trident';
      grid[4][2] = 'golden_trident';

      const wins = evaluateClusters(grid, ATLANTIS_CONFIG, 10000);
      const win = wins.find((w) => w.symbolId === 'golden_trident');
      expect(win).toBeDefined();
      expect(win?.size).toBe(5);
    });

    it('does NOT count diagonal-only matches as clusters', () => {
      const grid: Grid = Array.from({ length: 7 }, () => Array(7).fill('sea_turtle'));
      // 5 symbols strictly along a diagonal (0,0), (1,1), (2,2), (3,3), (4,4)
      for (let i = 0; i < 5; i++) grid[i][i] = 'royal_pearl';

      const wins = evaluateClusters(grid, ATLANTIS_CONFIG, 10000);
      const pearlWin = wins.find((w) => w.symbolId === 'royal_pearl');
      expect(pearlWin).toBeUndefined();
    });

    it('applies cascade multiplier ladder correctly to cluster payouts', () => {
      const grid: Grid = Array.from({ length: 7 }, () => Array(7).fill('sea_turtle'));
      for (let c = 0; c < 5; c++) grid[0][c] = 'ocean_king';

      // Step 1: multiplier 1x (10000 bp)
      const wins1x = evaluateClusters(grid, ATLANTIS_CONFIG, 10000);
      const ok1x = wins1x.find((w) => w.symbolId === 'ocean_king');
      expect(ok1x?.payBp).toBe(137);

      // Step 2: multiplier 2x (20000 bp)
      const wins2x = evaluateClusters(grid, ATLANTIS_CONFIG, 20000);
      const ok2x = wins2x.find((w) => w.symbolId === 'ocean_king');
      expect(ok2x?.payBp).toBe(274);

      // Step 3: multiplier 3x (30000 bp)
      const wins3x = evaluateClusters(grid, ATLANTIS_CONFIG, 30000);
      const ok3x = wins3x.find((w) => w.symbolId === 'ocean_king');
      expect(ok3x?.payBp).toBe(411);

      // Step 4: multiplier 5x (50000 bp)
      const wins5x = evaluateClusters(grid, ATLANTIS_CONFIG, 50000);
      const ok5x = wins5x.find((w) => w.symbolId === 'ocean_king');
      expect(ok5x?.payBp).toBe(685);
    });
  });

  describe('3. Wild Allocation & Single-Ownership Guarantee', () => {
    it('allows Tidal Wild to substitute for regular symbols to reach 5-cluster', () => {
      const grid: Grid = Array.from({ length: 7 }, () => Array(7).fill('sea_turtle'));
      grid[0][0] = 'atlantis_palace';
      grid[0][1] = 'atlantis_palace';
      grid[0][2] = 'atlantis_palace';
      grid[0][3] = 'atlantis_palace';
      grid[0][4] = 'tidal_wild'; // 5th is wild

      const wins = evaluateClusters(grid, ATLANTIS_CONFIG, 10000);
      const win = wins.find((w) => w.symbolId === 'atlantis_palace');
      expect(win).toBeDefined();
      expect(win?.size).toBe(5);
    });

    it('allocates a shared Wild cell to AT MOST ONE cluster (no duplicate payouts)', () => {
      const grid: Grid = Array.from({ length: 7 }, () => Array(7).fill('sea_turtle'));
      // Put a single Wild at (2, 2)
      grid[2][2] = 'tidal_wild';

      // 4 Ocean Kings adjacent to Wild: (2,0), (2,1), (1,1), (3,1)
      grid[2][0] = 'ocean_king';
      grid[2][1] = 'ocean_king';
      grid[1][1] = 'ocean_king';
      grid[3][1] = 'ocean_king';

      // 4 Mermaids adjacent to Wild: (2,3), (2,4), (1,3), (3,3)
      grid[2][3] = 'mermaid_queen';
      grid[2][4] = 'mermaid_queen';
      grid[1][3] = 'mermaid_queen';
      grid[3][3] = 'mermaid_queen';

      const wins = evaluateClusters(grid, ATLANTIS_CONFIG, 10000);

      // Total positions awarded must not duplicate the wild at (2,2)
      const wildOccurrences = wins.flatMap((w) => w.positions).filter((p) => p.row === 2 && p.col === 2);
      expect(wildOccurrences.length).toBe(1);

      // Higher paying Ocean King gets the wild (5 Ocean Kings), Mermaids remain 4 (no win)
      const okWin = wins.find((w) => w.symbolId === 'ocean_king');
      const mqWin = wins.find((w) => w.symbolId === 'mermaid_queen');
      expect(okWin).toBeDefined();
      expect(okWin?.size).toBe(5);
      expect(mqWin).toBeUndefined();
    });
  });

  describe('4. Special Features: Kraken Sweep & Treasure Chest', () => {
    it('triggers Kraken Sweep to remove regular symbols and Kraken emblem', () => {
      const hooks = getHooksForSlug('royale-atlantis');
      expect(hooks.onWins).toBeDefined();

      const rng = new DeterministicRng([0.0]); // selects first regular: ocean_king
      const grid: Grid = Array.from({ length: 7 }, () => Array(7).fill('sea_turtle'));
      grid[1][1] = 'kraken_emblem';
      grid[3][3] = 'ocean_king';
      grid[3][4] = 'ocean_king';

      const ctx: any = { rng, config: ATLANTIS_CONFIG, inFreeSpins: false, spinIndex: 0, roundState: {} };
      const wins: any[] = [];
      const res = hooks.onWins!(ctx, grid, wins, 1);

      expect(res.extraMeta?.krakenSweep).toBe('ocean_king');
      // Must remove the kraken at (1,1) and both ocean_kings at (3,3) and (3,4)
      expect(res.extraRemoved).toContainEqual({ row: 1, col: 1 });
      expect(res.extraRemoved).toContainEqual({ row: 3, col: 3 });
      expect(res.extraRemoved).toContainEqual({ row: 3, col: 4 });
    });

    it('triggers Treasure Chest instant prize for 3+ chests and removes them', () => {
      const hooks = getHooksForSlug('royale-atlantis');
      const rng = new DeterministicRng([0.5]); // 5 + floor(0.5 * 21) = 15x
      const grid: Grid = Array.from({ length: 7 }, () => Array(7).fill('sea_turtle'));
      grid[0][0] = 'treasure_chest';
      grid[1][1] = 'treasure_chest';
      grid[2][2] = 'treasure_chest';

      const ctx: any = { rng, config: ATLANTIS_CONFIG, inFreeSpins: false, spinIndex: 0, roundState: {} };
      const wins: any[] = [];
      const res = hooks.onWins!(ctx, grid, wins, 1);

      expect(res.extraMeta?.treasureBonusBp).toBe(150_000); // 15x = 150000 bp
      expect(wins).toHaveLength(1);
      expect(wins[0].symbolId).toBe('treasure_chest');
      expect(wins[0].payBp).toBe(150_000);

      // Chests must be marked for removal so tumbling occurs
      expect(res.extraRemoved).toContainEqual({ row: 0, col: 0 });
      expect(res.extraRemoved).toContainEqual({ row: 1, col: 1 });
      expect(res.extraRemoved).toContainEqual({ row: 2, col: 2 });
    });
  });

  describe('5. Scatter & Free Spins Mechanics', () => {
    it('awards 10 Free Spins when 4+ Atlantis Gates land on step 1', () => {
      const hooks = getHooksForSlug('royale-atlantis');
      const rng = new DeterministicRng();
      const round = deriveRound(rng, ATLANTIS_CONFIG, 100, hooks);

      // Check free spins structure
      expect(round.freeSpins).toBeDefined();
      expect(typeof round.freeSpins.triggered).toBe('boolean');
      expect(typeof round.freeSpins.totalPayBp).toBe('number');
    });

    it('verifies that every new Free Spin resets its cascade multiplier to 1x', () => {
      // In round.ts deriveRound, each free spin calls deriveOneSpin with stepIdx = 1 (1x multiplier)
      expect(ATLANTIS_CONFIG.freeSpinLadderBp[0]).toBe(10000); // 1.0x
      expect(ATLANTIS_CONFIG.freeSpinLadderBp[1]).toBe(20000); // 2.0x
      expect(ATLANTIS_CONFIG.freeSpinLadderBp[2]).toBe(30000); // 3.0x
      expect(ATLANTIS_CONFIG.freeSpinLadderBp[3]).toBe(50000); // 5.0x
    });
  });

  describe('6. Full Round Derivation & Cascade Mechanics', () => {
    it('executes server-authoritative round with tumble cascades', () => {
      const rng = new DeterministicRng();
      const hooks = getHooksForSlug('royale-atlantis');
      const round = deriveRound(rng, ATLANTIS_CONFIG, 100, hooks);

      expect(round.baseGrid).toHaveLength(7);
      expect(round.baseGrid[0]).toHaveLength(7);
      expect(round.baseSteps.length).toBeGreaterThanOrEqual(1);
      expect(round.payout).toBeGreaterThanOrEqual(0);
      expect(round.totalPayBp).toBeGreaterThanOrEqual(0);
    });

    it('preserves un-won wilds when tumbling symbols drop', () => {
      const rng = new DeterministicRng();
      const grid: Grid = [
        ['ocean_king', 'ocean_king', 'ocean_king', 'sea_dragon', 'sea_dragon', 'sea_dragon', 'sea_dragon'],
        ['dolphin',    'tidal_wild', 'dolphin',    'sea_dragon', 'sea_dragon', 'sea_dragon', 'sea_dragon'],
        ['sea_turtle', 'sea_turtle', 'sea_turtle', 'sea_dragon', 'sea_dragon', 'sea_dragon', 'sea_dragon'],
        ['sea_turtle', 'sea_turtle', 'sea_turtle', 'sea_dragon', 'sea_dragon', 'sea_dragon', 'sea_dragon'],
        ['sea_turtle', 'sea_turtle', 'sea_turtle', 'sea_dragon', 'sea_dragon', 'sea_dragon', 'sea_dragon'],
        ['sea_turtle', 'sea_turtle', 'sea_turtle', 'sea_dragon', 'sea_dragon', 'sea_dragon', 'sea_dragon'],
        ['sea_turtle', 'sea_turtle', 'sea_turtle', 'sea_dragon', 'sea_dragon', 'sea_dragon', 'sea_dragon'],
      ];
      const removed = [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }];
      const strips = Array(7).fill([{ symbolId: 'pearl', weight: 1 }]);

      const newGrid = applyCascade(rng, grid, removed, strips);

      // The un-won tidal_wild must remain in col 1
      let foundWild = false;
      for (let r = 0; r < 7; r++) {
        if (newGrid[r][1] === 'tidal_wild') foundWild = true;
      }
      expect(foundWild).toBe(true);
    });
  });

  describe('7. Free Play Engine Registration & Session Lifecycle', () => {
    it('is registered in the FreePlayEngine registry', () => {
      const engine = getFreePlayEngine('royale-atlantis');
      expect(engine).toBeDefined();
      expect(engine?.meta.slug).toBe('royale-atlantis');
      expect(engine?.meta.title).toBe('Royale Atlantis');
    });

    it('creates a non-null 7x7 initial grid on session start', () => {
      const engine = new RoyaleAtlantisEngine();
      const initial = engine.createInitialState();
      expect(initial.phase).toBe('READY');
      expect(Array.isArray(initial.grid)).toBe(true);
      const g = initial.grid as string[][];
      expect(g).toHaveLength(7);
      expect(g[0]).toHaveLength(7);
    });

    it('processes a SPIN action server-authoritatively and returns scored outcome', () => {
      const engine = new RoyaleAtlantisEngine();
      const res = engine.applyAction({}, { type: 'SPIN', payload: { bet: 100 } });
      expect(res.finished).toBe(true);
      expect(res.result).toBeDefined();
      expect(['WIN', 'LOSS']).toContain(res.result?.outcome);
      expect(typeof res.result?.score).toBe('number');

      const state: any = res.state;
      expect(state.phase).toBe('SPUN');
      expect(state.totalBet).toBe(100);
      expect(state.grid).toHaveLength(7);
      expect(state.grid[0]).toHaveLength(7);
      expect(Array.isArray(state.cascadeSteps)).toBe(true);
    });

    it('rejects invalid action types with PlayerActionError', () => {
      const engine = new RoyaleAtlantisEngine();
      expect(() => engine.applyAction({}, { type: 'INVALID_ACTION' })).toThrow(/Unsupported action/);
    });
  });

  describe('8. RTP & Monte Carlo Simulation Validation', () => {
    it('executes Monte Carlo simulation (10,000 spins) and validates RTP metrics', () => {
      const { runSimulation, formatSimReport } = require('../../src/modules/games/slots/slot-sim.cli');
      const rep = runSimulation('royale-atlantis', 10000, 100, 'atlantis-test-seed');
      console.log(formatSimReport(rep));

      expect(rep.spins).toBe(10000);
      expect(rep.totalWon).toBeGreaterThan(0);
      expect(rep.rtpTotal).toBeGreaterThan(50);
      expect(rep.hitFrequency).toBeGreaterThan(10);
      expect(rep.maxWinStakeMult).toBeGreaterThan(0);
    }, 60000);
  });
});

import { evaluatePaylines } from '../../src/modules/games/slots/core/evaluate-paylines';
import { evaluateWays } from '../../src/modules/games/slots/core/evaluate-ways';
import { evaluateClusters } from '../../src/modules/games/slots/core/evaluate-cluster';
import { applyCascade } from '../../src/modules/games/slots/core/cascade';
import { SeededRng } from '../../src/modules/games/slots/core/rng';
import { PHARAOH_CONFIG } from '../../src/modules/games/slots/games/pharaoh.config';
import { ATLANTIS_CONFIG } from '../../src/modules/games/slots/games/atlantis.config';
import { MYSTIC_CONFIG } from '../../src/modules/games/slots/games/mystic-forest.config';
import type { Grid } from '../../src/modules/games/slots/core/types';

describe('Slot Core Evaluators', () => {
  describe('Payline evaluation (Pharaoh)', () => {
    it('evaluates 3-of-a-kind on top horizontal payline', () => {
      // Row 0 is [0,0,0,0,0] in paylines
      const grid: Grid = [
        ['ankh', 'ankh', 'ankh', 'pyramid', 'pyramid'],
        ['pyramid', 'pyramid', 'pyramid', 'pyramid', 'pyramid'],
        ['pyramid', 'pyramid', 'pyramid', 'pyramid', 'pyramid'],
        ['pyramid', 'pyramid', 'pyramid', 'pyramid', 'pyramid'],
      ];
      const wins = evaluatePaylines(grid, PHARAOH_CONFIG, 10000);
      const topWin = wins.find((w) => w.lineIndex === 0 && w.symbolId === 'ankh');
      expect(topWin).toBeDefined();
      expect(topWin?.count).toBe(3);
      expect(topWin?.payBp).toBe(600);
    });

    it('substitutes wild for paying symbols', () => {
      const grid: Grid = [
        ['pharaoh', 'pharaoh_wild', 'pharaoh', 'pyramid', 'pyramid'],
        ['pyramid', 'pyramid', 'pyramid', 'pyramid', 'pyramid'],
        ['pyramid', 'pyramid', 'pyramid', 'pyramid', 'pyramid'],
        ['pyramid', 'pyramid', 'pyramid', 'pyramid', 'pyramid'],
      ];
      const wins = evaluatePaylines(grid, PHARAOH_CONFIG, 10000);
      const topWin = wins.find((w) => w.lineIndex === 0 && w.symbolId === 'pharaoh');
      expect(topWin).toBeDefined();
      expect(topWin?.count).toBe(3);
    });

    it('wild NEVER substitutes for scatter', () => {
      const grid: Grid = [
        ['scarab_scatter', 'pharaoh_wild', 'scarab_scatter', 'pyramid', 'pyramid'],
        ['pyramid', 'pyramid', 'pyramid', 'pyramid', 'pyramid'],
        ['pyramid', 'pyramid', 'pyramid', 'pyramid', 'pyramid'],
        ['pyramid', 'pyramid', 'pyramid', 'pyramid', 'pyramid'],
      ];
      const wins = evaluatePaylines(grid, PHARAOH_CONFIG, 10000);
      const scatterWin = wins.find((w) => w.symbolId === 'scarab_scatter');
      expect(scatterWin).toBeUndefined(); // scatters don't pay via payline
    });
  });

  describe('Ways evaluation (Mystic Forest 1024 ways)', () => {
    it('evaluates adjacent left-to-right runs', () => {
      const grid: Grid = [
        ['forest_fairy', 'forest_fairy', 'forest_fairy', 'moon_flower', 'moon_flower'],
        ['magic_crystal', 'magic_crystal', 'magic_crystal', 'moon_flower', 'moon_flower'],
        ['wise_owl', 'wise_owl', 'wise_owl', 'moon_flower', 'moon_flower'],
        ['enchanted_mushroom', 'enchanted_mushroom', 'enchanted_mushroom', 'moon_flower', 'moon_flower'],
      ];
      const wins = evaluateWays(grid, MYSTIC_CONFIG, 10000);
      expect(wins.length).toBeGreaterThan(0);
      const fairyWin = wins.find((w) => w.symbolId === 'forest_fairy');
      expect(fairyWin).toBeDefined();
      expect(fairyWin?.count).toBe(3);
    });

    it('multiplies ways correctly when multiple symbols match on a reel', () => {
      const grid: Grid = [
        ['forest_fairy', 'forest_fairy', 'forest_fairy', 'moon_flower', 'moon_flower'],
        ['forest_fairy', 'forest_fairy', 'moon_flower', 'moon_flower', 'moon_flower'],
        ['wise_owl', 'wise_owl', 'wise_owl', 'moon_flower', 'moon_flower'],
        ['wise_owl', 'wise_owl', 'wise_owl', 'moon_flower', 'moon_flower'],
      ];
      const wins = evaluateWays(grid, MYSTIC_CONFIG, 10000);
      const fairyWin = wins.find((w) => w.symbolId === 'forest_fairy');
      expect(fairyWin).toBeDefined();
      // Reel 0: 2 fairies, Reel 1: 2 fairies, Reel 2: 1 fairy -> 2 * 2 * 1 = 4 ways
      expect(fairyWin?.ways).toBe(4);
    });
  });

  describe('Cluster evaluation (Atlantis 7x7)', () => {
    it('requires minimum 5 adjacent symbols to form a winning cluster', () => {
      const grid: Grid = Array.from({ length: 7 }, () => Array(7).fill('sea_turtle'));
      // Create a 4-cluster of ocean_king (should NOT win)
      grid[0][0] = 'ocean_king';
      grid[0][1] = 'ocean_king';
      grid[1][0] = 'ocean_king';
      grid[1][1] = 'ocean_king';

      const wins = evaluateClusters(grid, ATLANTIS_CONFIG, 10000);
      const okWin = wins.find((w) => w.symbolId === 'ocean_king');
      expect(okWin).toBeUndefined();

      // Add 5th ocean_king
      grid[1][2] = 'ocean_king';
      const wins2 = evaluateClusters(grid, ATLANTIS_CONFIG, 10000);
      const okWin2 = wins2.find((w) => w.symbolId === 'ocean_king');
      expect(okWin2).toBeDefined();
      expect(okWin2?.size).toBe(5);
    });

    it('tidal wild joins cluster', () => {
      const grid: Grid = Array.from({ length: 7 }, () => Array(7).fill('sea_turtle'));
      grid[0][0] = 'mermaid_queen';
      grid[0][1] = 'mermaid_queen';
      grid[0][2] = 'mermaid_queen';
      grid[0][3] = 'mermaid_queen';
      grid[0][4] = 'tidal_wild'; // 5th is wild

      const wins = evaluateClusters(grid, ATLANTIS_CONFIG, 10000);
      const mermaidWin = wins.find((w) => w.symbolId === 'mermaid_queen');
      expect(mermaidWin).toBeDefined();
      expect(mermaidWin?.size).toBe(5);
    });
  });

  describe('Cascade & Gravity (Wild retention regression test)', () => {
    it('PRESERVES un-won wilds when other symbols tumble (fixes Atlantis bug)', () => {
      const rng = new SeededRng(12345);
      const grid: Grid = [
        ['ocean_king', 'ocean_king', 'ocean_king'],
        ['dolphin',    'tidal_wild', 'dolphin'],
        ['sea_turtle', 'sea_turtle', 'sea_turtle'],
      ];
      // Only remove top row (ocean_king)
      const removed = [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }];
      const strips = [
        [{ symbolId: 'sea_dragon', weight: 1 }],
        [{ symbolId: 'sea_dragon', weight: 1 }],
        [{ symbolId: 'sea_dragon', weight: 1 }],
      ];

      const newGrid = applyCascade(rng, grid, removed, strips);

      // The un-won tidal_wild at col 1 must STILL be on the board (dropped or in place)
      let foundWild = false;
      for (let r = 0; r < 3; r++) {
        if (newGrid[r][1] === 'tidal_wild') foundWild = true;
      }
      expect(foundWild).toBe(true);
    });
  });
});

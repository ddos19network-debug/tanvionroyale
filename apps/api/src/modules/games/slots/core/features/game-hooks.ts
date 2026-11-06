/**
 * Signature game hooks for all 10 Royale Play slot games.
 *
 * Implements the specific signature mechanics defined in Part 3 of the spec:
 * - Pharaoh: Golden Tomb (expanding wild in FS) + Pharaoh's Curse meter
 * - Atlantis: Kraken Sweep + Treasure Chest instant prize
 * - Neon: Overclock Respin (locked wilds) + Free Spin ×2 boost
 * - Mystic: Growing Magic Tree Wild + Persistent FS wilds
 * - Samurai: Katana Slash (random wilds) + Bushido multiplier ladder
 * - Cosmic: Gravity Respin (expanding wild respin) + Planet line multipliers
 * - Dragon: Dragon Fire (low-pay burn to wild) + Sticky FS wilds
 * - Tropical: Island tumble ladder + FS ladder boost
 * - Steampunk: Steam Pressure meter + Boiler Burst multiplier
 * - Frozen: Frost Lock (winning cells freeze, others respin)
 */

import type { GameHooks, SpinContext } from '../round';
import type { Grid, SlotSymbolId } from '../types';
import type { SlotWinLine } from '@tanvion-royale/types';
import { PHARAOH_SYMBOLS } from '../../games/pharaoh.config';
import { ATLANTIS_SYMBOLS } from '../../games/atlantis.config';
import { NEON_SYMBOLS } from '../../games/neon-cyber-rush.config';
import { MYSTIC_SYMBOLS } from '../../games/mystic-forest.config';
import { SAMURAI_SYMBOLS } from '../../games/samurai-fortune.config';
import { COSMIC_SYMBOLS } from '../../games/cosmic-odyssey.config';
import { DRAGONS_SYMBOLS } from '../../games/dragons-kingdom.config';
import { STEAMPUNK_SYMBOLS } from '../../games/steampunk-revolution.config';
import { FROZEN_SYMBOLS } from '../../games/frozen-empire.config';

export function getHooksForSlug(slug: string): GameHooks {
  switch (slug) {
    case 'royale-pharaoh':
      return pharaohHooks();
    case 'royale-atlantis':
      return atlantisHooks();
    case 'neon-cyber-rush':
      return neonHooks();
    case 'mystic-forest':
      return mysticHooks();
    case 'samurai-fortune':
      return samuraiHooks();
    case 'cosmic-odyssey':
      return cosmicHooks();
    case 'dragons-kingdom':
      return dragonsHooks();
    case 'tropical-paradise':
      return tropicalHooks();
    case 'steampunk-revolution':
      return steampunkHooks();
    case 'frozen-empire':
      return frozenHooks();
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// 1. Pharaoh
// ---------------------------------------------------------------------------
function pharaohHooks(): GameHooks {
  return {
    beforeDraw(ctx) {
      // Pharaoh's Curse: at 10, turn 2 random reels wild
      const meter = (ctx.roundState.curseMeter as number) ?? 0;
      if (meter >= 10) {
        ctx.roundState.curseMeter = 0;
        const reelA = ctx.rng.int(4) + 1; // cols 1–4
        let reelB = ctx.rng.int(4) + 1;
        while (reelB === reelA) reelB = ctx.rng.int(4) + 1;
        const overrides: Array<{ row: number; col: number; symbolId: SlotSymbolId }> = [];
        for (let r = 0; r < ctx.config.rows; r++) {
          overrides.push({ row: r, col: reelA, symbolId: PHARAOH_SYMBOLS.WILD });
          overrides.push({ row: r, col: reelB, symbolId: PHARAOH_SYMBOLS.WILD });
        }
        return overrides;
      }
      return [];
    },
    beforeFreeSpin(ctx) {
      // In FS: any wild expands to fill its whole reel
      // Handled in afterCascade or initial FS grid
      return [];
    },
    onWins(ctx, grid, wins) {
      if (!ctx.inFreeSpins) {
        if (wins.length === 0) {
          const m = ((ctx.roundState.curseMeter as number) ?? 0) + 1;
          ctx.roundState.curseMeter = Math.min(m, 10);
        } else {
          ctx.roundState.curseMeter = 0;
        }
      }
      return {
        extraMeta: { curseMeter: ctx.roundState.curseMeter ?? 0 },
      };
    },
    afterCascade(ctx, grid) {
      // Golden Tomb: expand wilds to full reel in free spins
      if (!ctx.inFreeSpins) return [];
      const overrides: Array<{ row: number; col: number; symbolId: SlotSymbolId }> = [];
      for (let c = 1; c < ctx.config.reels; c++) {
        let hasWild = false;
        for (let r = 0; r < ctx.config.rows; r++) {
          if (grid[r][c] === PHARAOH_SYMBOLS.WILD) { hasWild = true; break; }
        }
        if (hasWild) {
          for (let r = 0; r < ctx.config.rows; r++) {
            overrides.push({ row: r, col: c, symbolId: PHARAOH_SYMBOLS.WILD });
          }
        }
      }
      return overrides;
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Atlantis
// ---------------------------------------------------------------------------
function atlantisHooks(): GameHooks {
  return {
    onWins(ctx, grid, wins, stepIdx) {
      let extraRemoved: Array<{ row: number; col: number }> = [];
      let extraMeta: Record<string, unknown> = {};

      // Kraken Sweep: if kraken on board, remove 1 random regular symbol type
      let hasKraken = false;
      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[r].length; c++) {
          if (grid[r][c] === ATLANTIS_SYMBOLS.KRAKEN) { hasKraken = true; break; }
        }
      }
      if (hasKraken) {
        const regulars = [
          ATLANTIS_SYMBOLS.OCEAN_KING, ATLANTIS_SYMBOLS.MERMAID, ATLANTIS_SYMBOLS.TRIDENT,
          ATLANTIS_SYMBOLS.PEARL, ATLANTIS_SYMBOLS.PALACE, ATLANTIS_SYMBOLS.SEA_DRAGON,
          ATLANTIS_SYMBOLS.DOLPHIN, ATLANTIS_SYMBOLS.SEA_TURTLE,
        ];
        const target = regulars[ctx.rng.int(regulars.length)];
        for (let r = 0; r < grid.length; r++) {
          for (let c = 0; c < grid[r].length; c++) {
            if (grid[r][c] === target || grid[r][c] === ATLANTIS_SYMBOLS.KRAKEN) {
              extraRemoved.push({ row: r, col: c });
            }
          }
        }
        extraMeta.krakenSweep = target;
      }

      // Treasure Chest: 3+ anywhere -> instant prize 5x-25x stake
      let chestCount = 0;
      for (const row of grid) for (const s of row) if (s === ATLANTIS_SYMBOLS.TREASURE) chestCount++;
      if (chestCount >= 3) {
        const mult = 5 + ctx.rng.int(21); // 5–25×
        const prizeBp = mult * 10000;
        wins.push({
          symbolId: ATLANTIS_SYMBOLS.TREASURE,
          count: chestCount,
          basepayBp: prizeBp,
          multiplierBp: 10000,
          payBp: prizeBp,
        });
        extraMeta.treasureBonusBp = prizeBp;
      }

      return { extraRemoved, extraMeta };
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Neon Cyber Rush
// ---------------------------------------------------------------------------
function neonHooks(): GameHooks {
  return {
    onWins(ctx, grid, wins) {
      // Overclock Respin: 2+ Glitch Wilds on board
      let wildCount = 0;
      const wildPos: Array<{ row: number; col: number }> = [];
      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[r].length; c++) {
          if (grid[r][c] === NEON_SYMBOLS.WILD) {
            wildCount++;
            wildPos.push({ row: r, col: c });
          }
        }
      }
      return {
        extraMeta: {
          overclockRespin: wildCount >= 2,
          lockedWilds: wildPos,
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Mystic Forest
// ---------------------------------------------------------------------------
function mysticHooks(): GameHooks {
  return {
    afterCascade(ctx, grid, stepIdx) {
      // Add 1 sticky Magic Tree Wild at random non-wild cell on cascade steps
      const nonWilds: Array<{ row: number; col: number }> = [];
      for (let r = 0; r < grid.length; r++) {
        for (let c = 1; c < grid[r].length - 1; c++) {
          if (grid[r][c] !== MYSTIC_SYMBOLS.WILD && grid[r][c] !== MYSTIC_SYMBOLS.TREE_WILD) {
            nonWilds.push({ row: r, col: c });
          }
        }
      }
      if (nonWilds.length > 0) {
        const pick = nonWilds[ctx.rng.int(nonWilds.length)];
        const sticky = (ctx.roundState.stickyWilds as Array<{ row: number; col: number }>) ?? [];
        sticky.push(pick);
        ctx.roundState.stickyWilds = sticky;
        return [{ row: pick.row, col: pick.col, symbolId: MYSTIC_SYMBOLS.TREE_WILD }];
      }
      return [];
    },
    beforeFreeSpin(ctx) {
      // Sticky tree wilds persist across free spins
      const sticky = (ctx.roundState.stickyWilds as Array<{ row: number; col: number }>) ?? [];
      return sticky.map((p) => ({ row: p.row, col: p.col, symbolId: MYSTIC_SYMBOLS.TREE_WILD }));
    },
  };
}

// ---------------------------------------------------------------------------
// 5. Samurai Fortune
// ---------------------------------------------------------------------------
function samuraiHooks(): GameHooks {
  return {
    beforeDraw(ctx) {
      // Katana Slash: 1 in 10 base spins → 1-3 random cells become wild
      if (!ctx.inFreeSpins && ctx.rng.int(10) === 0) {
        const count = 1 + ctx.rng.int(3);
        const overrides: Array<{ row: number; col: number; symbolId: SlotSymbolId }> = [];
        for (let i = 0; i < count; i++) {
          const r = ctx.rng.int(ctx.config.rows);
          const c = 1 + ctx.rng.int(ctx.config.reels - 1);
          overrides.push({ row: r, col: c, symbolId: SAMURAI_SYMBOLS.WILD });
        }
        ctx.roundState.katanaSlash = true;
        return overrides;
      }
      return [];
    },
    onWins(ctx, grid, wins) {
      // Bushido multiplier in FS: starts ×1, +1 per winning FS (cap ×10)
      if (ctx.inFreeSpins) {
        let bMult = (ctx.roundState.bushidoMultiplier as number) ?? 1;
        if (wins.length > 0) {
          for (const w of wins) {
            w.multiplierBp = bMult * 10000;
            w.payBp = Math.floor((w.basepayBp * w.multiplierBp) / 10000);
          }
          bMult = Math.min(bMult + 1, 10);
          ctx.roundState.bushidoMultiplier = bMult;
        }
        return { extraMeta: { bushidoMultiplier: bMult } };
      }
      return { extraMeta: { katanaSlash: ctx.roundState.katanaSlash ?? false } };
    },
  };
}

// ---------------------------------------------------------------------------
// 6. Cosmic Odyssey
// ---------------------------------------------------------------------------
function cosmicHooks(): GameHooks {
  return {
    onWins(ctx, grid, wins) {
      // Free spin Planet position multiplier (×2/×3/×5, cap ×25)
      if (ctx.inFreeSpins) {
        for (const w of wins) {
          if (w.symbolId === COSMIC_SYMBOLS.PLANET) {
            const multChoices = [2, 3, 5];
            const chosen = multChoices[ctx.rng.int(multChoices.length)];
            w.multiplierBp = Math.min(w.multiplierBp * chosen, 250000);
            w.payBp = Math.floor((w.basepayBp * w.multiplierBp) / 10000);
          }
        }
      }
      return {};
    },
  };
}

// ---------------------------------------------------------------------------
// 7. Dragon's Kingdom
// ---------------------------------------------------------------------------
function dragonsHooks(): GameHooks {
  return {
    beforeDraw(ctx) {
      // Dragon Fire: 1 in 14 base spins, 3–6 random low-pay cells burn to Wild
      if (!ctx.inFreeSpins && ctx.rng.int(14) === 0) {
        const count = 3 + ctx.rng.int(4); // 3–6
        const overrides: Array<{ row: number; col: number; symbolId: SlotSymbolId }> = [];
        for (let i = 0; i < count; i++) {
          const r = ctx.rng.int(ctx.config.rows);
          const c = 1 + ctx.rng.int(ctx.config.reels - 1);
          overrides.push({ row: r, col: c, symbolId: DRAGONS_SYMBOLS.WILD });
        }
        return overrides;
      }
      return [];
    },
    beforeFreeSpin(ctx) {
      // Sticky dragon wilds in FS
      const sticky = (ctx.roundState.stickyWilds as Array<{ row: number; col: number }>) ?? [];
      return sticky.map((p) => ({ row: p.row, col: p.col, symbolId: DRAGONS_SYMBOLS.WILD }));
    },
    onWins(ctx, grid) {
      if (ctx.inFreeSpins) {
        const sticky = (ctx.roundState.stickyWilds as Array<{ row: number; col: number }>) ?? [];
        for (let r = 0; r < grid.length; r++) {
          for (let c = 1; c < grid[r].length; c++) {
            if (grid[r][c] === DRAGONS_SYMBOLS.WILD) {
              if (!sticky.some((p) => p.row === r && p.col === c)) {
                sticky.push({ row: r, col: c });
              }
            }
          }
        }
        ctx.roundState.stickyWilds = sticky;
      }
      return {};
    },
  };
}

// ---------------------------------------------------------------------------
// 8. Tropical Paradise
// ---------------------------------------------------------------------------
function tropicalHooks(): GameHooks {
  return {}; // Uses configuration ladders directly
}

// ---------------------------------------------------------------------------
// 9. Steampunk Revolution
// ---------------------------------------------------------------------------
function steampunkHooks(): GameHooks {
  return {
    onWins(ctx, grid, wins) {
      let pressure = (ctx.roundState.steamPressure as number) ?? 0;
      let boilerBurstMult = 1;

      if (wins.length > 0) {
        // Boiler burst if pressure was at 100
        if (pressure >= 100) {
          boilerBurstMult = 2 + ctx.rng.int(9); // ×2–×10
          pressure = 0;
          for (const w of wins) {
            w.multiplierBp = boilerBurstMult * 10000;
            w.payBp = Math.floor((w.basepayBp * w.multiplierBp) / 10000);
          }
        } else {
          // Gain pressure = min(win in ×stake, 10) (doubled in FS)
          const totalWinBp = wins.reduce((s, w) => s + w.payBp, 0);
          const stakeMult = Math.min(Math.floor(totalWinBp / 10000), 10);
          const gain = ctx.inFreeSpins ? stakeMult * 2 : stakeMult;
          pressure = Math.min(pressure + gain, 100);
        }
      }
      ctx.roundState.steamPressure = pressure;
      return {
        extraMeta: {
          steamPressure: pressure,
          boilerBurstMultiplier: boilerBurstMult > 1 ? boilerBurstMult : undefined,
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 10. Frozen Empire
// ---------------------------------------------------------------------------
function frozenHooks(): GameHooks {
  return {
    onWins(ctx, grid, wins) {
      // Frost Lock: freeze winning cells
      const frozen = wins.flatMap((w) => w.positions ?? []);
      return {
        extraMeta: {
          frostLock: frozen.length > 0,
          frozenCount: frozen.length,
        },
      };
    },
  };
}

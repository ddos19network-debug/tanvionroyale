/**
 * ROYALE ATLANTIS (royale-atlantis) — game configuration.
 *
 * Grid: 7×7 (7 rows × 7 cols)
 * Win model: Cluster pays, orthogonal adjacency, min cluster 5
 * Wild: tidal_wild (joins any cluster, never self-wins)
 * Scatter: atlantis_gate (triggers free spins)
 *
 * Signature features:
 *   - Tumble (cascade) with multiplier ladder ×1→×2→×3→×5 per step
 *   - Kraken Sweep: kraken_emblem on a step removes one random regular symbol type
 *   - Treasure Chest: 3+ chests → instant prize 5×–25× stake
 *   - 4+ Gates → 10 free spins; 3+ retrigger = +5 spins
 *   - Persistent multiplier ladder in free spins
 *
 * Target RTP: 96.0%
 * Max win: 5,000× stake = 50,000,000 bp
 */

import type { SlotGameConfig } from '../core/types';
import { STAKE_LEVELS } from '../core/types';

export const ATLANTIS_SLUG = 'royale-atlantis';

export const ATLANTIS_SYMBOLS = {
  WILD: 'tidal_wild',
  SCATTER: 'atlantis_gate',
  TREASURE: 'treasure_chest',
  KRAKEN: 'kraken_emblem',
  OCEAN_KING: 'ocean_king',
  MERMAID: 'mermaid_queen',
  TRIDENT: 'golden_trident',
  PEARL: 'royal_pearl',
  PALACE: 'atlantis_palace',
  SEA_DRAGON: 'sea_dragon',
  DOLPHIN: 'dolphin',
  SEA_TURTLE: 'sea_turtle',
} as const;

// Cluster paytable: symbolId → array indexed by cluster size (index = size, capped at last)
// Last entry repeats for larger clusters. Example: [0,0,0,0,0,X,Y,Z] means size<5→0, 5→X, 6→Y, 7+→Z
const makePay = (...pays: number[]): number[] => {
  // Index represents cluster size; index 0–4 unused
  return [0, 0, 0, 0, 0, ...pays];
};

const PT: Record<string, number[]> = {
  'ocean_king': [0, 0, 0, 0, 0, 137, 273, 548, 1094, 2190],
  'mermaid_queen': [0, 0, 0, 0, 0, 82, 164, 327, 684, 1369],
  'golden_trident': [0, 0, 0, 0, 0, 55, 110, 219, 438, 959],
  'royal_pearl': [0, 0, 0, 0, 0, 41, 82, 164, 327, 684],
  'atlantis_palace': [0, 0, 0, 0, 0, 28, 55, 110, 219, 410],
  'sea_dragon': [0, 0, 0, 0, 0, 16, 32, 68, 137, 273],
  'dolphin': [0, 0, 0, 0, 0, 10, 22, 44, 82, 164],
  'sea_turtle': [0, 0, 0, 0, 0, 6, 10, 22, 44, 82],
};

const makeStrip = (
  ok: number, mq: number, gt: number, rp: number, ap: number,
  sd: number, dol: number, st: number,
  wild: number, scatter: number, treasure: number, kraken: number,
) => [
  { symbolId: ATLANTIS_SYMBOLS.OCEAN_KING,  weight: ok },
  { symbolId: ATLANTIS_SYMBOLS.MERMAID,     weight: mq },
  { symbolId: ATLANTIS_SYMBOLS.TRIDENT,     weight: gt },
  { symbolId: ATLANTIS_SYMBOLS.PEARL,       weight: rp },
  { symbolId: ATLANTIS_SYMBOLS.PALACE,      weight: ap },
  { symbolId: ATLANTIS_SYMBOLS.SEA_DRAGON,  weight: sd },
  { symbolId: ATLANTIS_SYMBOLS.DOLPHIN,     weight: dol },
  { symbolId: ATLANTIS_SYMBOLS.SEA_TURTLE,  weight: st },
  { symbolId: ATLANTIS_SYMBOLS.WILD,        weight: wild },
  { symbolId: ATLANTIS_SYMBOLS.SCATTER,     weight: scatter },
  { symbolId: ATLANTIS_SYMBOLS.TREASURE,    weight: treasure },
  { symbolId: ATLANTIS_SYMBOLS.KRAKEN,      weight: kraken },
];

// 7 identical strips (uniform board weights — tuner will adjust)
const baseStrip = makeStrip(5, 7, 8, 9, 10, 14, 16, 18, 8, 2, 2, 1);
const fsStrip   = makeStrip(6, 8, 9, 10, 11, 12, 14, 15, 14, 2, 2, 2);

export const ATLANTIS_CONFIG: SlotGameConfig = {
  slug: ATLANTIS_SLUG,
  title: 'ROYALE ATLANTIS',
  version: 1,
  winModel: 'cluster',
  reels: 7,
  rows: 7,
  symbols: [
    { id: ATLANTIS_SYMBOLS.WILD,       name: 'Tidal Wild',       tier: 'wild',    glyph: '🌊' },
    { id: ATLANTIS_SYMBOLS.SCATTER,    name: 'Atlantis Gate',    tier: 'scatter', glyph: '🏛' },
    { id: ATLANTIS_SYMBOLS.TREASURE,   name: 'Treasure Chest',   tier: 'bonus',   glyph: '📦' },
    { id: ATLANTIS_SYMBOLS.KRAKEN,     name: 'Kraken Emblem',    tier: 'bonus',   glyph: '🦑' },
    { id: ATLANTIS_SYMBOLS.OCEAN_KING, name: 'Ocean King',       tier: 'high',    glyph: '🔱' },
    { id: ATLANTIS_SYMBOLS.MERMAID,    name: 'Mermaid Queen',    tier: 'high',    glyph: '🧜' },
    { id: ATLANTIS_SYMBOLS.TRIDENT,    name: 'Golden Trident',   tier: 'high',    glyph: '⚡' },
    { id: ATLANTIS_SYMBOLS.PEARL,      name: 'Royal Pearl',      tier: 'high',    glyph: '🫧' },
    { id: ATLANTIS_SYMBOLS.PALACE,     name: 'Atlantis Palace',  tier: 'low',     glyph: '🏰' },
    { id: ATLANTIS_SYMBOLS.SEA_DRAGON, name: 'Sea Dragon',       tier: 'low',     glyph: '🐉' },
    { id: ATLANTIS_SYMBOLS.DOLPHIN,    name: 'Dolphin',          tier: 'low',     glyph: '🐬' },
    { id: ATLANTIS_SYMBOLS.SEA_TURTLE, name: 'Sea Turtle',       tier: 'low',     glyph: '🐢' },
  ],
  wildId: ATLANTIS_SYMBOLS.WILD,
  scatterId: ATLANTIS_SYMBOLS.SCATTER,
  minClusterSize: 5,
  paytableBp: PT,
  strips: Array(7).fill(baseStrip),
  freeSpinStrips: Array(7).fill(fsStrip),
  // Tumble multiplier ladder: ×1→×2→×3→×5 (10000, 20000, 30000, 50000)
  baseLadderBp:    [10000, 20000, 30000, 50000],
  freeSpinLadderBp:[10000, 20000, 30000, 50000],
  freeSpins: {
    triggerSymbol: ATLANTIS_SYMBOLS.SCATTER,
    triggerCount: 4,
    awarded: 10,
    retriggerCount: 3,
    retriggerAwarded: 5,
    maxSpinsPerRound: 80,
  },
  maxWinBp: 50_000_000, // 5000× stake
  stakeLevels: [...STAKE_LEVELS],
  maxCascadeStepsPerSpin: 15,
  features: {
    tumble: true,
    multiplierLadder: true,
    krakenSweep: true,
    treasureBonus: true,
  },
};

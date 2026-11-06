/**
 * ROYALE TROPICAL PARADISE (tropical-paradise) — game configuration.
 *
 * Grid: 5×4, Win model: 1024 ways (5 reels × 4 rows)
 * Wild: toucan_wild (reels 2–5, cols 1–4)
 * Scatter: treasure_scatter
 *
 * Signature: Island Tumble — cascade with ×1→×2→×3→×5 ladder.
 * In FS (3+ treasures → 10 spins) ladder starts at ×2.
 * Low volatility: higher hit frequency tuned to ≥ 30%.
 * Max win: 2,000× = 20,000,000 bp
 */

import type { SlotGameConfig } from '../core/types';
import { STAKE_LEVELS } from '../core/types';

export const TROPICAL_SLUG = 'tropical-paradise';

export const TROPICAL_SYMBOLS = {
  WILD:        'toucan_wild',
  SCATTER:     'treasure_scatter',
  TOUCAN:      'tropical_toucan',
  PARROT:      'rainbow_parrot',
  PINEAPPLE:   'golden_pineapple',
  COCONUT:     'coconut',
  WATERFALL:   'paradise_waterfall',
  FLOWER:      'hibiscus_flower',
  LEAF:        'palm_leaf',
  SHELL:       'tropical_shell',
} as const;

const PT: Record<string, number[]> = {
  'tropical_toucan': [0, 0, 0, 533, 1598, 5328],
  'rainbow_parrot': [0, 0, 0, 399, 1199, 3997],
  'golden_pineapple': [0, 0, 0, 267, 800, 2664],
  'coconut': [0, 0, 0, 187, 533, 1866],
  'paradise_waterfall': [0, 0, 0, 134, 399, 1333],
  'hibiscus_flower': [0, 0, 0, 80, 241, 800],
  'palm_leaf': [0, 0, 0, 53, 160, 533],
  'tropical_shell': [0, 0, 0, 27, 80, 267],
};

const makeStrip = (t:number,p:number,pi:number,c:number,w:number,f:number,l:number,s:number,wild:number,scatter:number) => [
  { symbolId: TROPICAL_SYMBOLS.TOUCAN,    weight: t },
  { symbolId: TROPICAL_SYMBOLS.PARROT,    weight: p },
  { symbolId: TROPICAL_SYMBOLS.PINEAPPLE, weight: pi },
  { symbolId: TROPICAL_SYMBOLS.COCONUT,   weight: c },
  { symbolId: TROPICAL_SYMBOLS.WATERFALL, weight: w },
  { symbolId: TROPICAL_SYMBOLS.FLOWER,    weight: f },
  { symbolId: TROPICAL_SYMBOLS.LEAF,      weight: l },
  { symbolId: TROPICAL_SYMBOLS.SHELL,     weight: s },
  { symbolId: TROPICAL_SYMBOLS.WILD,      weight: wild },
  { symbolId: TROPICAL_SYMBOLS.SCATTER,   weight: scatter },
];

// Lower-volatility: higher overall weights on mid-tier symbols
const r0 = makeStrip(5,6,8,10,12,15,18,22, 0,3);
const r1 = makeStrip(5,6,8,10,12,14,17,21, 8,3);
const r2 = makeStrip(5,6,7,10,12,14,17,20, 8,3);
const r3 = makeStrip(5,6,7, 9,11,14,17,20, 8,3);
const r4 = makeStrip(4,5,7, 9,11,14,16,20, 8,3);

const r0FS = makeStrip(6,7,9,11,13,14,16,19, 0,3);
const r1FS = makeStrip(6,7,9,11,13,13,15,18,13,3);
const r2FS = makeStrip(6,7,8,10,13,13,15,17,13,3);
const r3FS = makeStrip(5,7,8,10,12,13,15,17,13,3);
const r4FS = makeStrip(5,6,8,10,12,13,14,17,13,3);

export const TROPICAL_CONFIG: SlotGameConfig = {
  slug: TROPICAL_SLUG,
  title: 'ROYALE TROPICAL PARADISE',
  version: 1,
  winModel: 'ways',
  reels: 5,
  rows: 4,
  symbols: [
    { id: TROPICAL_SYMBOLS.WILD,       name: 'Toucan Wild',          tier: 'wild',    glyph: '🦜' },
    { id: TROPICAL_SYMBOLS.SCATTER,    name: 'Treasure',             tier: 'scatter', glyph: '💰' },
    { id: TROPICAL_SYMBOLS.TOUCAN,     name: 'Tropical Toucan',      tier: 'high',    glyph: '🐦' },
    { id: TROPICAL_SYMBOLS.PARROT,     name: 'Rainbow Parrot',       tier: 'high',    glyph: '🦜' },
    { id: TROPICAL_SYMBOLS.PINEAPPLE,  name: 'Golden Pineapple',     tier: 'high',    glyph: '🍍' },
    { id: TROPICAL_SYMBOLS.COCONUT,    name: 'Coconut',              tier: 'high',    glyph: '🥥' },
    { id: TROPICAL_SYMBOLS.WATERFALL,  name: 'Paradise Waterfall',   tier: 'low',     glyph: '🌊' },
    { id: TROPICAL_SYMBOLS.FLOWER,     name: 'Hibiscus Flower',      tier: 'low',     glyph: '🌺' },
    { id: TROPICAL_SYMBOLS.LEAF,       name: 'Palm Leaf',            tier: 'low',     glyph: '🌴' },
    { id: TROPICAL_SYMBOLS.SHELL,      name: 'Tropical Shell',       tier: 'low',     glyph: '🐚' },
  ],
  wildId: TROPICAL_SYMBOLS.WILD,
  scatterId: TROPICAL_SYMBOLS.SCATTER,
  paytableBp: PT,
  strips: [r0, r1, r2, r3, r4],
  freeSpinStrips: [r0FS, r1FS, r2FS, r3FS, r4FS],
  baseLadderBp:    [10000, 20000, 30000, 50000],
  freeSpinLadderBp:[20000, 30000, 50000, 50000], // FS ladder starts at ×2
  freeSpins: {
    triggerSymbol: TROPICAL_SYMBOLS.SCATTER,
    triggerCount: 3,
    awarded: 10,
    retriggerCount: 3,
    retriggerAwarded: 5,
    maxSpinsPerRound: 60,
  },
  maxWinBp: 20_000_000,
  stakeLevels: [...STAKE_LEVELS],
  maxCascadeStepsPerSpin: 10,
  features: { islandTumble: true, fsLadderBoost: true },
};

/**
 * ROYALE MYSTIC FOREST (mystic-forest) — game configuration.
 *
 * Grid: 5×4, Win model: 1024 ways (5 reels × 4 rows)
 * Wild: fairy_wild (reels 2–4, cols 1–3)
 * Scatter: dragon_egg_scatter
 *
 * Signature: Enchanted Tumble + Growing Tree Wild — wins tumble; each cascade
 * step adds 1 sticky Magic Tree Wild at a random non-wild cell (max 5/spin).
 * 3+ Eggs → 8 FS in which Tree Wilds persist across the FS sequence.
 * Max win: 2,500× = 25,000,000 bp
 */

import type { SlotGameConfig } from '../core/types';
import { STAKE_LEVELS } from '../core/types';

export const MYSTIC_SLUG = 'mystic-forest';

export const MYSTIC_SYMBOLS = {
  WILD:        'fairy_wild',
  SCATTER:     'dragon_egg_scatter',
  TREE_WILD:   'magic_tree_wild',
  FAIRY:       'forest_fairy',
  CRYSTAL:     'magic_crystal',
  OWL:         'wise_owl',
  MUSHROOM:    'enchanted_mushroom',
  DEER:        'mystic_deer',
  FLOWER:      'moon_flower',
  LEAF:        'golden_leaf',
} as const;

const PT: Record<string, number[]> = {
  'forest_fairy': [0, 0, 0, 624, 1874, 6246],
  'magic_crystal': [0, 0, 0, 468, 1405, 4684],
  'wise_owl': [0, 0, 0, 313, 937, 3122],
  'enchanted_mushroom': [0, 0, 0, 218, 624, 2186],
  'mystic_deer': [0, 0, 0, 156, 468, 1561],
  'moon_flower': [0, 0, 0, 93, 281, 937],
  'golden_leaf': [0, 0, 0, 47, 141, 468],
};

const makeStrip = (f:number,c:number,o:number,m:number,d:number,fl:number,l:number,wild:number,scatter:number) => [
  { symbolId: MYSTIC_SYMBOLS.FAIRY,     weight: f },
  { symbolId: MYSTIC_SYMBOLS.CRYSTAL,   weight: c },
  { symbolId: MYSTIC_SYMBOLS.OWL,       weight: o },
  { symbolId: MYSTIC_SYMBOLS.MUSHROOM,  weight: m },
  { symbolId: MYSTIC_SYMBOLS.DEER,      weight: d },
  { symbolId: MYSTIC_SYMBOLS.FLOWER,    weight: fl },
  { symbolId: MYSTIC_SYMBOLS.LEAF,      weight: l },
  { symbolId: MYSTIC_SYMBOLS.WILD,      weight: wild },
  { symbolId: MYSTIC_SYMBOLS.SCATTER,   weight: scatter },
];

const r0 = makeStrip(5,6,8,9,11,14,18, 0,3);
const r1 = makeStrip(5,6,8,9,11,13,17, 7,3);
const r2 = makeStrip(5,6,7,9,11,13,16, 7,3);
const r3 = makeStrip(5,6,7,8,10,13,16, 7,3);
const r4 = makeStrip(4,5,7,8,10,13,16, 0,3);

const r0FS = makeStrip(6,7,9,10,12,13,15, 0,3);
const r1FS = makeStrip(6,7,8,10,12,12,14,12,3);
const r2FS = makeStrip(6,7,8,9,12,12,13,12,3);
const r3FS = makeStrip(5,7,8,9,11,12,13,12,3);
const r4FS = makeStrip(5,6,8,9,11,12,13, 0,3);

export const MYSTIC_CONFIG: SlotGameConfig = {
  slug: MYSTIC_SLUG,
  title: 'ROYALE MYSTIC FOREST',
  version: 1,
  winModel: 'ways',
  reels: 5,
  rows: 4,
  symbols: [
    { id: MYSTIC_SYMBOLS.WILD,        name: 'Fairy Wild',           tier: 'wild',    glyph: '🧚' },
    { id: MYSTIC_SYMBOLS.SCATTER,     name: 'Dragon Egg',           tier: 'scatter', glyph: '🥚' },
    { id: MYSTIC_SYMBOLS.TREE_WILD,   name: 'Magic Tree Wild',      tier: 'wild',    glyph: '🌳' },
    { id: MYSTIC_SYMBOLS.FAIRY,       name: 'Forest Fairy',         tier: 'high',    glyph: '✨' },
    { id: MYSTIC_SYMBOLS.CRYSTAL,     name: 'Magic Crystal',        tier: 'high',    glyph: '💎' },
    { id: MYSTIC_SYMBOLS.OWL,         name: 'Wise Owl',             tier: 'high',    glyph: '🦉' },
    { id: MYSTIC_SYMBOLS.MUSHROOM,    name: 'Enchanted Mushroom',   tier: 'low',     glyph: '🍄' },
    { id: MYSTIC_SYMBOLS.DEER,        name: 'Mystic Deer',          tier: 'low',     glyph: '🦌' },
    { id: MYSTIC_SYMBOLS.FLOWER,      name: 'Moon Flower',          tier: 'low',     glyph: '🌙' },
    { id: MYSTIC_SYMBOLS.LEAF,        name: 'Golden Leaf',          tier: 'low',     glyph: '🍃' },
  ],
  wildId: MYSTIC_SYMBOLS.WILD,
  scatterId: MYSTIC_SYMBOLS.SCATTER,
  paytableBp: PT,
  strips: [r0, r1, r2, r3, r4],
  freeSpinStrips: [r0FS, r1FS, r2FS, r3FS, r4FS],
  baseLadderBp:    [10000, 20000, 30000, 50000],
  freeSpinLadderBp:[10000, 20000, 30000, 50000],
  freeSpins: {
    triggerSymbol: MYSTIC_SYMBOLS.SCATTER,
    triggerCount: 3,
    awarded: 8,
    retriggerCount: 3,
    retriggerAwarded: 5,
    maxSpinsPerRound: 60,
  },
  maxWinBp: 25_000_000,
  stakeLevels: [...STAKE_LEVELS],
  maxCascadeStepsPerSpin: 10,
  features: { enchantedTumble: true, growingTreeWild: true, stickyFsWilds: true },
};

/**
 * ROYALE DRAGON'S KINGDOM (dragons-kingdom) — game configuration.
 *
 * Grid: 5×4, Win model: 20 paylines, left-to-right
 * Wild: dragon_wild (reels 2–5, cols 1–4)
 * Scatter: castle_scatter
 *
 * Signature: Dragon Fire — 1 in 14 base spins: 3–6 random low-pay cells burn
 * into Wilds. 3+ Castles → 8 FS where Dragon Wilds are sticky for the whole FS.
 * Max win: 2,500× = 25,000,000 bp
 */

import type { SlotGameConfig } from '../core/types';
import { STAKE_LEVELS } from '../core/types';

export const DRAGONS_SLUG = 'dragons-kingdom';

export const DRAGONS_SYMBOLS = {
  WILD:        'dragon_wild',
  SCATTER:     'castle_scatter',
  DRAGON:      'mighty_dragon',
  KNIGHT:      'dragon_knight',
  CROWN:       'dragon_crown',
  SWORD:       'dragon_sword',
  SHIELD:      'battle_shield',
  COIN:        'dragon_coin',
  GEM:         'fire_gem',
  FEATHER:     'dragon_feather',
} as const;

// 20 paylines
export const DRAGONS_PAYLINES = [
  {rows:[0,0,0,0,0]},{rows:[1,1,1,1,1]},{rows:[2,2,2,2,2]},{rows:[3,3,3,3,3]},
  {rows:[0,1,2,1,0]},{rows:[1,2,3,2,1]},{rows:[2,1,0,1,2]},{rows:[3,2,1,2,3]},
  {rows:[0,1,0,1,0]},{rows:[1,2,1,2,1]},{rows:[2,3,2,3,2]},{rows:[1,0,1,0,1]},
  {rows:[0,0,1,2,3]},{rows:[3,3,2,1,0]},{rows:[0,1,2,3,3]},{rows:[3,2,1,0,0]},
  {rows:[1,0,0,0,1]},{rows:[2,3,3,3,2]},{rows:[0,1,1,1,0]},{rows:[3,2,2,2,3]},
];

const PT: Record<string, number[]> = {
  'mighty_dragon': [0, 0, 0, 3865, 12888, 48330],
  'dragon_knight': [0, 0, 0, 3223, 9666, 32220],
  'dragon_crown': [0, 0, 0, 2578, 8054, 25776],
  'dragon_sword': [0, 0, 0, 1933, 5800, 19332],
  'battle_shield': [0, 0, 0, 1288, 3865, 12888],
  'dragon_coin': [0, 0, 0, 806, 2416, 8054],
  'fire_gem': [0, 0, 0, 484, 1611, 4834],
  'dragon_feather': [0, 0, 0, 258, 806, 2578],
};

const makeStrip = (dr:number,kn:number,cr:number,sw:number,sh:number,co:number,ge:number,fe:number,wild:number,scatter:number) => [
  { symbolId: DRAGONS_SYMBOLS.DRAGON,  weight: dr },
  { symbolId: DRAGONS_SYMBOLS.KNIGHT,  weight: kn },
  { symbolId: DRAGONS_SYMBOLS.CROWN,   weight: cr },
  { symbolId: DRAGONS_SYMBOLS.SWORD,   weight: sw },
  { symbolId: DRAGONS_SYMBOLS.SHIELD,  weight: sh },
  { symbolId: DRAGONS_SYMBOLS.COIN,    weight: co },
  { symbolId: DRAGONS_SYMBOLS.GEM,     weight: ge },
  { symbolId: DRAGONS_SYMBOLS.FEATHER, weight: fe },
  { symbolId: DRAGONS_SYMBOLS.WILD,    weight: wild },
  { symbolId: DRAGONS_SYMBOLS.SCATTER, weight: scatter },
];

const r0 = makeStrip(5,6,7,8,10,13,16,20, 0,3);
const r1 = makeStrip(5,6,7,8,10,13,15,19, 7,3);
const r2 = makeStrip(5,5,7,8, 9,12,15,18, 7,3);
const r3 = makeStrip(4,5,6,8, 9,12,15,18, 7,3);
const r4 = makeStrip(4,5,6,7, 9,12,14,17, 7,3);

const r0FS = makeStrip(6,7,8,9,11,12,15,18, 0,3);
const r1FS = makeStrip(6,7,8,9,11,12,14,17,12,3);
const r2FS = makeStrip(6,6,8,9,10,11,14,16,12,3);
const r3FS = makeStrip(5,6,7,9,10,11,14,16,12,3);
const r4FS = makeStrip(5,6,7,8,10,11,13,16,12,3);

export const DRAGONS_CONFIG: SlotGameConfig = {
  slug: DRAGONS_SLUG,
  title: "ROYALE DRAGON'S KINGDOM",
  version: 1,
  winModel: 'paylines',
  reels: 5,
  rows: 4,
  symbols: [
    { id: DRAGONS_SYMBOLS.WILD,     name: 'Dragon Wild',    tier: 'wild',    glyph: '🐲' },
    { id: DRAGONS_SYMBOLS.SCATTER,  name: 'Castle',         tier: 'scatter', glyph: '🏰' },
    { id: DRAGONS_SYMBOLS.DRAGON,   name: 'Mighty Dragon',  tier: 'high',    glyph: '🦕' },
    { id: DRAGONS_SYMBOLS.KNIGHT,   name: 'Dragon Knight',  tier: 'high',    glyph: '⚔️' },
    { id: DRAGONS_SYMBOLS.CROWN,    name: 'Dragon Crown',   tier: 'high',    glyph: '👑' },
    { id: DRAGONS_SYMBOLS.SWORD,    name: 'Dragon Sword',   tier: 'high',    glyph: '🗡️' },
    { id: DRAGONS_SYMBOLS.SHIELD,   name: 'Battle Shield',  tier: 'low',     glyph: '🛡️' },
    { id: DRAGONS_SYMBOLS.COIN,     name: 'Dragon Coin',    tier: 'low',     glyph: '🪙' },
    { id: DRAGONS_SYMBOLS.GEM,      name: 'Fire Gem',       tier: 'low',     glyph: '💎' },
    { id: DRAGONS_SYMBOLS.FEATHER,  name: 'Dragon Feather', tier: 'low',     glyph: '🪶' },
  ],
  wildId: DRAGONS_SYMBOLS.WILD,
  scatterId: DRAGONS_SYMBOLS.SCATTER,
  paylines: DRAGONS_PAYLINES,
  paytableBp: PT,
  strips: [r0, r1, r2, r3, r4],
  freeSpinStrips: [r0FS, r1FS, r2FS, r3FS, r4FS],
  baseLadderBp:    [10000],
  freeSpinLadderBp:[10000],
  freeSpins: {
    triggerSymbol: DRAGONS_SYMBOLS.SCATTER,
    triggerCount: 3,
    awarded: 8,
    retriggerCount: 3,
    retriggerAwarded: 5,
    maxSpinsPerRound: 50,
  },
  maxWinBp: 25_000_000,
  stakeLevels: [...STAKE_LEVELS],
  maxCascadeStepsPerSpin: 1,
  features: { dragonFire: true, stickyWildsFs: true },
};

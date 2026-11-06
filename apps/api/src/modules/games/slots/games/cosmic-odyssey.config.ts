/**
 * ROYALE COSMIC ODYSSEY (cosmic-odyssey) — game configuration.
 *
 * Grid: 5×4, Win model: 40 paylines, left-to-right
 * Wild: star_wild (reels 2–4, cols 1–3)
 * Scatter: space_station_scatter
 *
 * Signature: Gravity Respin — a Star Wild part of a win expands over its reel
 * and awards one respin (max 2 chained). 3+ Stations → 10 FS; in FS every
 * Planet symbol has a position multiplier ×2/×3/×5 applied (cap ×25 per line).
 * Max win: 3,000× = 30,000,000 bp
 */

import type { SlotGameConfig } from '../core/types';
import { STAKE_LEVELS } from '../core/types';

export const COSMIC_SLUG = 'cosmic-odyssey';

export const COSMIC_SYMBOLS = {
  WILD:        'star_wild',
  SCATTER:     'space_station_scatter',
  ASTRONAUT:   'astronaut',
  ALIEN:       'alien_commander',
  PLANET:      'ringed_planet',
  UFO:         'ufo_ship',
  COMET:       'comet',
  NEBULA:      'nebula_cloud',
  METEOR:      'meteor',
  SATELLITE:   'satellite',
} as const;

// 40-payline grid (5 reels × 4 rows — rows 0–3)
export const COSMIC_PAYLINES = Array.from({ length: 40 }, (_, i) => {
  // Generate 40 distinct paylines deterministically
  const patterns = [
    [0,0,0,0,0],[1,1,1,1,1],[2,2,2,2,2],[3,3,3,3,3],
    [0,1,2,1,0],[1,2,3,2,1],[2,1,0,1,2],[3,2,1,2,3],
    [0,1,0,1,0],[1,2,1,2,1],[2,3,2,3,2],[3,2,3,2,3],
    [1,0,1,0,1],[2,1,2,1,2],[0,1,2,3,3],[3,2,1,0,0],
    [0,0,1,2,3],[3,3,2,1,0],[1,0,0,0,1],[2,3,3,3,2],
    [0,1,1,1,0],[3,2,2,2,3],[1,1,0,1,1],[2,2,3,2,2],
    [0,2,1,2,0],[3,1,2,1,3],[0,0,2,0,0],[3,3,1,3,3],
    [1,2,3,3,2],[2,1,0,0,1],[0,1,3,1,0],[3,2,0,2,3],
    [0,2,0,2,0],[3,1,3,1,3],[1,3,1,3,1],[2,0,2,0,2],
    [0,3,1,3,0],[3,0,2,0,3],[1,2,0,2,1],[2,1,3,1,2],
  ];
  return { rows: patterns[i] };
});

const PT: Record<string, number[]> = {
  'astronaut': [0, 0, 0, 10545, 32955, 105456],
  'alien_commander': [0, 0, 0, 7909, 26364, 79092],
  'ringed_planet': [0, 0, 0, 6591, 19773, 65910],
  'ufo_ship': [0, 0, 0, 5273, 15818, 52727],
  'comet': [0, 0, 0, 3296, 10545, 32955],
  'nebula_cloud': [0, 0, 0, 1977, 6591, 19773],
  'meteor': [0, 0, 0, 1318, 3956, 13182],
  'satellite': [0, 0, 0, 989, 2636, 9228],
};

const makeStrip = (a:number,al:number,p:number,u:number,c:number,n:number,m:number,s:number,wild:number,scatter:number) => [
  { symbolId: COSMIC_SYMBOLS.ASTRONAUT,  weight: a },
  { symbolId: COSMIC_SYMBOLS.ALIEN,      weight: al },
  { symbolId: COSMIC_SYMBOLS.PLANET,     weight: p },
  { symbolId: COSMIC_SYMBOLS.UFO,        weight: u },
  { symbolId: COSMIC_SYMBOLS.COMET,      weight: c },
  { symbolId: COSMIC_SYMBOLS.NEBULA,     weight: n },
  { symbolId: COSMIC_SYMBOLS.METEOR,     weight: m },
  { symbolId: COSMIC_SYMBOLS.SATELLITE,  weight: s },
  { symbolId: COSMIC_SYMBOLS.WILD,       weight: wild },
  { symbolId: COSMIC_SYMBOLS.SCATTER,    weight: scatter },
];

const r0 = makeStrip(5,6,8,8,10,13,15,18, 0,3);
const r1 = makeStrip(5,6,8,8,10,13,14,17, 6,3);
const r2 = makeStrip(5,6,7,8,10,12,14,17, 6,3);
const r3 = makeStrip(4,6,7,8,10,12,14,16, 0,3);
const r4 = makeStrip(4,5,7,8, 9,12,14,16, 0,3);

const r0FS = makeStrip(6,7,9,9,11,12,14,16, 0,3);
const r1FS = makeStrip(6,7,9,9,11,12,13,15,10,3);
const r2FS = makeStrip(6,7,8,9,11,11,13,14,10,3);
const r3FS = makeStrip(5,7,8,9,11,11,13,14, 0,3);
const r4FS = makeStrip(5,6,8,8,10,11,13,14, 0,3);

export const COSMIC_CONFIG: SlotGameConfig = {
  slug: COSMIC_SLUG,
  title: 'ROYALE COSMIC ODYSSEY',
  version: 1,
  winModel: 'paylines',
  reels: 5,
  rows: 4,
  symbols: [
    { id: COSMIC_SYMBOLS.WILD,       name: 'Star Wild',          tier: 'wild',    glyph: '⭐' },
    { id: COSMIC_SYMBOLS.SCATTER,    name: 'Space Station',      tier: 'scatter', glyph: '🛸' },
    { id: COSMIC_SYMBOLS.ASTRONAUT,  name: 'Astronaut',          tier: 'high',    glyph: '👨‍🚀' },
    { id: COSMIC_SYMBOLS.ALIEN,      name: 'Alien Commander',    tier: 'high',    glyph: '👽' },
    { id: COSMIC_SYMBOLS.PLANET,     name: 'Ringed Planet',      tier: 'high',    glyph: '🪐' },
    { id: COSMIC_SYMBOLS.UFO,        name: 'UFO Ship',           tier: 'high',    glyph: '🛸' },
    { id: COSMIC_SYMBOLS.COMET,      name: 'Comet',              tier: 'low',     glyph: '☄️' },
    { id: COSMIC_SYMBOLS.NEBULA,     name: 'Nebula Cloud',       tier: 'low',     glyph: '🌌' },
    { id: COSMIC_SYMBOLS.METEOR,     name: 'Meteor',             tier: 'low',     glyph: '🌠' },
    { id: COSMIC_SYMBOLS.SATELLITE,  name: 'Satellite',          tier: 'low',     glyph: '🛰️' },
  ],
  wildId: COSMIC_SYMBOLS.WILD,
  scatterId: COSMIC_SYMBOLS.SCATTER,
  paylines: COSMIC_PAYLINES,
  paytableBp: PT,
  strips: [r0, r1, r2, r3, r4],
  freeSpinStrips: [r0FS, r1FS, r2FS, r3FS, r4FS],
  baseLadderBp:    [10000],
  freeSpinLadderBp:[10000],
  freeSpins: {
    triggerSymbol: COSMIC_SYMBOLS.SCATTER,
    triggerCount: 3,
    awarded: 10,
    retriggerCount: 3,
    retriggerAwarded: 5,
    maxSpinsPerRound: 60,
  },
  maxWinBp: 30_000_000,
  stakeLevels: [...STAKE_LEVELS],
  maxCascadeStepsPerSpin: 1,
  features: { gravityRespin: true, planetMultiplier: true },
};

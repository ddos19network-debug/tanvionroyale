/**
 * ROYALE NEON CYBER RUSH (neon-cyber-rush) — game configuration.
 *
 * Grid: 6×4, Win model: 4096 ways (6 reels × 4 rows), 3+ left-to-right
 * Wild: glitch_wild (reels 2–6, cols 1–5)
 * Scatter: data_core_scatter
 *
 * Signature: Overclock Respin — 2+ Glitch Wilds → locked respin (max 3,
 * resets on new wild, max 6 chained). 3+ Data Cores → 8 FS with ×2 wins.
 * Max win: 4,000× = 40,000,000 bp
 */

import type { SlotGameConfig } from '../core/types';
import { STAKE_LEVELS } from '../core/types';

export const NEON_SLUG = 'neon-cyber-rush';

export const NEON_SYMBOLS = {
  WILD:    'glitch_wild',
  SCATTER: 'data_core_scatter',
  CYBER_ROBOT:  'cyber_robot',
  HACKER:       'hacker',
  NEON_CHIP:    'neon_chip',
  HOLOGRAM:     'hologram',
  ENERGY_CORE:  'energy_core',
  CIRCUIT:      'circuit_board',
  BYTE:         'data_byte',
  PIXEL:        'pixel_block',
} as const;

const PT: Record<string, number[]> = {
  'cyber_robot': [0, 0, 0, 213, 640, 2135, 6404],
  'hacker': [0, 0, 0, 160, 480, 1601, 4803],
  'neon_chip': [0, 0, 0, 107, 320, 1067, 3202],
  'hologram': [0, 0, 0, 75, 213, 747, 2135],
  'energy_core': [0, 0, 0, 53, 160, 534, 1601],
  'circuit_board': [0, 0, 0, 32, 96, 320, 961],
  'data_byte': [0, 0, 0, 21, 64, 213, 640],
  'pixel_block': [0, 0, 0, 11, 32, 107, 320],
};

const makeStrip = (cr:number,hk:number,nc:number,holo:number,ec:number,circ:number,byte:number,pix:number,wild:number,scatter:number) => [
  { symbolId: NEON_SYMBOLS.CYBER_ROBOT, weight: cr },
  { symbolId: NEON_SYMBOLS.HACKER,      weight: hk },
  { symbolId: NEON_SYMBOLS.NEON_CHIP,   weight: nc },
  { symbolId: NEON_SYMBOLS.HOLOGRAM,    weight: holo },
  { symbolId: NEON_SYMBOLS.ENERGY_CORE, weight: ec },
  { symbolId: NEON_SYMBOLS.CIRCUIT,     weight: circ },
  { symbolId: NEON_SYMBOLS.BYTE,        weight: byte },
  { symbolId: NEON_SYMBOLS.PIXEL,       weight: pix },
  { symbolId: NEON_SYMBOLS.WILD,        weight: wild },
  { symbolId: NEON_SYMBOLS.SCATTER,     weight: scatter },
];

const r0 = makeStrip(4,5,6,7,8,12,14,16, 0, 3);
const r1 = makeStrip(4,5,6,7,8,12,14,15, 6, 3);
const r2 = makeStrip(4,5,6,7,7,11,13,15, 6, 3);
const r3 = makeStrip(3,5,6,7,7,11,13,15, 6, 3);
const r4 = makeStrip(3,4,6,6,7,11,13,15, 6, 3);
const r5 = makeStrip(3,4,5,6,7,11,13,14, 6, 3);

const r0FS = makeStrip(5,6,7,8,9,10,12,13, 0, 3);
const r1FS = makeStrip(5,6,7,8,9,10,12,13,10, 3);
const r2FS = makeStrip(5,6,7,8,9,10,11,12,10, 3);
const r3FS = makeStrip(4,6,7,8,9,10,11,12,10, 3);
const r4FS = makeStrip(4,5,7,7,9,10,11,12,10, 3);
const r5FS = makeStrip(4,5,6,7,8,10,11,12,10, 3);

export const NEON_CONFIG: SlotGameConfig = {
  slug: NEON_SLUG,
  title: 'ROYALE NEON CYBER RUSH',
  version: 1,
  winModel: 'ways',
  reels: 6,
  rows: 4,
  symbols: [
    { id: NEON_SYMBOLS.WILD,        name: 'Glitch Wild',       tier: 'wild',    glyph: '⚡' },
    { id: NEON_SYMBOLS.SCATTER,     name: 'Data Core',         tier: 'scatter', glyph: '💾' },
    { id: NEON_SYMBOLS.CYBER_ROBOT, name: 'Cyber Robot',       tier: 'high',    glyph: '🤖' },
    { id: NEON_SYMBOLS.HACKER,      name: 'Hacker',            tier: 'high',    glyph: '👨‍💻' },
    { id: NEON_SYMBOLS.NEON_CHIP,   name: 'Neon Chip',         tier: 'high',    glyph: '🔮' },
    { id: NEON_SYMBOLS.HOLOGRAM,    name: 'Hologram',          tier: 'high',    glyph: '🌀' },
    { id: NEON_SYMBOLS.ENERGY_CORE, name: 'Energy Core',       tier: 'low',     glyph: '🔋' },
    { id: NEON_SYMBOLS.CIRCUIT,     name: 'Circuit Board',     tier: 'low',     glyph: '🖥' },
    { id: NEON_SYMBOLS.BYTE,        name: 'Data Byte',         tier: 'low',     glyph: '📡' },
    { id: NEON_SYMBOLS.PIXEL,       name: 'Pixel Block',       tier: 'low',     glyph: '🔲' },
  ],
  wildId: NEON_SYMBOLS.WILD,
  scatterId: NEON_SYMBOLS.SCATTER,
  paytableBp: PT,
  strips: [r0, r1, r2, r3, r4, r5],
  freeSpinStrips: [r0FS, r1FS, r2FS, r3FS, r4FS, r5FS],
  baseLadderBp:    [10000],
  freeSpinLadderBp:[20000], // ×2 during free spins
  freeSpins: {
    triggerSymbol: NEON_SYMBOLS.SCATTER,
    triggerCount: 3,
    awarded: 8,
    retriggerCount: 3,
    retriggerAwarded: 5,
    maxSpinsPerRound: 50,
  },
  maxWinBp: 40_000_000,
  stakeLevels: [...STAKE_LEVELS],
  maxCascadeStepsPerSpin: 1,
  features: { overclockRespin: true, expandingWild: true },
};

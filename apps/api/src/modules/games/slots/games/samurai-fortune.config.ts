/**
 * ROYALE SAMURAI FORTUNE (samurai-fortune) — game configuration.
 *
 * Grid: 5×5, Win model: 3125 ways (5 reels × 5 rows)
 * Wild: katana_wild (reels 2–5, cols 1–4)
 * Scatter: temple_gate_scatter
 *
 * Signature: Katana Slash — 1 in 10 base spins: 1–3 random cells become wild.
 * 3+ Gates → 10 FS with Bushido multiplier (+1 after each winning FS, cap ×10).
 * Max win: 4,000× = 40,000,000 bp
 */

import type { SlotGameConfig } from '../core/types';
import { STAKE_LEVELS } from '../core/types';

export const SAMURAI_SLUG = 'samurai-fortune';

export const SAMURAI_SYMBOLS = {
  WILD:        'katana_wild',
  SCATTER:     'temple_gate_scatter',
  SAMURAI:     'samurai_warrior',
  DRAGON:      'dragon_spirit',
  KATANA:      'katana_blade',
  SAKURA:      'sakura_blossom',
  MASK:        'demon_mask',
  COIN:        'gold_coin',
  FAN:         'battle_fan',
  SCROLL:      'ancient_scroll',
} as const;

const PT: Record<string, number[]> = {
  'samurai_warrior': [0, 0, 0, 95, 288, 960],
  'dragon_spirit': [0, 0, 0, 72, 216, 720],
  'katana_blade': [0, 0, 0, 49, 144, 480],
  'sakura_blossom': [0, 0, 0, 33, 95, 336],
  'demon_mask': [0, 0, 0, 24, 72, 240],
  'gold_coin': [0, 0, 0, 14, 44, 144],
  'battle_fan': [0, 0, 0, 10, 29, 95],
  'ancient_scroll': [0, 0, 0, 5, 14, 49],
};

const makeStrip = (s:number,d:number,k:number,sa:number,m:number,c:number,f:number,sc:number,wild:number,scatter:number) => [
  { symbolId: SAMURAI_SYMBOLS.SAMURAI,  weight: s },
  { symbolId: SAMURAI_SYMBOLS.DRAGON,   weight: d },
  { symbolId: SAMURAI_SYMBOLS.KATANA,   weight: k },
  { symbolId: SAMURAI_SYMBOLS.SAKURA,   weight: sa },
  { symbolId: SAMURAI_SYMBOLS.MASK,     weight: m },
  { symbolId: SAMURAI_SYMBOLS.COIN,     weight: c },
  { symbolId: SAMURAI_SYMBOLS.FAN,      weight: f },
  { symbolId: SAMURAI_SYMBOLS.SCROLL,   weight: sc },
  { symbolId: SAMURAI_SYMBOLS.WILD,     weight: wild },
  { symbolId: SAMURAI_SYMBOLS.SCATTER,  weight: scatter },
];

const r0 = makeStrip(5,6,7,8,10,13,15,18, 0,3);
const r1 = makeStrip(5,6,7,8,10,13,14,17, 6,3);
const r2 = makeStrip(4,6,7,8,10,12,14,16, 6,3);
const r3 = makeStrip(4,5,7,7,10,12,14,16, 6,3);
const r4 = makeStrip(4,5,6,7, 9,12,13,15, 6,3);

const r0FS = makeStrip(6,7,8,9,11,12,14,16, 0,3);
const r1FS = makeStrip(6,7,8,9,11,12,13,15,10,3);
const r2FS = makeStrip(5,7,8,9,11,11,13,14,10,3);
const r3FS = makeStrip(5,6,8,8,10,11,13,14,10,3);
const r4FS = makeStrip(5,6,7,8,10,11,12,14,10,3);

export const SAMURAI_CONFIG: SlotGameConfig = {
  slug: SAMURAI_SLUG,
  title: 'ROYALE SAMURAI FORTUNE',
  version: 1,
  winModel: 'ways',
  reels: 5,
  rows: 5,
  symbols: [
    { id: SAMURAI_SYMBOLS.WILD,     name: 'Katana Wild',          tier: 'wild',    glyph: '⚔️' },
    { id: SAMURAI_SYMBOLS.SCATTER,  name: 'Temple Gate',          tier: 'scatter', glyph: '⛩️' },
    { id: SAMURAI_SYMBOLS.SAMURAI,  name: 'Samurai Warrior',      tier: 'high',    glyph: '🥷' },
    { id: SAMURAI_SYMBOLS.DRAGON,   name: 'Dragon Spirit',        tier: 'high',    glyph: '🐲' },
    { id: SAMURAI_SYMBOLS.KATANA,   name: 'Katana Blade',         tier: 'high',    glyph: '🗡️' },
    { id: SAMURAI_SYMBOLS.SAKURA,   name: 'Sakura Blossom',       tier: 'high',    glyph: '🌸' },
    { id: SAMURAI_SYMBOLS.MASK,     name: 'Demon Mask',           tier: 'low',     glyph: '😈' },
    { id: SAMURAI_SYMBOLS.COIN,     name: 'Gold Coin',            tier: 'low',     glyph: '🪙' },
    { id: SAMURAI_SYMBOLS.FAN,      name: 'Battle Fan',           tier: 'low',     glyph: '🪭' },
    { id: SAMURAI_SYMBOLS.SCROLL,   name: 'Ancient Scroll',       tier: 'low',     glyph: '📜' },
  ],
  wildId: SAMURAI_SYMBOLS.WILD,
  scatterId: SAMURAI_SYMBOLS.SCATTER,
  paytableBp: PT,
  strips: [r0, r1, r2, r3, r4],
  freeSpinStrips: [r0FS, r1FS, r2FS, r3FS, r4FS],
  baseLadderBp:    [10000],
  freeSpinLadderBp:[10000], // Bushido multiplier applied separately
  freeSpins: {
    triggerSymbol: SAMURAI_SYMBOLS.SCATTER,
    triggerCount: 3,
    awarded: 10,
    retriggerCount: 3,
    retriggerAwarded: 5,
    maxSpinsPerRound: 60,
  },
  maxWinBp: 40_000_000,
  stakeLevels: [...STAKE_LEVELS],
  maxCascadeStepsPerSpin: 1,
  features: { katanaSlash: true, bushidoMultiplier: true },
};

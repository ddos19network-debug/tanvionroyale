/**
 * ROYALE FROZEN EMPIRE (frozen-empire) — game configuration.
 *
 * Grid: 5×4, Win model: 1024 ways (5 reels × 4 rows)
 * Wild: ice_queen_wild (reels 2–5, cols 1–4)
 * Scatter: frozen_crown_scatter
 *
 * Signature feature: Frost Lock:
 *   - Winning symbols freeze (stay) while all other cells respin.
 *   - Repeats until no new win (max 4 chained, ladder ×1→×2→×3→×5).
 *   - 3+ Crowns → 10 free spins; in FS frozen cells persist one extra respin.
 * Max win: 4,000× = 40,000,000 bp
 */

import type { SlotGameConfig } from '../core/types';
import { STAKE_LEVELS } from '../core/types';

export const FROZEN_SLUG = 'frozen-empire';

export const FROZEN_SYMBOLS = {
  WILD:          'ice_queen_wild',
  SCATTER:       'frozen_crown_scatter',
  ICE_QUEEN:     'ice_queen',
  SNOW_WOLF:     'snow_wolf',
  FROZEN_CROWN:  'crown_jewel',
  ICE_CRYSTAL:   'ice_crystal',
  POLAR_BEAR:    'polar_bear',
  FROST_DAGGER:  'frost_dagger',
  SNOWFLAKE:     'snowflake',
  ICE_SHARD:     'ice_shard',
} as const;

const PT: Record<string, number[]> = {
  'ice_queen': [0, 0, 0, 716, 2149, 7161],
  'snow_wolf': [0, 0, 0, 515, 1547, 5156],
  'crown_jewel': [0, 0, 0, 344, 1031, 3438],
  'ice_crystal': [0, 0, 0, 229, 687, 2292],
  'polar_bear': [0, 0, 0, 144, 430, 1432],
  'frost_dagger': [0, 0, 0, 87, 258, 859],
  'snowflake': [0, 0, 0, 57, 171, 572],
  'ice_shard': [0, 0, 0, 28, 87, 286],
};

const makeStrip = (iq:number, sw:number, fc:number, ic:number, pb:number, fd:number, sf:number, is:number, wild:number, scatter:number) => [
  { symbolId: FROZEN_SYMBOLS.ICE_QUEEN,    weight: iq },
  { symbolId: FROZEN_SYMBOLS.SNOW_WOLF,    weight: sw },
  { symbolId: FROZEN_SYMBOLS.FROZEN_CROWN, weight: fc },
  { symbolId: FROZEN_SYMBOLS.ICE_CRYSTAL,  weight: ic },
  { symbolId: FROZEN_SYMBOLS.POLAR_BEAR,   weight: pb },
  { symbolId: FROZEN_SYMBOLS.FROST_DAGGER, weight: fd },
  { symbolId: FROZEN_SYMBOLS.SNOWFLAKE,    weight: sf },
  { symbolId: FROZEN_SYMBOLS.ICE_SHARD,    weight: is },
  { symbolId: FROZEN_SYMBOLS.WILD,         weight: wild },
  { symbolId: FROZEN_SYMBOLS.SCATTER,      weight: scatter },
];

const r0 = makeStrip(4, 5, 7, 8, 10, 13, 17, 21, 0, 3);
const r1 = makeStrip(4, 5, 7, 8, 10, 13, 16, 20, 7, 3);
const r2 = makeStrip(4, 5, 7, 8,  9, 12, 16, 19, 7, 3);
const r3 = makeStrip(4, 5, 6, 7,  9, 12, 15, 19, 7, 3);
const r4 = makeStrip(3, 4, 6, 7,  9, 11, 15, 18, 7, 3);

const r0FS = makeStrip(5, 6, 8, 9, 11, 12, 14, 18, 0, 3);
const r1FS = makeStrip(5, 6, 8, 9, 11, 12, 14, 17, 12, 3);
const r2FS = makeStrip(5, 6, 8, 9, 10, 11, 13, 16, 12, 3);
const r3FS = makeStrip(5, 6, 7, 8, 10, 11, 13, 16, 12, 3);
const r4FS = makeStrip(4, 5, 7, 8, 10, 11, 13, 15, 12, 3);

export const FROZEN_CONFIG: SlotGameConfig = {
  slug: FROZEN_SLUG,
  title: 'ROYALE FROZEN EMPIRE',
  version: 1,
  winModel: 'ways',
  reels: 5,
  rows: 4,
  symbols: [
    { id: FROZEN_SYMBOLS.WILD,         name: 'Ice Queen Wild',     tier: 'wild',    glyph: '❄️' },
    { id: FROZEN_SYMBOLS.SCATTER,      name: 'Frozen Crown',       tier: 'scatter', glyph: '👑' },
    { id: FROZEN_SYMBOLS.ICE_QUEEN,    name: 'Ice Queen',          tier: 'high',    glyph: '👸' },
    { id: FROZEN_SYMBOLS.SNOW_WOLF,    name: 'Snow Wolf',          tier: 'high',    glyph: '🐺' },
    { id: FROZEN_SYMBOLS.FROZEN_CROWN, name: 'Crown Jewel',        tier: 'high',    glyph: '💎' },
    { id: FROZEN_SYMBOLS.ICE_CRYSTAL,  name: 'Ice Crystal',        tier: 'high',    glyph: '🧊' },
    { id: FROZEN_SYMBOLS.POLAR_BEAR,   name: 'Polar Bear',         tier: 'low',     glyph: '🐻' },
    { id: FROZEN_SYMBOLS.FROST_DAGGER, name: 'Frost Dagger',       tier: 'low',     glyph: '🗡️' },
    { id: FROZEN_SYMBOLS.SNOWFLAKE,    name: 'Snowflake',          tier: 'low',     glyph: '🌨️' },
    { id: FROZEN_SYMBOLS.ICE_SHARD,    name: 'Ice Shard',          tier: 'low',     glyph: '💠' },
  ],
  wildId: FROZEN_SYMBOLS.WILD,
  scatterId: FROZEN_SYMBOLS.SCATTER,
  paytableBp: PT,
  strips: [r0, r1, r2, r3, r4],
  freeSpinStrips: [r0FS, r1FS, r2FS, r3FS, r4FS],
  baseLadderBp:    [10000, 20000, 30000, 50000],
  freeSpinLadderBp:[10000, 20000, 30000, 50000],
  freeSpins: {
    triggerSymbol: FROZEN_SYMBOLS.SCATTER,
    triggerCount: 3,
    awarded: 10,
    retriggerCount: 3,
    retriggerAwarded: 5,
    maxSpinsPerRound: 60,
  },
  maxWinBp: 40_000_000,
  stakeLevels: [...STAKE_LEVELS],
  maxCascadeStepsPerSpin: 4,
  features: { frostLock: true },
};

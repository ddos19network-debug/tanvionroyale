/**
 * ROYALE STEAMPUNK REVOLUTION (steampunk-revolution) — game configuration.
 *
 * Grid: 5×4, Win model: 30 fixed paylines, left-to-right, 3+
 * Wild: gear_wild (reels 2–5, cols 1–4)
 * Scatter: airship_scatter
 *
 * Signature feature: Steam Pressure meter:
 *   - Every winning spin adds pressure = min(win in ×stake, 10).
 *   - At 100 → Boiler Burst: next winning spin gets random ×2–×10 (weighted), meter resets.
 *   - 3+ Airships → 8 free spins in which pressure gain is doubled.
 * Max win: 3,000× = 30,000,000 bp
 */

import type { SlotGameConfig } from '../core/types';
import { STAKE_LEVELS } from '../core/types';

export const STEAMPUNK_SLUG = 'steampunk-revolution';

export const STEAMPUNK_SYMBOLS = {
  WILD:          'gear_wild',
  SCATTER:       'airship_scatter',
  INVENTOR:      'steampunk_inventor',
  STEAM_ENGINE:  'steam_engine',
  AIRSHIP:       'airship',
  POCKET_WATCH:  'pocket_watch',
  PRESSURE_GAUGE:'pressure_gauge',
  COPPER_WRENCH: 'copper_wrench',
  BRASS_COG:     'brass_cog',
  STEAM_VALVE:   'steam_valve',
} as const;

// 30 paylines for 5×4
export const STEAMPUNK_PAYLINES = [
  { rows: [0,0,0,0,0] }, { rows: [1,1,1,1,1] }, { rows: [2,2,2,2,2] }, { rows: [3,3,3,3,3] },
  { rows: [0,1,2,1,0] }, { rows: [1,2,3,2,1] }, { rows: [2,1,0,1,2] }, { rows: [3,2,1,2,3] },
  { rows: [0,1,0,1,0] }, { rows: [1,2,1,2,1] }, { rows: [2,3,2,3,2] }, { rows: [1,0,1,0,1] },
  { rows: [2,1,2,1,2] }, { rows: [3,2,3,2,3] }, { rows: [0,1,2,3,3] }, { rows: [3,2,1,0,0] },
  { rows: [0,0,1,2,3] }, { rows: [3,3,2,1,0] }, { rows: [1,0,0,0,1] }, { rows: [2,3,3,3,2] },
  { rows: [0,1,1,1,0] }, { rows: [3,2,2,2,3] }, { rows: [1,1,0,1,1] }, { rows: [2,2,3,2,2] },
  { rows: [0,2,1,2,0] }, { rows: [3,1,2,1,3] }, { rows: [0,0,2,0,0] }, { rows: [3,3,1,3,3] },
  { rows: [1,2,3,3,2] }, { rows: [2,1,0,0,1] },
];

const PT: Record<string, number[]> = {
  'steampunk_inventor': [0, 0, 0, 13204, 39611, 132034],
  'steam_engine': [0, 0, 0, 10562, 31689, 105629],
  'airship': [0, 0, 0, 7922, 23765, 79220],
  'pocket_watch': [0, 0, 0, 6602, 19805, 66016],
  'pressure_gauge': [0, 0, 0, 3961, 13204, 46212],
  'copper_wrench': [0, 0, 0, 2641, 7922, 26406],
  'brass_cog': [0, 0, 0, 1982, 5942, 19805],
  'steam_valve': [0, 0, 0, 1320, 3961, 13204],
};

const makeStrip = (inv:number, se:number, air:number, pw:number, pg:number, cw:number, bc:number, sv:number, wild:number, scatter:number) => [
  { symbolId: STEAMPUNK_SYMBOLS.INVENTOR,       weight: inv },
  { symbolId: STEAMPUNK_SYMBOLS.STEAM_ENGINE,   weight: se },
  { symbolId: STEAMPUNK_SYMBOLS.AIRSHIP,        weight: air },
  { symbolId: STEAMPUNK_SYMBOLS.POCKET_WATCH,   weight: pw },
  { symbolId: STEAMPUNK_SYMBOLS.PRESSURE_GAUGE, weight: pg },
  { symbolId: STEAMPUNK_SYMBOLS.COPPER_WRENCH,  weight: cw },
  { symbolId: STEAMPUNK_SYMBOLS.BRASS_COG,      weight: bc },
  { symbolId: STEAMPUNK_SYMBOLS.STEAM_VALVE,    weight: sv },
  { symbolId: STEAMPUNK_SYMBOLS.WILD,           weight: wild },
  { symbolId: STEAMPUNK_SYMBOLS.SCATTER,        weight: scatter },
];

const r0 = makeStrip(5, 6, 7, 8, 11, 14, 18, 22, 0, 3);
const r1 = makeStrip(5, 6, 7, 8, 10, 13, 17, 21, 7, 3);
const r2 = makeStrip(5, 6, 7, 8, 10, 13, 16, 20, 7, 3);
const r3 = makeStrip(4, 5, 7, 8, 10, 12, 16, 20, 7, 3);
const r4 = makeStrip(4, 5, 6, 7, 9,  12, 15, 19, 7, 3);

const r0FS = makeStrip(6, 7, 8, 9, 11, 12, 15, 18, 0, 3);
const r1FS = makeStrip(6, 7, 8, 9, 11, 12, 14, 17, 12, 3);
const r2FS = makeStrip(6, 6, 8, 9, 10, 11, 14, 16, 12, 3);
const r3FS = makeStrip(5, 6, 7, 9, 10, 11, 14, 16, 12, 3);
const r4FS = makeStrip(5, 6, 7, 8, 10, 11, 13, 16, 12, 3);

export const STEAMPUNK_CONFIG: SlotGameConfig = {
  slug: STEAMPUNK_SLUG,
  title: 'ROYALE STEAMPUNK REVOLUTION',
  version: 1,
  winModel: 'paylines',
  reels: 5,
  rows: 4,
  symbols: [
    { id: STEAMPUNK_SYMBOLS.WILD,           name: 'Gear Wild',          tier: 'wild',    glyph: '⚙️' },
    { id: STEAMPUNK_SYMBOLS.SCATTER,        name: 'Airship Scatter',    tier: 'scatter', glyph: '🎈' },
    { id: STEAMPUNK_SYMBOLS.INVENTOR,       name: 'Inventor',           tier: 'high',    glyph: '🧑‍🔧' },
    { id: STEAMPUNK_SYMBOLS.STEAM_ENGINE,   name: 'Steam Engine',       tier: 'high',    glyph: '🚂' },
    { id: STEAMPUNK_SYMBOLS.AIRSHIP,        name: 'Zeppelin',           tier: 'high',    glyph: '🚢' },
    { id: STEAMPUNK_SYMBOLS.POCKET_WATCH,   name: 'Pocket Watch',       tier: 'high',    glyph: '⏱️' },
    { id: STEAMPUNK_SYMBOLS.PRESSURE_GAUGE, name: 'Pressure Gauge',     tier: 'low',     glyph: '🧭' },
    { id: STEAMPUNK_SYMBOLS.COPPER_WRENCH,  name: 'Copper Wrench',      tier: 'low',     glyph: '🔧' },
    { id: STEAMPUNK_SYMBOLS.BRASS_COG,      name: 'Brass Cog',          tier: 'low',     glyph: '🔩' },
    { id: STEAMPUNK_SYMBOLS.STEAM_VALVE,    name: 'Steam Valve',        tier: 'low',     glyph: '🚰' },
  ],
  wildId: STEAMPUNK_SYMBOLS.WILD,
  scatterId: STEAMPUNK_SYMBOLS.SCATTER,
  paylines: STEAMPUNK_PAYLINES,
  paytableBp: PT,
  strips: [r0, r1, r2, r3, r4],
  freeSpinStrips: [r0FS, r1FS, r2FS, r3FS, r4FS],
  baseLadderBp:    [10000],
  freeSpinLadderBp:[10000],
  freeSpins: {
    triggerSymbol: STEAMPUNK_SYMBOLS.SCATTER,
    triggerCount: 3,
    awarded: 8,
    retriggerCount: 3,
    retriggerAwarded: 5,
    maxSpinsPerRound: 50,
  },
  maxWinBp: 30_000_000,
  stakeLevels: [...STAKE_LEVELS],
  maxCascadeStepsPerSpin: 1,
  features: { steamPressure: true, boilerBurst: true },
};

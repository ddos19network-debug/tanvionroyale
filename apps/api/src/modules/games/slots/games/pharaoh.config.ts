import { SlotGameConfig, STAKE_LEVELS, PaylineDefinition } from '../core/types';

/**
 * Slot identifiers for Pharaoh.
 */
export const PHARAOH_SLUG = 'royale-pharaoh';

/** Symbol IDs used by the Pharaoh slot engine. */
export const PHARAOH_SYMBOLS = {
  WILD: 'wild',
  SCATTER: 'scatter',
};

/** 20 standard paylines for 5 reels x 3 rows */
export const PHARAOH_PAYLINES_20: PaylineDefinition[] = [
  { rows: [1, 1, 1, 1, 1] }, // Middle Line
  { rows: [0, 0, 0, 0, 0] }, // Top Line
  { rows: [2, 2, 2, 2, 2] }, // Bottom Line
  { rows: [0, 1, 2, 1, 0] }, // V Shape
  { rows: [2, 1, 0, 1, 2] }, // Inverted V
  { rows: [0, 0, 1, 2, 2] }, // Down Stairs
  { rows: [2, 2, 1, 0, 0] }, // Up Stairs
  { rows: [1, 0, 0, 0, 1] }, // Top Arc
  { rows: [1, 2, 2, 2, 1] }, // Bottom Arc
  { rows: [0, 1, 1, 1, 0] }, // Shallow V
  { rows: [2, 1, 1, 1, 2] }, // Shallow Inverted V
  { rows: [1, 0, 1, 2, 1] }, // Wave Down
  { rows: [1, 2, 1, 0, 1] }, // Wave Up
  { rows: [0, 1, 0, 1, 0] }, // Zig-zag Top
  { rows: [2, 1, 2, 1, 2] }, // Zig-zag Bottom
  { rows: [1, 1, 0, 1, 1] }, // Center Peak
  { rows: [1, 1, 2, 1, 1] }, // Center Dip
  { rows: [0, 0, 2, 0, 0] }, // Deep Dip
  { rows: [2, 2, 0, 2, 2] }, // High Peak
  { rows: [0, 2, 0, 2, 0] }, // Wide M
];

/**
 * Backend Game Configuration for payline processing & RNG generation
 */
export const PHARAOH_BACKEND_CONFIG = {
  slug: PHARAOH_SLUG,
  name: 'Royale Pharaoh',
  reelsCount: 5,
  rowsCount: 3,
  paylinesCount: 20,
  minBet: 1,
  maxBet: 500,

  // Payline patterns mapping coordinates [reelIndex, rowIndex]
  paylines: [
    [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]], // Middle Line
    [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], // Top Line
    [[0, 2], [1, 2], [2, 2], [3, 2], [4, 2]], // Bottom Line
    [[0, 0], [1, 1], [2, 2], [3, 1], [4, 0]], // V Shape
    [[0, 2], [1, 1], [2, 0], [3, 1], [4, 2]], // Inverted V
  ],

  // Reel Strip definition template logic for RNG generation
  reelStrips: [
    ['cleopatra', 'anubis', 'ankh', 'coin', 'scarab', 'mask', 'horus', 'sarcophagus', 'scatter'],
    ['coin', 'cleopatra', 'scarab', 'anubis', 'horus', 'mask', 'ankh', 'scatter', 'sarcophagus'],
    ['sarcophagus', 'ankh', 'mask', 'scatter', 'cleopatra', 'scarab', 'anubis', 'coin', 'horus'],
    ['horus', 'coin', 'cleopatra', 'sarcophagus', 'anubis', 'scarab', 'mask', 'scatter', 'ankh'],
    ['ankh', 'mask', 'scatter', 'horus', 'coin', 'cleopatra', 'sarcophagus', 'anubis', 'scarab'],
  ],
};

/** Configuration for the **Royale Pharaoh** slot game. */
export const PHARAOH_CONFIG: SlotGameConfig = {
  slug: PHARAOH_SLUG,
  title: 'ROYALE PHARAOH',
  version: 1,
  winModel: 'paylines',
  reels: 5,
  rows: 3,
  symbols: [
    // Core symbols (wild & scatter)
    { id: PHARAOH_SYMBOLS.WILD, name: 'Ancient Wild', tier: 'wild', glyph: '🌟', asset: '/assets/image/royale pharaoh/Ancient Wild.jpg' },
    { id: PHARAOH_SYMBOLS.SCATTER, name: 'Golden Scatter', tier: 'scatter', glyph: '⭐', asset: '/assets/image/royale pharaoh/Golden Scatter.png' },
    // Premium symbols
    { id: 'cleopatra', name: 'Cleopatra', tier: 'high', glyph: '👑', asset: '/assets/image/royale pharaoh/Cleopatra.jpg' },
    { id: 'anubis', name: 'Anubis', tier: 'high', glyph: '👑', asset: '/assets/image/royale pharaoh/Anubis.jpg' },
    { id: 'pharaoh-mask', name: 'Pharaoh Mask', tier: 'high', glyph: '👑', asset: '/assets/image/royale pharaoh/Pharaoh Mask.jpg' },
    { id: 'golden-scarab', name: 'Golden Scarab', tier: 'high', glyph: '👑', asset: '/assets/image/royale pharaoh/Golden Scarab.jpg' },
    { id: 'sarcophagus', name: 'Royal Sarcophagus', tier: 'high', glyph: '👑', asset: '/assets/image/royale pharaoh/Sarcophagus.jpg' },
    // Regular symbols
    { id: 'ankh', name: 'Ankh', tier: 'low', glyph: '💎', asset: '/assets/image/royale pharaoh/Ankh.jpg' },
    { id: 'eye-of-horus', name: 'Eye of Horus', tier: 'low', glyph: '💎', asset: '/assets/image/royale pharaoh/Eye of Horus.jpg' },
    { id: 'golden-coin', name: 'Golden Coin', tier: 'low', glyph: '🪙', asset: '/assets/image/royale pharaoh/Golden Coin.jpg' },
    { id: 'papyrus', name: 'Ancient Papyrus', tier: 'low', glyph: '📜', asset: '/assets/image/royale pharaoh/Ancient Papyrus.jpg' },
  ],
  wildId: PHARAOH_SYMBOLS.WILD,
  scatterId: PHARAOH_SYMBOLS.SCATTER,
  paylines: PHARAOH_PAYLINES_20,
  // Paytable expressed in basis points per symbol ID.
  paytableBp: {
    [PHARAOH_SYMBOLS.WILD]: [0, 0, 600, 2500, 12000],
    [PHARAOH_SYMBOLS.SCATTER]: [0, 0, 200, 1000, 5000],
    cleopatra: [0, 0, 500, 2000, 10000],
    anubis: [0, 0, 400, 1600, 8000],
    'pharaoh-mask': [0, 0, 350, 1400, 7000],
    'golden-scarab': [0, 0, 300, 1200, 6000],
    sarcophagus: [0, 0, 250, 1000, 5000],
    ankh: [0, 0, 150, 600, 2500],
    'eye-of-horus': [0, 0, 120, 500, 2000],
    'golden-coin': [0, 0, 100, 400, 1500],
    papyrus: [0, 0, 80, 300, 1000],
  },
  // Reel strips with weighted distributions
  strips: Array(5).fill([
    { symbolId: PHARAOH_SYMBOLS.WILD, weight: 4 },
    { symbolId: PHARAOH_SYMBOLS.SCATTER, weight: 3 },
    { symbolId: 'cleopatra', weight: 8 },
    { symbolId: 'anubis', weight: 8 },
    { symbolId: 'pharaoh-mask', weight: 9 },
    { symbolId: 'golden-scarab', weight: 9 },
    { symbolId: 'sarcophagus', weight: 10 },
    { symbolId: 'ankh', weight: 12 },
    { symbolId: 'eye-of-horus', weight: 12 },
    { symbolId: 'golden-coin', weight: 12 },
    { symbolId: 'papyrus', weight: 13 },
  ]),
  freeSpinStrips: undefined,
  baseLadderBp: [10000, 20000, 30000, 40000, 50000],
  freeSpinLadderBp: [20000, 30000, 40000, 60000, 100000],
  freeSpins: {
    triggerSymbol: PHARAOH_SYMBOLS.SCATTER,
    triggerCount: 3,
    awarded: 10,
    retriggerCount: 3,
    retriggerAwarded: 5,
    maxSpinsPerRound: 40,
  },
  maxWinBp: 100_000,
  stakeLevels: [1, 2, 5, 10, 20, 50, 100, 200, 500],
  maxCascadeStepsPerSpin: 15,
  features: {
    tumble: false,
    multiplierLadder: true,
    expandingWild: false,
    wildSubstitution: true,
    scatterFreeSpins: true,
  },
};

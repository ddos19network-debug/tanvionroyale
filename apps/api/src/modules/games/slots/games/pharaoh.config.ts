import { SlotGameConfig, STAKE_LEVELS } from '../core/types';

/**
 * Slot identifiers for Pharaoh.
 */
export const PHARAOH_SLUG = 'royale-pharaoh';

/** Symbol IDs used by the Pharaoh slot engine. */
export const PHARAOH_SYMBOLS = {
  WILD: 'wild',
  SCATTER: 'scatter',
};

/** Configuration for the **Royale Pharaoh** slot game. */
export const PHARAOH_CONFIG: SlotGameConfig = {
  slug: PHARAOH_SLUG,
  title: 'ROYALE PHARAOH',
  version: 1,
  winModel: 'paylines',
  reels: 5,
  rows: 4,
  symbols: [
    // Core symbols (wild & scatter)
    { id: PHARAOH_SYMBOLS.WILD, name: 'Ancient Wild', tier: 'wild', glyph: '🌟' },
    { id: PHARAOH_SYMBOLS.SCATTER, name: 'Golden Scatter', tier: 'scatter', glyph: '⭐' },
    // Premium symbols
    { id: 'pharaoh-mask', name: 'Pharaoh Mask', tier: 'high', glyph: '👑' },
    { id: 'anubis', name: 'Anubis', tier: 'high', glyph: '👑' },
    { id: 'cleopatra', name: 'Cleopatra', tier: 'high', glyph: '👑' },
    { id: 'golden-scarab', name: 'Golden Scarab', tier: 'high', glyph: '👑' },
    { id: 'sarcophagus', name: 'Royal Sarcophagus', tier: 'high', glyph: '👑' },
    // Regular symbols
    { id: 'ankh', name: 'Ankh', tier: 'low', glyph: '💎' },
    { id: 'eye-of-horus', name: 'Eye of Horus', tier: 'low', glyph: '💎' },
    { id: 'golden-coin', name: 'Golden Coin', tier: 'low', glyph: '🪙' },
    { id: 'papyrus', name: 'Ancient Papyrus', tier: 'low', glyph: '📜' },
  ],
  wildId: PHARAOH_SYMBOLS.WILD,
  scatterId: PHARAOH_SYMBOLS.SCATTER,
  // Paytable expressed in basis points per symbol ID.
  paytableBp: {
    [PHARAOH_SYMBOLS.WILD]: [0, 0, 200, 500, 1200], // 3,4,5 of wild
    [PHARAOH_SYMBOLS.SCATTER]: [0, 0, 100, 300, 800], // scatter payouts
    'pharaoh-mask': [0, 0, 50],
    'anubis': [0, 0, 40],
    'cleopatra': [0, 0, 30],
    'golden-scarab': [0, 0, 20],
    'sarcophagus': [0, 0, 10],
    'ankh': [0, 0, 5],
    'eye-of-horus': [0, 0, 5],
    'golden-coin': [0, 0, 5],
    'papyrus': [0, 0, 5],
  },
  // Simple uniform reel strips – each reel uses the same distribution.
  strips: Array(5).fill([
    { symbolId: PHARAOH_SYMBOLS.WILD, weight: 5 },
    { symbolId: PHARAOH_SYMBOLS.SCATTER, weight: 2 },
    { symbolId: 'pharaoh-mask', weight: 10 },
    { symbolId: 'anubis', weight: 10 },
    { symbolId: 'cleopatra', weight: 10 },
    { symbolId: 'golden-scarab', weight: 10 },
    { symbolId: 'sarcophagus', weight: 10 },
    { symbolId: 'ankh', weight: 8 },
    { symbolId: 'eye-of-horus', weight: 8 },
    { symbolId: 'golden-coin', weight: 8 },
    { symbolId: 'papyrus', weight: 9 },
  ]),
  // For now free‑spin strips are identical to base strips.
  freeSpinStrips: undefined,
  baseLadderBp: [10000, 20000, 30000, 50000],
  freeSpinLadderBp: [10000, 20000, 30000, 50000],
  freeSpins: {
    triggerSymbol: PHARAOH_SYMBOLS.SCATTER,
    triggerCount: 3,
    awarded: 10,
    retriggerCount: 3,
    retriggerAwarded: 5,
    maxSpinsPerRound: 40,
  },
  maxWinBp: 10_000, // 100 % of stake cap
  stakeLevels: [...STAKE_LEVELS],
  maxCascadeStepsPerSpin: 15,
  features: {
    tumble: true,
    multiplierLadder: true,
    expandingWild: true,
    wildSubstitution: true,
    scatterFreeSpins: true,
  },
};

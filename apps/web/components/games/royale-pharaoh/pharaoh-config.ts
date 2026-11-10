import { SymbolConfig, WinLineResult } from './pharaoh-types';

/**
 * All 11 Royale Pharaoh symbols matching the 3D game UI icon pack:
 * 5 Premium, 4 Regular, 1 Wild, 1 Scatter.
 * Assets located at /assets/image/royale pharaoh/[filename]
 */
export const PHARAOH_SYMBOLS: Record<string, SymbolConfig> = {
  // Premium Symbols
  cleopatra: {
    id: 'cleopatra',
    name: 'Cleopatra',
    type: 'premium',
    tierLabel: 'Premium',
    image: 'Cleopatra.jpg',
    multiplier: [50, 200, 1000],
    description: 'The Golden Queen of the Nile',
  },
  anubis: {
    id: 'anubis',
    name: 'Anubis',
    type: 'premium',
    tierLabel: 'Premium',
    image: 'Anubis.jpg',
    multiplier: [40, 160, 800],
    description: 'Lord of the Sacred Underworld',
  },
  mask: {
    id: 'mask',
    name: 'Pharaoh Mask',
    type: 'premium',
    tierLabel: 'Premium',
    image: 'Pharaoh Mask.jpg',
    multiplier: [35, 140, 700],
    description: 'The Royal Golden Death Mask',
  },
  'pharaoh-mask': {
    id: 'pharaoh-mask',
    name: 'Pharaoh Mask',
    type: 'premium',
    tierLabel: 'Premium',
    image: 'Pharaoh Mask.jpg',
    multiplier: [35, 140, 700],
    description: 'The Royal Golden Death Mask',
  },
  scarab: {
    id: 'scarab',
    name: 'Golden Scarab',
    type: 'premium',
    tierLabel: 'Premium',
    image: 'Golden Scarab.jpg',
    multiplier: [30, 120, 600],
    description: 'Bringer of Eternal Sunlight',
  },
  'golden-scarab': {
    id: 'golden-scarab',
    name: 'Golden Scarab',
    type: 'premium',
    tierLabel: 'Premium',
    image: 'Golden Scarab.jpg',
    multiplier: [30, 120, 600],
    description: 'Bringer of Eternal Sunlight',
  },
  sarcophagus: {
    id: 'sarcophagus',
    name: 'Sarcophagus',
    type: 'premium',
    tierLabel: 'Premium',
    image: 'Sarcophagus.jpg',
    multiplier: [25, 100, 500],
    description: 'The Gilded Tomb of Pharaohs',
  },

  // Regular Symbols
  ankh: {
    id: 'ankh',
    name: 'Ankh',
    type: 'regular',
    tierLabel: 'Regular',
    image: 'Ankh.jpg',
    multiplier: [15, 60, 250],
    description: 'The Key of Eternal Life',
  },
  horus: {
    id: 'horus',
    name: 'Eye of Horus',
    type: 'regular',
    tierLabel: 'Regular',
    image: 'Eye of Horus.jpg',
    multiplier: [12, 50, 200],
    description: 'The All-Seeing Sacred Eye',
  },
  'eye-of-horus': {
    id: 'eye-of-horus',
    name: 'Eye of Horus',
    type: 'regular',
    tierLabel: 'Regular',
    image: 'Eye of Horus.jpg',
    multiplier: [12, 50, 200],
    description: 'The All-Seeing Sacred Eye',
  },
  coin: {
    id: 'coin',
    name: 'Golden Coin',
    type: 'regular',
    tierLabel: 'Regular',
    image: 'Golden Coin.jpg',
    multiplier: [10, 40, 150],
    description: 'Royal Mint of Dynasty Pharaohs',
  },
  'golden-coin': {
    id: 'golden-coin',
    name: 'Golden Coin',
    type: 'regular',
    tierLabel: 'Regular',
    image: 'Golden Coin.jpg',
    multiplier: [10, 40, 150],
    description: 'Royal Mint of Dynasty Pharaohs',
  },
  papyrus: {
    id: 'papyrus',
    name: 'Ancient Papyrus',
    type: 'regular',
    tierLabel: 'Regular',
    image: 'Ancient Papyrus.jpg',
    multiplier: [8, 30, 100],
    description: 'Sacred Hieroglyphic Inscriptions',
  },

  // Wild & Scatter
  wild: {
    id: 'wild',
    name: 'Ancient Wild',
    type: 'wild',
    tierLabel: 'Wild',
    image: 'Ancient Wild.jpg',
    multiplier: [60, 250, 1200],
    description: 'Substitutes for all symbols except Scatter',
  },
  scatter: {
    id: 'scatter',
    name: 'Golden Scatter',
    type: 'scatter',
    tierLabel: 'Scatter',
    image: 'Golden Scatter.png',
    multiplier: [5, 20, 100],
    description: 'Land 3 or more to trigger 10 Free Spins',
  },
};

/** List of distinct symbols for paytable & display */
export const SYMBOL_LIST: SymbolConfig[] = [
  PHARAOH_SYMBOLS.cleopatra,
  PHARAOH_SYMBOLS.anubis,
  PHARAOH_SYMBOLS.mask,
  PHARAOH_SYMBOLS.scarab,
  PHARAOH_SYMBOLS.sarcophagus,
  PHARAOH_SYMBOLS.ankh,
  PHARAOH_SYMBOLS.horus,
  PHARAOH_SYMBOLS.coin,
  PHARAOH_SYMBOLS.papyrus,
  PHARAOH_SYMBOLS.wild,
  PHARAOH_SYMBOLS.scatter,
];

/**
 * 20 Standard Paylines for 5 Reels x 3 Rows
 * Row indices: 0 = Top, 1 = Middle, 2 = Bottom
 */
export const PAYLINES: number[][] = [
  [1, 1, 1, 1, 1], // 1: Middle Horizontal
  [0, 0, 0, 0, 0], // 2: Top Horizontal
  [2, 2, 2, 2, 2], // 3: Bottom Horizontal
  [0, 1, 2, 1, 0], // 4: V-Shape
  [2, 1, 0, 1, 2], // 5: Inverted V
  [0, 0, 1, 2, 2], // 6: Down Stairs
  [2, 2, 1, 0, 0], // 7: Up Stairs
  [1, 0, 0, 0, 1], // 8: Top Arc
  [1, 2, 2, 2, 1], // 9: Bottom Arc
  [0, 1, 1, 1, 0], // 10: Shallow V
  [2, 1, 1, 1, 2], // 11: Shallow Inverted V
  [1, 0, 1, 2, 1], // 12: Wave Down
  [1, 2, 1, 0, 1], // 13: Wave Up
  [0, 1, 0, 1, 0], // 14: Zig-zag Top
  [2, 1, 2, 1, 2], // 15: Zig-zag Bottom
  [1, 1, 0, 1, 1], // 16: Top Center Peak
  [1, 1, 2, 1, 1], // 17: Bottom Center Dip
  [0, 0, 2, 0, 0], // 18: Steep Dip
  [2, 2, 0, 2, 2], // 19: Steep Peak
  [0, 2, 0, 2, 0], // 20: Wide M
];

export const BET_OPTIONS = [1, 2, 5, 10, 20, 50, 100, 200, 500];
export const MULTIPLIERS = [1, 2, 3, 4, 5];

/**
 * Reel strip pools for authentic RNG reels
 */
export const REEL_STRIPS: string[][] = [
  ['cleopatra', 'anubis', 'ankh', 'coin', 'scarab', 'mask', 'horus', 'sarcophagus', 'scatter', 'wild', 'papyrus'],
  ['coin', 'cleopatra', 'scarab', 'anubis', 'horus', 'mask', 'ankh', 'scatter', 'sarcophagus', 'wild', 'papyrus'],
  ['sarcophagus', 'ankh', 'mask', 'scatter', 'cleopatra', 'scarab', 'anubis', 'coin', 'horus', 'wild', 'papyrus'],
  ['horus', 'coin', 'cleopatra', 'sarcophagus', 'anubis', 'scarab', 'mask', 'scatter', 'ankh', 'wild', 'papyrus'],
  ['ankh', 'mask', 'scatter', 'horus', 'coin', 'cleopatra', 'sarcophagus', 'anubis', 'scarab', 'wild', 'papyrus'],
];

/**
 * Backend Game Configuration
 */
export const PHARAOH_BACKEND_CONFIG = {
  slug: 'royale-pharaoh',
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
  reelStrips: REEL_STRIPS,
};

/**
 * Normalizes symbol keys to handle canonical & short forms
 */
export function normalizeSymbolKey(key: string): string {
  if (key === 'pharaoh-mask') return 'mask';
  if (key === 'golden-scarab') return 'scarab';
  if (key === 'eye-of-horus') return 'horus';
  if (key === 'golden-coin') return 'coin';
  return key;
}

/**
 * Evaluates payline wins on a 5x3 grid (reels[col][row])
 */
export function evaluateSpin(
  reels: string[][],
  bet: number,
  betMultiplier: number
): {
  totalWin: number;
  winningLines: number[];
  winningCells: { col: number; row: number }[];
  lineResults: WinLineResult[];
  scatterCount: number;
  triggeredBonus: boolean;
} {
  const lineResults: WinLineResult[] = [];
  const winningLines: number[] = [];
  const winningCellsMap = new Set<string>();

  const lineBet = bet / PAYLINES.length;

  // 1. Evaluate Paylines
  PAYLINES.forEach((line, lineIndex) => {
    const lineSymbols = [
      reels[0][line[0]],
      reels[1][line[1]],
      reels[2][line[2]],
      reels[3][line[3]],
      reels[4][line[4]],
    ];

    // Find first non-wild symbol
    let matchSym = lineSymbols[0];
    for (let i = 0; i < 5; i++) {
      if (lineSymbols[i] !== 'wild' && lineSymbols[i] !== 'scatter') {
        matchSym = lineSymbols[i];
        break;
      }
    }

    if (matchSym === 'scatter') {
      return; // Scatters pay everywhere, not on standard payline matches
    }

    let matchCount = 0;
    const coords: { col: number; row: number }[] = [];

    for (let c = 0; c < 5; c++) {
      const current = lineSymbols[c];
      if (current === matchSym || current === 'wild') {
        matchCount++;
        coords.push({ col: c, row: line[c] });
      } else {
        break;
      }
    }

    if (matchCount >= 3) {
      const symConfig = PHARAOH_SYMBOLS[matchSym] || PHARAOH_SYMBOLS[normalizeSymbolKey(matchSym)];
      const multiplierIdx = matchCount - 3; // 0 for 3x, 1 for 4x, 2 for 5x
      const payMultiplier = symConfig?.multiplier?.[multiplierIdx] ?? 5;
      const rawPayout = lineBet * payMultiplier * betMultiplier;
      const linePayout = Math.max(1, Math.round(rawPayout));

      winningLines.push(lineIndex);
      coords.forEach((coord) => winningCellsMap.add(`${coord.col},${coord.row}`));
      lineResults.push({
        lineIndex,
        symbolId: matchSym,
        count: matchCount,
        payout: linePayout,
        coords,
      });
    }
  });

  // 2. Evaluate Scatter Free Spins (Scatter can appear on any reel)
  let scatterCount = 0;
  const scatterCoords: { col: number; row: number }[] = [];
  for (let c = 0; c < 5; c++) {
    for (let r = 0; r < 3; r++) {
      if (reels[c][r] === 'scatter') {
        scatterCount++;
        scatterCoords.push({ col: c, row: r });
      }
    }
  }

  let scatterPayout = 0;
  const triggeredBonus = scatterCount >= 3;
  if (scatterCount >= 3) {
    const scatterConfig = PHARAOH_SYMBOLS.scatter;
    const multIdx = Math.min(2, scatterCount - 3);
    const scatterMult = scatterConfig.multiplier[multIdx] ?? 10;
    scatterPayout = bet * scatterMult * betMultiplier;
    scatterCoords.forEach((coord) => winningCellsMap.add(`${coord.col},${coord.row}`));
  }

  const paylineTotal = lineResults.reduce((acc, r) => acc + r.payout, 0);
  const totalWin = paylineTotal + scatterPayout;

  const winningCells = Array.from(winningCellsMap).map((str) => {
    const [col, row] = str.split(',').map(Number);
    return { col, row };
  });

  return {
    totalWin,
    winningLines,
    winningCells,
    lineResults,
    scatterCount,
    triggeredBonus,
  };
}

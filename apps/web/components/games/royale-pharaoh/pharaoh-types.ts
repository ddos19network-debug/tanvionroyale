export type PharaohSymbolId =
  | 'pharaoh-mask'
  | 'anubis'
  | 'cleopatra'
  | 'golden-scarab'
  | 'sarcophagus'
  | 'ankh'
  | 'eye-of-horus'
  | 'golden-coin'
  | 'papyrus'
  | 'wild'
  | 'scatter'
  | 'mask'
  | 'scarab'
  | 'horus'
  | 'coin';

export type SymbolType = 'premium' | 'high' | 'regular' | 'medium' | 'special' | 'wild' | 'scatter';

export interface SymbolConfig {
  id: string;
  name: string;
  type: SymbolType;
  image: string;
  multiplier: number[]; // 3x, 4x, 5x matches
  tierLabel?: string;
  description?: string;
}

export interface WinLineResult {
  lineIndex: number;
  symbolId: string;
  count: number;
  payout: number;
  coords: { col: number; row: number }[];
}

export interface SpinHistoryItem {
  id: string;
  time: string;
  bet: number;
  multiplier: number;
  win: number;
  isBonus?: boolean;
}

export interface GameState {
  reels: string[][]; // 5 columns x 3 rows: reels[col][row]
  isSpinning: boolean;
  reelSpinning: boolean[]; // Staggered spin state per reel
  bet: number;
  balance: number;
  win: number;
  totalWin: number;
  multiplier: number;
  freeSpins: number;
  inFreeSpins: boolean;
  showBonusAnimation: boolean;
  winningLines: number[];
  winningCells: { col: number; row: number }[];
  activeWinResults: WinLineResult[];
  autoPlay: boolean;
  autoPlayCount: number;
  turbo: boolean;
  soundEnabled: boolean;
  showPaytable: boolean;
  showRules: boolean;
  showSettings: boolean;
}

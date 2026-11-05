export type RouletteState =
  | 'BETTING_OPEN'
  | 'BETS_CLOSED'
  | 'BETTING_CLOSED'
  | 'SPINNING'
  | 'PAYOUT';

export type BetType =
  | 'straight_up'
  | 'split'
  | 'street'
  | 'corner'
  | 'six_line'
  | 'column'
  | 'dozen'
  | 'color'
  | 'parity'
  | 'range'
  | 'racetrack';

export interface BetItem {
  type: BetType | string;
  selection: string;
  amount: number;
}

export interface PlaceBetPayload {
  userId: string;
  bets: BetItem[];
}

export interface UserBetSummary {
  userId: string;
  bets: BetItem[];
  totalBet: number;
  totalWon: number;
  netPayout: number;
  details: Array<{
    type: string;
    selection: string;
    amount: number;
    won: boolean;
    payout: number;
  }>;
}

export interface StateBroadcast {
  currentState: RouletteState;
  timerRemaining: number;
  winningNumber: number | null;
  history: number[];
  roundId: string;
  serverTime: number;
}

export interface WheelSpinBroadcast {
  roundId: string;
  winningNumber: number;
  pocketIndex: number;
  targetAngle: number;
  spinDurationMs: number;
}

export interface RoundResultBroadcast {
  roundId: string;
  winningNumber: number;
  color: 'red' | 'black' | 'green';
  history: number[];
  userPayouts: Record<string, UserBetSummary>;
}

/** European Roulette wheel pocket sequence (clockwise, 37 pockets: 0-36). */
export const WHEEL_NUMBERS: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
] as const;

export const RED_NUMBERS: ReadonlySet<number> = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export const BLACK_NUMBERS: ReadonlySet<number> = new Set([
  2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35,
]);

export const RACETRACK_ZONES = {
  voisins: [22, 18, 29, 7, 28, 12, 35, 3, 26, 0, 32, 15, 19, 4, 21, 2, 25],
  tiers: [27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33],
  orphelins: [1, 20, 14, 31, 9, 17, 34, 6],
  zero: [12, 35, 3, 26, 0, 32, 15],
} as const;


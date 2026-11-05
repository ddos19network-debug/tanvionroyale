import { io, Socket } from 'socket.io-client';
import { getAccessToken } from '@/lib/auth/session';
import { getApiBaseUrl } from './client';

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

export interface RoundResultBroadcast {
  roundId: string;
  winningNumber: number;
  color: 'red' | 'black' | 'green';
  history: number[];
  userPayouts: Record<string, UserBetSummary>;
}

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

function getWsOrigin(): string {
  try {
    const base = getApiBaseUrl().replace(/\/api\/v1\/?$/, '');
    if (base) return base;
  } catch {
    // getApiBaseUrl can throw if production and not set
  }
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return 'http://localhost:3000';
}

export function createRouletteSocket(): Socket {
  return io(`${getWsOrigin()}/games/roulette`, {
    auth: { token: getAccessToken() ?? undefined },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    withCredentials: true,
  });
}

/**
 * Validates a single bet item and determines payout multiplier on win.
 */
export function evaluateBet(
  bet: BetItem,
  winningNumber: number,
): { won: boolean; payout: number } {
  const { type, selection, amount } = bet;
  if (!amount || amount <= 0 || !Number.isFinite(amount)) {
    return { won: false, payout: 0 };
  }

  const isRed = RED_NUMBERS.has(winningNumber);
  const isBlack = BLACK_NUMBERS.has(winningNumber);
  const isZero = winningNumber === 0;

  switch (type) {
    case 'straight_up': {
      const target = parseInt(selection, 10);
      if (target === winningNumber) {
        return { won: true, payout: amount * 36 };
      }
      return { won: false, payout: 0 };
    }

    case 'split': {
      const nums = selection.split(/[,-]/).map((n) => parseInt(n.trim(), 10));
      if (nums.includes(winningNumber)) {
        return { won: true, payout: amount * 18 };
      }
      return { won: false, payout: 0 };
    }

    case 'street': {
      const nums = selection.split(/[,-]/).map((n) => parseInt(n.trim(), 10));
      if (nums.includes(winningNumber)) {
        return { won: true, payout: amount * 12 };
      }
      return { won: false, payout: 0 };
    }

    case 'corner': {
      const nums = selection.split(/[,-]/).map((n) => parseInt(n.trim(), 10));
      if (nums.includes(winningNumber)) {
        return { won: true, payout: amount * 9 };
      }
      return { won: false, payout: 0 };
    }

    case 'six_line': {
      const nums = selection.split(/[,-]/).map((n) => parseInt(n.trim(), 10));
      if (nums.includes(winningNumber)) {
        return { won: true, payout: amount * 6 };
      }
      return { won: false, payout: 0 };
    }

    case 'column': {
      if (isZero) return { won: false, payout: 0 };
      const col = selection.toLowerCase();
      const colNum = winningNumber % 3;
      const matched =
        (col === 'col1' || col === '1') && colNum === 1
          ? true
          : (col === 'col2' || col === '2') && colNum === 2
          ? true
          : (col === 'col3' || col === '3') && colNum === 0;
      return matched ? { won: true, payout: amount * 3 } : { won: false, payout: 0 };
    }

    case 'dozen': {
      if (isZero) return { won: false, payout: 0 };
      const matched =
        (selection === '1st' || selection === '1-12') && winningNumber >= 1 && winningNumber <= 12
          ? true
          : (selection === '2nd' || selection === '13-24') && winningNumber >= 13 && winningNumber <= 24
          ? true
          : (selection === '3rd' || selection === '25-36') && winningNumber >= 25 && winningNumber <= 36;
      return matched ? { won: true, payout: amount * 3 } : { won: false, payout: 0 };
    }

    case 'color': {
      if (isZero) return { won: false, payout: 0 };
      const sel = selection.toLowerCase();
      if ((sel === 'red' && isRed) || (sel === 'black' && isBlack)) {
        return { won: true, payout: amount * 2 };
      }
      return { won: false, payout: 0 };
    }

    case 'parity': {
      if (isZero) return { won: false, payout: 0 };
      const sel = selection.toLowerCase();
      const isEven = winningNumber % 2 === 0;
      if ((sel === 'even' && isEven) || (sel === 'odd' && !isEven)) {
        return { won: true, payout: amount * 2 };
      }
      return { won: false, payout: 0 };
    }

    case 'range': {
      if (isZero) return { won: false, payout: 0 };
      const sel = selection.toLowerCase();
      const matched =
        (sel === '1-18' || sel === 'low') && winningNumber >= 1 && winningNumber <= 18
          ? true
          : (sel === '19-36' || sel === 'high') && winningNumber >= 19 && winningNumber <= 36;
      return matched ? { won: true, payout: amount * 2 } : { won: false, payout: 0 };
    }

    case 'racetrack': {
      const zoneKey = selection.toLowerCase() as keyof typeof RACETRACK_ZONES;
      const zoneNumbers = RACETRACK_ZONES[zoneKey];
      if (zoneNumbers && (zoneNumbers as readonly number[]).includes(winningNumber)) {
        const mult =
          zoneKey === 'voisins' ? 2 : zoneKey === 'tiers' ? 3 : zoneKey === 'orphelins' ? 3.5 : 4.5;
        return { won: true, payout: Math.floor(amount * mult) };
      }
      return { won: false, payout: 0 };
    }

    default:
      return { won: false, payout: 0 };
  }
}

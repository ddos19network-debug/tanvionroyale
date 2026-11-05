import * as crypto from 'crypto';
import {
  BetItem,
  BLACK_NUMBERS,
  RACETRACK_ZONES,
  RED_NUMBERS,
  UserBetSummary,
  WHEEL_NUMBERS,
} from './roulette.types';

export function getNumberColor(num: number): 'green' | 'red' | 'black' {
  if (num === 0) return 'green';
  return RED_NUMBERS.has(num) ? 'red' : 'black';
}

/** Secure server-side CSPRNG: generates 0..36 */
export function generateWinningOutcome(): {
  winningNumber: number;
  pocketIndex: number;
  targetAngle: number;
} {
  const winningNumber = crypto.randomInt(0, 37);
  const pocketIndex = WHEEL_NUMBERS.indexOf(winningNumber);
  // Pocket angle: 360 / 37 ≈ 9.7297 degrees per pocket
  const step = 360 / WHEEL_NUMBERS.length;
  const targetAngle = Number((pocketIndex * step).toFixed(4));

  return { winningNumber, pocketIndex, targetAngle };
}

/**
 * Validates a single bet item and determines payout multiplier on win.
 * Standard European Roulette payouts:
 * - straight_up: 35:1 (+1 stake = 36x)
 * - split: 17:1 (+1 = 18x)
 * - street: 11:1 (+1 = 12x)
 * - corner: 8:1 (+1 = 9x)
 * - six_line: 5:1 (+1 = 6x)
 * - column: 2:1 (+1 = 3x)
 * - dozen: 2:1 (+1 = 3x)
 * - color: 1:1 (+1 = 2x)
 * - parity: 1:1 (+1 = 2x)
 * - range: 1:1 (+1 = 2x)
 * - racetrack: splits, corners, straight-ups based on traditional French call layout.
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
      const colNum = winningNumber % 3; // 1, 4, 7 -> 1; 2, 5, 8 -> 2; 3, 6, 9 -> 0
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
        // Average payout based on French Call bet coverage ratio:
        // Voisins: 9 chips, covers 17 (pays 2x to 4x equivalent)
        // Tiers: 6 chips, covers 12 (pays 3x)
        // Orphelins: 5 chips, covers 8 (pays ~3.6x)
        // Zero: 4 chips, covers 7 (pays ~4.5x)
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

export function calculateUserPayout(userId: string, bets: BetItem[], winningNumber: number): UserBetSummary {
  let totalBet = 0;
  let totalWon = 0;

  const details = bets.map((b) => {
    totalBet += b.amount;
    const { won, payout } = evaluateBet(b, winningNumber);
    totalWon += payout;
    return {
      type: b.type,
      selection: b.selection,
      amount: b.amount,
      won,
      payout,
    };
  });

  return {
    userId,
    bets,
    totalBet,
    totalWon,
    netPayout: totalWon - totalBet,
    details,
  };
}


/**
 * Max-win cap logic.
 */

import { BASIS_POINTS } from './types';

/**
 * Clamp totalPayBp to maxWinBp.
 * Returns { capped, totalPayBp, payout }.
 */
export function applyCap(
  totalPayBp: number,
  stake: number,
  maxWinBp: number,
): { capped: boolean; totalPayBp: number; payout: number } {
  const capped = totalPayBp > maxWinBp;
  const clampedBp = capped ? maxWinBp : totalPayBp;
  const payout = Math.floor((stake * clampedBp) / BASIS_POINTS);
  return { capped, totalPayBp: clampedBp, payout };
}

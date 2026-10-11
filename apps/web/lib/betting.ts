/**
 * Client-side money/odds helpers (Phase 5).
 *
 * These are ONLY for display/UX. The backend is the source of truth and always
 * recomputes stake/payout/odds deterministically; nothing here is authoritative.
 */

/** Parse "1.85" => 185/100 so payouts use integer arithmetic (no float drift). */
export function parseOdds(price: string): { numerator: number; denominator: number } {
  const [whole, fraction = ''] = price.split('.');
  const scale = fraction.length;
  return {
    numerator: Number(whole) * 10 ** scale + Number(fraction || '0'),
    denominator: 10 ** scale,
  };
}

/** Deterministic potential return in MINOR units: floor(stake * num / den). */
export function calculatePotentialReturn(stakeMinorUnits: number, price: string): number {
  const { numerator, denominator } = parseOdds(price);
  return Math.floor((stakeMinorUnits * numerator) / denominator);
}

/** 1000 minor units (BDT) => "BDT 10.00". Display only — backend is authoritative. */
export function formatMoney(minorUnits: number, currency = 'BDT'): string {
  const major = minorUnits / 100;
  return `${currency} ${major.toFixed(2)}`;
}

/** "10.00" => 1000 minor units (2dp, rounded down to whole pence). */
export function majorToMinor(value: string): number {
  const cleaned = (value || '0').replace(/,/g, '').trim();
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed * 100);
}

/** 1000 minor units => "10.00" for an editable input. */
export function minorToMajor(minorUnits: number): string {
  return (minorUnits / 100).toFixed(2);
}
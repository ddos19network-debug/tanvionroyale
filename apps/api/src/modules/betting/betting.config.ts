/**
 * Betting configuration.
 *
 * Test-mode (development) values chosen to be safe. Money is in integer MINOR
 * UNITS (2dp), matching the wallet's supported currencies (BDT/USD/EUR):
 *
 *   MIN_STAKE = 100   ->  1.00 BDT
 *   MAX_STAKE = 100000 -> 1000.00 BDT
 *
 * Odds are decimal strings (max 2 dp), e.g. "1.85". These limits are business
 * policy and are revalidated server-side on every bet placement — never trusted
 * from the frontend.
 */
export interface BettingConfig {
  currency: string; // ISO 4217
  minStake: number; // minor units
  maxStake: number; // minor units
  decimalPlaces: number;
  /** Phase 5 ships SINGLE bets only; multiples are modelled for a later phase. */
  maxSelections: number;
}

export function loadBettingConfig(env: NodeJS.ProcessEnv = process.env): BettingConfig {
  const parseMinor = (key: string, fallback: number): number => {
    const raw = env[key];
    if (raw === undefined || raw === '') return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };

  return {
    // Must be one of the wallet-supported currencies (BDT/USD/EUR) — bets
    // reserve stake through the wallet ledger, which rejects anything else.
    currency: env.BETTING_CURRENCY ?? 'BDT',
    minStake: parseMinor('BETTING_MIN_STAKE', 100),
    maxStake: parseMinor('BETTING_MAX_STAKE', 100_000),
    decimalPlaces: 2,
    maxSelections: 1,
  };
}
/**
 * Wallet configuration.
 *
 * Money is stored as integer MINOR UNITS.
 *
 * Supported currencies:
 * - BDT
 * - USD
 * - EUR
 *
 * The frontend may display normal decimal amounts, but the backend keeps
 * integer minor units for financial calculations.
 */
export interface WalletConfig {
  /** Default wallet currency used when no currency is explicitly supplied. */
  currency: string;

  /** All currencies currently supported by the wallet. */
  supportedCurrencies: string[];

  /** Minimum deposit amount in minor units. */
  minDeposit: number;

  /** Maximum deposit amount in minor units. */
  maxDeposit: number;

  /** Minimum withdrawal amount in minor units. */
  minWithdrawal: number;

  /** Maximum withdrawal amount in minor units. */
  maxWithdrawal: number;
}

export function loadWalletConfig(
  env: NodeJS.ProcessEnv = process.env,
): WalletConfig {
  const parseMinor = (key: string, fallback: number): number => {
    const raw = env[key];

    if (raw === undefined || raw === '') {
      return fallback;
    }

    const value = Number.parseInt(raw, 10);

    return Number.isInteger(value) && value > 0 ? value : fallback;
  };

  /**
   * The wallet supports these three currencies.
   *
   * Do not read this list directly from the frontend.
   * Backend validation must always use this server-side configuration.
   */
  const supportedCurrencies = ['BDT', 'USD', 'EUR'];

  /**
   * Default currency is BDT because the primary manual payment methods
   * (bKash, Nagad, Rocket and Bank) are expected to operate in Bangladesh.
   *
   * WALLET_CURRENCY can still be used to change the default, but only to
   * one of the supported currencies.
   */
  const requestedCurrency = (env.WALLET_CURRENCY ?? 'BDT').toUpperCase();

  const currency = supportedCurrencies.includes(requestedCurrency)
    ? requestedCurrency
    : 'BDT';

  return {
    currency,

    supportedCurrencies,

    /*
     * Amounts are stored as minor units.
     *
     * Examples:
     * BDT 100.00 -> 10000
     * USD 10.00  -> 1000
     * EUR 10.00  -> 1000
     *
     * These are global wallet limits. Payment-method-specific limits are
     * additionally handled by the PaymentMethod configuration.
     */
    minDeposit: parseMinor(
      'WALLET_MIN_DEPOSIT',
      100,
    ),

    maxDeposit: parseMinor(
      'WALLET_MAX_DEPOSIT',
      100_000_000,
    ),

    minWithdrawal: parseMinor(
      'WALLET_MIN_WITHDRAWAL',
      500,
    ),

    maxWithdrawal: parseMinor(
      'WALLET_MAX_WITHDRAWAL',
      50_000_000,
    ),
  };
}

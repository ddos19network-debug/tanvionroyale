/** VIRTUAL paper-trading configuration. Never affects the real Wallet. */
export interface TradingConfig {
  currency: string; // ISO 4217 (virtual)
  /** Starting VIRTUAL balance in minor units (default: 10,000.00). */
  startingBalanceMinor: number;
  /** Maximum quantity per order (whole virtual units). */
  maxOrderQuantity: number;
  /** Number of historical price points served for charts. */
  historyPoints: number;
}

export function loadTradingConfig(env: NodeJS.ProcessEnv = process.env): TradingConfig {
  const parseMinor = (key: string, fallback: number): number => {
    const raw = env[key];
    if (raw === undefined || raw === '') return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isInteger(n) && n >= 0 ? n : fallback;
  };
  const parseMax = (key: string, fallback: number): number => {
    const raw = env[key];
    if (raw === undefined || raw === '') return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  return {
    currency: env.TRADING_CURRENCY ?? 'USD',
    startingBalanceMinor: parseMinor('TRADING_STARTING_BALANCE', 10_000_00),
    maxOrderQuantity: parseMax('TRADING_MAX_ORDER_QUANTITY', 1_000_000),
    historyPoints: Math.min(Math.max(parseMax('TRADING_HISTORY_POINTS', 30), 5), 200),
  };
}
/**
 * TANVION ROYALE TRADING PLATFORM — INSTRUMENT CONTRACT SPECIFICATIONS
 * Standardized institutional financial calculations for Crypto, Forex, Metals, Commodities, and Indices.
 * Ensures that 1 lot of EUR/USD = 100,000 units, 1 lot of Gold = 100 oz, etc.
 */

export interface InstrumentContractSpec {
  symbol: string;
  name: string;
  assetClass: 'CRYPTO' | 'FOREX' | 'COMMODITY' | 'STOCK' | 'INDEX';
  contractSize: number;       // Multiplier per 1.00 lot
  tickSize: number;           // Minimum price movement
  tickValue: number;          // Monetary value of 1 tick per 1 lot in quote currency
  pipSize: number;            // Pip definition (e.g. 0.0001 for EURUSD, 0.01 for USDJPY)
  minVolume: number;          // e.g. 0.01 lots
  maxVolume: number;          // e.g. 100.00 lots
  volumeStep: number;         // e.g. 0.01
  pricePrecision: number;     // Decimals (e.g. 5 for EURUSD, 2 for BTCUSD)
  defaultLeverage: number;    // e.g. 500 for Forex, 50 for Crypto
  tradingHours: string;       // e.g. '24/7' or '24/5'
  quoteCurrency: string;
}

export const CONTRACT_SPECIFICATIONS: Record<string, InstrumentContractSpec> = {
  // --- CRYPTO (1 Lot = 1 Unit) ---
  BTCUSD: {
    symbol: 'BTCUSD',
    name: 'Bitcoin',
    assetClass: 'CRYPTO',
    contractSize: 1,
    tickSize: 0.01,
    tickValue: 0.01,
    pipSize: 1.0,
    minVolume: 0.01,
    maxVolume: 50.0,
    volumeStep: 0.01,
    pricePrecision: 2,
    defaultLeverage: 100,
    tradingHours: '24/7',
    quoteCurrency: 'USD',
  },
  ETHUSD: {
    symbol: 'ETHUSD',
    name: 'Ethereum',
    assetClass: 'CRYPTO',
    contractSize: 1,
    tickSize: 0.01,
    tickValue: 0.01,
    pipSize: 0.1,
    minVolume: 0.01,
    maxVolume: 200.0,
    volumeStep: 0.01,
    pricePrecision: 2,
    defaultLeverage: 100,
    tradingHours: '24/7',
    quoteCurrency: 'USD',
  },
  SOLUSD: {
    symbol: 'SOLUSD',
    name: 'Solana',
    assetClass: 'CRYPTO',
    contractSize: 1,
    tickSize: 0.01,
    tickValue: 0.01,
    pipSize: 0.1,
    minVolume: 0.1,
    maxVolume: 1000.0,
    volumeStep: 0.1,
    pricePrecision: 2,
    defaultLeverage: 50,
    tradingHours: '24/7',
    quoteCurrency: 'USD',
  },
  BNBUSD: {
    symbol: 'BNBUSD',
    name: 'BNB',
    assetClass: 'CRYPTO',
    contractSize: 1,
    tickSize: 0.01,
    tickValue: 0.01,
    pipSize: 0.1,
    minVolume: 0.1,
    maxVolume: 500.0,
    volumeStep: 0.1,
    pricePrecision: 2,
    defaultLeverage: 50,
    tradingHours: '24/7',
    quoteCurrency: 'USD',
  },
  DOGEUSD: {
    symbol: 'DOGEUSD',
    name: 'Dogecoin',
    assetClass: 'CRYPTO',
    contractSize: 1000,
    tickSize: 0.00001,
    tickValue: 0.01,
    pipSize: 0.001,
    minVolume: 1.0,
    maxVolume: 50000.0,
    volumeStep: 1.0,
    pricePrecision: 4,
    defaultLeverage: 50,
    tradingHours: '24/7',
    quoteCurrency: 'USD',
  },
  XRPUSD: {
    symbol: 'XRPUSD',
    name: 'XRP',
    assetClass: 'CRYPTO',
    contractSize: 100,
    tickSize: 0.0001,
    tickValue: 0.01,
    pipSize: 0.01,
    minVolume: 1.0,
    maxVolume: 10000.0,
    volumeStep: 1.0,
    pricePrecision: 4,
    defaultLeverage: 50,
    tradingHours: '24/7',
    quoteCurrency: 'USD',
  },

  // --- FOREX (1 Lot = 100,000 Units of Base Currency) ---
  EURUSD: {
    symbol: 'EURUSD',
    name: 'EUR / USD',
    assetClass: 'FOREX',
    contractSize: 100000,
    tickSize: 0.00001,
    tickValue: 1.0,
    pipSize: 0.0001,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    pricePrecision: 5,
    defaultLeverage: 500,
    tradingHours: '24/5',
    quoteCurrency: 'USD',
  },
  GBPUSD: {
    symbol: 'GBPUSD',
    name: 'GBP / USD',
    assetClass: 'FOREX',
    contractSize: 100000,
    tickSize: 0.00001,
    tickValue: 1.0,
    pipSize: 0.0001,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    pricePrecision: 5,
    defaultLeverage: 500,
    tradingHours: '24/5',
    quoteCurrency: 'USD',
  },
  USDJPY: {
    symbol: 'USDJPY',
    name: 'USD / JPY',
    assetClass: 'FOREX',
    contractSize: 100000,
    tickSize: 0.001,
    tickValue: 0.65, // in USD approx based on rate
    pipSize: 0.01,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    pricePrecision: 3,
    defaultLeverage: 500,
    tradingHours: '24/5',
    quoteCurrency: 'JPY',
  },
  AUDUSD: {
    symbol: 'AUDUSD',
    name: 'AUD / USD',
    assetClass: 'FOREX',
    contractSize: 100000,
    tickSize: 0.00001,
    tickValue: 1.0,
    pipSize: 0.0001,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    pricePrecision: 5,
    defaultLeverage: 500,
    tradingHours: '24/5',
    quoteCurrency: 'USD',
  },
  AUDCAD: {
    symbol: 'AUDCAD',
    name: 'AUD / CAD',
    assetClass: 'FOREX',
    contractSize: 100000,
    tickSize: 0.00001,
    tickValue: 0.74,
    pipSize: 0.0001,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    pricePrecision: 5,
    defaultLeverage: 500,
    tradingHours: '24/5',
    quoteCurrency: 'CAD',
  },
  AUDCHF: {
    symbol: 'AUDCHF',
    name: 'AUD / CHF',
    assetClass: 'FOREX',
    contractSize: 100000,
    tickSize: 0.00001,
    tickValue: 1.15,
    pipSize: 0.0001,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    pricePrecision: 5,
    defaultLeverage: 500,
    tradingHours: '24/5',
    quoteCurrency: 'CHF',
  },
  AUDJPY: {
    symbol: 'AUDJPY',
    name: 'AUD / JPY',
    assetClass: 'FOREX',
    contractSize: 100000,
    tickSize: 0.001,
    tickValue: 0.65,
    pipSize: 0.01,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    pricePrecision: 3,
    defaultLeverage: 500,
    tradingHours: '24/5',
    quoteCurrency: 'JPY',
  },
  AUDNZD: {
    symbol: 'AUDNZD',
    name: 'AUD / NZD',
    assetClass: 'FOREX',
    contractSize: 100000,
    tickSize: 0.00001,
    tickValue: 0.60,
    pipSize: 0.0001,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    pricePrecision: 5,
    defaultLeverage: 500,
    tradingHours: '24/5',
    quoteCurrency: 'NZD',
  },
  CADJPY: {
    symbol: 'CADJPY',
    name: 'CAD / JPY',
    assetClass: 'FOREX',
    contractSize: 100000,
    tickSize: 0.001,
    tickValue: 0.65,
    pipSize: 0.01,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    pricePrecision: 3,
    defaultLeverage: 500,
    tradingHours: '24/5',
    quoteCurrency: 'JPY',
  },

  // --- COMMODITIES & METALS (Gold = 100 oz, Silver = 5,000 oz, Oil = 1,000 bbl) ---
  XAUUSD: {
    symbol: 'XAUUSD',
    name: 'Gold / US Dollar',
    assetClass: 'COMMODITY',
    contractSize: 100, // 100 Troy Ounces
    tickSize: 0.01,
    tickValue: 1.0,
    pipSize: 0.1,
    minVolume: 0.01,
    maxVolume: 50.0,
    volumeStep: 0.01,
    pricePrecision: 2,
    defaultLeverage: 200,
    tradingHours: '24/5',
    quoteCurrency: 'USD',
  },
  XAGUSD: {
    symbol: 'XAGUSD',
    name: 'Silver / US Dollar',
    assetClass: 'COMMODITY',
    contractSize: 5000, // 5,000 Troy Ounces
    tickSize: 0.001,
    tickValue: 5.0,
    pipSize: 0.01,
    minVolume: 0.01,
    maxVolume: 20.0,
    volumeStep: 0.01,
    pricePrecision: 3,
    defaultLeverage: 100,
    tradingHours: '24/5',
    quoteCurrency: 'USD',
  },
  USOIL: {
    symbol: 'USOIL',
    name: 'Crude Oil',
    assetClass: 'COMMODITY',
    contractSize: 1000, // 1,000 Barrels
    tickSize: 0.01,
    tickValue: 10.0,
    pipSize: 0.01,
    minVolume: 0.01,
    maxVolume: 50.0,
    volumeStep: 0.01,
    pricePrecision: 2,
    defaultLeverage: 100,
    tradingHours: '24/5',
    quoteCurrency: 'USD',
  },

  // --- STOCKS (1 Lot = 1 Share) ---
  AAPL: {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    assetClass: 'STOCK',
    contractSize: 1,
    tickSize: 0.01,
    tickValue: 0.01,
    pipSize: 0.01,
    minVolume: 1.0,
    maxVolume: 1000.0,
    volumeStep: 1.0,
    pricePrecision: 2,
    defaultLeverage: 20,
    tradingHours: 'NYSE Hours',
    quoteCurrency: 'USD',
  },
  TSLA: {
    symbol: 'TSLA',
    name: 'Tesla Inc.',
    assetClass: 'STOCK',
    contractSize: 1,
    tickSize: 0.01,
    tickValue: 0.01,
    pipSize: 0.01,
    minVolume: 1.0,
    maxVolume: 1000.0,
    volumeStep: 1.0,
    pricePrecision: 2,
    defaultLeverage: 20,
    tradingHours: 'NYSE Hours',
    quoteCurrency: 'USD',
  },
  NVDA: {
    symbol: 'NVDA',
    name: 'NVIDIA Corp.',
    assetClass: 'STOCK',
    contractSize: 1,
    tickSize: 0.01,
    tickValue: 0.01,
    pipSize: 0.01,
    minVolume: 1.0,
    maxVolume: 1000.0,
    volumeStep: 1.0,
    pricePrecision: 2,
    defaultLeverage: 20,
    tradingHours: 'NYSE Hours',
    quoteCurrency: 'USD',
  },
  AMZN: {
    symbol: 'AMZN',
    name: 'Amazon.com Inc.',
    assetClass: 'STOCK',
    contractSize: 1,
    tickSize: 0.01,
    tickValue: 0.01,
    pipSize: 0.01,
    minVolume: 1.0,
    maxVolume: 1000.0,
    volumeStep: 1.0,
    pricePrecision: 2,
    defaultLeverage: 20,
    tradingHours: 'NYSE Hours',
    quoteCurrency: 'USD',
  },
};

/**
 * Get contract specification for any symbol with automatic fallback
 */
export function getContractSpec(symbol: string): InstrumentContractSpec {
  const clean = symbol.toUpperCase().replace('/', '').trim();
  if (CONTRACT_SPECIFICATIONS[clean]) {
    return CONTRACT_SPECIFICATIONS[clean];
  }

  // Detect category from naming pattern
  if (clean.includes('USD') && (clean.includes('EUR') || clean.includes('GBP') || clean.includes('JPY') || clean.includes('AUD') || clean.includes('CAD') || clean.includes('CHF') || clean.includes('NZD'))) {
    return {
      symbol: clean,
      name: clean,
      assetClass: 'FOREX',
      contractSize: 100000,
      tickSize: clean.includes('JPY') ? 0.001 : 0.00001,
      tickValue: 1.0,
      pipSize: clean.includes('JPY') ? 0.01 : 0.0001,
      minVolume: 0.01,
      maxVolume: 100.0,
      volumeStep: 0.01,
      pricePrecision: clean.includes('JPY') ? 3 : 5,
      defaultLeverage: 500,
      tradingHours: '24/5',
      quoteCurrency: 'USD',
    };
  }

  // Default Crypto
  return {
    symbol: clean,
    name: clean,
    assetClass: 'CRYPTO',
    contractSize: 1,
    tickSize: 0.01,
    tickValue: 0.01,
    pipSize: 0.1,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    pricePrecision: 2,
    defaultLeverage: 100,
    tradingHours: '24/7',
    quoteCurrency: 'USD',
  };
}

/**
 * Institutional Floating P&L calculation
 */
export function calculateFloatingPnl(
  side: 'BUY' | 'SELL',
  openPrice: number,
  currentPrice: number,
  lots: number,
  symbol: string,
): number {
  const spec = getContractSpec(symbol);
  const diff = side === 'BUY' ? currentPrice - openPrice : openPrice - currentPrice;
  return diff * lots * spec.contractSize;
}

/**
 * Institutional Required Margin calculation
 */
export function calculateRequiredMargin(
  price: number,
  lots: number,
  leverage: number,
  symbol: string,
): number {
  const spec = getContractSpec(symbol);
  const effLeverage = Math.max(1, leverage || spec.defaultLeverage);
  return (price * lots * spec.contractSize) / effLeverage;
}

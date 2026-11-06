import { MarketDataSource, MarketPrice, PricePoint } from '../market-data.provider';

/** Market data providers for live feeds (crypto, forex, stocks). */
export interface IMarketAdapter {
  readonly name: string;
  /** Transform an instrument into a live price quote. */
  getLatestPrice(instrument: { id: string; symbol: string; basePrice: number }): Promise<MarketPrice>;
  /** Historical price points for charting. */
  getHistoricalPrices(
    instrument: { id: string; symbol: string; basePrice: number },
    points: number,
  ): Promise<PricePoint[]>;
  /** Market status (open/closed). */
  getMarketStatus(): Promise<{ open: boolean; label: string }>;
}

/** Common adapter interface for all market sources. */
export type MarketAdapter = IMarketAdapter;

/** Crypto exchange adapter (e.g., Binance, Coinbase). */
export interface ICryptoAdapter extends IMarketAdapter {
  readonly type: 'crypto';
  /** Currency pair precision (decimals). */
  readonly pairPrecision: number;
}

/** Forex broker adapter (e.g., MetaTrader, OANDA). */
export interface IForexAdapter extends IMarketAdapter {
  readonly type: 'forex';
  /** Currency pair base quote precision. */
  readonly pairPrecision: number;
}

/** Stock exchange adapter (e.g., NYSE, NASDAQ, Binance). */
export interface IStockAdapter extends IMarketAdapter {
  readonly type: 'stock';
  /** Stock ticker precision. */
  readonly tickerPrecision: number;
}

/** Base market data provider configuration. */
export interface MarketDataProviderConfig {
  name: string;
  environment: 'sandbox' | 'production';
  enabled: boolean;
}

/** Provider-specific configuration. */
export interface CryptoDataProviderConfig extends MarketDataProviderConfig {
  type: 'crypto';
  apiKey: string;
  secretKey: string;
  baseUrl: string;
  pairPrecision: number;
}

export interface ForexDataProviderConfig extends MarketDataProviderConfig {
  type: 'forex';
  apiKey: string;
  secretKey: string;
  baseUrl: string;
  pairPrecision: number;
}

export interface StockDataProviderConfig extends MarketDataProviderConfig {
  type: 'stock';
  apiKey: string;
  baseUrl: string;
  tickerPrecision: number;
}

/** Registry of available market data providers. */
export interface MarketDataProviderRegistry {
  [key: string]: MarketDataProviderConfig | undefined;
}

/**
 * Frontend Trading Platform API.
 * Communicates with TANVIONROYALE trading backend module.
 */
import { apiFetch, authFetch } from './client';
import type {
  TradingAccountView,
  TradingInstrumentView,
  TradingInstrumentDetailView,
  TradingOrderView,
  TradingPositionView,
  TradingPortfolioView,
  TradingOrderResult,
  TradingTransactionView,
  TradingLeaderboardEntry,
  TradingOrderSide,
  TradingOrderType,
  TradingCandle,
  TradingOrderBook,
  TradingMarketTrade,
} from '@tanvion-royale/types';

export type {
  TradingAccountView,
  TradingInstrumentView,
  TradingInstrumentDetailView,
  TradingOrderView,
  TradingPositionView,
  TradingPortfolioView,
  TradingOrderResult,
  TradingTransactionView,
  TradingLeaderboardEntry,
  TradingOrderSide,
  TradingOrderType,
  TradingCandle,
  TradingOrderBook,
  TradingMarketTrade,
};

// ----------------------------------------------------------------------------
// Public Market Data (no sign-in required)
// ----------------------------------------------------------------------------

export async function listTradingInstruments(): Promise<TradingInstrumentView[]> {
  return apiFetch<TradingInstrumentView[]>('/trading/instruments');
}

export async function getTradingInstrument(idOrSymbol: string): Promise<TradingInstrumentDetailView> {
  return apiFetch<TradingInstrumentDetailView>(
    `/trading/instruments/${encodeURIComponent(idOrSymbol)}`,
  );
}

export async function getTradingCandles(
  idOrSymbol: string,
  timeframe = '15m',
  count = 80,
): Promise<TradingCandle[]> {
  return apiFetch<TradingCandle[]>(
    `/trading/instruments/${encodeURIComponent(idOrSymbol)}/candles?timeframe=${timeframe}&count=${count}`,
  );
}

export async function getTradingOrderBook(idOrSymbol: string): Promise<TradingOrderBook> {
  return apiFetch<TradingOrderBook>(
    `/trading/instruments/${encodeURIComponent(idOrSymbol)}/orderbook`,
  );
}

export async function getTradingRecentTrades(
  idOrSymbol: string,
  count = 25,
): Promise<TradingMarketTrade[]> {
  return apiFetch<TradingMarketTrade[]>(
    `/trading/instruments/${encodeURIComponent(idOrSymbol)}/trades?count=${count}`,
  );
}

export async function getTradingLeaderboard(limit = 10): Promise<TradingLeaderboardEntry[]> {
  return apiFetch<TradingLeaderboardEntry[]>(`/trading/leaderboard?limit=${limit}`);
}

// ----------------------------------------------------------------------------
// Market Data Proxy (forex rates + stock quotes via backend)
// ----------------------------------------------------------------------------

export interface MarketRatesResponse {
  base: string;
  date: string;
  rates: Record<string, number>;
  dataSource: 'LIVE' | 'DELAYED' | 'DEMO';
  stale: boolean;
  upstreamStatus: number | null;
}

export interface MarketQuotesResponse {
  quotes: Record<string, unknown>;
  dataSource: 'LIVE' | 'DELAYED' | 'DEMO';
  stale: boolean;
  upstreamStatus: number | null;
}

/**
 * Fetch forex exchange rates from the backend market-data proxy.
 * The backend fetches from Frankfurter (ECB) server-side.
 */
export async function getMarketRates(): Promise<MarketRatesResponse> {
  return apiFetch<MarketRatesResponse>('/market/rates');
}

/**
 * Fetch stock quotes from the backend market-data proxy.
 * The backend fetches from Yahoo Finance server-side.
 * Optionally pass a comma-separated list of symbols to filter.
 */
export async function getMarketQuotes(symbols?: string): Promise<MarketQuotesResponse> {
  const qs = symbols ? `?symbols=${encodeURIComponent(symbols)}` : '';
  return apiFetch<MarketQuotesResponse>(`/market/quotes${qs}`);
}

// ----------------------------------------------------------------------------
// Authenticated User Endpoints (requires sign-in)
// ----------------------------------------------------------------------------

export async function getTradingAccount(): Promise<TradingAccountView> {
  return authFetch<TradingAccountView>('/trading/account');
}

export async function claimTradingFaucet(
  amount?: number,
  reset?: boolean,
): Promise<TradingAccountView> {
  return authFetch<TradingAccountView>('/trading/account/faucet', {
    method: 'POST',
    body: JSON.stringify({ amount, reset }),
  });
}

export async function getTradingPortfolio(): Promise<TradingPortfolioView> {
  return authFetch<TradingPortfolioView>('/trading/account/portfolio');
}

export async function placeTradingOrder(
  instrumentId: string,
  side: TradingOrderSide,
  quantity: number,
  type: TradingOrderType = 'MARKET',
  limitPrice?: number,
  stopPrice?: number,
  leverage = 1,
): Promise<TradingOrderResult> {
  return authFetch<TradingOrderResult>('/trading/orders', {
    method: 'POST',
    body: JSON.stringify({
      instrumentId,
      side,
      quantity,
      type,
      limitPrice,
      stopPrice,
      leverage,
    }),
  });
}

export async function listTradingOrders(limit = 50): Promise<TradingOrderView[]> {
  return authFetch<TradingOrderView[]>(`/trading/orders?limit=${limit}`);
}

export async function listOpenTradingOrders(): Promise<TradingOrderView[]> {
  return authFetch<TradingOrderView[]>('/trading/orders/open');
}

export async function cancelTradingOrder(orderId: string): Promise<TradingOrderView> {
  return authFetch<TradingOrderView>(`/trading/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
  });
}

export async function listTradingPositions(): Promise<TradingPositionView[]> {
  return authFetch<TradingPositionView[]>('/trading/positions');
}

export async function closeTradingPosition(positionId: string): Promise<TradingOrderResult> {
  return authFetch<TradingOrderResult>(`/trading/positions/${encodeURIComponent(positionId)}/close`, {
    method: 'POST',
  });
}

export async function listTradingHistory(limit = 50): Promise<TradingTransactionView[]> {
  return authFetch<TradingTransactionView[]>(`/trading/history?limit=${limit}`);
}

/** Format integer minor units as a currency string (2 dp). */
export function formatMinor(amount: number, currency = 'USD'): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const body = (abs / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}${currency === 'USD' ? '$' : `${currency} `}${body}`;
}

/** Format price in minor units with decimals appropriate for the asset. */
export function formatPrice(priceInMinor: number, symbol = ''): string {
  const isForex = symbol.includes('EUR') || symbol.includes('GBP') || symbol.includes('JPY') || symbol.includes('AUD');
  const isSmallCrypto = symbol.includes('XRP') || symbol.includes('DOGE');

  if (isForex || isSmallCrypto) {
    return (priceInMinor / 100).toFixed(4);
  }
  return (priceInMinor / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Format basis points to percentage (+3.45%). */
export function formatPercent(bps = 0): string {
  const pct = bps / 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

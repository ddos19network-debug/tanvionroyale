/**
 * ============================================================
 *  TANVION ROYALE — Live Market Rates (via Backend Proxy)
 * ============================================================
 *
 * All market data is now fetched through the project's own backend API
 * (/api/v1/market/rates and /api/v1/market/quotes) rather than directly
 * from third-party endpoints in the browser. This avoids:
 *
 *   • CORS errors from Frankfurter (api.frankfurter.app)
 *   • 401 / CORS errors from Yahoo Finance (query1/2.finance.yahoo.com)
 *
 * The backend proxies Frankfurter (ECB forex) and Yahoo Finance (stocks)
 * server-side, with caching and fallback to the last valid data.
 *
 * Crypto and other instrument prices come from /api/v1/trading/instruments
 * (backend MarketDataProvider), which is already called by the trading page.
 *
 * Prices update every 5s.
 * ============================================================
 */

import {
  getMarketQuotes,
  getMarketRates,
  type MarketQuotesResponse,
  type MarketRatesResponse,
} from './trading';

export interface LiveMarketQuote {
  symbol: string;
  currentPrice: number; // minor units (USD cents)
  change24h: number; // basis points (e.g. +230 = +2.30%)
  high24h: number; // minor units
  low24h: number; // minor units
  volume24h: number; // minor units (USD cents)
  asOf: string; // ISO 8601 timestamp
}

// ─── Cache ───────────────────────────────────────────────────
let cachedQuotes: Record<string, LiveMarketQuote> = {};
let lastFetchTime = 0;
const CACHE_TTL_MS = 5_000; // 5 seconds

// ─── Helper ───────────────────────────────────────────────────
function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toMinor(usd: number): number {
  return Math.round(usd * 100);
}

// ─────────────────────────────────────────────────────────────
// Backend-powered market data (forex via Frankfurter proxy)
// ─────────────────────────────────────────────────────────────

/**
 * Forex pairs supported by Frankfurter (USD base).
 * Frankfurter returns rates like { EUR: 0.92, GBP: 0.79, ... }
 * meaning 1 USD = X foreign_currency.
 */
const FOREX_PAIRS: Record<string, string> = {
  EUR: 'EURUSD',
  GBP: 'GBPUSD',
  JPY: 'USDJPY',
  AUD: 'AUDUSD',
  CAD: 'USDCAD',
  CHF: 'USDCHF',
};

function mapForexRates(
  rates: Record<string, number>,
  asOf: string,
): Record<string, LiveMarketQuote> {
  const quotes: Record<string, LiveMarketQuote> = {};

  for (const [ccy, rate] of Object.entries(rates)) {
    const pair = FOREX_PAIRS[ccy];
    if (!pair) continue;
    if (!Number.isFinite(rate) || rate <= 0) continue;

    let price: number;
    if (pair.startsWith('USD')) {
      price = rate;
    } else {
      price = 1 / rate;
    }

    quotes[pair] = {
      symbol: pair,
      currentPrice: toMinor(price),
      change24h: 0,
      high24h: toMinor(price * 1.004),
      low24h: toMinor(price * 0.996),
      volume24h: 0,
      asOf,
    };
  }

  return quotes;
}

function mapStockQuotes(
  quotes: Record<string, unknown>,
  asOf: string,
): Record<string, LiveMarketQuote> {
  const result: Record<string, LiveMarketQuote> = {};

  for (const [sym, val] of Object.entries(quotes)) {
    if (typeof val !== 'object' || val === null) continue;
    const row = val as Record<string, unknown>;

    const price = safeNum(row.regularMarketPrice);
    if (price <= 0) continue;

    const changePct = safeNum(row.regularMarketChangePercent);
    const high = safeNum(row.regularMarketDayHigh) || price * 1.02;
    const low = safeNum(row.regularMarketDayLow) || price * 0.98;
    const vol = safeNum(row.regularMarketVolume) || 10_000_000;

    result[sym] = {
      symbol: sym,
      currentPrice: toMinor(price),
      change24h: Math.round(changePct * 100),
      high24h: toMinor(high),
      low24h: toMinor(low),
      volume24h: toMinor(vol * price),
      asOf,
    };
  }

  return result;
}

async function fetchFromBackend(): Promise<Record<string, LiveMarketQuote>> {
  const quotes: Record<string, LiveMarketQuote> = {};
  const now = new Date().toISOString();

  try {
    const [ratesRes, quotesRes] = await Promise.allSettled([
      getMarketRates(),
      getMarketQuotes(),
    ]);

    if (ratesRes.status === 'fulfilled') {
      const data: MarketRatesResponse = ratesRes.value;
      Object.assign(
        quotes,
        mapForexRates(data.rates, data.date || now),
      );
    }

    if (quotesRes.status === 'fulfilled') {
      const data: MarketQuotesResponse = quotesRes.value;
      Object.assign(quotes, mapStockQuotes(data.quotes, now));
    }
  } catch {
    // Backend unavailable — caller will use cache
  }

  return quotes;
}

// ─────────────────────────────────────────────────────────────
// PUBLIC EXPORT — fetch all sources via backend, merge & cache
// ─────────────────────────────────────────────────────────────
export async function getLiveMarketQuotes(): Promise<Record<string, LiveMarketQuote>> {
  const now = Date.now();
  if (now - lastFetchTime < CACHE_TTL_MS && Object.keys(cachedQuotes).length > 0) {
    return cachedQuotes;
  }

  const live = await fetchFromBackend();

  if (Object.keys(live).length > 0) {
    cachedQuotes = { ...cachedQuotes, ...live };
    lastFetchTime = now;
  }

  return cachedQuotes;
}

/**
 * Returns the current cached quotes without triggering a new fetch.
 * Useful for rendering while a background fetch is in progress.
 */
export function getCachedQuotes(): Record<string, LiveMarketQuote> {
  return cachedQuotes;
}

/**
 * Returns the ISO timestamp of the last successful fetch, or null.
 */
export function getLastFetchTime(): string | null {
  return lastFetchTime > 0 ? new Date(lastFetchTime).toISOString() : null;
}

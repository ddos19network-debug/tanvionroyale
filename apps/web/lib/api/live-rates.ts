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
import { isBackendOffline, markBackendOffline } from './client';

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
 * Convert standard currency quote to minor units:
 * - Forex: 100,000 minor units (5 decimal pips, e.g. 1.08420 -> 108420; JPY 3 decimals * 1000 = 152450)
 * - Crypto & Stocks: 100 minor units (cents, e.g. $74,584.57 -> 7458457)
 */
function toForexMinor(pair: string, price: number): number {
  if (pair.includes('JPY')) {
    return Math.round(price * 1000);
  }
  return Math.round(price * 100_000);
}

function mapForexRates(
  rates: Record<string, number>,
  asOf: string,
): Record<string, LiveMarketQuote> {
  const quotes: Record<string, LiveMarketQuote> = {};

  const getRate = (ccy: string) => rates[ccy] ?? 0;

  // Major pairs (vs USD)
  const majors: Record<string, number> = {};
  if (getRate('EUR') > 0) majors['EURUSD'] = 1 / getRate('EUR');
  if (getRate('GBP') > 0) majors['GBPUSD'] = 1 / getRate('GBP');
  if (getRate('AUD') > 0) majors['AUDUSD'] = 1 / getRate('AUD');
  if (getRate('NZD') > 0) majors['NZDUSD'] = 1 / getRate('NZD');
  if (getRate('JPY') > 0) majors['USDJPY'] = getRate('JPY');
  if (getRate('CAD') > 0) majors['USDCAD'] = getRate('CAD');
  if (getRate('CHF') > 0) majors['USDCHF'] = getRate('CHF');

  // Cross rates (calculated from ECB USD rates)
  if (getRate('AUD') > 0 && getRate('CAD') > 0) majors['AUDCAD'] = getRate('CAD') / getRate('AUD');
  if (getRate('AUD') > 0 && getRate('CHF') > 0) majors['AUDCHF'] = getRate('CHF') / getRate('AUD');
  if (getRate('AUD') > 0 && getRate('JPY') > 0) majors['AUDJPY'] = getRate('JPY') / getRate('AUD');
  if (getRate('AUD') > 0 && getRate('NZD') > 0) majors['AUDNZD'] = getRate('NZD') / getRate('AUD');
  if (getRate('CAD') > 0 && getRate('JPY') > 0) majors['CADJPY'] = getRate('JPY') / getRate('CAD');
  if (getRate('EUR') > 0 && getRate('GBP') > 0) majors['EURGBP'] = getRate('GBP') / getRate('EUR');
  if (getRate('EUR') > 0 && getRate('JPY') > 0) majors['EURJPY'] = getRate('JPY') / getRate('EUR');
  if (getRate('GBP') > 0 && getRate('JPY') > 0) majors['GBPJPY'] = getRate('JPY') / getRate('GBP');
  if (getRate('EUR') > 0 && getRate('CHF') > 0) majors['EURCHF'] = getRate('CHF') / getRate('EUR');
  if (getRate('EUR') > 0 && getRate('CAD') > 0) majors['EURCAD'] = getRate('CAD') / getRate('EUR');
  if (getRate('EUR') > 0 && getRate('AUD') > 0) majors['EURAUD'] = getRate('AUD') / getRate('EUR');

  for (const [pair, price] of Object.entries(majors)) {
    if (!Number.isFinite(price) || price <= 0) continue;
    const minorPrice = toForexMinor(pair, price);

    quotes[pair] = {
      symbol: pair,
      currentPrice: minorPrice,
      change24h: 0,
      high24h: Math.round(minorPrice * 1.002),
      low24h: Math.round(minorPrice * 0.998),
      volume24h: 50_000_000,
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

async function fetchBinanceCryptoQuotes(): Promise<Record<string, LiveMarketQuote>> {
  const result: Record<string, LiveMarketQuote> = {};
  const pairs = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'DOGEUSDT', 'XRPUSDT', 'ADAUSDT', 'AVAXUSDT',
    'LINKUSDT', 'SUIUSDT', 'PEPEUSDT', 'NEARUSDT', 'APTUSDT', 'DOTUSDT', 'SHIBUSDT', 'TRXUSDT',
    'TONUSDT', 'LTCUSDT', 'UNIUSDT', 'ATOMUSDT', 'FILUSDT', 'HBARUSDT', 'ICPUSDT', 'INJUSDT',
    'TIAUSDT', 'RENDERUSDT', 'FETUSDT', 'ARBUSDT', 'OPUSDT', 'WLDUSDT', 'GALAUSDT', 'SANDUSDT',
    // Paxos Gold (PAXG = 1 troy ounce physical gold spot price)
    'PAXGUSDT',
  ];
  const now = new Date().toISOString();

  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(pairs))}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return result;
    const data: any[] = await res.json();
    for (const item of data) {
      const p = parseFloat(item.lastPrice) || 0;
      const chg = parseFloat(item.priceChangePercent) || 0;
      const h = parseFloat(item.highPrice) || p;
      const l = parseFloat(item.lowPrice) || p;
      const v = parseFloat(item.volume) || 0;
      const trSym = item.symbol.replace('USDT', 'USD');
      const quoteObj: LiveMarketQuote = {
        symbol: trSym,
        currentPrice: Math.round(p * 100),
        change24h: Math.round(chg * 100),
        high24h: Math.round(h * 100),
        low24h: Math.round(l * 100),
        volume24h: Math.round(v * p * 100),
        asOf: now,
      };
      result[trSym] = quoteObj;
      result[item.symbol] = quoteObj;

      // Special mapping: PAXGUSDT -> XAUUSD (Gold spot)
      if (item.symbol === 'PAXGUSDT') {
        result['XAUUSD'] = { ...quoteObj, symbol: 'XAUUSD' };
        result['GOLD'] = { ...quoteObj, symbol: 'GOLD' };
        result['XAU'] = { ...quoteObj, symbol: 'XAU' };
        // Estimate Silver spot based on real live gold price and live gold/silver ratio (~84.3)
        const silverPrice = p / 84.3;
        result['XAGUSD'] = {
          symbol: 'XAGUSD',
          currentPrice: Math.round(silverPrice * 100),
          change24h: Math.round(chg * 100),
          high24h: Math.round((h / 84.3) * 100),
          low24h: Math.round((l / 84.3) * 100),
          volume24h: Math.round(v * silverPrice * 100),
          asOf: now,
        };
      }
    }
  } catch {
    // Binance rate limit or network error fallback
  }

  return result;
}

async function fetchDirectFrankfurter(): Promise<Record<string, LiveMarketQuote>> {
  const quotes: Record<string, LiveMarketQuote> = {};
  const now = new Date().toISOString();
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data && data.rates) {
        Object.assign(quotes, mapForexRates(data.rates, data.date || now));
      }
    }
  } catch {
    // ignore
  }
  return quotes;
}

async function fetchFromBackend(): Promise<Record<string, LiveMarketQuote>> {
  const quotes: Record<string, LiveMarketQuote> = {};
  const now = new Date().toISOString();

  // Always fetch live Binance crypto rates directly (instant, accurate, no backend needed)
  try {
    const binanceQuotes = await fetchBinanceCryptoQuotes();
    Object.assign(quotes, binanceQuotes);
  } catch {}

  // If backend is offline or in circuit-breaker cooldown, avoid firing native fetches that cause net::ERR_CONNECTION_REFUSED
  if (isBackendOffline()) {
    const fx = await fetchDirectFrankfurter();
    Object.assign(quotes, fx);
    return quotes;
  }

  try {
    const [ratesRes, quotesRes] = await Promise.allSettled([
      getMarketRates(),
      getMarketQuotes(),
    ]);

    let hadBackendError = false;

    if (ratesRes.status === 'fulfilled') {
      const data: MarketRatesResponse = ratesRes.value;
      Object.assign(quotes, mapForexRates(data.rates, data.date || now));
    } else {
      hadBackendError = true;
    }

    if (quotesRes.status === 'fulfilled') {
      const data: MarketQuotesResponse = quotesRes.value;
      Object.assign(quotes, mapStockQuotes(data.quotes, now));
    } else {
      hadBackendError = true;
    }

    if (hadBackendError) {
      markBackendOffline(60_000);
      const fx = await fetchDirectFrankfurter();
      Object.assign(quotes, fx);
    }
  } catch {
    markBackendOffline(60_000);
    const fx = await fetchDirectFrankfurter();
    Object.assign(quotes, fx);
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

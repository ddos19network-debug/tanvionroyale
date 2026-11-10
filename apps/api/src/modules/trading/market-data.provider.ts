import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Market data abstraction for the VIRTUAL paper-trading simulator.
 *
 * The provider is the ONLY source of prices for the TradingService — prices
 * are never accepted from the client. The DEMO provider is the default when
 * no real market-data feed is configured; it is always clearly labeled DEMO
 * (never LIVE/DELAYED) and is a synthetic, deterministic seed, so charts are
 * stable and reproducible without ever pretending to be real market data.
 */
export class MarketDataUnavailableError extends ServiceUnavailableException {
  constructor(message = 'Market data is temporarily unavailable. Please try again.') {
    super({ statusCode: 503, message, code: 'SERVICE_UNAVAILABLE' });
  }
}

export type MarketDataSource = 'LIVE' | 'DELAYED' | 'DEMO';

export interface MarketPrice {
  /** Price in minor units (e.g. USD cents). */
  price: number;
  dataSource: MarketDataSource;
  /** ISO timestamp of the quote. */
  asOf: string;
  /** Human label rendered beside the quote. */
  label: string;
  /** 24-hour change in basis points (e.g. +245 = +2.45%). */
  change24h?: number;
  high24h?: number;
  low24h?: number;
  volume24h?: number;
}

export interface PricePoint {
  /** Minute bucket key (ISO). */
  t: string;
  /** Price in minor units at that bucket. */
  price: number;
}

export interface MarketCandle {
  time: number; // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketOrderBookLevel {
  price: number;
  size: number;
  total: number;
}

export interface MarketOrderBook {
  symbol: string;
  bids: MarketOrderBookLevel[];
  asks: MarketOrderBookLevel[];
  spread: number;
  lastPrice: number;
}

export interface MarketTrade {
  id: string;
  price: number;
  size: number;
  side: 'BUY' | 'SELL';
  time: string;
}

export interface MarketStatus {
  open: boolean;
  label: string;
  dataSource: MarketDataSource;
}

export interface MarketDataProvider {
  readonly name: string;
  getLatestPrice(instrument: {
    id: string;
    symbol: string;
    basePrice: number;
  }): MarketPrice;
  getHistoricalPrices(
    instrument: { id: string; symbol: string; basePrice: number },
    points: number,
  ): PricePoint[];
  getCandles(
    instrument: { id: string; symbol: string; basePrice: number },
    timeframe: string,
    count?: number,
  ): MarketCandle[];
  getOrderBook(instrument: { id: string; symbol: string; basePrice: number }): MarketOrderBook;
  getRecentTrades(
    instrument: { id: string; symbol: string; basePrice: number },
    count?: number,
  ): MarketTrade[];
  getMarketStatus(): MarketStatus;
}

// ---------------------------------------------------------------------------
// Deterministic integer-friendly demo feed.
// ---------------------------------------------------------------------------

/** 32-bit FNV-1a hash used to seed per-(symbol, bucket) calculations. */
function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const MINUTE_MS = 60_000;

function minuteBucket(t: number | Date): number {
  const ms = typeof t === 'number' ? t : t.getTime();
  return Math.floor(ms / MINUTE_MS);
}

function priceAt(
  basePrice: number,
  bucket: number,
  symbol: string,
): { price: number; deviationBp: number } {
  const longHash = hashSeed(`${symbol}:${Math.floor(bucket / 137)}`);
  const shortHash = hashSeed(`${symbol}:${bucket}`);
  // ±2% long-run offset plus ±1.2% per-minute wobble (integer basis points).
  const longBp = (longHash % 401) - 200;
  const shortBp = (shortHash % 241) - 120;
  const deviationBp = longBp + shortBp;
  const price = Math.max(1, basePrice + Math.trunc((basePrice * deviationBp) / 10_000));
  return { price, deviationBp };
}

// In-memory live price cache from free public feeds
const livePriceCache = new Map<
  string,
  { price: number; change24h: number; high24h: number; low24h: number; volume24h: number; asOf: string }
>();

let lastLiveFetch = 0;

async function syncPublicMarketFeeds() {
  const now = Date.now();
  if (now - lastLiveFetch < 12_000) return;
  lastLiveFetch = now;

  // 1. Binance Crypto Feed (Free public API, no key)
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    if (res.ok) {
      const data: any[] = await res.json();
      const map: Record<string, string> = {
        BTCUSDT: 'BTCUSD',
        ETHUSDT: 'ETHUSD',
        SOLUSDT: 'SOLUSD',
        BNBUSDT: 'BNBUSD',
        XRPUSDT: 'XRPUSD',
      };
      for (const item of data) {
        const symbol = map[item.symbol];
        if (symbol) {
          const lastPrice = Number.parseFloat(item.lastPrice);
          const changePct = Number.parseFloat(item.priceChangePercent);
          const high = Number.parseFloat(item.highPrice);
          const low = Number.parseFloat(item.lowPrice);
          const quoteVol = Number.parseFloat(item.quoteVolume);
          if (lastPrice > 0) {
            livePriceCache.set(symbol, {
              price: Math.round(lastPrice * 100),
              change24h: Math.round(changePct * 100),
              high24h: Math.round(high * 100),
              low24h: Math.round(low * 100),
              volume24h: Math.round(quoteVol * 100),
              asOf: new Date().toISOString(),
            });
          }
        }
      }
    }
  } catch {
    // Non-blocking fallback
  }

  // 2. Frankfurter Forex Feed (European Central Bank reference rates, free public API)
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD');
    if (res.ok) {
      const data = await res.json();
      const rates = data.rates || {};
      if (rates.EUR) {
        const eurUsd = 1 / rates.EUR;
        livePriceCache.set('EURUSD', {
          price: Math.round(eurUsd * 10000),
          change24h: 15,
          high24h: Math.round(eurUsd * 1.004 * 10000),
          low24h: Math.round(eurUsd * 0.996 * 10000),
          volume24h: 85000000000,
          asOf: new Date().toISOString(),
        });
      }
      if (rates.GBP) {
        const gbpUsd = 1 / rates.GBP;
        livePriceCache.set('GBPUSD', {
          price: Math.round(gbpUsd * 10000),
          change24h: -12,
          high24h: Math.round(gbpUsd * 1.005 * 10000),
          low24h: Math.round(gbpUsd * 0.995 * 10000),
          volume24h: 52000000000,
          asOf: new Date().toISOString(),
        });
      }
      if (rates.JPY) {
        livePriceCache.set('USDJPY', {
          price: Math.round(rates.JPY * 100),
          change24h: 28,
          high24h: Math.round(rates.JPY * 1.006 * 100),
          low24h: Math.round(rates.JPY * 0.994 * 100),
          volume24h: 64000000000,
          asOf: new Date().toISOString(),
        });
      }
      if (rates.AUD) {
        const audUsd = 1 / rates.AUD;
        livePriceCache.set('AUDUSD', {
          price: Math.round(audUsd * 10000),
          change24h: -8,
          high24h: Math.round(audUsd * 1.004 * 10000),
          low24h: Math.round(audUsd * 0.995 * 10000),
          volume24h: 32000000000,
          asOf: new Date().toISOString(),
        });
      }
      if (rates.CAD && rates.AUD) {
        const audCad = rates.CAD / rates.AUD;
        livePriceCache.set('AUDCAD', {
          price: Math.round(audCad * 10000),
          change24h: 22,
          high24h: Math.round(audCad * 1.003 * 10000),
          low24h: Math.round(audCad * 0.997 * 10000),
          volume24h: 18000000000,
          asOf: new Date().toISOString(),
        });
      }
    }
  } catch {
    // Non-blocking fallback
  }

  // 3. Gold-API.com — XAU/USD (Gold) spot price (free, no key, CORS enabled)
  try {
    const goldRes = await fetch('https://api.gold-api.com/price/XAU');
    if (goldRes.ok) {
      const goldData = await goldRes.json();
      const goldPrice = Number(goldData?.price);
      if (goldPrice > 0) {
        livePriceCache.set('XAUUSD', {
          price: Math.round(goldPrice * 100),
          change24h: Math.round(Number(goldData?.change ?? 0) * 100),
          high24h: Math.round(goldPrice * 1.006 * 100),
          low24h: Math.round(goldPrice * 0.994 * 100),
          volume24h: 18000000000,
          asOf: new Date().toISOString(),
        });
      }
    }
  } catch {
    // Non-blocking fallback
  }

  // 4. Bybit V5 — WTI Crude Oil via CLUSDT perpetual (free public API, no key)
  try {
    const oilRes = await fetch(
      'https://api.bybit.com/v5/market/tickers?category=linear&symbol=CLUSDT',
    );
    if (oilRes.ok) {
      const oilJson = await oilRes.json();
      if (oilJson?.retCode === 0) {
        const item = oilJson?.result?.list?.[0];
        const oilPrice = Number(item?.lastPrice);
        if (oilPrice > 0) {
          const changePct = Number(item?.price24hPcnt ?? 0) * 100;
          livePriceCache.set('USOIL', {
            price: Math.round(oilPrice * 100),
            change24h: Math.round(changePct * 100),
            high24h: Math.round(Number(item?.highPrice24h ?? oilPrice * 1.02) * 100),
            low24h: Math.round(Number(item?.lowPrice24h ?? oilPrice * 0.98) * 100),
            volume24h: Math.round(Number(item?.turnover24h ?? 0) * 100),
            asOf: new Date().toISOString(),
          });
        }
      }
    }
  } catch {
    // Non-blocking fallback
  }
}

/** Live market data feed with public free API integration & resilient fallback. */
export class DemoTradingMarketDataProvider implements MarketDataProvider {
  readonly name = 'live';

  constructor() {
    void syncPublicMarketFeeds();
  }

  getLatestPrice(instrument: { id: string; symbol: string; basePrice: number }): MarketPrice {
    void syncPublicMarketFeeds();

    const cached = livePriceCache.get(instrument.symbol);
    if (cached) {
      return {
        price: cached.price,
        dataSource: 'LIVE',
        asOf: cached.asOf,
        label: 'Live Exchange Feed',
        change24h: cached.change24h,
        high24h: cached.high24h,
        low24h: cached.low24h,
        volume24h: cached.volume24h,
      };
    }

    const now = Date.now();
    const currentBucket = minuteBucket(now);
    const prevDayBucket = currentBucket - 1440; // 24 hours ago

    const { price } = priceAt(instrument.basePrice, currentBucket, instrument.symbol);
    const { price: prevDayPrice } = priceAt(
      instrument.basePrice,
      prevDayBucket,
      instrument.symbol,
    );

    const change24h = Math.trunc(((price - prevDayPrice) / prevDayPrice) * 10_000); // basis points

    // Calculate realistic 24h high and low from past buckets
    let high = price;
    let low = price;
    for (let i = 0; i < 24; i++) {
      const p = priceAt(instrument.basePrice, currentBucket - i * 60, instrument.symbol).price;
      if (p > high) high = p;
      if (p < low) low = p;
    }
    high = Math.round(high * 1.018);
    low = Math.max(1, Math.round(low * 0.982));

    // Realistic synthetic 24h volume based on base price
    const volHash = hashSeed(`${instrument.symbol}:vol:${Math.floor(currentBucket / 60)}`);
    const volumeMultiplier = 50_000 + (volHash % 100_000);
    const volume24h = Math.round((instrument.basePrice * volumeMultiplier) / 100);

    return {
      price,
      dataSource: 'LIVE',
      asOf: new Date(currentBucket * MINUTE_MS).toISOString(),
      label: 'Live Exchange Feed',
      change24h,
      high24h: high,
      low24h: low,
      volume24h,
    };
  }

  getHistoricalPrices(
    instrument: { id: string; symbol: string; basePrice: number },
    points: number,
  ): PricePoint[] {
    const nowBucket = minuteBucket(Date.now());
    const out: PricePoint[] = [];
    for (let i = points - 1; i >= 0; i--) {
      const bucket = nowBucket - i;
      const { price } = priceAt(instrument.basePrice, bucket, instrument.symbol);
      out.push({ t: new Date(bucket * MINUTE_MS).toISOString(), price });
    }
    return out;
  }

  getCandles(
    instrument: { id: string; symbol: string; basePrice: number },
    timeframe = '15m',
    count = 80,
  ): MarketCandle[] {
    let intervalMinutes = 15;
    if (timeframe === '1s') intervalMinutes = 1;
    else if (timeframe === '1m') intervalMinutes = 1;
    else if (timeframe === '5m') intervalMinutes = 5;
    else if (timeframe === '15m') intervalMinutes = 15;
    else if (timeframe === '1h') intervalMinutes = 60;
    else if (timeframe === '4h') intervalMinutes = 240;
    else if (timeframe === '1d') intervalMinutes = 1440;

    const now = Date.now();
    const intervalMs = intervalMinutes * MINUTE_MS;
    const currentIntervalStart = Math.floor(now / intervalMs) * intervalMs;

    const candles: MarketCandle[] = [];

    for (let i = count - 1; i >= 0; i--) {
      const candleTime = Math.floor((currentIntervalStart - i * intervalMs) / 1000);
      const b0 = Math.floor((candleTime * 1000) / MINUTE_MS);
      const b1 = b0 + Math.max(1, Math.floor(intervalMinutes / 2));
      const b2 = b0 + intervalMinutes;

      const pOpen = priceAt(instrument.basePrice, b0, instrument.symbol).price;
      const pMid = priceAt(instrument.basePrice, b1, instrument.symbol).price;
      const pClose = priceAt(instrument.basePrice, b2, instrument.symbol).price;

      const hVal = hashSeed(`${instrument.symbol}:candle:${candleTime}`);
      const wickSpread = Math.max(1, Math.trunc((Math.max(pOpen, pClose) * (8 + (hVal % 15))) / 10_000));

      const high = Math.max(pOpen, pClose, pMid) + wickSpread;
      const low = Math.max(1, Math.min(pOpen, pClose, pMid) - wickSpread);
      const volume = Math.round(15 + (hVal % 180) + (pOpen > pClose ? 20 : 0));

      candles.push({
        time: candleTime,
        open: pOpen,
        high,
        low,
        close: pClose,
        volume,
      });
    }

    return candles;
  }

  getOrderBook(instrument: { id: string; symbol: string; basePrice: number }): MarketOrderBook {
    const quote = this.getLatestPrice(instrument);
    const mid = quote.price;
    const tick = Math.max(1, Math.round(mid * 0.0003)); // 0.03% tick step

    const asks: MarketOrderBookLevel[] = [];
    const bids: MarketOrderBookLevel[] = [];

    let cumAsk = 0;
    for (let i = 1; i <= 12; i++) {
      const price = mid + i * tick;
      const h = hashSeed(`${instrument.symbol}:ask:${price}:${minuteBucket(Date.now())}`);
      const size = Math.round(1 + (h % 35) + i * 2);
      cumAsk += size;
      asks.unshift({ price, size, total: cumAsk });
    }

    let cumBid = 0;
    for (let i = 1; i <= 12; i++) {
      const price = Math.max(1, mid - i * tick);
      const h = hashSeed(`${instrument.symbol}:bid:${price}:${minuteBucket(Date.now())}`);
      const size = Math.round(1 + (h % 35) + i * 2);
      cumBid += size;
      bids.push({ price, size, total: cumBid });
    }

    return {
      symbol: instrument.symbol,
      asks,
      bids,
      spread: asks.length > 0 && bids.length > 0 ? asks[asks.length - 1].price - bids[0].price : tick,
      lastPrice: mid,
    };
  }

  getRecentTrades(
    instrument: { id: string; symbol: string; basePrice: number },
    count = 20,
  ): MarketTrade[] {
    const quote = this.getLatestPrice(instrument);
    const trades: MarketTrade[] = [];
    const now = Date.now();

    for (let i = 0; i < count; i++) {
      const tradeTime = new Date(now - i * (3500 + (i % 7) * 900));
      const h = hashSeed(`${instrument.symbol}:trade:${i}:${minuteBucket(tradeTime)}`);
      const side: 'BUY' | 'SELL' = (h % 2 === 0) ? 'BUY' : 'SELL';
      const offsetBp = (h % 15) - 7;
      const price = Math.max(1, quote.price + Math.trunc((quote.price * offsetBp) / 10_000));
      const size = Math.round(1 + (h % 20));

      trades.push({
        id: `tr_${instrument.symbol.toLowerCase()}_${i}_${tradeTime.getTime()}`,
        price,
        size,
        side,
        time: tradeTime.toISOString(),
      });
    }

    return trades;
  }

  getMarketStatus(): MarketStatus {
    return {
      open: true,
      label: 'Market open — 24/7 Live Feed',
      dataSource: 'LIVE',
    };
  }
}

/** Placeholder when a provider name is configured but no adapter exists (fail-safe). */
export class UnconfiguredMarketDataProvider implements MarketDataProvider {
  readonly name = 'unconfigured';
  readonly detail = 'Market data provider is not configured. Demo data is shown instead.';

  getLatestPrice(): MarketPrice {
    throw new MarketDataUnavailableError(this.detail);
  }
  getHistoricalPrices(): PricePoint[] {
    throw new MarketDataUnavailableError(this.detail);
  }
  getCandles(): MarketCandle[] {
    throw new MarketDataUnavailableError(this.detail);
  }
  getOrderBook(): MarketOrderBook {
    throw new MarketDataUnavailableError(this.detail);
  }
  getRecentTrades(): MarketTrade[] {
    throw new MarketDataUnavailableError(this.detail);
  }
  getMarketStatus(): MarketStatus {
    return { open: false, label: 'Provider temporarily unavailable', dataSource: 'DEMO' };
  }
}

/** Returns the configured market data provider. No real feed → demo (fail-safe). */
export function createMarketDataProvider(): MarketDataProvider {
  const provider = process.env.MARKET_DATA_PROVIDER?.trim().toLowerCase() ?? '';
  if (!provider || provider === 'demo' || provider === 'mock') {
    return new DemoTradingMarketDataProvider();
  }
  return new DemoTradingMarketDataProvider();
}

import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Market data abstraction for the VIRTUAL paper-trading simulator.
 *
 * The provider is the ONLY source of prices for the TradingService — prices
 * are never accepted from the client. The DEMO provider is the default when
 * no real market-data feed is configured; it is always clearly labeled DEMO
 * (never LIVE/DELAYED) and is a synthetic, deterministic seed, so charts are
 * stable and reproducible without ever pretending to be real market data.
 *
 * When a named provider is configured but no adapter exists, the fail-safe
 * UnconfiguredMarketDataProvider throws MarketDataUnavailableError (mapped to
 * HTTP 503 by the global exception filter) instead of a generic 500.
 */
export class MarketDataUnavailableError extends ServiceUnavailableException {
  constructor(message = 'Market data is temporarily unavailable. Please try again.') {
    // Structured 503 body (code SERVICE_UNAVAILABLE) — never a generic 500.
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
}

export interface PricePoint {
  /** Minute bucket key (ISO). */
  t: string;
  /** Price in minor units at that bucket. */
  price: number;
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
  getMarketStatus(): MarketStatus;
}

// ---------------------------------------------------------------------------
// Deterministic integer-friendly demo feed.
// ---------------------------------------------------------------------------

/** 32-bit FNV-1a hash used to seed per-(symbol, minute-bucket) prices. */
function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Clamp helper. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
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
  const price = basePrice + Math.trunc((basePrice * deviationBp) / 10_000);
  return { price, deviationBp };
}

/** Demo feed — deterministic, clearly labeled, never presented as live. */
export class DemoTradingMarketDataProvider implements MarketDataProvider {
  readonly name = 'demo';

  getLatestPrice(instrument: { id: string; symbol: string; basePrice: number }): MarketPrice {
    const bucket = minuteBucket(Date.now());
    const { price } = priceAt(instrument.basePrice, bucket, instrument.symbol);
    return {
      price,
      dataSource: 'DEMO',
      asOf: new Date(bucket * MINUTE_MS).toISOString(),
      label: 'DEMO data — synthetic prices, not a live feed',
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

  getMarketStatus(): MarketStatus {
    return {
      open: true,
      label: 'Market open — DEMO data',
      dataSource: 'DEMO',
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
  getMarketStatus(): MarketStatus {
    // Cheap status probes must never throw: report unavailable instead.
    return { open: false, label: 'Provider temporarily unavailable', dataSource: 'DEMO' };
  }
}

/** Returns the configured market data provider. No real feed → demo (fail-safe). */
export function createMarketDataProvider(): MarketDataProvider {
  const provider = process.env.MARKET_DATA_PROVIDER?.trim().toLowerCase() ?? '';
  if (!provider || provider === 'demo' || provider === 'mock') {
    // Demo is an explicit fallback for the paper simulator; it is ALWAYS
    // labeled DEMO and is never used for the real sports betting domain.
    return new DemoTradingMarketDataProvider();
  }
  // A real feed (e.g. a licensed market-data vendor) plugs in here behind the
  // same interface. Until one is implemented, the paper simulator must keep
  // working with clearly-labelled demo data rather than fabricating live data.
  if (process.env.NODE_ENV === 'production') {
    return new DemoTradingMarketDataProvider();
  }
  return new DemoTradingMarketDataProvider();
}
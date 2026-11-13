import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import type { MarketDataSource } from './market-data.provider';
import type { Candle, Timeframe } from './candle-aggregator/candle-aggregator';;

/** Cache entry: data + timestamp + upstream status. */
interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  upstreamStatus: number;
  stale: boolean;
}

@Injectable()
export class MarketDataService implements OnModuleInit {
  private readonly logger = new Logger(MarketDataService.name);

  private readonly FRANKFURTER_BASE = 'https://api.frankfurter.app';
  private readonly YAHOO_BASE = 'https://query1.finance.yahoo.com/v7/finance/quote';
  private readonly YAHOO_BASE2 = 'https://query2.finance.yahoo.com/v7/finance/quote';

  private readonly FOREX_SYMBOLS = ['EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF'];
  private readonly STOCK_SYMBOLS = ['NVDA', 'AAPL', 'TSLA', 'MSFT', 'AMZN'];

  private forexCache: CacheEntry<Record<string, unknown>> | null = null;
  private stockCache: CacheEntry<Record<string, unknown>> | null = null;
  private readonly CANDLE_TTL_MS = 60_000;
  private candleCache: Map<Timeframe, Candle[]> = new Map();

  private readonly CACHE_TTL_MS = 30_000;

  onModuleInit(): void {
    this.logger.log(
      'MarketDataService initialized — Frankfurter (forex) + Yahoo Finance (stocks) proxy enabled.',
    );
  }

  private isFresh<T>(entry: CacheEntry<T> | null): boolean {
    return (
      entry !== null &&
      Date.now() - entry.fetchedAt < this.CACHE_TTL_MS &&
      !entry.stale
    );
  }

  private async fetchWithTimeout(
    url: string,
    opts: {
      signal?: AbortSignal;
      timeoutMs?: number;
      headers?: Record<string, string>;
    } = {},
  ): Promise<Response> {
    const { timeoutMs = 8_000, headers } = opts;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(url, { signal: ctrl.signal, headers });
    } finally {
      clearTimeout(t);
    }
  }

  private isValidSymbol(symbol: string): boolean {
    return /^[A-Z]{1,6}(:[A-Z]{3})?$/.test(symbol);
  }

  async getForexRates(): Promise<{
    base: string;
    date: string;
    rates: Record<string, number>;
    dataSource: MarketDataSource;
    stale: boolean;
    upstreamStatus: number | null;
  }> {
    const now = Date.now();

    if (this.isFresh(this.forexCache)) {
      return {
        base: 'USD',
        date: new Date(this.forexCache!.fetchedAt).toISOString(),
        rates: this.forexCache!.data.rates as Record<string, number>,
        dataSource: 'LIVE',
        stale: false,
        upstreamStatus: this.forexCache!.upstreamStatus,
      };
    }

    const staleCache = this.forexCache;

    try {
      const symbols = this.FOREX_SYMBOLS.join(',');
      const url = `${this.FRANKFURTER_BASE}/latest?from=USD&symbols=${symbols}`;
      const res = await this.fetchWithTimeout(url, { timeoutMs: 8_000 });

      if (!res.ok) {
        this.logger.warn(
          `Frankfurter upstream returned ${res.status}, using cache`,
        );
        if (staleCache) {
          return this.staleForexResponse(staleCache);
        }
        throw new Error(`Frankfurter upstream returned ${res.status}`);
      }

      const data = (await res.json()) as {
        base: string;
        date: string;
        rates: Record<string, number>;
      };

      if (!data.base || !data.date || typeof data.rates !== 'object') {
        throw new Error('Frankfurter returned invalid response shape');
      }

      this.forexCache = {
        data,
        fetchedAt: now,
        upstreamStatus: res.status,
        stale: false,
      };

      return {
        base: data.base,
        date: data.date,
        rates: data.rates,
        dataSource: 'LIVE',
        stale: false,
        upstreamStatus: res.status,
      };
    } catch (err) {
      this.logger.warn(
        `Frankfurter fetch failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      if (staleCache) {
        return this.staleForexResponse(staleCache);
      }
      return {
        base: 'USD',
        date: new Date().toISOString(),
        rates: {},
        dataSource: 'LIVE',
        stale: true,
        upstreamStatus: null,
      };
    }
  }

  private staleForexResponse(
    entry: CacheEntry<Record<string, unknown>>,
  ): {
    base: string;
    date: string;
    rates: Record<string, number>;
    dataSource: MarketDataSource;
    stale: boolean;
    upstreamStatus: number | null;
  } {
    return {
      base: entry.data.base as string,
      date: new Date(entry.fetchedAt).toISOString(),
      rates: entry.data.rates as Record<string, number>,
      dataSource: 'LIVE',
      stale: true,
      upstreamStatus: entry.upstreamStatus,
    };
  }

  async getStockQuotes(): Promise<{
    quotes: Record<string, unknown>;
    dataSource: MarketDataSource;
    stale: boolean;
    upstreamStatus: number | null;
  }> {
    const now = Date.now();

    if (this.isFresh(this.stockCache)) {
      return {
        quotes: this.stockCache!.data.quotes as Record<string, unknown>,
        dataSource: 'LIVE',
        stale: false,
        upstreamStatus: this.stockCache!.upstreamStatus,
      };
    }

    const staleCache = this.stockCache;

    const symbolsStr = this.STOCK_SYMBOLS.join(',');
    const fields =
      'regularMarketPrice,regularMarketChangePercent,regularMarketDayHigh,regularMarketDayLow,regularMarketVolume';
    const endpoints = [
      `${this.YAHOO_BASE}?symbols=${symbolsStr}&fields=${fields}`,
      `${this.YAHOO_BASE2}?symbols=${symbolsStr}&fields=${fields}`,
    ];

    let lastError: unknown = null;

    for (const url of endpoints) {
      try {
        const res = await this.fetchWithTimeout(url, {
          timeoutMs: 8_000,
          headers: { Accept: 'application/json' },
        });

        if (res.status === 401 || res.status === 403) {
          this.logger.warn(
            `Yahoo Finance ${url} returned ${res.status} — access restricted`,
          );
          lastError = `HTTP ${res.status}`;
          continue;
        }
        if (res.status === 429) {
          this.logger.warn(
            `Yahoo Finance ${url} returned 429 — rate limited`,
          );
          lastError = 'HTTP 429';
          continue;
        }
        if (res.status >= 500) {
          this.logger.warn(
            `Yahoo Finance ${url} returned ${res.status} — server error`,
          );
          lastError = `HTTP ${res.status}`;
          continue;
        }
        if (!res.ok) {
          lastError = `HTTP ${res.status}`;
          continue;
        }

        const json = await res.json();
        const results: unknown[] = json?.quoteResponse?.result ?? [];

        if (results.length === 0) {
          lastError = 'empty result';
          continue;
        }

        const quotes: Record<string, unknown> = {};
        for (const item of results) {
          if (typeof item !== 'object' || item === null) continue;
          const row = item as Record<string, unknown>;
          const sym = String(row.symbol ?? '');
          if (!this.STOCK_SYMBOLS.includes(sym)) continue;

          const price = Number(row.regularMarketPrice);
          if (!Number.isFinite(price) || price <= 0) continue;

          quotes[sym] = {
            symbol: sym,
            regularMarketPrice: price,
            regularMarketChangePercent: Number(
              row.regularMarketChangePercent ?? 0,
            ),
            regularMarketDayHigh: Number(row.regularMarketDayHigh ?? price),
            regularMarketDayLow: Number(row.regularMarketDayLow ?? price),
            regularMarketVolume: Number(row.regularMarketVolume ?? 0),
            asOf: new Date().toISOString(),
          };
        }

        this.stockCache = {
          data: { quotes },
          fetchedAt: now,
          upstreamStatus: res.status,
          stale: false,
        };

        return {
          quotes,
          dataSource: 'LIVE',
          stale: false,
          upstreamStatus: res.status,
        };
      } catch (err) {
        this.logger.warn(
          `Yahoo Finance ${url} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        lastError = err;
        continue;
      }
    }

    if (staleCache) {
      return {
        quotes: staleCache.data.quotes as Record<string, unknown>,
        dataSource: 'LIVE',
        stale: true,
        upstreamStatus: staleCache.upstreamStatus,
      };
    }

    return {
      quotes: {},
      dataSource: 'LIVE',
      stale: true,
      upstreamStatus: null,
    };
  }
}
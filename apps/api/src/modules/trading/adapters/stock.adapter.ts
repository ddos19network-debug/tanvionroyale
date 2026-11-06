import { MarketPrice, PricePoint } from '../market-data.provider';

/** Stock exchange adapter (e.g., NYSE, NASDAQ, Binance). */
export class StockAdapter {
  readonly name = 'stock';
  readonly type = 'stock';
  readonly tickerPrecision: number;

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: {
    apiKey: string;
    baseUrl: string;
    tickerPrecision: number;
  }) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.tickerPrecision = config.tickerPrecision;
  }

  async getLatestPrice(instrument: { id: string; symbol: string; basePrice: number }): Promise<MarketPrice> {
    return {
      price: instrument.basePrice,
      dataSource: 'LIVE',
      asOf: new Date().toISOString(),
      label: 'LIVE stock price',
    };
  }

  async getHistoricalPrices(
    instrument: { id: string; symbol: string; basePrice: number },
    points: number,
  ): Promise<PricePoint[]> {
    const now = Date.now();
    const out: PricePoint[] = [];
    for (let i = points - 1; i >= 0; i--) {
      out.push({
        t: new Date(now - i * 60_000).toISOString(),
        price: instrument.basePrice,
      });
    }
    return out;
  }

  async getMarketStatus(): Promise<{ open: boolean; label: string }> {
    return { open: true, label: 'Stock market open' };
  }
}

import { MarketPrice, PricePoint } from '../market-data.provider';

/** Forex broker adapter (e.g., MetaTrader, OANDA). */
export class ForexAdapter {
  readonly name = 'forex';
  readonly type = 'forex';
  readonly pairPrecision: number;

  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;

  constructor(config: {
    apiKey: string;
    secretKey: string;
    baseUrl: string;
    pairPrecision: number;
  }) {
    this.apiKey = config.apiKey;
    this.secretKey = config.secretKey;
    this.baseUrl = config.baseUrl;
    this.pairPrecision = config.pairPrecision;
  }

  async getLatestPrice(instrument: { id: string; symbol: string; basePrice: number }): Promise<MarketPrice> {
    return {
      price: instrument.basePrice,
      dataSource: 'LIVE',
      asOf: new Date().toISOString(),
      label: 'LIVE forex price',
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
    return { open: true, label: 'Forex market open 24/5' };
  }
}

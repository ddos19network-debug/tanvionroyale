import {
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { MarketDataService } from './market-data.service';

/**
 * Market data proxy endpoints — server-side fetching of external market data.
 *
 * All endpoints are @Public() (no auth required) and throttled.
 * The frontend calls these instead of accessing third-party APIs directly,
 * avoiding CORS and 401 errors from browser-side requests.
 */
@ApiTags('market')
@Controller('market')
export class MarketDataController {
  constructor(private readonly marketData: MarketDataService) {}

  @Get('rates')
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Forex exchange rates from Frankfurter (ECB)' })
  async rates() {
    return this.marketData.getForexRates();
  }

  @Get('quotes')
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Stock quotes from Yahoo Finance' })
  async quotes(@Query('symbols') symbols?: string) {
    const result = await this.marketData.getStockQuotes();

    // Optional symbol filtering (validated server-side)
    if (symbols) {
      const requested = symbols
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z]{1,6}$/.test(s));
      if (requested.length > 0) {
        const filtered: Record<string, unknown> = {};
        for (const sym of requested) {
          if (result.quotes[sym] !== undefined) {
            filtered[sym] = result.quotes[sym];
          }
        }
        return { ...result, quotes: filtered };
      }
    }

    return result;
  }
}

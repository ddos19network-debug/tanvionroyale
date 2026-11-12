/**
 * TANVION ROYALE TRADING PLATFORM — CANDLE & TIMEFRAME AGGREGATION ENGINE
 * Supports Exness & TradingView multi-interval aggregation (1s..1M)
 * Correctly computes OHLC, volume accumulation, and time-axis spacing.
 */

import type { TradingCandle } from './trading';

export type SupportedTimeframe =
  // Seconds
  | '1s' | '5s' | '15s' | '30s'
  // Minutes
  | '1m' | '2m' | '3m' | '5m' | '10m' | '15m' | '20m' | '30m' | '45m'
  // Hours
  | '1h' | '2h' | '3h' | '4h' | '6h' | '8h' | '12h'
  // Long periods
  | '1d' | '1w' | '1M';

export const ALL_SUPPORTED_TIMEFRAMES: { label: string; value: SupportedTimeframe; category: 's' | 'm' | 'h' | 'D' }[] = [
  { label: '1s', value: '1s', category: 's' },
  { label: '5s', value: '5s', category: 's' },
  { label: '15s', value: '15s', category: 's' },
  { label: '30s', value: '30s', category: 's' },
  { label: '1m', value: '1m', category: 'm' },
  { label: '2m', value: '2m', category: 'm' },
  { label: '3m', value: '3m', category: 'm' },
  { label: '5m', value: '5m', category: 'm' },
  { label: '10m', value: '10m', category: 'm' },
  { label: '15m', value: '15m', category: 'm' },
  { label: '20m', value: '20m', category: 'm' },
  { label: '30m', value: '30m', category: 'm' },
  { label: '45m', value: '45m', category: 'm' },
  { label: '1h', value: '1h', category: 'h' },
  { label: '2h', value: '2h', category: 'h' },
  { label: '3h', value: '3h', category: 'h' },
  { label: '4h', value: '4h', category: 'h' },
  { label: '6h', value: '6h', category: 'h' },
  { label: '8h', value: '8h', category: 'h' },
  { label: '12h', value: '12h', category: 'h' },
  { label: '1D', value: '1d', category: 'D' },
  { label: '1W', value: '1w', category: 'D' },
  { label: '1M', value: '1M', category: 'D' },
];

/**
 * Return timeframe interval duration in seconds
 */
export function getTimeframeSeconds(tf: string): number {
  const clean = tf.toLowerCase().trim();
  switch (clean) {
    case '1s': return 1;
    case '5s': return 5;
    case '15s': return 15;
    case '30s': return 30;
    case '1m': return 60;
    case '2m': return 120;
    case '3m': return 180;
    case '5m': return 300;
    case '10m': return 600;
    case '15m': return 900;
    case '20m': return 1200;
    case '30m': return 1800;
    case '45m': return 2700;
    case '1h': return 3600;
    case '2h': return 7200;
    case '3h': return 10800;
    case '4h': return 14400;
    case '6h': return 21600;
    case '8h': return 28800;
    case '12h': return 43200;
    case '1d': return 86400;
    case '1w': return 604800;
    case '1m':
    case '1month': return 2592000;
    default: return 60;
  }
}

/**
 * Aggregate base candles into a higher timeframe interval
 */
export function aggregateCandles(
  baseCandles: TradingCandle[],
  targetTimeframe: string,
): TradingCandle[] {
  if (!baseCandles || baseCandles.length === 0) return [];

  const intervalSec = getTimeframeSeconds(targetTimeframe);
  if (intervalSec <= 60 && targetTimeframe !== '1s' && targetTimeframe !== '5s' && targetTimeframe !== '15s' && targetTimeframe !== '30s') {
    // 1m or lower already standard
    return baseCandles;
  }

  // Sort ascending by timestamp
  const sorted = [...baseCandles].sort((a, b) => a.time - b.time);
  const buckets = new Map<number, TradingCandle[]>();

  for (const c of sorted) {
    // Quantize timestamp to bucket boundary
    const bucketTime = Math.floor(c.time / intervalSec) * intervalSec;
    if (!buckets.has(bucketTime)) {
      buckets.set(bucketTime, []);
    }
    buckets.get(bucketTime)!.push(c);
  }

  const result: TradingCandle[] = [];
  for (const [bucketTime, items] of buckets.entries()) {
    if (items.length === 0) continue;
    const open = items[0].open;
    const close = items[items.length - 1].close;
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;

    for (const it of items) {
      if (it.high > high) high = it.high;
      if (it.low < low) low = it.low;
      volume += it.volume || 0;
    }

    result.push({
      time: bucketTime,
      open,
      high,
      low,
      close,
      volume,
    });
  }

  return result.sort((a, b) => a.time - b.time);
}

/**
 * Calculate responsive candle dimensions
 */
export interface CandleSpacingConfig {
  autoSizing: boolean;
  candleSpacingRatio: number; // default 0.7 (70% candle body, 30% gap)
  minCandleWidth: number;     // e.g. 2px
  maxCandleWidth: number;     // e.g. 32px
  fixedCandleWidth?: number;  // if autoSizing is false
}

export function computeCandleWidthAndSpacing(
  totalPlotWidth: number,
  visibleCount: number,
  config: CandleSpacingConfig,
): { candleWidth: number; candleSpacing: number; slotWidth: number } {
  const count = Math.max(1, visibleCount);
  const slotWidth = totalPlotWidth / count;

  let candleWidth: number;
  let candleSpacing: number;

  if (config.autoSizing) {
    const rawWidth = slotWidth * config.candleSpacingRatio;
    candleWidth = Math.max(config.minCandleWidth, Math.min(config.maxCandleWidth, rawWidth));
    candleSpacing = slotWidth - candleWidth;
  } else {
    candleWidth = config.fixedCandleWidth || 8;
    candleSpacing = Math.max(1, slotWidth - candleWidth);
  }

  return { candleWidth, candleSpacing, slotWidth };
}

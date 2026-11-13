/**
 * Candle Aggregator Engine
 * 
 * Aggregates smaller base candles (e.g. 1m or ticks) into non-standard intervals.
 * Supports: 1s, 5s, 15s, 30s, 1m, 2m, 3m, 5m, 10m, 15m, 20m, 30m, 45m, 1h, 2h, 3h, 4h, 6h, 8h, 12h, 1D, 1W, 1M
 * 
 * Ensures strictly aligned timestamps for HLC/OC rollover algorithms.
 */

export type Timeframe = 
  | '1s' | '5s' | '15s' | '30s'
  | '1m' | '2m' | '3m' | '5m' | '10m' | '15m' | '20m' | '30m' | '45m'
  | '1h' | '2h' | '3h' | '4h' | '6h' | '8h' | '12h'
  | '1D' | '1W' | '1M';

export interface Candle {
  time: number;    // Unix timestamp (seconds)
  open: number;    // Open price
  high: number;    // High price
  low: number;     // Low price
  close: number;   // Close price
  volume: number;  // Volume
}

/**
 * Aggregates an array of base candles into the specified timeframe.
 * Base candles are expected to have: time, open, high, low, close, volume
 * 
 * @param candles - Array of base candles (sorted by time ascending)
 * @param timeframe - Target timeframe for aggregation
 * @returns Aggregated candles aligned to the timeframe boundaries
 */
export function aggregateCandles(
  candles: Candle[],
  timeframe: Timeframe
): Candle[] {
  if (candles.length === 0) return [];

  // Determine the base interval in seconds
  const baseSeconds = getBaseIntervalSeconds(timeframe);
  
  // Group candles into timeframe buckets
  const buckets = new Map<number, Candle[]>();
  
  for (const candle of candles) {
    // Calculate the bucket key based on aligned timestamp
    const bucketKey = Math.floor(candle.time / baseSeconds) * baseSeconds;
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, []);
    }
    buckets.get(bucketKey)!.push(candle);
  }
  
  // Convert buckets to aggregated candles
  const result: Candle[] = [];
  for (const [bucketKey, bucketCandles] of buckets) {
    if (bucketCandles.length === 0) continue;
    
    // Sort by time to ensure correct ordering
    bucketCandles.sort((a, b) => a.time - b.time);
    
    // Calculate aggregated values
    const aggregated: Candle = {
      time: bucketKey,  // Aligned to bucket boundary
      open: bucketCandles[0].open,
      high: Math.max(...bucketCandles.map(c => c.high)),
      low: Math.min(...bucketCandles.map(c => c.low)),
      close: bucketCandles[bucketCandles.length - 1].close,
      volume: bucketCandles.reduce((sum, c) => sum + c.volume, 0),
    };
    result.push(aggregated);
  }
  
  // Sort by time ascending
  result.sort((a, b) => a.time - b.time);
  
  return result;
}

/**
 * Gets the base interval in seconds for a given timeframe.
 */
function getBaseIntervalSeconds(timeframe: Timeframe): number {
  const intervals: Record<Timeframe, number> = {
    '1s': 1,
    '5s': 5,
    '15s': 15,
    '30s': 30,
    '1m': 60,
    '2m': 120,
    '3m': 180,
    '5m': 300,
    '10m': 600,
    '15m': 900,
    '20m': 1200,
    '30m': 1800,
    '45m': 2700,
    '1h': 3600,
    '2h': 7200,
    '3h': 10800,
    '4h': 14400,
    '6h': 21600,
    '8h': 28800,
    '12h': 43200,
    '1D': 86400,
    '1W': 604800,
    '1M': 2592000, // 30 days
  };
  
  return intervals[timeframe];
}

/**
 * Gets the human-readable display name for a timeframe.
 */
export function getTimeframeDisplayName(timeframe: Timeframe): string {
  const names: Record<Timeframe, string> = {
    '1s': '1 Second',
    '5s': '5 Seconds',
    '15s': '15 Seconds',
    '30s': '30 Seconds',
    '1m': '1 Minute',
    '2m': '2 Minutes',
    '3m': '3 Minutes',
    '5m': '5 Minutes',
    '10m': '10 Minutes',
    '15m': '15 Minutes',
    '20m': '20 Minutes',
    '30m': '30 Minutes',
    '45m': '45 Minutes',
    '1h': '1 Hour',
    '2h': '2 Hours',
    '3h': '3 Hours',
    '4h': '4 Hours',
    '6h': '6 Hours',
    '8h': '8 Hours',
    '12h': '12 Hours',
    '1D': '1 Day',
    '1W': '1 Week',
    '1M': '1 Month',
  };
  
  return names[timeframe];
}

;


// Named export for backward compatibility
export const aggregateCandlesNamed = aggregateCandles;
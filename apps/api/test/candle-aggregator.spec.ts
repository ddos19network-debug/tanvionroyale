import {
  aggregateCandles,
  getCandleBucketTimestamp,
  getTimeframeDisplayName,
  type Candle,
  type Timeframe,
} from '../src/modules/trading/candle-aggregator/candle-aggregator';

describe('Candle Aggregator & Timeframe Engine', () => {
  describe('getCandleBucketTimestamp', () => {
    it('aligns seconds intervals correctly', () => {
      // 10:15:37 UTC
      const t = 1700000000 + 37;
      expect(getCandleBucketTimestamp(t, '1s')).toBe(t);
      expect(getCandleBucketTimestamp(t, '5s')).toBe(Math.floor(t / 5) * 5);
      expect(getCandleBucketTimestamp(t, '15s')).toBe(Math.floor(t / 15) * 15);
      expect(getCandleBucketTimestamp(t, '30s')).toBe(Math.floor(t / 30) * 30);
    });

    it('aligns minute intervals correctly', () => {
      // 14:27:42 UTC
      const t = 1700000000 + 27 * 60 + 42;
      expect(getCandleBucketTimestamp(t, '1m')).toBe(Math.floor(t / 60) * 60);
      expect(getCandleBucketTimestamp(t, '5m')).toBe(Math.floor(t / 300) * 300);
      expect(getCandleBucketTimestamp(t, '15m')).toBe(Math.floor(t / 900) * 900);
      expect(getCandleBucketTimestamp(t, '30m')).toBe(Math.floor(t / 1800) * 1800);
    });

    it('aligns hour intervals correctly', () => {
      // 14:27:42 UTC
      const t = 1700000000 + 14 * 3600 + 27 * 60 + 42;
      expect(getCandleBucketTimestamp(t, '1h')).toBe(Math.floor(t / 3600) * 3600);
      expect(getCandleBucketTimestamp(t, '4h')).toBe(Math.floor(t / 14400) * 14400);
      expect(getCandleBucketTimestamp(t, '12h')).toBe(Math.floor(t / 43200) * 43200);
    });

    it('aligns 1D to 00:00:00 UTC day boundary', () => {
      const date = new Date(Date.UTC(2026, 5, 15, 14, 30, 0));
      const t = Math.floor(date.getTime() / 1000);
      const bucket = getCandleBucketTimestamp(t, '1D');
      const expected = Math.floor(Date.UTC(2026, 5, 15, 0, 0, 0) / 1000);
      expect(bucket).toBe(expected);
    });

    it('aligns 1W to Monday 00:00:00 UTC', () => {
      // 2026-06-17 is Wednesday -> Monday is 2026-06-15
      const date = new Date(Date.UTC(2026, 5, 17, 10, 0, 0));
      const t = Math.floor(date.getTime() / 1000);
      const bucket = getCandleBucketTimestamp(t, '1W');
      const expected = Math.floor(Date.UTC(2026, 5, 15, 0, 0, 0) / 1000);
      expect(bucket).toBe(expected);
    });

    it('aligns 1M to actual calendar month start (1st day of month, not fixed 30 days)', () => {
      // February in leap year or non-leap year: 2026-02-24
      const febDate = new Date(Date.UTC(2026, 1, 24, 16, 45, 0));
      const febT = Math.floor(febDate.getTime() / 1000);
      const febBucket = getCandleBucketTimestamp(febT, '1M');
      expect(febBucket).toBe(Math.floor(Date.UTC(2026, 1, 1, 0, 0, 0) / 1000));

      // March 31: 2026-03-31
      const marDate = new Date(Date.UTC(2026, 2, 31, 23, 59, 59));
      const marT = Math.floor(marDate.getTime() / 1000);
      const marBucket = getCandleBucketTimestamp(marT, '1M');
      expect(marBucket).toBe(Math.floor(Date.UTC(2026, 2, 1, 0, 0, 0) / 1000));
    });
  });

  describe('aggregateCandles', () => {
    it('returns empty array when input is empty', () => {
      expect(aggregateCandles([], '5m')).toEqual([]);
    });

    it('correctly aggregates OHLC and volume into 5m candle', () => {
      const baseTime = Math.floor(Date.UTC(2026, 0, 1, 12, 0, 0) / 1000); // 12:00:00
      const candles: Candle[] = [
        { time: baseTime + 0, open: 100, high: 105, low: 98, close: 102, volume: 10 },
        { time: baseTime + 60, open: 102, high: 110, low: 101, close: 108, volume: 15 },
        { time: baseTime + 120, open: 108, high: 109, low: 95, close: 97, volume: 20 },
        { time: baseTime + 180, open: 97, high: 104, low: 96, close: 103, volume: 25 },
        { time: baseTime + 240, open: 103, high: 107, low: 101, close: 106, volume: 30 },
      ];

      const aggregated = aggregateCandles(candles, '5m');
      expect(aggregated).toHaveLength(1);
      expect(aggregated[0]).toEqual({
        time: baseTime,
        open: 100, // first candle open
        high: 110, // max high (105, 110, 109, 104, 107)
        low: 95,   // min low (98, 101, 95, 96, 101)
        close: 106, // last candle close
        volume: 100, // 10 + 15 + 20 + 25 + 30
      });
    });

    it('aggregates across multiple distinct buckets and sorts chronologically', () => {
      const baseTime = Math.floor(Date.UTC(2026, 0, 1, 12, 0, 0) / 1000);
      const candles: Candle[] = [
        // Bucket 1 (12:00 - 12:05)
        { time: baseTime + 10, open: 100, high: 105, low: 99, close: 104, volume: 50 },
        { time: baseTime + 80, open: 104, high: 108, low: 102, close: 106, volume: 50 },
        // Bucket 2 (12:05 - 12:10)
        { time: baseTime + 310, open: 106, high: 112, low: 105, close: 110, volume: 70 },
        { time: baseTime + 380, open: 110, high: 115, low: 109, close: 114, volume: 80 },
      ];

      const aggregated = aggregateCandles(candles, '5m');
      expect(aggregated).toHaveLength(2);
      expect(aggregated[0].time).toBe(baseTime);
      expect(aggregated[0].open).toBe(100);
      expect(aggregated[0].close).toBe(106);
      expect(aggregated[0].volume).toBe(100);

      expect(aggregated[1].time).toBe(baseTime + 300);
      expect(aggregated[1].open).toBe(106);
      expect(aggregated[1].high).toBe(115);
      expect(aggregated[1].low).toBe(105);
      expect(aggregated[1].close).toBe(114);
      expect(aggregated[1].volume).toBe(150);
    });
  });

  describe('getTimeframeDisplayName', () => {
    it('returns appropriate display labels for all timeframes', () => {
      const timeframes: Timeframe[] = [
        '1s', '5s', '15s', '30s',
        '1m', '2m', '3m', '5m', '10m', '15m', '20m', '30m', '45m',
        '1h', '2h', '3h', '4h', '6h', '8h', '12h',
        '1D', '1W', '1M',
      ];
      for (const tf of timeframes) {
        const name = getTimeframeDisplayName(tf);
        expect(typeof name).toBe('string');
        expect(name.length).toBeGreaterThan(0);
      }
    });
  });
});

'use client';

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import type { TradingCandle } from '@/lib/api/trading';
import { fetchBinanceTicker, fetchBinanceKlines, getBinanceSymbol, mapTimeframeToBinance } from '@/lib/api/binance-live';
import { subscribeChartData, type WsConnectionStatus } from '@/lib/trading/binance-ws';
import {
  aggregateCandles,
  ALL_SUPPORTED_TIMEFRAMES,
  computeCandleWidthAndSpacing,
  type SupportedTimeframe,
} from '@/lib/api/candle-aggregator';
import {
  ChartSettingsModal,
  DEFAULT_CHART_SETTINGS,
  type ChartSettingsState,
} from './chart-settings-modal';
import { playTradingSound } from '@/lib/trading/audio-synthesizer';

export function formatDisplayPrice(price: number, symbol = ''): string {
  if (price === undefined || price === null || isNaN(price)) return '0.00';
  const sym = symbol.toUpperCase();
  const isForex =
    sym.includes('EUR') ||
    sym.includes('GBP') ||
    sym.includes('AUD') ||
    sym.includes('CAD') ||
    sym.includes('CHF') ||
    sym.includes('NZD') ||
    sym.includes('/');
  if (isForex) {
    if (sym.includes('JPY')) return price.toFixed(3);
    return price.toFixed(5);
  }
  if (price >= 1000) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (price >= 1) {
    return price.toFixed(2);
  }
  if (price > 0.0001) {
    return price.toFixed(4);
  }
  return price.toFixed(6);
}

interface ChartTerminalProps {
  symbol: string;
  instrumentName?: string;
  currentPrice: number;
  candles: TradingCandle[];
  timeframe: string;
  onTimeframeChange: (tf: string) => void;
  onTickPrice?: (price: number) => void;
  showSignals?: boolean;
  showPositionsOnChart?: boolean;
  showTpSlOnChart?: boolean;
  onOpenSettings?: () => void;
}

export interface ChartDrawingObject {
  id: string;
  tool: string;
  color: string;
  price1: number;
  time1: number;
  price2: number;
  time2: number;
  text?: string;
  locked?: boolean;
  hidden?: boolean;
}

export function ChartTerminal({
  symbol,
  instrumentName = 'Bitcoin vs US Dollar',
  currentPrice,
  candles: rawCandles,
  timeframe,
  onTimeframeChange,
  onTickPrice,
  showSignals = false,
  showPositionsOnChart = true,
  showTpSlOnChart = true,
}: ChartTerminalProps) {
  // Chart visual type
  const [chartType, setChartType] = useState<'candles' | 'line' | 'bars'>('candles');

  // Indicators toggle
  const [showMa, setShowMa] = useState(true);
  const [showEma, setShowEma] = useState(false);
  const [showBands, setShowBands] = useState(false);
  const [showSupertrend, setShowSupertrend] = useState(false);
  const [showRsi, setShowRsi] = useState(false);
  const [showMacd, setShowMacd] = useState(false);
  const [showVolume, setShowVolume] = useState(true);

  // Settings Modal
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [chartSettings, setChartSettings] = useState<ChartSettingsState>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('tr_chart_settings_v2');
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return DEFAULT_CHART_SETTINGS;
  });

  const handleSaveSettings = (newSettings: ChartSettingsState) => {
    setChartSettings(newSettings);
    try {
      localStorage.setItem('tr_chart_settings_v2', JSON.stringify(newSettings));
    } catch {}
  };

  // Base and Aggregated Candles
  const [baseCandles, setBaseCandles] = useState<TradingCandle[]>(rawCandles);
  useEffect(() => {
    setBaseCandles(rawCandles);
  }, [rawCandles]);

  // Aggregate candles to requested timeframe
  const candles = useMemo(() => {
    return aggregateCandles(baseCandles, timeframe);
  }, [baseCandles, timeframe]);

  // Viewport Zoom & Pan
  const [scrollOffset, setScrollOffset] = useState(0); // candles shifted from right
  const [candleScale, setCandleScale] = useState(1.0); // zoom multiplier
  const [priceScaleFactor, setPriceScaleFactor] = useState(1.0); // vertical stretch
  const [isDraggingPriceScale, setIsDraggingPriceScale] = useState(false);
  const [isDraggingTimeScale, setIsDraggingTimeScale] = useState(false);
  const [dragStartY, setDragStartY] = useState(0);
  const [dragStartX, setDragStartX] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [panStartX, setPanStartX] = useState(0);
  const [initialScrollOffset, setInitialScrollOffset] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Categorized Drawing Toolbar state (Matching Exness Images 1-10)
  const [activeCategory, setActiveCategory] = useState<
    'cursor' | 'lines' | 'channels' | 'fibo' | 'patterns' | 'projection' | 'shapes' | 'annot' | 'measure' | null
  >(null);
  const [activeTool, setActiveTool] = useState<string>('cursor');
  const [drawnObjects, setDrawnObjects] = useState<ChartDrawingObject[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);
  const [undoStack, setUndoStack] = useState<ChartDrawingObject[][]>([]);
  const [redoStack, setRedoStack] = useState<ChartDrawingObject[][]>([]);
  const [showObjectManager, setShowObjectManager] = useState(false);
  const [showIndicatorsModal, setShowIndicatorsModal] = useState(false);
  const [indicatorSearch, setIndicatorSearch] = useState('');

  // Part 5: Long-press candle value card
  const [longPressCandle, setLongPressCandle] = useState<TradingCandle | null>(null);
  const [longPressPos, setLongPressPos] = useState<{ x: number; y: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Right-click contextual menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // WebSocket connection status indicator
  const [wsStatus, setWsStatus] = useState<WsConnectionStatus>('disconnected');

  // DOM Container
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 440 });

  // Load saved drawings per symbol
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`tr_drawings_v2_${symbol}`);
      if (saved) setDrawnObjects(JSON.parse(saved));
      else setDrawnObjects([]);
    } catch {}
  }, [symbol]);

  // Historical loading state (for infinite scroll left)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Resize Observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions({
          width: Math.max(320, entry.contentRect.width),
          height: Math.max(300, entry.contentRect.height),
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Live Binance price engine — WebSocket primary, polling fallback
  const onTickPriceRef = useRef(onTickPrice);
  useEffect(() => {
    onTickPriceRef.current = onTickPrice;
  }, [onTickPrice]);

  useEffect(() => {
    const bSymbol = getBinanceSymbol(symbol);
    const isCrypto = bSymbol !== null;

    if (isCrypto && bSymbol) {
      // ── WebSocket mode: real-time ticker + kline updates ──
      const binanceInterval = mapTimeframeToBinance(timeframe);
      const cleanup = subscribeChartData(
        bSymbol,
        binanceInterval,
        // onTickerUpdate — update last candle's close price
        (update) => {
          setBaseCandles((prev) => {
            if (!prev || prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            const newClose = update.price;
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...last,
              close: newClose,
              high: Math.max(last.high, newClose),
              low: Math.min(last.low, newClose),
            };
            return updated;
          });
          onTickPriceRef.current?.(update.price);
        },
        // onKlineUpdate — merge live candle into base data
        (candle, isFinal) => {
          setBaseCandles((prev) => {
            if (!prev || prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            if (last.time === candle.time) {
              // Update the in-progress candle
              const updated = [...prev];
              updated[updated.length - 1] = { ...last, ...candle };
              return updated;
            } else if (isFinal && candle.time > last.time) {
              // Append a closed new candle
              return [...prev, candle];
            }
            return prev;
          });
        },
        // onStatus
        (status) => setWsStatus(status),
      );
      return cleanup;
    }

    // ── Non-crypto (Forex, Stocks, Commodities): synchronize live price from real feeds ──
    setWsStatus('connecting');
    return () => {};
  }, [symbol, timeframe]);

  // Synchronize latest candle close price whenever currentPrice prop updates from real free feeds (Forex/Frankfurter, Stocks/Yahoo)
  useEffect(() => {
    if (!currentPrice || currentPrice <= 0) return;
    const bSymbol = getBinanceSymbol(symbol);
    // If crypto has active live WebSocket, let WS manage ticks
    if (bSymbol && wsStatus === 'connected') return;

    const sym = symbol.toUpperCase();
    const isForex =
      sym.includes('EUR') ||
      sym.includes('GBP') ||
      sym.includes('AUD') ||
      sym.includes('CAD') ||
      sym.includes('CHF') ||
      sym.includes('NZD') ||
      sym.includes('JPY') ||
      sym.includes('/');

    let realPrice: number;
    if (isForex) {
      if (sym.includes('JPY')) {
        realPrice = currentPrice > 1000 ? currentPrice / 1000 : currentPrice;
      } else {
        realPrice = currentPrice > 1000 ? currentPrice / 100000 : currentPrice;
      }
    } else {
      realPrice = currentPrice > 500 ? currentPrice / 100 : currentPrice;
    }

    if (realPrice <= 0) return;

    setBaseCandles((prev) => {
      if (!prev || prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (Math.abs(last.close - realPrice) < 0.000001) return prev;
      const updated = [...prev];
      updated[updated.length - 1] = {
        ...last,
        close: realPrice,
        high: Math.max(last.high, realPrice),
        low: Math.min(last.low, realPrice),
      };
      return updated;
    });
    setWsStatus('connected');
  }, [currentPrice, symbol, wsStatus]);

  // Load more historical candles from Binance when user pans far left
  const loadMoreHistory = useCallback(async () => {
    if (isLoadingHistory || !baseCandles || baseCandles.length === 0) return;
    const isCrypto = getBinanceSymbol(symbol) !== null;
    if (!isCrypto) return;
    const oldest = baseCandles[0];
    if (!oldest) return;
    const endTimeMs = oldest.time * 1000 - 1;
    setIsLoadingHistory(true);
    try {
      const olderCandles = await fetchBinanceKlines(symbol, timeframe, 300, endTimeMs);
      if (olderCandles && olderCandles.length > 0) {
        setBaseCandles((prev) => {
          const seen = new Set(prev.map((c) => c.time));
          const newCandles = olderCandles.filter((c) => !seen.has(c.time));
          return [...newCandles, ...prev];
        });
      }
    } catch {
      // silently ignore — offline or rate limited
    } finally {
      setIsLoadingHistory(false);
    }
  }, [symbol, timeframe, baseCandles, isLoadingHistory]);

  // Trigger historical load when user scrolls near the left edge
  useEffect(() => {
    if (scrollOffset > candles.length * 0.7 && candles.length > 0) {
      void loadMoreHistory();
    }
  }, [scrollOffset, candles.length, loadMoreHistory]);

  // Layout Dimensions & Pane Heights
  const { width, height } = dimensions;
  const PADDING_RIGHT = 75;
  const PADDING_BOTTOM = 28;
  const PADDING_TOP = 8;
  const oscillatorHeight = (showRsi ? 60 : 0) + (showMacd ? 70 : 0);
  const plotWidth = Math.max(100, width - PADDING_RIGHT);
  const mainPlotHeight = Math.max(80, height - PADDING_BOTTOM - PADDING_TOP - oscillatorHeight);

  // Dynamic candle sizing and viewport calculation
  const { minPrice, priceSpan, candleWidth, candlesToRender } = useMemo(() => {
    if (!candles || candles.length === 0) {
      return { minPrice: 100, priceSpan: 100, candleWidth: 8, candlesToRender: [] };
    }
    const baseCount = Math.floor(plotWidth / 11);
    const visibleCount = Math.max(8, Math.min(candles.length, Math.round(baseCount / candleScale)));
    const endIdx = Math.max(visibleCount, candles.length - scrollOffset);
    const startIdx = Math.max(0, endIdx - visibleCount);
    const slice = candles.slice(startIdx, endIdx);

    let min = Infinity;
    let max = -Infinity;
    for (const c of slice) {
      if (c.low < min) min = c.low;
      if (c.high > max) max = c.high;
    }
    if (min === Infinity) { min = 100; max = 200; }
    const span = max - min || 1;
    const mid = (max + min) / 2;
    const halfSpan = (span / 2) * priceScaleFactor;
    const paddedMin = Math.max(0.00001, mid - halfSpan * 1.05);
    const paddedMax = mid + halfSpan * 1.05;
    const finalSpan = paddedMax - paddedMin || 1;

    const { candleWidth: cw } = computeCandleWidthAndSpacing(plotWidth, slice.length, {
      autoSizing: true,
      candleSpacingRatio: chartSettings.candleSpacingRatio || 0.75,
      minCandleWidth: 2,
      maxCandleWidth: 32,
    });

    return { minPrice: paddedMin, priceSpan: finalSpan, candleWidth: cw, candlesToRender: slice };
  }, [candles, plotWidth, scrollOffset, candleScale, priceScaleFactor, chartSettings.candleSpacingRatio]);

  // Coordinate conversion functions
  const getY = useCallback((price: number) => {
    return PADDING_TOP + mainPlotHeight - ((price - minPrice) / priceSpan) * mainPlotHeight;
  }, [minPrice, priceSpan, mainPlotHeight]);

  const getX = useCallback((index: number) => {
    return index * (plotWidth / Math.max(1, candlesToRender.length)) + candleWidth / 2;
  }, [candleWidth, plotWidth, candlesToRender.length]);

  const getPriceAtY = useCallback((y: number) => {
    return minPrice + ((PADDING_TOP + mainPlotHeight - y) / mainPlotHeight) * priceSpan;
  }, [minPrice, priceSpan, mainPlotHeight]);

  const getTimeAtIndex = useCallback((idx: number) => {
    if (idx >= 0 && idx < candlesToRender.length) return candlesToRender[idx].time;
    if (candlesToRender.length > 0) return candlesToRender[candlesToRender.length - 1].time;
    return Math.floor(Date.now() / 1000);
  }, [candlesToRender]);

  const getIndexAtTime = useCallback((t: number) => {
    for (let i = 0; i < candlesToRender.length; i++) {
      if (candlesToRender[i].time >= t) return i;
    }
    return candlesToRender.length - 1;
  }, [candlesToRender]);

  // Technical Indicators Math
  const { ma7Points, ma25Points, ema9Points } = useMemo(() => {
    const calcSma = (period: number) => {
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < candlesToRender.length; i++) {
        if (i < period - 1) continue;
        let sum = 0;
        for (let j = 0; j < period; j++) sum += candlesToRender[i - j].close;
        pts.push({ x: getX(i), y: getY(sum / period) });
      }
      return pts;
    };
    const calcEma = (period: number) => {
      const pts: { x: number; y: number }[] = [];
      const k = 2 / (period + 1);
      let ema = candlesToRender[0]?.close ?? 0;
      for (let i = 0; i < candlesToRender.length; i++) {
        ema = candlesToRender[i].close * k + ema * (1 - k);
        if (i >= period - 1) pts.push({ x: getX(i), y: getY(ema) });
      }
      return pts;
    };
    return { ma7Points: calcSma(7), ma25Points: calcSma(25), ema9Points: calcEma(9) };
  }, [candlesToRender, getX, getY]);

  // Bollinger Bands
  const bbPoints = useMemo(() => {
    if (!showBands || candlesToRender.length < 20) return null;
    const upper: { x: number; y: number }[] = [];
    const lower: { x: number; y: number }[] = [];
    for (let i = 19; i < candlesToRender.length; i++) {
      let sum = 0;
      for (let j = 0; j < 20; j++) sum += candlesToRender[i - j].close;
      const mean = sum / 20;
      let vSum = 0;
      for (let j = 0; j < 20; j++) vSum += Math.pow(candlesToRender[i - j].close - mean, 2);
      const std = Math.sqrt(vSum / 20);
      upper.push({ x: getX(i), y: getY(mean + 2 * std) });
      lower.push({ x: getX(i), y: getY(mean - 2 * std) });
    }
    return { upper, lower };
  }, [candlesToRender, showBands, getX, getY]);

  // RSI (14) series
  const rsiSeries = useMemo(() => {
    if (!showRsi || candlesToRender.length < 15) return [];
    const rsiValues: { x: number; y: number; rsi: number }[] = [];
    const period = 14;
    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const diff = candlesToRender[i].close - candlesToRender[i - 1].close;
      if (diff >= 0) gains += diff;
      else losses += Math.abs(diff);
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;

    const rsiYBase = PADDING_TOP + mainPlotHeight + 10;
    const rsiH = 50;

    for (let i = period; i < candlesToRender.length; i++) {
      const diff = candlesToRender[i].close - candlesToRender[i - 1].close;
      if (diff >= 0) {
        avgGain = (avgGain * 13 + diff) / 14;
        avgLoss = (avgLoss * 13) / 14;
      } else {
        avgGain = (avgGain * 13) / 14;
        avgLoss = (avgLoss * 13 + Math.abs(diff)) / 14;
      }
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      const rsi = 100 - 100 / (1 + rs);
      const y = rsiYBase + rsiH - (rsi / 100) * rsiH;
      rsiValues.push({ x: getX(i), y, rsi });
    }
    return rsiValues;
  }, [candlesToRender, showRsi, mainPlotHeight, getX]);

  // MACD (12, 26, 9)
  const macdSeries = useMemo(() => {
    if (!showMacd || candlesToRender.length < 35) return { macdPoints: [], signalPoints: [], histBars: [] };
    const emaFast: number[] = [];
    const emaSlow: number[] = [];
    const k12 = 2 / 13;
    const k26 = 2 / 27;

    let fEma = candlesToRender[0].close;
    let sEma = candlesToRender[0].close;

    for (const c of candlesToRender) {
      fEma = c.close * k12 + fEma * (1 - k12);
      sEma = c.close * k26 + sEma * (1 - k26);
      emaFast.push(fEma);
      emaSlow.push(sEma);
    }

    const macdLine: number[] = emaFast.map((f, idx) => f - emaSlow[idx]);
    const k9 = 2 / 10;
    let sig = macdLine[25] || 0;
    const signalLine: number[] = [];
    for (let i = 0; i < macdLine.length; i++) {
      if (i < 25) {
        signalLine.push(0);
      } else {
        sig = macdLine[i] * k9 + sig * (1 - k9);
        signalLine.push(sig);
      }
    }

    const macdYBase = PADDING_TOP + mainPlotHeight + (showRsi ? 65 : 10) + 35;
    const scale = 15;

    const macdPoints = macdLine.slice(26).map((m, idx) => ({
      x: getX(idx + 26),
      y: macdYBase - m * scale,
    }));
    const signalPoints = signalLine.slice(26).map((s, idx) => ({
      x: getX(idx + 26),
      y: macdYBase - s * scale,
    }));
    const histBars = macdLine.slice(26).map((m, idx) => {
      const diff = m - signalLine[idx + 26];
      return {
        x: getX(idx + 26),
        y: diff >= 0 ? macdYBase - diff * scale : macdYBase,
        h: Math.abs(diff * scale),
        isBull: diff >= 0,
      };
    });

    return { macdPoints, signalPoints, histBars };
  }, [candlesToRender, showMacd, showRsi, mainPlotHeight, getX]);

  // Grid lines
  const gridLines = useMemo(() => {
    const count = 6;
    const lines: { y: number; price: number }[] = [];
    for (let i = 0; i <= count; i++) {
      const price = minPrice + (priceSpan / count) * i;
      lines.push({ y: getY(price), price });
    }
    return lines;
  }, [minPrice, priceSpan, getY]);

  // Time axis labels with timeframe-aware formatting
  const timeLabels = useMemo(() => {
    if (candlesToRender.length === 0) return [];
    const step = Math.max(1, Math.floor(candlesToRender.length / 7));
    const labels: { x: number; label: string }[] = [];
    const tz = chartSettings.timezone === 'UTC' ? 'UTC' : (chartSettings.timezone || 'UTC');
    const tf = timeframe.toLowerCase();
    const isLongTf = ['1d', '1w', '1m', '1mo', '1month'].includes(tf);
    const isMedTf = ['4h', '6h', '8h', '12h', '1h', '2h', '3h'].includes(tf);

    for (let i = 0; i < candlesToRender.length; i += step) {
      const c = candlesToRender[i];
      const d = new Date(c.time * 1000);
      let label: string;
      try {
        if (isLongTf) {
          // Show date only
          label = d.toLocaleDateString('en-US', {
            timeZone: tz,
            month: 'short',
            day: 'numeric',
            ...(tf === '1w' || tf === '1m' || tf === '1mo' ? { year: '2-digit' } : {}),
          });
        } else if (isMedTf) {
          // Show date + time
          label = d.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' })
            + ' '
            + d.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
        } else {
          // Show time only
          label = d.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
        }
      } catch {
        label = d.toISOString().slice(11, 16);
      }
      labels.push({ x: getX(i), label });
    }
    return labels;
  }, [candlesToRender, getX, timeframe, chartSettings.timezone]);

  // Active candle for top banner
  const activeCandle = hoverIndex != null && hoverIndex < candlesToRender.length
    ? candlesToRender[hoverIndex]
    : candlesToRender[candlesToRender.length - 1];

  const activeIsBull = activeCandle ? activeCandle.close >= activeCandle.open : true;
  const activeChangeDiff = activeCandle ? activeCandle.close - activeCandle.open : 0;
  const activeChangePct = activeCandle && activeCandle.open > 0
    ? ((activeChangeDiff / activeCandle.open) * 100).toFixed(2) : '0.00';

  const latestPrice = candlesToRender.length > 0
    ? candlesToRender[candlesToRender.length - 1].close : currentPrice;
  const latestY = getY(latestPrice);

  // Wheel listener
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.cancelable) e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        setCandleScale((prev) => Math.max(0.3, Math.min(5, prev + (e.deltaY > 0 ? -0.1 : 0.1))));
      } else {
        setScrollOffset((prev) => Math.max(0, Math.min(candles.length - 8, prev + (e.deltaY > 0 ? -3 : 3))));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [candles.length]);

  // Keyboard Shortcuts (Arrows, +/-, Esc, Del, Ctrl+Z/Y)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveTool('cursor');
        setActiveCategory(null);
        setIsDrawing(false);
        setDrawStart(null);
        setContextMenu(null);
      } else if (e.key === '+' || e.key === '=') {
        setCandleScale((p) => Math.min(5, p + 0.2));
      } else if (e.key === '-' || e.key === '_') {
        setCandleScale((p) => Math.max(0.3, p - 0.2));
      } else if (e.key === 'ArrowLeft') {
        setScrollOffset((p) => Math.min(candles.length - 8, p + 2));
      } else if (e.key === 'ArrowRight') {
        setScrollOffset((p) => Math.max(0, p - 2));
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (drawnObjects.length > 0) {
          const updated = drawnObjects.slice(0, -1);
          setDrawnObjects(updated);
          localStorage.setItem(`tr_drawings_v2_${symbol}`, JSON.stringify(updated));
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [candles.length, drawnObjects, symbol]);

  const getSvgCoords = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleDoubleClick = () => {
    setCandleScale(1.0);
    setPriceScaleFactor(1.0);
    setScrollOffset(0);
    setLongPressCandle(null);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (e.cancelable) e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setContextMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (contextMenu) setContextMenu(null);
    const coords = getSvgCoords(e);

    // Right price scale drag
    if (coords.x >= plotWidth) {
      setIsDraggingPriceScale(true);
      setDragStartY(e.clientY);
      if (e.cancelable) e.preventDefault();
      return;
    }

    // Bottom time axis drag
    if (coords.y >= height - PADDING_BOTTOM) {
      setIsDraggingTimeScale(true);
      setDragStartX(e.clientX);
      if (e.cancelable) e.preventDefault();
      return;
    }

    // Drawing tool active
    if (activeTool !== 'cursor') {
      setIsDrawing(true);
      setDrawStart(coords);
      setDrawCurrent(coords);
      if (e.cancelable) e.preventDefault();
      return;
    }

    // Cursor pan
    setIsPanning(true);
    setPanStartX(e.clientX);
    setInitialScrollOffset(scrollOffset);

    // Part 5: Long press timer
    if (chartSettings.longPressTooltipEnabled) {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = setTimeout(() => {
        const slotW = plotWidth / Math.max(1, candlesToRender.length);
        const idx = Math.floor(coords.x / slotW);
        if (idx >= 0 && idx < candlesToRender.length) {
          setLongPressCandle(candlesToRender[idx]);
          setLongPressPos({ x: coords.x, y: coords.y });
          playTradingSound('priceAlert', {
            enabled: chartSettings.soundsEnabled,
            masterVolume: chartSettings.masterVolume,
            effects: chartSettings.soundEffects,
          });
        }
      }, chartSettings.longPressDurationMs || 400);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const coords = getSvgCoords(e);

    if (longPressTimerRef.current && isPanning && Math.abs(e.clientX - panStartX) > 8) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
      setLongPressCandle(null);
    }

    if (isDraggingPriceScale) {
      const deltaY = e.clientY - dragStartY;
      setPriceScaleFactor((prev) => Math.max(0.2, Math.min(4.0, prev + deltaY * 0.005)));
      setDragStartY(e.clientY);
      return;
    }

    if (isDraggingTimeScale) {
      const deltaX = e.clientX - dragStartX;
      setCandleScale((prev) => Math.max(0.3, Math.min(5.0, prev + deltaX * 0.01)));
      setDragStartX(e.clientX);
      return;
    }

    if (isPanning) {
      const deltaX = e.clientX - panStartX;
      const slotW = plotWidth / Math.max(1, candlesToRender.length);
      const candlesShift = Math.round(deltaX / slotW);
      setScrollOffset(Math.max(0, Math.min(candles.length - 8, initialScrollOffset + candlesShift)));
      return;
    }

    if (isDrawing && drawStart) {
      setDrawCurrent(coords);
    }

    const slotW = plotWidth / Math.max(1, candlesToRender.length);
    if (slotW > 0) {
      const idx = Math.floor(coords.x / slotW);
      if (idx >= 0 && idx < candlesToRender.length) setHoverIndex(idx);
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setIsDraggingPriceScale(false);
    setIsDraggingTimeScale(false);
    setIsPanning(false);

    if (isDrawing && drawStart && drawCurrent && activeTool !== 'cursor') {
      const slotW = plotWidth / Math.max(1, candlesToRender.length);
      const idx1 = Math.max(0, Math.min(candlesToRender.length - 1, Math.floor(drawStart.x / slotW)));
      const idx2 = Math.max(0, Math.min(candlesToRender.length - 1, Math.floor(drawCurrent.x / slotW)));
      const p1 = getPriceAtY(drawStart.y);
      const p2 = getPriceAtY(drawCurrent.y);
      const t1 = getTimeAtIndex(idx1);
      const t2 = getTimeAtIndex(idx2);

      let customText: string | undefined = undefined;
      if (activeTool === 'text') {
        const input = typeof window !== 'undefined' ? window.prompt('Enter chart annotation:', 'Resistance / Support') : 'Note';
        customText = input || 'Note';
      }

      const toolColors: Record<string, string> = {
        trend: '#f59e0b',
        ray: '#38bdf8',
        extended: '#fbbf24',
        channel: '#a855f7',
        hline: '#3b82f6',
        vline: '#8b5cf6',
        fibo: '#10b981',
        fiboExt: '#06b6d4',
        fiboFan: '#ec4899',
        rect: '#f59e0b',
        circle: '#3b82f6',
        triangle: '#8b5cf6',
        brush: '#f97316',
        text: '#ffffff',
        callout: '#22c55e',
        measure: '#06b6d4',
        longPos: '#22c55e',
        shortPos: '#ef4444',
      };

      const newObj: ChartDrawingObject = {
        id: `draw-${Date.now()}`,
        tool: activeTool,
        color: toolColors[activeTool] || '#f59e0b',
        price1: p1,
        time1: t1,
        price2: p2,
        time2: t2,
        text: customText,
      };

      setUndoStack((prev) => [...prev, drawnObjects]);
      setRedoStack([]);
      const updated = [...drawnObjects, newObj];
      setDrawnObjects(updated);
      try {
        localStorage.setItem(`tr_drawings_v2_${symbol}`, JSON.stringify(updated));
      } catch {}
    }

    setIsDrawing(false);
    setDrawStart(null);
    setDrawCurrent(null);
  };

  // Line chart polyline
  const linePoints = useMemo(() =>
    candlesToRender.map((c, i) => `${getX(i).toFixed(1)},${getY(c.close).toFixed(1)}`).join(' '),
    [candlesToRender, getX, getY]);

  return (
    <div className="flex h-full w-full flex-col bg-ink-950 overflow-hidden relative select-none">
      
      {/* ── TOP BAR (Matching Exness Images 1, 3, 4, 5) ── */}
      <div className="flex items-center justify-between border-b border-ink-800 bg-[#0d1117] px-2 h-9 text-xs shrink-0 select-none">
        
        {/* Left: (+) Compare + Timeframes + Chart Style + fx Indicators + Layout + Undo/Redo */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          {/* (+) Plus compare button */}
          <button
            type="button"
            className="w-6 h-6 rounded-full border border-ink-700 bg-ink-900 hover:bg-ink-800 flex items-center justify-center text-slate-300 hover:text-white font-bold text-xs"
            title="Compare or Add Symbol"
          >
            +
          </button>

          <div className="h-4 w-px bg-ink-800 mx-0.5" />

          {/* Quick Timeframes: 3m, 10m, 5m (with yellow active highlight) */}
          <div className="flex items-center gap-1">
            {['3m', '5m', '10m', '15m', '1h', '1d'].map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => onTimeframeChange(tf)}
                className={`px-1.5 py-0.5 rounded font-bold text-[11px] transition shrink-0 ${
                  timeframe.toLowerCase() === tf.toLowerCase()
                    ? 'text-amber-400 font-black'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tf}
              </button>
            ))}

            {/* Timeframe dropdown arrow for remaining intervals */}
            <select
              value={timeframe}
              onChange={(e) => onTimeframeChange(e.target.value)}
              className="bg-transparent text-slate-400 hover:text-white text-[11px] outline-none cursor-pointer"
            >
              <option value={timeframe} className="bg-ink-900 text-white">⌄</option>
              {ALL_SUPPORTED_TIMEFRAMES.map((t) => (
                <option key={t.value} value={t.value} className="bg-ink-900 text-white">{t.label}</option>
              ))}
            </select>
          </div>

          <div className="h-4 w-px bg-ink-800 mx-0.5" />

          {/* Chart Style: Candles / Line / Bars with icon */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setChartType(chartType === 'candles' ? 'line' : chartType === 'line' ? 'bars' : 'candles')}
              className="flex items-center gap-1 px-1.5 py-0.5 text-amber-400 hover:text-amber-300 font-bold text-xs"
              title="Change Chart Type (Candles, Line, Bars)"
            >
              <span>{chartType === 'candles' ? '🕯️' : chartType === 'line' ? '📈' : '📊'}</span>
              <span className="text-[10px] text-slate-400">⌄</span>
            </button>
          </div>

          <div className="h-4 w-px bg-ink-800 mx-0.5" />

          {/* fx Indicators button */}
          <button
            type="button"
            onClick={() => setShowIndicatorsModal(!showIndicatorsModal)}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-bold transition ${
              showIndicatorsModal ? 'text-amber-400' : 'text-slate-300 hover:text-white'
            }`}
          >
            <span className="italic font-serif text-amber-300 font-bold text-sm">fx</span>
            <span className="text-[11px]">Indicators</span>
          </button>

          <div className="h-4 w-px bg-ink-800 mx-0.5" />

          {/* Template Layout icon ⊞ */}
          <button
            type="button"
            className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-white"
            title="Chart Templates"
          >
            ⊞
          </button>

          {/* Undo / Redo */}
          <div className="flex items-center gap-0.5 text-slate-400">
            <button
              type="button"
              onClick={() => {
                if (undoStack.length > 0) {
                  const prev = undoStack[undoStack.length - 1];
                  setRedoStack((r) => [...r, drawnObjects]);
                  setUndoStack((u) => u.slice(0, -1));
                  setDrawnObjects(prev);
                }
              }}
              disabled={undoStack.length === 0}
              className="p-1 hover:text-white disabled:opacity-30"
              title="Undo (Ctrl+Z)"
            >
              ↶
            </button>
            <button
              type="button"
              onClick={() => {
                if (redoStack.length > 0) {
                  const next = redoStack[redoStack.length - 1];
                  setUndoStack((u) => [...u, drawnObjects]);
                  setRedoStack((r) => r.slice(0, -1));
                  setDrawnObjects(next);
                }
              }}
              disabled={redoStack.length === 0}
              className="p-1 hover:text-white disabled:opacity-30"
              title="Redo (Ctrl+Y)"
            >
              ↷
            </button>
          </div>
        </div>

        {/* Right Top Tools: Layout + Save + Magnet + Camera + Fullscreen + Settings */}
        <div className="flex items-center gap-2">
          {/* Save Status with Green Dot */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-ink-900 border border-ink-800 text-[11px]">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-slate-300 font-semibold">Save</span>
          </div>

          {/* Magnet snap */}
          <button
            type="button"
            className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-white"
            title="Magnet Snap"
          >
            🧲
          </button>

          {/* Camera screenshot */}
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.alert('Snapshot saved to clipboard / download.');
              }
            }}
            className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-white"
            title="Take Screenshot"
          >
            📷
          </button>

          {/* Gear Settings Modal Button */}
          <button
            type="button"
            onClick={() => setShowSettingsModal(true)}
            className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-white transition"
            title="Chart & Order Settings"
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* ── MAIN CHART BODY (Matching Exness Images 1-10) ── */}
      <div className="relative flex flex-1 w-full overflow-hidden min-h-0 bg-[#0c1017]">
        
        {/* Left Drawing Toolbar Rail (Matching Exness Images 1-10) */}
        <div className="w-10 border-r border-ink-800 bg-[#0d1117] flex flex-col items-center py-2 gap-1 select-none shrink-0 z-30 relative">
          
          {/* Yellow vertical pill drag handle on right rail edge (seen in all screenshots) */}
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1.5 h-8 bg-amber-400 rounded-l-md pointer-events-none" />

          {/* 1. Cursor Tools (Image 2) */}
          <div className="relative">
            <button
              onClick={() => setActiveCategory(activeCategory === 'cursor' ? null : 'cursor')}
              className={`h-7 w-7 rounded flex items-center justify-center transition text-xs ${
                activeTool === 'cursor' ? 'text-amber-400 bg-amber-400/10' : 'text-slate-400 hover:text-white hover:bg-ink-800'
              }`}
              title="Cursor Modes"
            >
              ✚
            </button>
            {activeCategory === 'cursor' && (
              <div className="absolute left-10 top-0 bg-[#161c26] border border-ink-700 rounded-lg shadow-2xl p-1.5 w-52 space-y-0.5 z-50 text-xs">
                {[
                  { id: 'cross', label: 'Cross', icon: '✛' },
                  { id: 'dot', label: 'Dot', icon: '•' },
                  { id: 'arrow', label: 'Arrow', icon: '↗' },
                  { id: 'demo', label: 'Demonstration', icon: '▷' },
                ].map((cur) => (
                  <button
                    key={cur.id}
                    onClick={() => { setActiveTool(cur.id === 'cross' ? 'cursor' : cur.id); setActiveCategory(null); }}
                    className="w-full text-left px-2.5 py-1.5 rounded hover:bg-ink-800 text-slate-200 flex items-center gap-2.5"
                  >
                    <span className="w-4 text-center font-bold text-slate-400">{cur.icon}</span>
                    <span>{cur.label}</span>
                  </button>
                ))}
                <div className="h-px bg-ink-700 my-1" />
                <button
                  onClick={() => { setActiveTool('eraser'); setActiveCategory(null); }}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-ink-800 text-slate-200 flex items-center gap-2.5"
                >
                  <span className="w-4 text-center text-slate-400">⌫</span>
                  <span>Eraser</span>
                </button>
                <div className="h-px bg-ink-700 my-1" />
                <div className="flex items-center justify-between px-2.5 py-1 text-[11px] text-slate-300">
                  <span>Values tooltip on long press</span>
                  <input
                    type="checkbox"
                    checked={chartSettings.longPressTooltipEnabled}
                    onChange={(e) => handleSaveSettings({ ...chartSettings, longPressTooltipEnabled: e.target.checked })}
                    className="rounded accent-amber-400"
                  />
                </div>
              </div>
            )}
          </div>

          {/* 2. Lines (Image 3) */}
          <div className="relative">
            <button
              onClick={() => setActiveCategory(activeCategory === 'lines' ? null : 'lines')}
              className={`h-7 w-7 rounded flex items-center justify-center transition text-xs ${
                activeCategory === 'lines' ? 'text-amber-400 bg-amber-400/10' : 'text-slate-400 hover:text-white hover:bg-ink-800'
              }`}
              title="Lines"
            >
              ╱
            </button>
            {activeCategory === 'lines' && (
              <div className="absolute left-10 top-0 bg-[#161c26] border border-ink-700 rounded-lg shadow-2xl p-1.5 w-60 space-y-0.5 z-50 text-xs max-h-[85vh] overflow-y-auto">
                <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Lines</div>
                {[
                  { id: 'trend', label: 'Trend Line', shortcut: 'Alt + T', star: true },
                  { id: 'ray', label: 'Ray' },
                  { id: 'infoLine', label: 'Info Line' },
                  { id: 'extended', label: 'Extended Line' },
                  { id: 'trendAngle', label: 'Trend Angle' },
                ].map((l) => (
                  <button
                    key={l.id}
                    onClick={() => { setActiveTool(l.id); setActiveCategory(null); }}
                    className="w-full text-left px-2.5 py-1.5 rounded hover:bg-ink-800 text-slate-200 flex items-center justify-between"
                  >
                    <span>{l.label}</span>
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                      {l.shortcut && <span>{l.shortcut}</span>}
                      {l.star && <span className="text-amber-400">★</span>}
                    </div>
                  </button>
                ))}
                <div className="h-px bg-ink-700 my-1" />
                {[
                  { id: 'hline', label: 'Horizontal Line', shortcut: 'Alt + H' },
                  { id: 'hray', label: 'Horizontal Ray', shortcut: 'Alt + J' },
                  { id: 'vline', label: 'Vertical Line', shortcut: 'Alt + V' },
                  { id: 'crossLine', label: 'Cross Line', shortcut: 'Alt + C' },
                ].map((l) => (
                  <button
                    key={l.id}
                    onClick={() => { setActiveTool(l.id); setActiveCategory(null); }}
                    className="w-full text-left px-2.5 py-1.5 rounded hover:bg-ink-800 text-slate-200 flex items-center justify-between"
                  >
                    <span>{l.label}</span>
                    {l.shortcut && <span className="text-[10px] text-slate-500">{l.shortcut}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 3. Channels & Pitchforks (Image 4) */}
          <div className="relative">
            <button
              onClick={() => setActiveCategory(activeCategory === 'channels' ? null : 'channels')}
              className={`h-7 w-7 rounded flex items-center justify-center transition text-xs ${
                activeCategory === 'channels' ? 'text-amber-400 bg-amber-400/10' : 'text-slate-400 hover:text-white hover:bg-ink-800'
              }`}
              title="Channels & Pitchforks"
            >
              ☷
            </button>
            {activeCategory === 'channels' && (
              <div className="absolute left-10 top-0 bg-[#161c26] border border-ink-700 rounded-lg shadow-2xl p-1.5 w-56 space-y-0.5 z-50 text-xs max-h-[85vh] overflow-y-auto">
                <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Channels</div>
                {[
                  { id: 'channel', label: 'Parallel Channel' },
                  { id: 'regression', label: 'Regression Trend' },
                  { id: 'flatTop', label: 'Flat Top/Bottom' },
                  { id: 'disjoint', label: 'Disjoint Channel' },
                ].map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { setActiveTool(c.id); setActiveCategory(null); }}
                    className="w-full text-left px-2.5 py-1.5 rounded hover:bg-ink-800 text-slate-200"
                  >
                    {c.label}
                  </button>
                ))}
                <div className="h-px bg-ink-700 my-1" />
                <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pitchforks</div>
                {[
                  { id: 'pitchfork', label: 'Pitchfork' },
                  { id: 'schiff', label: 'Schiff Pitchfork' },
                  { id: 'modSchiff', label: 'Modified Schiff Pitchfork' },
                  { id: 'insidePitch', label: 'Inside Pitchfork' },
                ].map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { setActiveTool(p.id); setActiveCategory(null); }}
                    className="w-full text-left px-2.5 py-1.5 rounded hover:bg-ink-800 text-slate-200"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 4. Fibonacci & Gann (Images 5 & 6) */}
          <div className="relative">
            <button
              onClick={() => setActiveCategory(activeCategory === 'fibo' ? null : 'fibo')}
              className={`h-7 w-7 rounded flex items-center justify-center transition text-xs ${
                activeCategory === 'fibo' ? 'text-amber-400 bg-amber-400/10' : 'text-slate-400 hover:text-white hover:bg-ink-800'
              }`}
              title="Fibonacci & Gann"
            >
              ⌗
            </button>
            {activeCategory === 'fibo' && (
              <div className="absolute left-10 top-0 bg-[#161c26] border border-ink-700 rounded-lg shadow-2xl p-1.5 w-64 space-y-0.5 z-50 text-xs max-h-[85vh] overflow-y-auto">
                <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Fibonacci</div>
                {[
                  { id: 'fibo', label: 'Fib Retracement', shortcut: 'Alt + F' },
                  { id: 'fiboExt', label: 'Trend-Based Fib Extension' },
                  { id: 'fibChannel', label: 'Fib Channel' },
                  { id: 'fibTimeZone', label: 'Fib Time Zone' },
                  { id: 'fiboFan', label: 'Fib Speed Resistance Fan' },
                  { id: 'fibTime', label: 'Trend-Based Fib Time' },
                  { id: 'fibCircles', label: 'Fib Circles' },
                  { id: 'fibSpiral', label: 'Fib Spiral' },
                  { id: 'fibArcs', label: 'Fib Speed Resistance Arcs' },
                  { id: 'fibWedge', label: 'Fib Wedge' },
                  { id: 'pitchfan', label: 'Pitchfan' },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => { setActiveTool(f.id); setActiveCategory(null); }}
                    className="w-full text-left px-2.5 py-1.5 rounded hover:bg-ink-800 text-slate-200 flex items-center justify-between"
                  >
                    <span>{f.label}</span>
                    {f.shortcut && <span className="text-[10px] text-slate-500">{f.shortcut}</span>}
                  </button>
                ))}
                <div className="h-px bg-ink-700 my-1" />
                <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Gann</div>
                {[
                  { id: 'gannBox', label: 'Gann Box' },
                  { id: 'gannSqFixed', label: 'Gann Square Fixed' },
                  { id: 'gannSquare', label: 'Gann Square' },
                  { id: 'gannFan', label: 'Gann Fan' },
                ].map((g) => (
                  <button
                    key={g.id}
                    onClick={() => { setActiveTool(g.id); setActiveCategory(null); }}
                    className="w-full text-left px-2.5 py-1.5 rounded hover:bg-ink-800 text-slate-200"
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 5. Patterns & Elliott Waves (Images 7 & 8) */}
          <div className="relative">
            <button
              onClick={() => setActiveCategory(activeCategory === 'patterns' ? null : 'patterns')}
              className={`h-7 w-7 rounded flex items-center justify-center transition text-xs ${
                activeCategory === 'patterns' ? 'text-amber-400 bg-amber-400/10' : 'text-slate-400 hover:text-white hover:bg-ink-800'
              }`}
              title="Patterns & Elliott Waves"
            >
              ⌘
            </button>
            {activeCategory === 'patterns' && (
              <div className="absolute left-10 top-0 bg-[#161c26] border border-ink-700 rounded-lg shadow-2xl p-1.5 w-64 space-y-0.5 z-50 text-xs max-h-[85vh] overflow-y-auto">
                <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Patterns</div>
                {[
                  { id: 'xabcd', label: 'XABCD Pattern' },
                  { id: 'cypher', label: 'Cypher Pattern' },
                  { id: 'headShoulders', label: 'Head and Shoulders' },
                  { id: 'abcd', label: 'ABCD Pattern' },
                  { id: 'triangle', label: 'Triangle Pattern' },
                  { id: 'threeDrives', label: 'Three Drives Pattern' },
                ].map((pt) => (
                  <button
                    key={pt.id}
                    onClick={() => { setActiveTool(pt.id); setActiveCategory(null); }}
                    className="w-full text-left px-2.5 py-1.5 rounded hover:bg-ink-800 text-slate-200"
                  >
                    {pt.label}
                  </button>
                ))}
                <div className="h-px bg-ink-700 my-1" />
                <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Elliott Waves</div>
                {[
                  { id: 'elliott12345', label: 'Elliott Impulse Wave (12345)' },
                  { id: 'elliottAbc', label: 'Elliott Correction Wave (ABC)' },
                  { id: 'elliottAbcde', label: 'Elliott Triangle Wave (ABCDE)' },
                  { id: 'elliottWxy', label: 'Elliott Double Combo Wave (WXY)' },
                  { id: 'elliottWxyz', label: 'Elliott Triple Combo Wave (WXYZ)' },
                ].map((ew) => (
                  <button
                    key={ew.id}
                    onClick={() => { setActiveTool(ew.id); setActiveCategory(null); }}
                    className="w-full text-left px-2.5 py-1.5 rounded hover:bg-ink-800 text-slate-200"
                  >
                    {ew.label}
                  </button>
                ))}
                <div className="h-px bg-ink-700 my-1" />
                <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Cycles</div>
                {[
                  { id: 'cyclicLines', label: 'Cyclic Lines' },
                  { id: 'timeCycles', label: 'Time Cycles' },
                  { id: 'sineLine', label: 'Sine Line' },
                ].map((cy) => (
                  <button
                    key={cy.id}
                    onClick={() => { setActiveTool(cy.id); setActiveCategory(null); }}
                    className="w-full text-left px-2.5 py-1.5 rounded hover:bg-ink-800 text-slate-200"
                  >
                    {cy.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 6. Projections, Volume & Measurer (Images 9 & 10) */}
          <div className="relative">
            <button
              onClick={() => setActiveCategory(activeCategory === 'projection' ? null : 'projection')}
              className={`h-7 w-7 rounded flex items-center justify-center transition text-xs ${
                activeCategory === 'projection' ? 'text-amber-400 bg-amber-400/10' : 'text-slate-400 hover:text-white hover:bg-ink-800'
              }`}
              title="Projection & Measure"
            >
              ⇱
            </button>
            {activeCategory === 'projection' && (
              <div className="absolute left-10 top-0 bg-[#161c26] border border-ink-700 rounded-lg shadow-2xl p-1.5 w-60 space-y-0.5 z-50 text-xs max-h-[85vh] overflow-y-auto">
                <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Projection</div>
                {[
                  { id: 'longPos', label: 'Long Position' },
                  { id: 'shortPos', label: 'Short Position' },
                  { id: 'forecast', label: 'Forecast' },
                  { id: 'barsPattern', label: 'Bars Pattern' },
                  { id: 'ghostFeed', label: 'Ghost Feed' },
                  { id: 'projection', label: 'Projection' },
                ].map((pj) => (
                  <button
                    key={pj.id}
                    onClick={() => { setActiveTool(pj.id); setActiveCategory(null); }}
                    className="w-full text-left px-2.5 py-1.5 rounded hover:bg-ink-800 text-slate-200"
                  >
                    {pj.label}
                  </button>
                ))}
                <div className="h-px bg-ink-700 my-1" />
                <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Volume-Based</div>
                {[
                  { id: 'anchoredVwap', label: 'Anchored VWAP' },
                  { id: 'fixedVolumeProfile', label: 'Fixed Range Volume Profile' },
                ].map((vb) => (
                  <button
                    key={vb.id}
                    onClick={() => { setActiveTool(vb.id); setActiveCategory(null); }}
                    className="w-full text-left px-2.5 py-1.5 rounded hover:bg-ink-800 text-slate-200"
                  >
                    {vb.label}
                  </button>
                ))}
                <div className="h-px bg-ink-700 my-1" />
                <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Measurer</div>
                {[
                  { id: 'measure', label: 'Price Range' },
                  { id: 'dateRange', label: 'Date Range' },
                  { id: 'datePriceRange', label: 'Date and Price Range' },
                ].map((ms) => (
                  <button
                    key={ms.id}
                    onClick={() => { setActiveTool(ms.id); setActiveCategory(null); }}
                    className="w-full text-left px-2.5 py-1.5 rounded hover:bg-ink-800 text-slate-200"
                  >
                    {ms.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 7. Geometric Shapes */}
          <div className="relative">
            <button
              onClick={() => setActiveCategory(activeCategory === 'shapes' ? null : 'shapes')}
              className={`h-7 w-7 rounded flex items-center justify-center transition text-xs ${
                activeCategory === 'shapes' ? 'text-amber-400 bg-amber-400/10' : 'text-slate-400 hover:text-white hover:bg-ink-800'
              }`}
              title="Geometric Shapes"
            >
              ◻
            </button>
            {activeCategory === 'shapes' && (
              <div className="absolute left-10 top-0 bg-[#161c26] border border-ink-700 rounded-lg shadow-2xl p-1.5 w-44 space-y-0.5 z-50 text-xs">
                {[
                  { id: 'brush', label: 'Brush' },
                  { id: 'rect', label: 'Rectangle (Zone)' },
                  { id: 'circle', label: 'Circle' },
                  { id: 'triangle', label: 'Triangle' },
                ].map((s) => (
                  <button
                    key={s.id}
                    onClick={() => { setActiveTool(s.id); setActiveCategory(null); }}
                    className="w-full text-left px-2.5 py-1.5 rounded hover:bg-ink-800 text-slate-200"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 8. Text & Annotations */}
          <div className="relative">
            <button
              onClick={() => setActiveCategory(activeCategory === 'annot' ? null : 'annot')}
              className={`h-7 w-7 rounded flex items-center justify-center transition text-xs ${
                activeCategory === 'annot' ? 'text-amber-400 bg-amber-400/10' : 'text-slate-400 hover:text-white hover:bg-ink-800'
              }`}
              title="Text & Annotations"
            >
              T
            </button>
            {activeCategory === 'annot' && (
              <div className="absolute left-10 top-0 bg-[#161c26] border border-ink-700 rounded-lg shadow-2xl p-1.5 w-44 space-y-0.5 z-50 text-xs">
                {[
                  { id: 'text', label: 'Text Note' },
                  { id: 'callout', label: 'Callout Tag' },
                ].map((a) => (
                  <button
                    key={a.id}
                    onClick={() => { setActiveTool(a.id); setActiveCategory(null); }}
                    className="w-full text-left px-2.5 py-1.5 rounded hover:bg-ink-800 text-slate-200"
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 9. Smiley / Stickers */}
          <button
            onClick={() => {
              if (typeof window !== 'undefined') {
                const icon = window.prompt('Enter sticker emoji or text:', '🎯');
                if (icon) {
                  setActiveTool('text');
                }
              }
            }}
            className="h-7 w-7 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-ink-800 text-xs"
            title="Icons & Stickers"
          >
            ☺
          </button>

          {/* 10. Zoom / Scale */}
          <button
            onClick={() => handleDoubleClick()}
            className="h-7 w-7 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-ink-800 text-xs"
            title="Reset Scale"
          >
            🔍
          </button>

          <div className="flex-1" />

          {/* Object Manager */}
          <button
            type="button"
            onClick={() => setShowObjectManager((p) => !p)}
            className={`h-7 w-7 rounded flex items-center justify-center transition text-xs ${
              showObjectManager || drawnObjects.length > 0 ? 'text-amber-400' : 'text-slate-500 hover:text-white'
            }`}
            title={`Objects Manager (${drawnObjects.length})`}
          >
            📦
          </button>

          {/* Clear all drawings */}
          <button
            type="button"
            onClick={() => {
              setDrawnObjects([]);
              setActiveTool('cursor');
              localStorage.removeItem(`tr_drawings_v2_${symbol}`);
            }}
            className="h-7 w-7 rounded flex items-center justify-center text-slate-500 hover:text-rose-400 transition text-xs"
            title="Clear all drawings"
          >
            🗑
          </button>

          {/* Zoom In & Out buttons */}
          <button
            type="button"
            onClick={() => setCandleScale((p) => Math.min(5, p + 0.3))}
            className="h-7 w-7 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-ink-800 transition text-sm font-bold"
            title="Zoom In (+)"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setCandleScale((p) => Math.max(0.3, p - 0.3))}
            className="h-7 w-7 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-ink-800 transition text-sm font-bold"
            title="Zoom Out (-)"
          >
            −
          </button>
        </div>

        {/* SVG Drawing Canvas Container */}
        <div
          ref={containerRef}
          className={`relative flex-1 h-full overflow-hidden select-none ${
            isDraggingPriceScale
              ? 'cursor-ns-resize'
              : isDraggingTimeScale
              ? 'cursor-ew-resize'
              : isPanning
              ? 'cursor-grabbing'
              : activeTool !== 'cursor'
              ? 'cursor-crosshair'
              : 'cursor-crosshair'
          }`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onDoubleClick={handleDoubleClick}
          onContextMenu={handleContextMenu}
          onMouseLeave={() => {
            setHoverIndex(null);
            setIsPanning(false);
            setIsDraggingPriceScale(false);
            setIsDraggingTimeScale(false);
            if (longPressTimerRef.current) {
              clearTimeout(longPressTimerRef.current);
              longPressTimerRef.current = null;
            }
          }}
        >
          {/* ── FLOATING TOP-LEFT SYMBOL & OHLC PILL (Exness Images 1-10) ── */}
          <div className="absolute top-2.5 left-3 z-20 flex flex-wrap items-center gap-2 text-xs font-mono select-none pointer-events-none">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#161c26]/90 border border-ink-700/80 text-white shadow-md pointer-events-auto cursor-pointer hover:border-amber-400/50 transition">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[9px] text-ink-950 font-bold">
                {symbol.includes('BTC') ? '₿' : symbol.includes('ETH') ? 'Ξ' : symbol.includes('XAU') ? '🪙' : '💱'}
              </span>
              <span className="font-bold text-[12px]">{instrumentName || (symbol.includes('BTC') ? 'Bitcoin vs US Dollar' : symbol)} · {timeframe.replace('m', '')}</span>
              <span className="text-slate-500 text-[10px] ml-0.5">⋯</span>
            </div>
            {activeCandle && (
              <div className="hidden sm:flex items-center gap-2 text-[11px] bg-[#0c1017]/85 px-2.5 py-1 rounded backdrop-blur border border-ink-800/70 font-mono shadow-sm">
                <span className="text-slate-400">O<strong className="text-slate-200 ml-0.5">{formatDisplayPrice(activeCandle.open, symbol)}</strong></span>
                <span className="text-slate-400">H<strong className="text-slate-200 ml-0.5">{formatDisplayPrice(activeCandle.high, symbol)}</strong></span>
                <span className="text-slate-400">L<strong className="text-slate-200 ml-0.5">{formatDisplayPrice(activeCandle.low, symbol)}</strong></span>
                <span className="text-slate-400">C<strong className={activeIsBull ? 'text-blue-400 ml-0.5' : 'text-rose-400 ml-0.5'}>{formatDisplayPrice(activeCandle.close, symbol)}</strong></span>
                <span className={activeIsBull ? 'text-blue-400' : 'text-rose-400'}>
                  {activeChangeDiff >= 0 ? '+' : ''}{formatDisplayPrice(Math.abs(activeChangeDiff), symbol)} ({activeChangeDiff >= 0 ? '+' : ''}{activeChangePct}%)
                </span>
              </div>
            )}
          </div>

          {/* Floating Quick Layout / Template Pill (seen in Images 3-10) */}
          <div className="absolute top-12 left-1/3 z-20 hidden md:flex items-center gap-1.5 px-2 py-1 rounded bg-[#161c26]/90 border border-ink-700/70 text-slate-400 shadow-md">
            <span className="text-[10px] cursor-grab">⋮⋮</span>
            <span className="text-xs hover:text-white cursor-pointer" title="Multi-chart template">⊞⁺</span>
          </div>

          {/* Long-Press Values Tooltip Card (Part 5 requirement) */}
          {longPressCandle && longPressPos && (
            <div
              className="absolute z-40 bg-ink-900/95 border border-amber-400 rounded-xl p-3 shadow-2xl text-xs backdrop-blur pointer-events-none min-w-56"
              style={{
                left: Math.max(10, Math.min(width - 240, longPressPos.x - 90)),
                top: Math.max(10, Math.min(height - 180, longPressPos.y - 130)),
              }}
            >
              <div className="flex items-center justify-between border-b border-ink-700 pb-1.5 mb-2 font-bold text-white">
                <span className="text-amber-400">{symbol}</span>
                <span className="text-slate-400 font-mono text-[10px]">
                  {new Date(longPressCandle.time * 1000).toLocaleTimeString([], {
                    timeZone: chartSettings.timezone === 'UTC' ? 'UTC' : chartSettings.timezone,
                  })}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px]">
                <div className="text-slate-400">Open: <span className="text-white font-bold">{formatDisplayPrice(longPressCandle.open, symbol)}</span></div>
                <div className="text-slate-400">Close: <span className="text-white font-bold">{formatDisplayPrice(longPressCandle.close, symbol)}</span></div>
                <div className="text-slate-400">High: <span className="text-emerald-400 font-bold">{formatDisplayPrice(longPressCandle.high, symbol)}</span></div>
                <div className="text-slate-400">Low: <span className="text-rose-400 font-bold">{formatDisplayPrice(longPressCandle.low, symbol)}</span></div>
                <div className="col-span-2 text-slate-400 pt-1.5 border-t border-ink-800 flex justify-between">
                  <span>Volume:</span>
                  <span className="text-slate-200 font-bold">{longPressCandle.volume.toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}

          {/* Right-click Contextual Chart Menu */}
          {contextMenu && (
            <div
              className="absolute z-50 bg-ink-900 border border-ink-700 rounded-xl shadow-2xl py-1 text-xs text-slate-200 min-w-48 select-none"
              style={{ left: Math.min(width - 200, contextMenu.x), top: Math.min(height - 200, contextMenu.y) }}
            >
              <button
                type="button"
                onClick={() => { handleDoubleClick(); setContextMenu(null); }}
                className="w-full text-left px-3 py-2 hover:bg-ink-800 flex items-center justify-between"
              >
                <span>Reset Chart Scale</span>
                <span className="text-slate-500 text-[10px]">Dbl-Click</span>
              </button>
              <button
                type="button"
                onClick={() => { setShowIndicatorsModal(true); setContextMenu(null); }}
                className="w-full text-left px-3 py-2 hover:bg-ink-800"
              >
                + Add Technical Indicators
              </button>
              <button
                type="button"
                onClick={() => { setShowSettingsModal(true); setContextMenu(null); }}
                className="w-full text-left px-3 py-2 hover:bg-ink-800"
              >
                ⚙️ Chart Settings
              </button>
              <button
                type="button"
                onClick={() => {
                  setDrawnObjects([]);
                  localStorage.removeItem(`tr_drawings_v2_${symbol}`);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 hover:bg-ink-800 text-rose-400 border-t border-ink-800"
              >
                Clear All Drawings
              </button>
            </div>
          )}

          {/* Main SVG Graphic Canvas */}
          <svg
            ref={svgRef}
            width={width}
            height={height}
            className="block"
            style={{ userSelect: 'none' }}
          >
            <defs>
              <clipPath id="mainChartClip">
                <rect x={0} y={PADDING_TOP} width={plotWidth} height={mainPlotHeight} />
              </clipPath>
            </defs>

            {/* Background */}
            <rect x={0} y={0} width={width} height={height} fill={chartSettings.backgroundColor || '#060d14'} />

            {/* Horizontal Grid lines */}
            {chartSettings.gridVisibility && gridLines.map((line, idx) => (
              <g key={`grid-${idx}`}>
                <line
                  x1={0} y1={line.y}
                  x2={plotWidth} y2={line.y}
                  stroke={chartSettings.gridColor || 'rgba(255,255,255,0.04)'}
                  strokeWidth={1}
                />
                <text
                  x={plotWidth + 4}
                  y={line.y + 3}
                  fill="#64748b"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {formatDisplayPrice(line.price, symbol)}
                </text>
              </g>
            ))}

            {/* Time labels on bottom axis */}
            {timeLabels.map((lbl, idx) => (
              <text
                key={`time-${idx}`}
                x={lbl.x}
                y={height - 6}
                fill="#64748b"
                fontSize="8"
                fontFamily="monospace"
                textAnchor="middle"
              >
                {lbl.label}
              </text>
            ))}

            {/* Clipped Main Chart Region */}
            <g clipPath="url(#mainChartClip)">
              {/* Economic Calendar High-Impact Bands with (III) Badge (Images 1-10) */}
              {chartSettings.showEconomicCalendar !== false && [0.38, 0.54, 0.68].map((ratio, idx) => {
                const eventX = plotWidth * ratio;
                return (
                  <g key={`econ-band-${idx}`} opacity={0.88}>
                    <rect
                      x={eventX - 7}
                      y={PADDING_TOP}
                      width={14}
                      height={mainPlotHeight}
                      fill="rgba(239, 68, 68, 0.09)"
                    />
                    <line
                      x1={eventX}
                      y1={PADDING_TOP}
                      x2={eventX}
                      y2={PADDING_TOP + mainPlotHeight}
                      stroke="rgba(239, 68, 68, 0.45)"
                      strokeWidth={1}
                      strokeDasharray="4 3"
                    />
                    {/* Circular red badge with III */}
                    <circle
                      cx={eventX}
                      cy={PADDING_TOP + mainPlotHeight - 12}
                      r={7.5}
                      fill="#b91c1c"
                      stroke="#f87171"
                      strokeWidth={1}
                    />
                    <text
                      x={eventX}
                      y={PADDING_TOP + mainPlotHeight - 9.5}
                      fill="#ffffff"
                      fontSize="7"
                      fontWeight="black"
                      textAnchor="middle"
                      fontFamily="monospace"
                    >
                      III
                    </text>
                  </g>
                );
              })}

              {/* Bollinger Bands */}
              {bbPoints && (
                <g>
                  <path
                    d={`M ${bbPoints.upper.map((p) => `${p.x},${p.y}`).join(' L ')}`}
                    fill="none" stroke="rgba(168,85,247,0.5)" strokeWidth={1} strokeDasharray="3 2"
                  />
                  <path
                    d={`M ${bbPoints.lower.map((p) => `${p.x},${p.y}`).join(' L ')}`}
                    fill="none" stroke="rgba(168,85,247,0.5)" strokeWidth={1} strokeDasharray="3 2"
                  />
                </g>
              )}

              {/* Volume Bars */}
              {showVolume && candlesToRender.map((c, i) => {
                const maxVol = Math.max(...candlesToRender.map((cd) => cd.volume), 1);
                const vHeight = (c.volume / maxVol) * (mainPlotHeight * 0.18);
                const vY = PADDING_TOP + mainPlotHeight - vHeight;
                const isBull = c.close >= c.open;
                return (
                  <rect
                    key={`vol-${i}`}
                    x={getX(i) - candleWidth * 0.4}
                    y={vY}
                    width={Math.max(1, candleWidth * 0.8)}
                    height={vHeight}
                    fill={isBull ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)'}
                  />
                );
              })}

              {/* Candlesticks */}
              {chartType === 'candles' && candlesToRender.map((c, i) => {
                const x = getX(i);
                const openY = getY(c.open);
                const closeY = getY(c.close);
                const highY = getY(c.high);
                const lowY = getY(c.low);
                const isBull = c.close >= c.open;
                const fill = isBull ? chartSettings.bullishCandleColor : chartSettings.bearishCandleColor;
                const bodyY = Math.min(openY, closeY);
                const bodyH = Math.max(1, Math.abs(closeY - openY));
                const bw = Math.max(2, candleWidth);

                return (
                  <g key={`cand-${i}`}>
                    <line x1={x} y1={highY} x2={x} y2={lowY} stroke={fill} strokeWidth={1} />
                    <rect
                      x={x - bw / 2}
                      y={bodyY}
                      width={bw}
                      height={bodyH}
                      fill={fill}
                      rx={0.5}
                    />
                  </g>
                );
              })}

              {/* Bars Chart */}
              {chartType === 'bars' && candlesToRender.map((c, i) => {
                const x = getX(i);
                const isBull = c.close >= c.open;
                const color = isBull ? chartSettings.bullishCandleColor : chartSettings.bearishCandleColor;
                const arm = Math.max(2, candleWidth * 0.4);
                return (
                  <g key={`bar-${i}`}>
                    <line x1={x} y1={getY(c.high)} x2={x} y2={getY(c.low)} stroke={color} strokeWidth={1.5} />
                    <line x1={x - arm} y1={getY(c.open)} x2={x} y2={getY(c.open)} stroke={color} strokeWidth={1.5} />
                    <line x1={x} y1={getY(c.close)} x2={x + arm} y2={getY(c.close)} stroke={color} strokeWidth={1.5} />
                  </g>
                );
              })}

              {/* Line Chart */}
              {chartType === 'line' && linePoints && (
                <polyline fill="none" stroke="#38bdf8" strokeWidth={2} points={linePoints} />
              )}

              {/* MA 7 & MA 25 Overlays */}
              {showMa && ma7Points.length > 0 && (
                <polyline
                  fill="none" stroke="#f59e0b" strokeWidth={1.5}
                  points={ma7Points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                />
              )}
              {showMa && ma25Points.length > 0 && (
                <polyline
                  fill="none" stroke="#8b5cf6" strokeWidth={1.5}
                  points={ma25Points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                />
              )}

              {/* EMA 9 Overlay */}
              {showEma && ema9Points.length > 0 && (
                <polyline
                  fill="none" stroke="#06b6d4" strokeWidth={1.5}
                  points={ema9Points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                />
              )}

              {/* User Drawn Objects (Market Coordinate Anchoring) */}
              {drawnObjects.map((obj) => {
                if (obj.hidden) return null;
                const idx1 = getIndexAtTime(obj.time1);
                const idx2 = getIndexAtTime(obj.time2);
                const x1 = getX(idx1);
                const x2 = getX(idx2);
                const y1 = getY(obj.price1);
                const y2 = getY(obj.price2);

                if (obj.tool === 'hline') {
                  return (
                    <g key={obj.id}>
                      <line x1={0} y1={y1} x2={plotWidth} y2={y1} stroke={obj.color} strokeWidth={1.5} strokeDasharray="5 3" />
                      <rect x={plotWidth - 75} y={y1 - 8} width={75} height={16} fill={obj.color} rx={2} />
                      <text x={plotWidth - 37} y={y1 + 4} fill="#060d14" fontSize="9" fontWeight="bold" fontFamily="monospace" textAnchor="middle">
                        {formatDisplayPrice(obj.price1, symbol)}
                      </text>
                    </g>
                  );
                }

                if (obj.tool === 'vline') {
                  return (
                    <line key={obj.id} x1={x1} y1={PADDING_TOP} x2={x1} y2={PADDING_TOP + mainPlotHeight} stroke={obj.color} strokeWidth={1.5} strokeDasharray="5 3" />
                  );
                }

                if (obj.tool === 'rect') {
                  const rx = Math.min(x1, x2);
                  const ry = Math.min(y1, y2);
                  const rw = Math.max(4, Math.abs(x2 - x1));
                  const rh = Math.max(4, Math.abs(y2 - y1));
                  return (
                    <g key={obj.id}>
                      <rect x={rx} y={ry} width={rw} height={rh} fill="rgba(245,158,11,0.15)" stroke={obj.color} strokeWidth={1.5} rx={2} />
                      <rect x={rx + 2} y={ry + 2} width={36} height={14} fill="#060d14" rx={2} />
                      <text x={rx + 5} y={ry + 12} fill="#f59e0b" fontSize="8" fontWeight="bold">ZONE</text>
                    </g>
                  );
                }

                if (obj.tool === 'fibo') {
                  const fiboLevels = [
                    { level: 0, label: '0.0%', color: '#94a3b8' },
                    { level: 0.236, label: '23.6%', color: '#ef4444' },
                    { level: 0.382, label: '38.2%', color: '#f59e0b' },
                    { level: 0.5, label: '50.0%', color: '#10b981' },
                    { level: 0.618, label: '61.8% Golden', color: '#06b6d4' },
                    { level: 0.786, label: '78.6%', color: '#8b5cf6' },
                    { level: 1.0, label: '100.0%', color: '#94a3b8' },
                  ];
                  const yDiff = y2 - y1;
                  return (
                    <g key={obj.id}>
                      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(245,158,11,0.4)" strokeWidth={1} strokeDasharray="3 3" />
                      {fiboLevels.map((fib) => {
                        const levelY = y1 + yDiff * fib.level;
                        const lvlP = obj.price1 + (obj.price2 - obj.price1) * fib.level;
                        return (
                          <g key={`fib-${fib.level}`}>
                            <line x1={Math.min(x1, x2)} y1={levelY} x2={plotWidth} y2={levelY} stroke={fib.color} strokeWidth={1} opacity={0.8} />
                            <text x={Math.min(x1, x2) + 4} y={levelY - 3} fill={fib.color} fontSize="8" fontFamily="monospace" fontWeight="bold">
                              {fib.label} ({formatDisplayPrice(lvlP, symbol)})
                            </text>
                          </g>
                        );
                      })}
                    </g>
                  );
                }

                if (obj.tool === 'text') {
                  return (
                    <g key={obj.id}>
                      <rect x={x1 - 4} y={y1 - 14} width={Math.max(60, (obj.text?.length ?? 4) * 8)} height={18} fill="#0b1720" rx={3} stroke="#38bdf8" strokeWidth={1} />
                      <text x={x1} y={y1} fill="#ffffff" fontSize="10" fontWeight="bold">{obj.text || 'Note'}</text>
                    </g>
                  );
                }

                if (obj.tool === 'measure') {
                  const rx = Math.min(x1, x2);
                  const ry = Math.min(y1, y2);
                  const rw = Math.max(4, Math.abs(x2 - x1));
                  const rh = Math.max(4, Math.abs(y2 - y1));
                  const pDiff = Math.abs(obj.price2 - obj.price1);
                  return (
                    <g key={obj.id}>
                      <rect x={rx} y={ry} width={rw} height={rh} fill="rgba(6,182,212,0.15)" stroke="#06b6d4" strokeWidth={1.5} strokeDasharray="3 3" />
                      <text x={rx + 8} y={ry + 16} fill="#06b6d4" fontSize="9" fontWeight="bold" fontFamily="monospace">
                        ΔP: {formatDisplayPrice(pDiff, symbol)}
                      </text>
                    </g>
                  );
                }

                return (
                  <line key={obj.id} x1={x1} y1={y1} x2={x2} y2={y2} stroke={obj.color} strokeWidth={1.5} strokeLinecap="round" />
                );
              })}

              {/* Drawing preview line */}
              {isDrawing && drawStart && drawCurrent && activeTool !== 'cursor' && (
                <line
                  x1={drawStart.x} y1={drawStart.y}
                  x2={drawCurrent.x} y2={drawCurrent.y}
                  stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 2"
                />
              )}
            </g>

            {/* Price dashed line on right scale (Exness bright red) */}
            <line
              x1={0} y1={latestY}
              x2={plotWidth} y2={latestY}
              stroke="#f23645"
              strokeDasharray="4 3"
              strokeWidth={1}
            />

            {/* Price badge on right axis: solid Exness red rectangle with bold white monospace price */}
            <g transform={`translate(${plotWidth}, ${Math.max(PADDING_TOP, Math.min(latestY - 10, height - PADDING_BOTTOM - 20))})`}>
              <rect
                x={2} y={0} width={PADDING_RIGHT - 4} height={20}
                fill="#f23645"
                rx={2}
              />
              <text x={8} y={14} fill="#ffffff" fontSize="11" fontWeight="bold" fontFamily="monospace">
                {formatDisplayPrice(latestPrice, symbol)}
              </text>
            </g>

            {/* Crosshair guide lines & hover badge */}
            {hoverIndex != null && hoverIndex < candlesToRender.length && (
              <g>
                <line
                  x1={getX(hoverIndex)} y1={PADDING_TOP}
                  x2={getX(hoverIndex)} y2={PADDING_TOP + mainPlotHeight}
                  stroke="rgba(255,255,255,0.25)" strokeDasharray="3 3" strokeWidth={1}
                />
                <line
                  x1={0} y1={getY(candlesToRender[hoverIndex].close)}
                  x2={plotWidth} y2={getY(candlesToRender[hoverIndex].close)}
                  stroke="rgba(255,255,255,0.25)" strokeDasharray="3 3" strokeWidth={1}
                />
                <rect
                  x={plotWidth + 2}
                  y={getY(candlesToRender[hoverIndex].close) - 9}
                  width={PADDING_RIGHT - 2} height={18}
                  fill="#1e293b" rx={2} stroke="#475569" strokeWidth={1}
                />
                <text
                  x={plotWidth + 6}
                  y={getY(candlesToRender[hoverIndex].close) + 4}
                  fill="#94a3b8" fontSize="9" fontFamily="monospace"
                >
                  {formatDisplayPrice(candlesToRender[hoverIndex].close, symbol)}
                </text>
              </g>
            )}

            {/* ── SEPARATE OSCILLATOR SUB-PANES ── */}
            {/* 1. RSI Sub-Pane */}
            {showRsi && (
              <g transform={`translate(0, ${PADDING_TOP + mainPlotHeight + 5})`}>
                <line x1={0} y1={0} x2={plotWidth} y2={0} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
                <text x={10} y={15} fill="#06b6d4" fontSize="9" fontWeight="bold">RSI (14)</text>
                {/* 70/30 guide lines */}
                <line x1={0} y1={20} x2={plotWidth} y2={20} stroke="rgba(239,68,68,0.3)" strokeDasharray="2 2" />
                <line x1={0} y1={40} x2={plotWidth} y2={40} stroke="rgba(34,197,94,0.3)" strokeDasharray="2 2" />
                {rsiSeries.length > 1 && (
                  <polyline
                    fill="none" stroke="#06b6d4" strokeWidth={1.5}
                    points={rsiSeries.map((p) => `${p.x.toFixed(1)},${(p.y - (PADDING_TOP + mainPlotHeight + 5)).toFixed(1)}`).join(' ')}
                  />
                )}
              </g>
            )}

            {/* 2. MACD Sub-Pane */}
            {showMacd && (
              <g transform={`translate(0, ${PADDING_TOP + mainPlotHeight + (showRsi ? 65 : 5)})`}>
                <line x1={0} y1={0} x2={plotWidth} y2={0} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
                <text x={10} y={15} fill="#a855f7" fontSize="9" fontWeight="bold">MACD (12, 26, 9)</text>
                {macdSeries.histBars.map((b, idx) => (
                  <rect
                    key={`hist-${idx}`}
                    x={b.x - 2}
                    y={b.y - (PADDING_TOP + mainPlotHeight + (showRsi ? 65 : 5))}
                    width={4}
                    height={Math.max(1, b.h)}
                    fill={b.isBull ? '#22c55e' : '#ef4444'}
                  />
                ))}
              </g>
            )}
          </svg>
        </div>
      </div>

      {/* ── TECHNICAL INDICATORS MODAL ── */}
      {showIndicatorsModal && (
        <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-ink-900 border border-ink-700 rounded-xl shadow-2xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-ink-700">
              <span className="font-bold text-white text-sm flex items-center gap-2">
                <span className="italic font-serif text-amber-300 font-bold">fx</span>
                Technical Indicators
              </span>
              <button onClick={() => setShowIndicatorsModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <div className="p-3 border-b border-ink-700">
              <input
                type="text"
                placeholder="Search indicators (MA, Bollinger, RSI, MACD…)"
                value={indicatorSearch}
                onChange={(e) => setIndicatorSearch(e.target.value)}
                className="w-full h-8 bg-ink-950 border border-ink-700 rounded px-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
              />
            </div>
            <div className="p-3 overflow-y-auto space-y-2">
              {[
                { name: 'Moving Average (SMA 7 & 25)', active: showMa, toggle: () => setShowMa(!showMa), cat: 'Trend' },
                { name: 'Exponential Moving Average (EMA 9)', active: showEma, toggle: () => setShowEma(!showEma), cat: 'Trend' },
                { name: 'Bollinger Bands (BB 20, 2)', active: showBands, toggle: () => setShowBands(!showBands), cat: 'Volatility' },
                { name: 'Relative Strength Index (RSI 14)', active: showRsi, toggle: () => setShowRsi(!showRsi), cat: 'Momentum' },
                { name: 'MACD (12, 26, 9)', active: showMacd, toggle: () => setShowMacd(!showMacd), cat: 'Momentum' },
                { name: 'Volume Histogram', active: showVolume, toggle: () => setShowVolume(!showVolume), cat: 'Volume' },
              ].filter((ind) => ind.name.toLowerCase().includes(indicatorSearch.toLowerCase())).map((item) => (
                <div key={item.name} className="flex items-center justify-between p-2 rounded-lg bg-ink-950 border border-ink-800">
                  <div>
                    <div className="font-semibold text-white text-xs">{item.name}</div>
                    <div className="text-[10px] text-slate-500">{item.cat}</div>
                  </div>
                  <button
                    onClick={item.toggle}
                    className={`px-3 py-1 rounded text-xs font-bold transition ${
                      item.active ? 'bg-amber-400 text-ink-950' : 'bg-ink-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {item.active ? 'Active' : '+ Add'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── OBJECTS MANAGER MODAL ── */}
      {showObjectManager && (
        <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-ink-900 border border-ink-700 rounded-xl shadow-2xl flex flex-col max-h-[70vh]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-ink-700">
              <span className="font-bold text-white text-xs">Objects Tree ({drawnObjects.length})</span>
              <button onClick={() => setShowObjectManager(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <div className="p-3 overflow-y-auto space-y-2 flex-1">
              {drawnObjects.length === 0 ? (
                <div className="text-center text-xs text-slate-500 py-6">No active drawing objects on chart.</div>
              ) : (
                drawnObjects.map((obj, i) => (
                  <div key={obj.id} className="flex items-center justify-between p-2 rounded bg-ink-950 border border-ink-800 text-xs">
                    <span className="text-slate-200 capitalize font-medium">{obj.tool} #{i + 1}</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const updated = drawnObjects.map((o) => (o.id === obj.id ? { ...o, hidden: !o.hidden } : o));
                          setDrawnObjects(updated);
                          localStorage.setItem(`tr_drawings_v2_${symbol}`, JSON.stringify(updated));
                        }}
                        className="text-slate-400 hover:text-white"
                      >
                        {obj.hidden ? '👁️‍🗨️' : '👁️'}
                      </button>
                      <button
                        onClick={() => {
                          const updated = drawnObjects.filter((o) => o.id !== obj.id);
                          setDrawnObjects(updated);
                          localStorage.setItem(`tr_drawings_v2_${symbol}`, JSON.stringify(updated));
                        }}
                        className="text-rose-400 hover:text-rose-300"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 10-CATEGORY CHART SETTINGS MODAL ── */}
      <ChartSettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        settings={chartSettings}
        onSave={handleSaveSettings}
      />
    </div>
  );
}

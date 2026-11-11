'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import type { TradingCandle } from '@/lib/api/trading';
import { formatPrice } from '@/lib/api/trading';

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
}

interface DrawnLine {
  id: string;
  x1: number; y1: number;
  x2: number; y2: number;
  tool: string;
  color: string;
  text?: string;
  hidden?: boolean;
}

export function ChartTerminal({
  symbol,
  instrumentName = 'Bitcoin vs US Dollar',
  currentPrice,
  candles: initialCandles,
  timeframe,
  onTimeframeChange,
  onTickPrice,
  showSignals = false,
}: ChartTerminalProps) {
  const [chartType, setChartType] = useState<'candles' | 'line' | 'bars'>('candles');
  const [showMa, setShowMa] = useState(true);
  const [showEma, setShowEma] = useState(false);
  const [showBands, setShowBands] = useState(false);
  const [showMacd, setShowMacd] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [candles, setCandles] = useState<TradingCandle[]>(initialCandles);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [activeTool, setActiveTool] = useState<'cursor' | 'trend' | 'fibo' | 'rect' | 'brush' | 'text' | 'measure' | 'hline' | 'vline'>('cursor');
  const [showIndicatorsModal, setShowIndicatorsModal] = useState(false);
  const [showObjectManager, setShowObjectManager] = useState(false);
  const [indicatorSearch, setIndicatorSearch] = useState('');

  // Drawing state
  const [drawnLines, setDrawnLines] = useState<DrawnLine[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);

  // Scroll/zoom state
  const [scrollOffset, setScrollOffset] = useState(0); // how many candles to shift from right
  const [candleScale, setCandleScale] = useState(1.0); // zoom multiplier

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 420 });

  useEffect(() => {
    setCandles(initialCandles);
    setScrollOffset(0);
  }, [initialCandles]);

  // Resize observer
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

  const onTickPriceRef = useRef(onTickPrice);
  useEffect(() => {
    onTickPriceRef.current = onTickPrice;
  }, [onTickPrice]);

  // Live tick engine - generates new candle data each interval
  useEffect(() => {
    let tickedPrice: number | null = null;
    const interval = setInterval(() => {
      setCandles((prev) => {
        if (!prev || prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        // Realistic volatility based on price magnitude
        const volatility = last.close * 0.0008;
        const delta = (Math.random() - 0.49) * volatility;
        const newClose = Math.max(0.0001, +(last.close + delta).toFixed(5));
        const newHigh = Math.max(last.high, newClose);
        const newLow = Math.min(last.low, newClose);
        tickedPrice = newClose;
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...last,
          close: newClose,
          high: newHigh,
          low: newLow,
          volume: last.volume + Math.floor(Math.random() * 8),
        };
        return updated;
      });
      if (tickedPrice !== null) onTickPriceRef.current?.(tickedPrice);
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  const { width, height } = dimensions;
  const PADDING_RIGHT = 75;
  const PADDING_BOTTOM = 28;
  const PADDING_TOP = 8;
  const plotWidth = Math.max(100, width - PADDING_RIGHT);
  const plotHeight = Math.max(80, height - PADDING_BOTTOM - PADDING_TOP);

  // Visible candles based on zoom + scroll
  const { minPrice, priceSpan, candleWidth, candlesToRender } = useMemo(() => {
    if (!candles || candles.length === 0) {
      return { minPrice: 100, priceSpan: 100, candleWidth: 8, candlesToRender: [] };
    }
    const baseCount = Math.floor(plotWidth / 10);
    const visibleCount = Math.max(10, Math.min(candles.length, Math.round(baseCount / candleScale)));
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
    const paddedMin = Math.max(0.0001, min - span * 0.06);
    const paddedMax = max + span * 0.06;
    const finalSpan = paddedMax - paddedMin || 1;
    const cWidth = Math.max(3, plotWidth / slice.length);

    return { minPrice: paddedMin, priceSpan: finalSpan, candleWidth: cWidth, candlesToRender: slice };
  }, [candles, plotWidth, scrollOffset, candleScale]);

  const getY = useCallback((price: number) =>
    PADDING_TOP + plotHeight - ((price - minPrice) / priceSpan) * plotHeight,
    [minPrice, priceSpan, plotHeight]);

  const getX = useCallback((index: number) =>
    index * candleWidth + candleWidth / 2,
    [candleWidth]);

  const getPriceAtY = useCallback((y: number) =>
    minPrice + ((PADDING_TOP + plotHeight - y) / plotHeight) * priceSpan,
    [minPrice, priceSpan, plotHeight]);

  // MA lines
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

  // Time axis labels
  const timeLabels = useMemo(() => {
    if (candlesToRender.length === 0) return [];
    const step = Math.max(1, Math.floor(candlesToRender.length / 6));
    const labels: { x: number; label: string }[] = [];
    for (let i = 0; i < candlesToRender.length; i += step) {
      const c = candlesToRender[i];
      const t = typeof c.time === 'number' ? new Date(c.time * 1000) : new Date(c.time);
      const label = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      labels.push({ x: getX(i), label });
    }
    return labels;
  }, [candlesToRender, getX]);

  // Active candle for OHLC bar
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

  // Wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+scroll = zoom
      setCandleScale((prev) => Math.max(0.3, Math.min(5, prev + (e.deltaY > 0 ? -0.1 : 0.1))));
    } else {
      // Scroll = pan
      setScrollOffset((prev) => Math.max(0, Math.min(candles.length - 10, prev + (e.deltaY > 0 ? -3 : 3))));
    }
  }, [candles.length]);

  // Drawing mouse events
  const getSvgCoords = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const coords = getSvgCoords(e);
    if (activeTool !== 'cursor') {
      setIsDrawing(true);
      setDrawStart(coords);
      setDrawCurrent(coords);
      e.preventDefault();
    }
    // hover tracking
    if (candleWidth > 0) {
      const idx = Math.floor(coords.x / candleWidth);
      if (idx >= 0 && idx < candlesToRender.length) setHoverIndex(idx);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const coords = getSvgCoords(e);
    if (isDrawing && drawStart) {
      setDrawCurrent(coords);
    }
    if (candleWidth > 0) {
      const idx = Math.floor(coords.x / candleWidth);
      if (idx >= 0 && idx < candlesToRender.length) setHoverIndex(idx);
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (isDrawing && drawStart && drawCurrent && activeTool !== 'cursor') {
      const toolColors: Record<string, string> = {
        trend: '#f59e0b',
        hline: '#3b82f6',
        vline: '#8b5cf6',
        fibo: '#10b981',
        rect: '#f59e0b',
        measure: '#06b6d4',
        brush: '#f97316',
        text: '#ffffff',
      };
      const newLine: DrawnLine = {
        id: `line-${Date.now()}`,
        x1: drawStart.x, y1: drawStart.y,
        x2: drawCurrent.x, y2: drawCurrent.y,
        tool: activeTool,
        color: toolColors[activeTool] ?? '#f59e0b',
      };
      setDrawnLines((prev) => [...prev, newLine]);
    }
    setIsDrawing(false);
    setDrawStart(null);
    setDrawCurrent(null);
  };

  const indicatorsList = [
    { id: 'ma', name: 'Moving Average (SMA 7 & 25)', cat: 'Trend', active: showMa, toggle: () => setShowMa(!showMa) },
    { id: 'ema', name: 'Exponential Moving Average (EMA 9)', cat: 'Trend', active: showEma, toggle: () => setShowEma(!showEma) },
    { id: 'bb', name: 'Bollinger Bands (BB 20, 2)', cat: 'Volatility', active: showBands, toggle: () => setShowBands(!showBands) },
    { id: 'macd', name: 'MACD (12, 26, 9)', cat: 'Momentum', active: showMacd, toggle: () => setShowMacd(!showMacd) },
    { id: 'vol', name: 'Volume Bars', cat: 'Volume', active: showVolume, toggle: () => setShowVolume(!showVolume) },
  ];
  const filteredIndicators = indicatorsList.filter((ind) =>
    ind.name.toLowerCase().includes(indicatorSearch.toLowerCase()) ||
    ind.cat.toLowerCase().includes(indicatorSearch.toLowerCase())
  );

  const toolCursor = activeTool === 'cursor' ? 'cursor-crosshair' : 'cursor-crosshair';

  // Line chart polyline
  const linePoints = useMemo(() =>
    candlesToRender.map((c, i) => `${getX(i).toFixed(1)},${getY(c.close).toFixed(1)}`).join(' '),
    [candlesToRender, getX, getY]);

  return (
    <div className="flex h-full w-full flex-col bg-ink-950 overflow-hidden relative">

      {/* ── TOP BAR: Instrument name + timeframes + chart type buttons ── */}
      <div className="flex flex-wrap items-center justify-between border-b border-ink-700 bg-ink-900 px-2 py-1.5 text-xs gap-y-1 gap-x-2 shrink-0">

        {/* Left group: name + timeframes + indicators */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Instrument name */}
          <div className="flex items-center gap-1 font-bold text-white text-xs whitespace-nowrap">
            <span className="text-amber-400">⚡</span>
            <span className="max-w-[100px] truncate">{instrumentName}</span>
            <span className="text-slate-500 font-normal text-[10px]">· {timeframe}</span>
          </div>

          <div className="w-px h-3 bg-ink-700" />

          {/* Timeframe buttons */}
          <div className="flex items-center gap-0.5">
            {['1m', '3m', '10m', '15m', '1h', '1d'].map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => onTimeframeChange(tf)}
                className={`rounded px-1.5 py-0.5 font-semibold text-[10px] transition ${
                  timeframe === tf
                    ? 'bg-amber-400 text-ink-950 font-black'
                    : 'text-slate-400 hover:bg-ink-800 hover:text-white'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* fx Indicators */}
          <button
            type="button"
            onClick={() => setShowIndicatorsModal(!showIndicatorsModal)}
            className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold border transition ${
              showIndicatorsModal
                ? 'bg-amber-400/20 border-amber-400 text-amber-300'
                : 'text-slate-300 hover:text-white bg-ink-800 border-ink-700'
            }`}
          >
            <span className="italic font-serif text-amber-300">fx</span>
            <span>Indicators</span>
          </button>
        </div>

        {/* Right group: chart type + MA/BB/Vol toggles */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Chart type */}
          <div className="flex rounded bg-ink-800 p-0.5 border border-ink-700 text-[10px]">
            {(['candles', 'line', 'bars'] as const).map((ct) => (
              <button
                key={ct}
                type="button"
                onClick={() => setChartType(ct)}
                className={`rounded px-1.5 py-0.5 capitalize transition ${
                  chartType === ct ? 'bg-amber-400 text-ink-950 font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                {ct}
              </button>
            ))}
          </div>

          {/* Quick toggles */}
          {[
            { label: 'MA', active: showMa, toggle: () => setShowMa(!showMa), color: 'indigo' },
            { label: 'BB', active: showBands, toggle: () => setShowBands(!showBands), color: 'purple' },
            { label: 'Vol', active: showVolume, toggle: () => setShowVolume(!showVolume), color: 'emerald' },
          ].map((btn) => (
            <button
              key={btn.label}
              type="button"
              onClick={btn.toggle}
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold border transition ${
                btn.active
                  ? `border-${btn.color}-400/50 bg-${btn.color}-500/20 text-${btn.color}-300`
                  : 'border-ink-700 text-slate-400 hover:text-white'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── OHLC INFO BAR (below top bar, Exness style) ── */}
      {activeCandle && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-ink-800 bg-[#0d1117] px-3 py-1 text-[10px] font-mono text-slate-400 shrink-0">
          <span className="font-bold text-white text-[11px]">{symbol}</span>
          <span>O <span className="text-slate-200">{formatPrice(activeCandle.open, symbol)}</span></span>
          <span>H <span className="text-slate-200">{formatPrice(activeCandle.high, symbol)}</span></span>
          <span>L <span className="text-slate-200">{formatPrice(activeCandle.low, symbol)}</span></span>
          <span>C <span className={activeIsBull ? 'text-blue-400' : 'text-rose-400'}>{formatPrice(activeCandle.close, symbol)}</span></span>
          <span className={activeIsBull ? 'text-blue-400' : 'text-rose-400'}>
            {activeChangeDiff >= 0 ? '+' : ''}{formatPrice(Math.abs(activeChangeDiff), symbol)} ({activeChangeDiff >= 0 ? '+' : ''}{activeChangePct}%)
          </span>
          {showVolume && <span className="text-slate-500">Vol: {activeCandle.volume.toLocaleString()}</span>}
          {showSignals && (
            <span className={`rounded px-1.5 py-0.5 text-[9px] font-black ${activeIsBull ? 'bg-brand/20 text-brand border border-brand/30' : 'bg-rose-500/20 text-rose-400 border border-rose-400/30'}`}>
              SIGNAL: {activeIsBull ? 'BUY' : 'SELL'}
            </span>
          )}
        </div>
      )}

      {/* ── MAIN CHART BODY ── */}
      <div className="relative flex flex-1 w-full overflow-hidden min-h-0">

        {/* Left Drawing Tools Rail */}
        <div className="w-9 border-r border-ink-800 bg-ink-900 flex flex-col items-center py-1.5 gap-1 select-none shrink-0">
          {[
            { id: 'cursor', svg: <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 3l14 9-7 1-4 7z"/></svg>, label: 'Cursor' },
            { id: 'trend', svg: <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="20" x2="20" y2="4"/><circle cx="4" cy="20" r="2"/><circle cx="20" cy="4" r="2"/></svg>, label: 'Trend Line' },
            { id: 'hline', svg: <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2"><line x1="2" y1="12" x2="22" y2="12"/></svg>, label: 'Horizontal Line' },
            { id: 'vline', svg: <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="2" x2="12" y2="22"/></svg>, label: 'Vertical Line' },
            { id: 'fibo', svg: <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="2" y1="6" x2="22" y2="6"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="18" x2="22" y2="18"/></svg>, label: 'Fibonacci' },
            { id: 'rect', svg: <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>, label: 'Rectangle (Zone)' },
            { id: 'brush', svg: <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3l4 4-10 10H7v-4L17 3z"/></svg>, label: 'Draw' },
            { id: 'measure', svg: <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12h20M2 12l4-4M2 12l4 4M22 12l-4-4M22 12l-4 4"/></svg>, label: 'Measure' },
            { id: 'text', svg: <span className="text-[11px] font-bold">T</span>, label: 'Text' },
          ].map((tool) => (
            <button
              key={tool.id}
              type="button"
              onClick={() => setActiveTool(tool.id as typeof activeTool)}
              className={`h-7 w-7 rounded flex items-center justify-center transition ${
                activeTool === tool.id
                  ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40'
                  : 'text-slate-400 hover:text-white hover:bg-ink-800'
              }`}
              title={tool.label}
            >
              {tool.svg}
            </button>
          ))}
          <div className="flex-1" />
          {/* Object Manager toggle */}
          <button
            type="button"
            onClick={() => setShowObjectManager((prev) => !prev)}
            className={`h-7 w-7 rounded flex items-center justify-center transition ${
              showObjectManager || drawnLines.length > 0 ? 'text-amber-400 hover:bg-ink-800' : 'text-slate-500 hover:text-white'
            }`}
            title={`Objects Manager (${drawnLines.length})`}
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="12 2 2 7 12 12 22 7 12 2"/>
              <polyline points="2 17 12 22 22 17"/>
              <polyline points="2 12 12 17 22 12"/>
            </svg>
          </button>
          {/* Clear drawings */}
          <button
            type="button"
            onClick={() => { setDrawnLines([]); setActiveTool('cursor'); }}
            className="h-7 w-7 rounded flex items-center justify-center text-slate-500 hover:text-rose-400 transition"
            title="Clear all drawings"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>
            </svg>
          </button>
          {/* Zoom in */}
          <button
            type="button"
            onClick={() => setCandleScale((p) => Math.min(5, p + 0.3))}
            className="h-7 w-7 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-ink-800 transition text-sm font-bold"
            title="Zoom In"
          >+</button>
          {/* Zoom out */}
          <button
            type="button"
            onClick={() => setCandleScale((p) => Math.max(0.3, p - 0.3))}
            className="h-7 w-7 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-ink-800 transition text-sm font-bold"
            title="Zoom Out"
          >−</button>
        </div>

        {/* SVG Chart Area */}
        <div
          ref={containerRef}
          className={`relative flex-1 h-full overflow-hidden ${toolCursor}`}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => { setHoverIndex(null); if (isDrawing) handleMouseUp({} as React.MouseEvent); }}
        >
          <svg
            ref={svgRef}
            width={width}
            height={height}
            className="block"
            style={{ userSelect: 'none' }}
          >
            <defs>
              <clipPath id="chartClip">
                <rect x={0} y={PADDING_TOP} width={plotWidth} height={plotHeight} />
              </clipPath>
              <linearGradient id="bullGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.15"/>
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0"/>
              </linearGradient>
            </defs>

            {/* Background */}
            <rect x={0} y={0} width={width} height={height} fill="#060d14" />

            {/* Grid horizontal lines */}
            {gridLines.map((line, idx) => (
              <g key={idx}>
                <line
                  x1={0} y1={line.y}
                  x2={plotWidth} y2={line.y}
                  stroke="rgba(255,255,255,0.04)"
                  strokeWidth={1}
                />
                <text
                  x={plotWidth + 4}
                  y={line.y + 3}
                  fill="#4b5563"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {formatPrice(line.price, symbol)}
                </text>
              </g>
            ))}

            {/* Time labels at bottom */}
            {timeLabels.map((lbl, idx) => (
              <text
                key={idx}
                x={lbl.x}
                y={height - 6}
                fill="#374151"
                fontSize="8"
                fontFamily="monospace"
                textAnchor="middle"
              >
                {lbl.label}
              </text>
            ))}

            {/* Clip group for chart content */}
            <g clipPath="url(#chartClip)">

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

              {/* Volume bars at bottom of chart */}
              {showVolume && candlesToRender.map((c, i) => {
                const maxVol = Math.max(...candlesToRender.map((cd) => cd.volume), 1);
                const vHeight = (c.volume / maxVol) * (plotHeight * 0.18);
                const vY = PADDING_TOP + plotHeight - vHeight;
                const isBull = c.close >= c.open;
                return (
                  <rect
                    key={`vol-${i}`}
                    x={getX(i) - candleWidth * 0.4}
                    y={vY}
                    width={Math.max(1, candleWidth * 0.8)}
                    height={vHeight}
                    fill={isBull ? 'rgba(59,130,246,0.18)' : 'rgba(239,68,68,0.18)'}
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
                // Green up, Red down – matching TradingView style
                const fill = isBull ? '#26a69a' : '#ef5350';
                const stroke = isBull ? '#26a69a' : '#ef5350';
                const bodyY = Math.min(openY, closeY);
                const bodyH = Math.max(1, Math.abs(closeY - openY));
                const bw = Math.max(2, candleWidth * 0.72);
                return (
                  <g key={`c-${i}`}>
                    {/* Wick */}
                    <line x1={x} y1={highY} x2={x} y2={lowY} stroke={stroke} strokeWidth={1} />
                    {/* Body */}
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

              {/* Bars chart */}
              {chartType === 'bars' && candlesToRender.map((c, i) => {
                const x = getX(i);
                const isBull = c.close >= c.open;
                const color = isBull ? '#26a69a' : '#ef5350';
                const arm = Math.max(2, candleWidth * 0.3);
                return (
                  <g key={`bar-${i}`}>
                    <line x1={x} y1={getY(c.high)} x2={x} y2={getY(c.low)} stroke={color} strokeWidth={1.5} />
                    <line x1={x - arm} y1={getY(c.open)} x2={x} y2={getY(c.open)} stroke={color} strokeWidth={1.5} />
                    <line x1={x} y1={getY(c.close)} x2={x + arm} y2={getY(c.close)} stroke={color} strokeWidth={1.5} />
                  </g>
                );
              })}

              {/* Line chart */}
              {chartType === 'line' && linePoints && (
                <>
                  <polyline fill="none" stroke="#3b82f6" strokeWidth={2} points={linePoints} />
                </>
              )}

              {/* MA 7 */}
              {showMa && ma7Points.length > 0 && (
                <polyline
                  fill="none" stroke="#f59e0b" strokeWidth={1.5}
                  points={ma7Points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                />
              )}

              {/* MA 25 */}
              {showMa && ma25Points.length > 0 && (
                <polyline
                  fill="none" stroke="#8b5cf6" strokeWidth={1.5}
                  points={ma25Points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                />
              )}

              {/* EMA 9 */}
              {showEma && ema9Points.length > 0 && (
                <polyline
                  fill="none" stroke="#06b6d4" strokeWidth={1.5}
                  points={ema9Points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                />
              )}

              {/* User-drawn lines and objects */}
              {drawnLines.map((line) => {
                if (line.hidden) return null;

                if (line.tool === 'hline') {
                  return (
                    <g key={line.id}>
                      <line
                        x1={0} y1={line.y1} x2={plotWidth} y2={line.y1}
                        stroke={line.color} strokeWidth={1.5} strokeDasharray="6 3"
                      />
                      <rect x={plotWidth - 45} y={line.y1 - 8} width={45} height={16} fill={line.color} rx={2} />
                      <text x={plotWidth - 23} y={line.y1 + 4} fill="#06131a" fontSize="9" fontWeight="bold" textAnchor="middle">
                        HL
                      </text>
                    </g>
                  );
                }

                if (line.tool === 'vline') {
                  return (
                    <line key={line.id}
                      x1={line.x1} y1={PADDING_TOP} x2={line.x1} y2={PADDING_TOP + plotHeight}
                      stroke={line.color} strokeWidth={1.5} strokeDasharray="6 3"
                    />
                  );
                }

                if (line.tool === 'rect') {
                  const rx = Math.min(line.x1, line.x2);
                  const ry = Math.min(line.y1, line.y2);
                  const rw = Math.max(4, Math.abs(line.x2 - line.x1));
                  const rh = Math.max(4, Math.abs(line.y2 - line.y1));
                  return (
                    <g key={line.id}>
                      <rect
                        x={rx} y={ry} width={rw} height={rh}
                        fill="rgba(245,158,11,0.12)" stroke={line.color} strokeWidth={1.5} rx={2}
                      />
                      <text x={rx + 4} y={ry + 12} fill="#f59e0b" fontSize="9" fontWeight="bold">
                        Zone
                      </text>
                    </g>
                  );
                }

                if (line.tool === 'fibo') {
                  const fiboLevels = [
                    { level: 0, label: '0.0%', color: '#94a3b8' },
                    { level: 0.236, label: '23.6%', color: '#ef4444' },
                    { level: 0.382, label: '38.2%', color: '#f59e0b' },
                    { level: 0.5, label: '50.0%', color: '#10b981' },
                    { level: 0.618, label: '61.8% (Golden)', color: '#06b6d4' },
                    { level: 0.786, label: '78.6%', color: '#8b5cf6' },
                    { level: 1.0, label: '100.0%', color: '#94a3b8' },
                  ];
                  const xStart = Math.min(line.x1, line.x2);
                  const xEnd = Math.max(line.x1, line.x2, plotWidth - 10);
                  const yDiff = line.y2 - line.y1;
                  return (
                    <g key={line.id}>
                      {/* Trend connecting line */}
                      <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="rgba(245,158,11,0.4)" strokeWidth={1} strokeDasharray="3 3" />
                      {/* Fibo level lines */}
                      {fiboLevels.map((fib) => {
                        const levelY = line.y1 + yDiff * fib.level;
                        return (
                          <g key={`fib-${fib.level}`}>
                            <line x1={xStart} y1={levelY} x2={xEnd} y2={levelY} stroke={fib.color} strokeWidth={1} opacity={0.8} />
                            <text x={xStart + 4} y={levelY - 3} fill={fib.color} fontSize="8" fontFamily="monospace" fontWeight="bold">
                              {fib.label}
                            </text>
                          </g>
                        );
                      })}
                    </g>
                  );
                }

                if (line.tool === 'measure') {
                  const rx = Math.min(line.x1, line.x2);
                  const ry = Math.min(line.y1, line.y2);
                  const rw = Math.max(4, Math.abs(line.x2 - line.x1));
                  const rh = Math.max(4, Math.abs(line.y2 - line.y1));
                  return (
                    <g key={line.id}>
                      <rect
                        x={rx} y={ry} width={rw} height={rh}
                        fill="rgba(6,182,212,0.15)" stroke="#06b6d4" strokeWidth={1.5} strokeDasharray="3 3"
                      />
                      <rect x={rx + 4} y={ry + 4} width={80} height={20} fill="#06131a" rx={2} stroke="#06b6d4" strokeWidth={0.8} />
                      <text x={rx + 8} y={ry + 18} fill="#06b6d4" fontSize="9" fontWeight="bold" fontFamily="monospace">
                        ΔW:{rw.toFixed(0)}px | ΔH:{rh.toFixed(0)}px
                      </text>
                    </g>
                  );
                }

                if (line.tool === 'text') {
                  return (
                    <g key={line.id}>
                      <rect x={line.x1 - 4} y={line.y1 - 12} width={60} height={16} fill="#0f2632" rx={2} stroke="#14b8a6" strokeWidth={1} />
                      <text x={line.x1} y={line.y1} fill="#ffffff" fontSize="10" fontWeight="bold">
                        {line.text || 'Note / TP'}
                      </text>
                    </g>
                  );
                }

                return (
                  <line key={line.id}
                    x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
                    stroke={line.color} strokeWidth={1.5} strokeLinecap="round"
                  />
                );
              })}

              {/* Drawing preview line (while dragging) */}
              {isDrawing && drawStart && drawCurrent && activeTool !== 'cursor' && (
                <>
                  {activeTool === 'rect' ? (
                    <rect
                      x={Math.min(drawStart.x, drawCurrent.x)}
                      y={Math.min(drawStart.y, drawCurrent.y)}
                      width={Math.abs(drawCurrent.x - drawStart.x)}
                      height={Math.abs(drawCurrent.y - drawStart.y)}
                      fill="rgba(245,158,11,0.1)" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 2"
                    />
                  ) : activeTool === 'fibo' ? (
                    <g>
                      <line
                        x1={drawStart.x} y1={drawStart.y} x2={drawCurrent.x} y2={drawCurrent.y}
                        stroke="#f59e0b" strokeWidth={1} strokeDasharray="4 2"
                      />
                      <line x1={0} y1={drawStart.y} x2={plotWidth} y2={drawStart.y} stroke="#94a3b8" strokeWidth={1} opacity={0.6} />
                      <line x1={0} y1={drawCurrent.y} x2={plotWidth} y2={drawCurrent.y} stroke="#06b6d4" strokeWidth={1} opacity={0.6} />
                    </g>
                  ) : (
                    <line
                      x1={drawStart.x} y1={drawStart.y}
                      x2={drawCurrent.x} y2={drawCurrent.y}
                      stroke="#f59e0b" strokeWidth={1.5}
                      strokeDasharray="4 2" opacity={0.8}
                    />
                  )}
                </>
              )}

            </g>{/* end clipPath group */}

            {/* Price dashed line (outside clip so label shows) */}
            <line
              x1={0} y1={latestY}
              x2={plotWidth} y2={latestY}
              stroke={latestPrice >= (candlesToRender[0]?.open ?? 0) ? '#26a69a' : '#ef5350'}
              strokeDasharray="4 3"
              strokeWidth={1}
            />

            {/* Price badge on right axis */}
            <g transform={`translate(${plotWidth}, ${Math.max(PADDING_TOP, Math.min(latestY - 9, height - PADDING_BOTTOM - 18))})`}>
              <rect
                x={2} y={0} width={PADDING_RIGHT - 2} height={18}
                fill={latestPrice >= (candlesToRender[0]?.open ?? 0) ? '#26a69a' : '#ef5350'}
                rx={3}
              />
              <text x={6} y={13} fill="#ffffff" fontSize="10" fontWeight="bold" fontFamily="monospace">
                {formatPrice(latestPrice, symbol)}
              </text>
            </g>

            {/* Hover crosshair */}
            {hoverIndex != null && hoverIndex < candlesToRender.length && (
              <g>
                <line
                  x1={getX(hoverIndex)} y1={PADDING_TOP}
                  x2={getX(hoverIndex)} y2={PADDING_TOP + plotHeight}
                  stroke="rgba(255,255,255,0.2)" strokeDasharray="3 3" strokeWidth={1}
                />
                <line
                  x1={0} y1={getY(candlesToRender[hoverIndex].close)}
                  x2={plotWidth} y2={getY(candlesToRender[hoverIndex].close)}
                  stroke="rgba(255,255,255,0.2)" strokeDasharray="3 3" strokeWidth={1}
                />
                {/* Price tooltip on crosshair */}
                <rect
                  x={plotWidth + 2}
                  y={getY(candlesToRender[hoverIndex].close) - 9}
                  width={PADDING_RIGHT - 2} height={18}
                  fill="#1e222d" rx={2} stroke="#374151" strokeWidth={1}
                />
                <text
                  x={plotWidth + 6}
                  y={getY(candlesToRender[hoverIndex].close) + 4}
                  fill="#94a3b8" fontSize="9" fontFamily="monospace"
                >
                  {formatPrice(candlesToRender[hoverIndex].close, symbol)}
                </text>
              </g>
            )}
          </svg>
        </div>
      </div>

      {/* ── INDICATORS MODAL ── */}
      {showIndicatorsModal && (
        <div className="absolute inset-0 bg-ink-950/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-ink-900 border border-ink-700 rounded-xl shadow-2xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-ink-700">
              <div className="flex items-center gap-2">
                <span className="italic font-serif text-amber-300 font-bold">fx</span>
                <h3 className="font-bold text-white text-sm">Technical Indicators</h3>
              </div>
              <button type="button" onClick={() => setShowIndicatorsModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <div className="p-3 border-b border-ink-700">
              <input
                type="text"
                placeholder="Search indicators (RSI, MACD, MA…)"
                value={indicatorSearch}
                onChange={(e) => setIndicatorSearch(e.target.value)}
                className="w-full h-8 bg-ink-950 border border-ink-700 rounded px-3 text-xs text-white placeholder-slate-500 outline-none focus:border-amber-400"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {filteredIndicators.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-2.5 rounded-lg bg-ink-950/60 border border-ink-800">
                  <div>
                    <div className="text-xs font-bold text-white">{item.name}</div>
                    <div className="text-[10px] text-slate-400">{item.cat}</div>
                  </div>
                  <button
                    type="button"
                    onClick={item.toggle}
                    className={`px-2.5 py-1 rounded text-xs font-bold transition ${
                      item.active ? 'bg-amber-400 text-ink-950' : 'bg-ink-800 text-slate-300 hover:text-white border border-ink-700'
                    }`}
                  >
                    {item.active ? '✓ Active' : '+ Add'}
                  </button>
                </div>
              ))}
            </div>
            <div className="px-4 py-2 border-t border-ink-700 flex justify-end">
              <button type="button" onClick={() => setShowIndicatorsModal(false)} className="px-3 py-1 bg-amber-400 text-ink-950 font-bold rounded text-xs">
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── OBJECT MANAGER MODAL ── */}
      {showObjectManager && (
        <div className="absolute top-12 left-12 w-80 bg-ink-900 border border-ink-700 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-ink-700 bg-ink-950">
            <div className="flex items-center gap-1.5">
              <span className="text-amber-400 text-xs">◆</span>
              <span className="text-xs font-bold text-white">Objects Manager ({drawnLines.length})</span>
            </div>
            <button
              type="button"
              onClick={() => setShowObjectManager(false)}
              className="text-slate-400 hover:text-white text-xs"
            >
              ✕
            </button>
          </div>
          <div className="p-2 max-h-64 overflow-y-auto space-y-1">
            {drawnLines.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                No drawing objects on chart.<br />
                Use left toolbar to draw.
              </div>
            ) : (
              drawnLines.map((obj, i) => (
                <div
                  key={obj.id}
                  className="flex items-center justify-between px-2 py-1.5 rounded bg-ink-800/60 border border-ink-700 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: obj.color }} />
                    <span className="font-semibold text-slate-200 capitalize">{obj.tool} #{i + 1}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setDrawnLines((prev) =>
                          prev.map((item) => (item.id === obj.id ? { ...item, hidden: !item.hidden } : item))
                        );
                      }}
                      className="px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-white"
                      title={obj.hidden ? 'Show' : 'Hide'}
                    >
                      {obj.hidden ? '👁' : '—'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDrawnLines((prev) => prev.filter((item) => item.id !== obj.id));
                      }}
                      className="px-1.5 py-0.5 text-[10px] text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded"
                      title="Delete"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          {drawnLines.length > 0 && (
            <div className="p-2 border-t border-ink-700 bg-ink-950 flex justify-between items-center text-xs">
              <button
                type="button"
                onClick={() => setDrawnLines([])}
                className="text-rose-400 hover:underline text-[11px]"
              >
                Delete All
              </button>
              <button
                type="button"
                onClick={() => setShowObjectManager(false)}
                className="px-2.5 py-1 bg-ink-800 hover:bg-ink-700 text-slate-200 rounded text-[11px]"
              >
                Close
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

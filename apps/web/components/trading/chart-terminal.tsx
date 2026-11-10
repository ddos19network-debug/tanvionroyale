'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
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
}

export function ChartTerminal({
  symbol,
  instrumentName = 'Bitcoin vs US Dollar',
  currentPrice,
  candles: initialCandles,
  timeframe,
  onTimeframeChange,
  onTickPrice,
}: ChartTerminalProps) {
  const [chartType, setChartType] = useState<'candles' | 'line'>('candles');
  const [showMa, setShowMa] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [candles, setCandles] = useState<TradingCandle[]>(initialCandles);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [activeTool, setActiveTool] = useState<'cursor' | 'trend' | 'fibo' | 'brush' | 'text' | 'measure'>('cursor');
  const [showIndicatorsModal, setShowIndicatorsModal] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 420 });

  useEffect(() => {
    setCandles(initialCandles);
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
          height: Math.max(340, entry.contentRect.height),
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Live real-time tick engine simulating exchange ticker updates
  useEffect(() => {
    const interval = setInterval(() => {
      setCandles((prev) => {
        if (!prev || prev.length === 0) return prev;
        const last = { ...prev[prev.length - 1] };
        const tickDelta = (Math.random() - 0.49) * (last.close * 0.001);
        const newClose = Math.max(1, Math.round(last.close + tickDelta));

        last.close = newClose;
        if (newClose > last.high) last.high = newClose;
        if (newClose < last.low) last.low = newClose;
        last.volume += Math.floor(Math.random() * 3);

        onTickPrice?.(newClose);
        return [...prev.slice(0, prev.length - 1), last];
      });
    }, 1800);

    return () => clearInterval(interval);
  }, [onTickPrice]);

  const { width, height } = dimensions;
  const paddingRight = 72; // Price axis
  const paddingBottom = 32; // Time axis
  const paddingTop = 12; // Header spacing
  const plotWidth = Math.max(100, width - paddingRight);
  const plotHeight = Math.max(100, height - paddingBottom - paddingTop);

  // Calculate scales
  const { minPrice, maxPrice, priceSpan, candleWidth, candlesToRender } = useMemo(() => {
    if (!candles || candles.length === 0) {
      return { minPrice: 100, maxPrice: 200, priceSpan: 100, candleWidth: 8, candlesToRender: [] };
    }
    const visibleCount = Math.min(candles.length, Math.floor(plotWidth / 9));
    const slice = candles.slice(-visibleCount);

    let min = Infinity;
    let max = -Infinity;
    let maxVol = 0;

    for (const c of slice) {
      if (c.low < min) min = c.low;
      if (c.high > max) max = c.high;
      if (c.volume > maxVol) maxVol = c.volume;
    }

    const span = max - min || 1;
    const paddedMin = Math.max(1, min - span * 0.04);
    const paddedMax = max + span * 0.04;
    const finalSpan = paddedMax - paddedMin || 1;
    const cWidth = Math.max(4, plotWidth / slice.length);

    return {
      minPrice: paddedMin,
      maxPrice: paddedMax,
      priceSpan: finalSpan,
      candleWidth: cWidth,
      candlesToRender: slice,
    };
  }, [candles, plotWidth]);

  // Coordinate transforms
  const getY = (price: number) => {
    return paddingTop + plotHeight - ((price - minPrice) / priceSpan) * plotHeight;
  };

  const getX = (index: number) => {
    return index * candleWidth + candleWidth / 2;
  };

  // Moving Averages (MA 7 and MA 25)
  const { ma7Points, ma25Points } = useMemo(() => {
    const calcMa = (period: number) => {
      const points: { x: number; y: number }[] = [];
      for (let i = 0; i < candlesToRender.length; i++) {
        if (i < period - 1) continue;
        let sum = 0;
        for (let j = 0; j < period; j++) {
          sum += candlesToRender[i - j].close;
        }
        const ma = sum / period;
        points.push({ x: getX(i), y: getY(ma) });
      }
      return points;
    };
    return {
      ma7Points: calcMa(7),
      ma25Points: calcMa(25),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candlesToRender, minPrice, priceSpan, plotHeight, candleWidth]);

  const activeCandle =
    hoverIndex != null && candlesToRender[hoverIndex]
      ? candlesToRender[hoverIndex]
      : candlesToRender[candlesToRender.length - 1];

  const activeIsBull = activeCandle ? activeCandle.close >= activeCandle.open : true;
  const activeChangeDiff = activeCandle ? (activeCandle.close - activeCandle.open) / 100 : 0;
  const activeChangePct = activeCandle
    ? (((activeCandle.close - activeCandle.open) / activeCandle.open) * 100).toFixed(2)
    : '0.00';

  // Y-axis grid price lines
  const gridLines = useMemo(() => {
    const count = 5;
    const lines = [];
    for (let i = 0; i <= count; i++) {
      const price = minPrice + (priceSpan / count) * i;
      const y = getY(price);
      lines.push({ price, y });
    }
    return lines;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minPrice, priceSpan, plotHeight]);

  const latestPrice =
    candlesToRender.length > 0 ? candlesToRender[candlesToRender.length - 1].close : currentPrice;
  const latestY = getY(latestPrice);

  return (
    <div className="flex h-full w-full flex-col rounded-xl border border-white/10 bg-[#121620] overflow-hidden shadow-2xl">
      {/* Exness Top Controls & OHLC bar */}
      <div className="flex flex-wrap items-center justify-between border-b border-white/10 bg-[#0e121b] px-3 py-2 text-xs gap-2">
        {/* Symbol Title & Timeframes (1m, 3m, 10m, 15m, 1h, 1d) */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5 font-bold text-white text-xs sm:text-sm">
            <span className="text-amber-400">⚡</span>
            <span>{instrumentName}</span>
            <span className="text-slate-500 font-normal">· {timeframe}</span>
          </div>

          <div className="h-4 w-px bg-white/10" />

          {/* Timeframe Buttons matching Exness */}
          <div className="flex items-center gap-1">
            {['1m', '3m', '10m', '15m', '1h', '1d'].map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => onTimeframeChange(tf)}
                className={`rounded px-2 py-0.5 font-semibold text-[11px] transition ${
                  timeframe === tf
                    ? 'bg-amber-400 text-black font-extrabold shadow-sm'
                    : 'text-slate-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* fx Indicators button */}
          <button
            type="button"
            onClick={() => setShowIndicatorsModal(!showIndicatorsModal)}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-bold text-slate-300 hover:text-white bg-white/5 border border-white/5 hover:border-white/20 transition"
            title="Technical Indicators"
          >
            <span className="italic font-serif text-amber-300 font-bold">fx</span>
            <span className="hidden sm:inline">Indicators</span>
          </button>
        </div>

        {/* Display Toggles */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-md bg-white/5 p-0.5 border border-white/5 text-[11px]">
            <button
              type="button"
              onClick={() => setChartType('candles')}
              className={`rounded px-2 py-0.5 transition ${
                chartType === 'candles'
                  ? 'bg-amber-400 text-black font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Candles
            </button>
            <button
              type="button"
              onClick={() => setChartType('line')}
              className={`rounded px-2 py-0.5 transition ${
                chartType === 'line'
                  ? 'bg-amber-400 text-black font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Line
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowMa(!showMa)}
            className={`rounded px-2 py-0.5 text-[11px] font-bold transition border ${
              showMa
                ? 'border-indigo-400/40 bg-indigo-500/20 text-indigo-300'
                : 'border-white/5 text-slate-400 hover:text-white'
            }`}
          >
            MA
          </button>
          <button
            type="button"
            onClick={() => setShowVolume(!showVolume)}
            className={`rounded px-2 py-0.5 text-[11px] font-bold transition border ${
              showVolume
                ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-300'
                : 'border-white/5 text-slate-400 hover:text-white'
            }`}
          >
            Vol
          </button>
        </div>
      </div>

      {/* OHLC Bar Matching Picture 2 (O 75,765.53 H 75,774.38 L 75,762.44 C 75,773.75 +6.86 (+0.01%)) */}
      {activeCandle && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/5 bg-[#121620] px-3 py-1.5 text-[11px] font-mono text-slate-400">
          <span className="font-bold text-white">{symbol}</span>
          <span>
            O <span className="text-white">{formatPrice(activeCandle.open, symbol)}</span>
          </span>
          <span>
            H <span className="text-white">{formatPrice(activeCandle.high, symbol)}</span>
          </span>
          <span>
            L <span className="text-white">{formatPrice(activeCandle.low, symbol)}</span>
          </span>
          <span>
            C <span className={activeIsBull ? 'text-blue-400' : 'text-rose-400'}>{formatPrice(activeCandle.close, symbol)}</span>
          </span>
          <span className={activeIsBull ? 'text-blue-400' : 'text-rose-400'}>
            {activeChangeDiff >= 0 ? '+' : ''}{activeChangeDiff.toFixed(2)} ({Number(activeChangePct) >= 0 ? '+' : ''}{activeChangePct}%)
          </span>
          {showVolume && (
            <span className="text-slate-500 hidden md:inline">
              Vol: {activeCandle.volume.toLocaleString()}
            </span>
          )}
        </div>
      )}

      {/* Main Chart Body: Left Drawing Rail + SVG Chart Area */}
      <div className="relative flex-1 flex w-full overflow-hidden">
        {/* Left Drawing Tools Rail (Matching Exness Picture 2) */}
        <div className="w-10 border-r border-white/5 bg-[#0e121b] flex flex-col items-center py-2 space-y-2 select-none">
          {[
            { id: 'cursor', icon: '✛', label: 'Crosshair' },
            { id: 'trend', icon: '╱', label: 'Trend Line' },
            { id: 'fibo', icon: '☰', label: 'Fibonacci' },
            { id: 'brush', icon: '✎', label: 'Draw / Brush' },
            { id: 'text', icon: 'T', label: 'Text Note' },
            { id: 'measure', icon: '↔', label: 'Measure Ruler' },
          ].map((tool) => (
            <button
              key={tool.id}
              type="button"
              onClick={() => setActiveTool(tool.id as typeof activeTool)}
              className={`h-7 w-7 rounded flex items-center justify-center text-xs font-bold transition ${
                activeTool === tool.id
                  ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
              title={tool.label}
            >
              {tool.icon}
            </button>
          ))}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setActiveTool('cursor')}
            className="h-7 w-7 rounded flex items-center justify-center text-xs text-slate-500 hover:text-rose-400 transition"
            title="Clear Chart Drawings"
          >
            🗑
          </button>
        </div>

        {/* Interactive SVG Chart Area */}
        <div
          ref={containerRef}
          className="relative flex-1 h-full select-none cursor-crosshair overflow-hidden"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            if (mouseX >= 0 && mouseX <= plotWidth && candleWidth > 0) {
              const idx = Math.floor(mouseX / candleWidth);
              if (idx >= 0 && idx < candlesToRender.length) {
                setHoverIndex(idx);
              }
            }
          }}
          onMouseLeave={() => setHoverIndex(null)}
        >
          <svg width={width} height={height} className="block">
            <defs>
              <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Grid lines */}
            {gridLines.map((line, idx) => (
              <g key={idx}>
                <line
                  x1={0}
                  y1={line.y}
                  x2={plotWidth}
                  y2={line.y}
                  stroke="rgba(255, 255, 255, 0.05)"
                  strokeDasharray="3 3"
                />
                <text
                  x={plotWidth + 6}
                  y={line.y + 4}
                  fill="#64748b"
                  fontSize="10"
                  fontFamily="monospace"
                >
                  {formatPrice(line.price, symbol)}
                </text>
              </g>
            ))}

            {/* Volume bars */}
            {showVolume &&
              candlesToRender.map((c, i) => {
                const x = getX(i) - candleWidth * 0.35;
                const maxVol = Math.max(...candlesToRender.map((cd) => cd.volume)) || 1;
                const vHeight = (c.volume / maxVol) * 45;
                const vY = paddingTop + plotHeight - vHeight;
                const isBull = c.close >= c.open;
                return (
                  <rect
                    key={`vol-${i}`}
                    x={x}
                    y={vY}
                    width={Math.max(2, candleWidth * 0.7)}
                    height={vHeight}
                    fill={isBull ? 'rgba(59, 130, 246, 0.2)' : 'rgba(239, 68, 68, 0.2)'}
                  />
                );
              })}

            {/* Candlesticks */}
            {chartType === 'candles' &&
              candlesToRender.map((c, i) => {
                const x = getX(i);
                const openY = getY(c.open);
                const closeY = getY(c.close);
                const highY = getY(c.high);
                const lowY = getY(c.low);
                const isBull = c.close >= c.open;
                const color = isBull ? '#3b82f6' : '#ef4444'; // Exness style cyan-blue / red
                const bodyTop = Math.min(openY, closeY);
                const bodyHeight = Math.max(2, Math.abs(closeY - openY));

                return (
                  <g key={`candle-${i}`}>
                    {/* Upper & lower wicks */}
                    <line x1={x} y1={highY} x2={x} y2={lowY} stroke={color} strokeWidth={1} />
                    {/* Candle body */}
                    <rect
                      x={x - candleWidth * 0.38}
                      y={bodyTop}
                      width={Math.max(2, candleWidth * 0.76)}
                      height={bodyHeight}
                      fill={color}
                      stroke={color}
                      strokeWidth={1}
                      rx={1}
                    />
                  </g>
                );
              })}

            {/* Line chart mode */}
            {chartType === 'line' && candlesToRender.length > 1 && (
              <>
                <polygon
                  points={`0,${paddingTop + plotHeight} ${candlesToRender
                    .map((c, i) => `${getX(i)},${getY(c.close)}`)
                    .join(' ')} ${plotWidth},${paddingTop + plotHeight}`}
                  fill="url(#areaGradient)"
                />
                <polyline
                  points={candlesToRender.map((c, i) => `${getX(i)},${getY(c.close)}`).join(' ')}
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth={2}
                />
              </>
            )}

            {/* Moving Average Lines */}
            {showMa && (
              <>
                {ma7Points.length > 1 && (
                  <polyline
                    points={ma7Points.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth={1.5}
                    opacity={0.8}
                  />
                )}
                {ma25Points.length > 1 && (
                  <polyline
                    points={ma25Points.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="#a855f7"
                    strokeWidth={1.5}
                    opacity={0.8}
                  />
                )}
              </>
            )}

            {/* Current Price Horizontal Dashed Line (Exness Style) */}
            <line
              x1={0}
              y1={latestY}
              x2={plotWidth}
              y2={latestY}
              stroke="#ef4444"
              strokeDasharray="4 4"
              strokeWidth={1.5}
            />

            {/* Price Badge on Axis */}
            <g transform={`translate(${plotWidth}, ${latestY - 10})`}>
              <rect
                x={0}
                y={0}
                width={paddingRight}
                height={20}
                fill="#ef4444"
                rx={3}
              />
              <text
                x={6}
                y={14}
                fill="#ffffff"
                fontSize="11"
                fontWeight="bold"
                fontFamily="monospace"
              >
                {formatPrice(latestPrice, symbol)}
              </text>
            </g>

            {/* Hover Crosshair */}
            {hoverIndex != null && (
              <g>
                <line
                  x1={getX(hoverIndex)}
                  y1={paddingTop}
                  x2={getX(hoverIndex)}
                  y2={paddingTop + plotHeight}
                  stroke="rgba(255, 255, 255, 0.4)"
                  strokeDasharray="2 2"
                />
                <line
                  x1={0}
                  y1={getY(candlesToRender[hoverIndex].close)}
                  x2={plotWidth}
                  y2={getY(candlesToRender[hoverIndex].close)}
                  stroke="rgba(255, 255, 255, 0.4)"
                  strokeDasharray="2 2"
                />
              </g>
            )}
          </svg>
        </div>
      </div>
    </div>
  );
}

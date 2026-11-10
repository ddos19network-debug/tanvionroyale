'use client';

import { useMemo, useState } from 'react';
import type { TradingOrderBook } from '@/lib/api/trading';
import { formatPrice } from '@/lib/api/trading';

interface OrderBookProps {
  orderBook: TradingOrderBook | null;
  symbol: string;
  onSelectPrice: (price: number) => void;
}

export function OrderBook({ orderBook, symbol, onSelectPrice }: OrderBookProps) {
  const [viewMode, setViewMode] = useState<'both' | 'bids' | 'asks'>('both');

  const { maxTotal, displayAsks, displayBids } = useMemo(() => {
    if (!orderBook) return { maxTotal: 1, displayAsks: [], displayBids: [] };

    const asks = [...orderBook.asks];
    const bids = [...orderBook.bids];

    const maxA = asks.length > 0 ? Math.max(...asks.map((a) => a.total)) : 1;
    const maxB = bids.length > 0 ? Math.max(...bids.map((b) => b.total)) : 1;
    const maxT = Math.max(maxA, maxB, 1);

    const limit = viewMode === 'both' ? 7 : 14;

    return {
      maxTotal: maxT,
      displayAsks: asks.slice(-limit),
      displayBids: bids.slice(0, limit),
    };
  }, [orderBook, viewMode]);

  if (!orderBook) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-xl border border-white/10 bg-[#121620] p-4 text-xs text-slate-400">
        Loading Order Book...
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col rounded-xl border border-white/10 bg-[#121620] overflow-hidden text-xs">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 bg-[#0e121b] px-3 py-2 font-semibold">
        <span className="text-white">Order Book</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setViewMode('both')}
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              viewMode === 'both' ? 'bg-amber-400/20 text-amber-300 font-bold' : 'text-slate-400 hover:text-white'
            }`}
            title="Default View"
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setViewMode('bids')}
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              viewMode === 'bids' ? 'bg-emerald-500/20 text-emerald-400 font-bold' : 'text-slate-400 hover:text-white'
            }`}
            title="Buy Orders Only"
          >
            Bids
          </button>
          <button
            type="button"
            onClick={() => setViewMode('asks')}
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              viewMode === 'asks' ? 'bg-rose-500/20 text-rose-400 font-bold' : 'text-slate-400 hover:text-white'
            }`}
            title="Sell Orders Only"
          >
            Asks
          </button>
        </div>
      </div>

      {/* Column Titles */}
      <div className="grid grid-cols-3 px-3 py-1 text-[11px] font-mono text-slate-400 border-b border-white/5 bg-[#121620]">
        <span className="text-left">Price (USD)</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>

      <div className="flex-1 flex flex-col justify-between overflow-hidden p-1 font-mono text-[11px]">
        {/* Asks (Sell Orders - Red) */}
        {(viewMode === 'both' || viewMode === 'asks') && (
          <div className="flex flex-col justify-end space-y-0.5 overflow-hidden">
            {displayAsks.map((ask, idx) => {
              const depthPct = Math.min(100, Math.round((ask.total / maxTotal) * 100));
              return (
                <button
                  key={`ask-${idx}`}
                  type="button"
                  onClick={() => onSelectPrice(ask.price)}
                  className="group relative grid grid-cols-3 px-2 py-0.5 text-left transition hover:bg-white/5 rounded"
                >
                  {/* Depth Background Bar */}
                  <div
                    className="absolute inset-y-0 right-0 bg-rose-500/10 transition-all group-hover:bg-rose-500/20"
                    style={{ width: `${depthPct}%` }}
                  />
                  <span className="relative z-10 text-rose-400 font-medium">
                    {formatPrice(ask.price, symbol)}
                  </span>
                  <span className="relative z-10 text-right text-slate-300">
                    {ask.size}
                  </span>
                  <span className="relative z-10 text-right text-slate-400">
                    {ask.total}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Mid Market Price & Spread */}
        <div className="my-1 flex items-center justify-between rounded border border-white/5 bg-[#0e121b] px-3 py-1 font-semibold">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-amber-400">
              {formatPrice(orderBook.lastPrice, symbol)}
            </span>
            <span className="text-[10px] text-slate-400">Mark</span>
          </div>
          <span className="text-[10px] text-slate-400">
            Spread: <span className="text-slate-300 font-mono">{formatPrice(orderBook.spread, symbol)}</span>
          </span>
        </div>

        {/* Bids (Buy Orders - Green) */}
        {(viewMode === 'both' || viewMode === 'bids') && (
          <div className="flex flex-col space-y-0.5 overflow-hidden">
            {displayBids.map((bid, idx) => {
              const depthPct = Math.min(100, Math.round((bid.total / maxTotal) * 100));
              return (
                <button
                  key={`bid-${idx}`}
                  type="button"
                  onClick={() => onSelectPrice(bid.price)}
                  className="group relative grid grid-cols-3 px-2 py-0.5 text-left transition hover:bg-white/5 rounded"
                >
                  {/* Depth Background Bar */}
                  <div
                    className="absolute inset-y-0 right-0 bg-emerald-500/10 transition-all group-hover:bg-emerald-500/20"
                    style={{ width: `${depthPct}%` }}
                  />
                  <span className="relative z-10 text-emerald-400 font-medium">
                    {formatPrice(bid.price, symbol)}
                  </span>
                  <span className="relative z-10 text-right text-slate-300">
                    {bid.size}
                  </span>
                  <span className="relative z-10 text-right text-slate-400">
                    {bid.total}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import type { TradingMarketTrade } from '@/lib/api/trading';
import { formatPrice } from '@/lib/api/trading';

interface MarketTradesProps {
  trades: TradingMarketTrade[];
  symbol: string;
}

export function MarketTrades({ trades, symbol }: MarketTradesProps) {
  return (
    <div className="flex h-full w-full flex-col rounded-xl border border-white/10 bg-[#121620] overflow-hidden text-xs">
      <div className="flex items-center justify-between border-b border-white/10 bg-[#0e121b] px-3 py-2 font-semibold">
        <span className="text-white">Recent Trades</span>
        <span className="flex items-center gap-1.5 text-[10px] text-emerald-400">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          Live Stream
        </span>
      </div>

      <div className="grid grid-cols-3 px-3 py-1 text-[11px] font-mono text-slate-400 border-b border-white/5 bg-[#121620]">
        <span className="text-left">Price (USD)</span>
        <span className="text-right">Size</span>
        <span className="text-right">Time</span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-0.5 p-1 font-mono text-[11px]">
        {trades.slice(0, 25).map((tr) => {
          const isBuy = tr.side === 'BUY';
          const d = new Date(tr.time);
          const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
          return (
            <div
              key={tr.id}
              className="grid grid-cols-3 px-2 py-0.5 rounded transition hover:bg-white/5"
            >
              <span className={`font-semibold ${isBuy ? 'text-emerald-400' : 'text-rose-400'}`}>
                {formatPrice(tr.price, symbol)}
              </span>
              <span className="text-right text-slate-300">{tr.size}</span>
              <span className="text-right text-slate-400">{timeStr}</span>
            </div>
          );
        })}
        {trades.length === 0 && (
          <div className="p-4 text-center text-slate-400">Waiting for live executions...</div>
        )}
      </div>
    </div>
  );
}

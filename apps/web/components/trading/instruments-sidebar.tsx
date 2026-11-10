'use client';

import { useState, useMemo } from 'react';
import type { TradingInstrumentView } from '@/lib/api/trading';
import { formatPrice } from '@/lib/api/trading';

interface InstrumentsSidebarProps {
  instruments: TradingInstrumentView[];
  selectedInstrument: TradingInstrumentView;
  onSelect: (inst: TradingInstrumentView) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function InstrumentsSidebar({
  instruments,
  selectedInstrument,
  onSelect,
  isCollapsed = false,
  onToggleCollapse,
}: InstrumentsSidebarProps) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('ALL');

  const filtered = useMemo(() => {
    return instruments.filter((inst) => {
      const matchCat = category === 'ALL' || inst.type === category;
      const matchSearch =
        search === '' ||
        inst.symbol.toLowerCase().includes(search.toLowerCase()) ||
        inst.name.toLowerCase().includes(search.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [instruments, category, search]);

  // Asset icons and flags
  function getAssetIcon(symbol: string) {
    if (symbol.includes('BTC')) return { icon: '₿', bg: 'bg-amber-500/20 text-amber-400' };
    if (symbol.includes('ETH')) return { icon: 'Ξ', bg: 'bg-indigo-500/20 text-indigo-400' };
    if (symbol.includes('SOL')) return { icon: '◎', bg: 'bg-purple-500/20 text-purple-400' };
    if (symbol.includes('BNB')) return { icon: '🟡', bg: 'bg-yellow-500/20 text-yellow-400' };
    if (symbol.includes('XAU') || symbol.includes('GOLD')) return { icon: '👑', bg: 'bg-yellow-400/20 text-yellow-300' };
    if (symbol.includes('EUR')) return { icon: '💶', bg: 'bg-blue-500/20 text-blue-400' };
    if (symbol.includes('GBP')) return { icon: '💷', bg: 'bg-purple-500/20 text-purple-400' };
    if (symbol.includes('JPY')) return { icon: '💴', bg: 'bg-red-500/20 text-red-400' };
    if (symbol.includes('AUD')) return { icon: '🇦🇺', bg: 'bg-emerald-500/20 text-emerald-400' };
    if (symbol.includes('CAD')) return { icon: '🇨🇦', bg: 'bg-red-500/20 text-red-400' };
    if (symbol.includes('OIL')) return { icon: '🛢️', bg: 'bg-amber-600/20 text-amber-500' };
    return { icon: '📈', bg: 'bg-slate-700/40 text-slate-300' };
  }

  // Format symbol display (e.g. BTCUSD -> BTC / USD)
  function formatSymbolName(symbol: string) {
    if (symbol.length === 6 && (symbol.endsWith('USD') || symbol.endsWith('JPY'))) {
      return `${symbol.slice(0, 3)}/${symbol.slice(3)}`;
    }
    return symbol;
  }

  if (isCollapsed) {
    return (
      <div className="flex h-full w-12 flex-col items-center rounded-xl border border-white/10 bg-[#121620] py-3 shadow-xl">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="rounded p-1.5 text-slate-400 hover:text-white hover:bg-white/5 transition"
          title="Expand Instruments Sidebar"
        >
          ▶
        </button>
        <div className="mt-4 flex flex-col items-center gap-2 overflow-y-auto">
          {instruments.slice(0, 8).map((inst) => {
            const isSelected = inst.id === selectedInstrument.id;
            const asset = getAssetIcon(inst.symbol);
            return (
              <button
                key={inst.id}
                type="button"
                onClick={() => onSelect(inst)}
                className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold transition ${
                  isSelected
                    ? 'border border-amber-400 bg-amber-400/20 text-amber-300'
                    : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                }`}
                title={inst.symbol}
              >
                {asset.icon}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col rounded-xl border border-white/10 bg-[#121620] overflow-hidden text-xs shadow-2xl">
      {/* Sidebar Header */}
      <div className="flex items-center justify-between border-b border-white/10 bg-[#0e121b] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-amber-400 font-bold">⋮≡</span>
          <span className="font-extrabold uppercase tracking-wider text-slate-200 text-[11px]">
            Instruments
          </span>
        </div>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="text-slate-400 hover:text-white transition text-xs"
            title="Collapse Sidebar"
          >
            ◀
          </button>
        )}
      </div>

      {/* Search Input */}
      <div className="p-2.5 border-b border-white/5 space-y-2">
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search symbol..."
            className="w-full rounded-lg border border-white/10 bg-[#0e121b] pl-7 pr-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
            🔍
          </span>
        </div>

        {/* Category Dropdown (Exness: All ▾) */}
        <div className="flex items-center justify-between">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-md border border-white/10 bg-[#0e121b] px-2 py-1 text-[11px] font-bold text-slate-300 focus:border-amber-400 focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Categories</option>
            <option value="CRYPTO">Crypto</option>
            <option value="FOREX">Forex</option>
            <option value="COMMODITY">Commodities</option>
            <option value="STOCK">Stocks</option>
          </select>
        </div>
      </div>

      {/* Instruments Table Headers (Symbol | Signal | Bid) */}
      <div className="grid grid-cols-12 border-b border-white/5 bg-[#0a0d14] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        <div className="col-span-6">Symbol</div>
        <div className="col-span-3 text-center">Signal</div>
        <div className="col-span-3 text-right">Bid</div>
      </div>

      {/* Instruments Table Rows */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {filtered.map((inst) => {
          const isSelected = inst.id === selectedInstrument.id;
          const change = inst.change24h ?? 0;
          const isUp = change >= 0;
          const asset = getAssetIcon(inst.symbol);

          return (
            <div
              key={inst.id}
              onClick={() => onSelect(inst)}
              className={`grid grid-cols-12 items-center px-3 py-2 cursor-pointer transition select-none ${
                isSelected
                  ? 'bg-amber-400/15 border-l-2 border-amber-400 text-white font-bold'
                  : 'hover:bg-white/5 text-slate-300'
              }`}
            >
              {/* Symbol */}
              <div className="col-span-6 flex items-center gap-2 truncate">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] ${asset.bg}`}
                >
                  {asset.icon}
                </span>
                <span className="font-mono text-xs font-bold text-white truncate">
                  {formatSymbolName(inst.symbol)}
                </span>
              </div>

              {/* Signal Up/Down Button */}
              <div className="col-span-3 flex justify-center">
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded text-[10px] font-black ${
                    isUp
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-rose-500/20 text-rose-400'
                  }`}
                >
                  {isUp ? '↑' : '↓'}
                </span>
              </div>

              {/* Bid Price */}
              <div className="col-span-3 text-right font-mono text-[11px] font-bold text-white">
                {formatPrice(inst.currentPrice, inst.symbol)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import type { TradingInstrumentView } from '@/lib/api/trading';
import { formatPrice, formatPercent } from '@/lib/api/trading';

interface PairSelectorProps {
  instruments: TradingInstrumentView[];
  selectedInstrument: TradingInstrumentView;
  onSelect: (inst: TradingInstrumentView) => void;
}

export function PairSelector({
  instruments,
  selectedInstrument,
  onSelect,
}: PairSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('ALL');

  const filtered = instruments.filter((inst) => {
    const matchCat = category === 'ALL' || inst.type === category;
    const matchSearch =
      search === '' ||
      inst.symbol.toLowerCase().includes(search.toLowerCase()) ||
      inst.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#121620] px-3 py-1.5 transition hover:bg-white/5 active:scale-95"
      >
        <span className="text-base font-black text-white tracking-wide">
          {selectedInstrument.symbol}
        </span>
        <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
          {selectedInstrument.type}
        </span>
        <span className="text-xs text-slate-400">▾</span>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-full mt-2 z-50 w-80 sm:w-96 rounded-xl border border-white/10 bg-[#121620] p-3 shadow-2xl overflow-hidden">
            {/* Search Input */}
            <div className="relative mb-2">
              <input
                type="text"
                placeholder="Search markets (e.g. BTC, ETH, EUR, NVDA)..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#0e121b] px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                autoFocus
              />
            </div>

            {/* Category Filter Pills */}
            <div className="flex flex-wrap gap-1 mb-2 border-b border-white/5 pb-2 text-[10px]">
              {['ALL', 'CRYPTO', 'FOREX', 'COMMODITY', 'STOCK'].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`rounded-md px-2 py-1 font-semibold transition ${
                    category === cat
                      ? 'bg-amber-400 text-black font-bold'
                      : 'bg-white/5 text-slate-400 hover:text-white'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Instruments List */}
            <div className="max-h-72 overflow-y-auto space-y-1">
              {filtered.map((inst) => {
                const isSelected = inst.id === selectedInstrument.id;
                const change = inst.change24h ?? 0;
                const isUp = change >= 0;
                return (
                  <button
                    key={inst.id}
                    type="button"
                    onClick={() => {
                      onSelect(inst);
                      setOpen(false);
                    }}
                    className={`w-full flex items-center justify-between p-2 rounded-lg text-left transition ${
                      isSelected
                        ? 'bg-amber-400/15 border border-amber-400/30'
                        : 'hover:bg-white/5'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-xs">{inst.symbol}</span>
                        <span className="text-[10px] text-slate-400">{inst.type}</span>
                      </div>
                      <span className="text-[11px] text-slate-400 block truncate max-w-[150px]">
                        {inst.name}
                      </span>
                    </div>

                    <div className="text-right font-mono text-xs">
                      <div className="text-white font-medium">
                        {formatPrice(inst.currentPrice, inst.symbol)}
                      </div>
                      <div className={`text-[11px] font-bold ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {formatPercent(change)}
                      </div>
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div className="py-8 text-center text-xs text-slate-400">
                  No markets match your filter.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

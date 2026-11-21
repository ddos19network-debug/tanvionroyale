'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { TradingShell } from '@/components/trading/trading-shell';
import { listTradingInstruments, type TradingInstrumentView, formatPrice, formatPercent } from '@/lib/api/trading';
import { getLiveMarketQuotes, type LiveMarketQuote } from '@/lib/api/live-rates';

const POPULAR_TAGS = ['BTC', 'ETH', 'SOL', 'BNB', 'NVDA', 'AAPL', 'XAUUSD', 'EURUSD'];

export default function TradingSearchPage() {
  const [query, setQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [instruments, setInstruments] = useState<TradingInstrumentView[]>([]);
  const [liveQuotes, setLiveQuotes] = useState<Record<string, LiveMarketQuote>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    listTradingInstruments()
      .then((res) => {
        if (mounted) setInstruments(res);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    async function sync() {
      try {
        const q = await getLiveMarketQuotes();
        if (mounted && q) setLiveQuotes(q);
      } catch {}
    }
    void sync();
    const interval = setInterval(() => void sync(), 3000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return instruments.filter((inst) => {
      if (selectedType !== 'ALL' && inst.type !== selectedType) return false;
      if (!q) return true;
      return (
        inst.symbol.toLowerCase().includes(q) ||
        inst.name.toLowerCase().includes(q)
      );
    });
  }, [instruments, query, selectedType]);

  return (
    <TradingShell>
      <div className="space-y-6 max-w-4xl mx-auto py-2">
        <div>
          <h1 className="text-2xl font-black text-white sm:text-3xl tracking-tight">
            Search Markets &amp; Assets
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-400">
            Find cryptocurrencies, stocks, forex pairs, and commodities with real-time quotes.
          </p>
        </div>

        {/* Search Bar Input */}
        <div className="relative">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by coin, stock name, or symbol (e.g. BTC, Apple, Gold)..."
            autoFocus
            className="w-full rounded-2xl border border-ink-700 bg-ink-900/90 pl-11 pr-4 py-3.5 text-sm sm:text-base text-white placeholder-slate-500 outline-none focus:border-amber-400 shadow-xl transition"
          />
          <svg
            className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <circle cx="11" cy="11" r="7" strokeWidth={2} />
            <path d="M20 20l-3.5-3.5" strokeWidth={2} strokeLinecap="round" />
          </svg>
        </div>

        {/* Popular Tags */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-500 font-medium mr-1">Trending:</span>
          {POPULAR_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setQuery(tag)}
              className="rounded-full border border-ink-700 bg-ink-900/80 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:border-amber-400 hover:text-amber-400 transition"
            >
              {tag}
            </button>
          ))}
        </div>

        {/* Asset Type Filter Pills */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pt-2">
          {['ALL', 'CRYPTO', 'STOCK', 'FOREX', 'COMMODITY'].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setSelectedType(t)}
              className={`rounded-full px-3.5 py-1 text-xs font-bold transition whitespace-nowrap ${
                selectedType === t
                  ? 'bg-amber-400/15 text-amber-400 border border-amber-400/40 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              {t === 'ALL' ? 'All Assets' : t}
            </button>
          ))}
        </div>

        {/* Search Results List */}
        <div className="rounded-2xl border border-ink-700/80 bg-ink-900/60 overflow-hidden shadow-2xl backdrop-blur">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
              <p className="text-xs font-medium text-slate-400">Loading market directory...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-slate-500 text-xs sm:text-sm">
              No matching trading instruments found for &quot;{query}&quot;
            </div>
          ) : (
            <div className="divide-y divide-ink-800">
              {filtered.map((inst) => {
                const quote = liveQuotes[inst.symbol] || liveQuotes[inst.symbol + 'USD'];
                const price = quote ? quote.currentPrice : inst.currentPrice;
                const change = quote ? quote.change24h : (inst.change24h ?? 0);
                const isUp = change >= 0;

                return (
                  <Link
                    key={inst.id}
                    href={`/trading?symbol=${inst.symbol}`}
                    className="flex items-center justify-between p-4 hover:bg-white/[0.02] transition group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400/10 text-amber-400 font-bold text-xs uppercase font-mono">
                        {inst.symbol.slice(0, 3)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white text-sm group-hover:text-amber-400 transition truncate">
                            {inst.symbol}
                          </span>
                          <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[9px] font-bold text-slate-400 uppercase">
                            {inst.type}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 truncate mt-0.5">{inst.name}</div>
                      </div>
                    </div>

                    <div className="text-right flex items-center gap-4">
                      <div className="space-y-0.5">
                        <div className="font-mono font-bold text-white text-sm">
                          {formatPrice(price, inst.symbol)}
                        </div>
                        <div className={`font-mono text-[11px] font-semibold ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isUp ? '+' : ''}{formatPercent(change)}
                        </div>
                      </div>

                      <span className="hidden sm:inline-block rounded-lg bg-amber-400/10 px-3 py-1.5 text-xs font-bold text-amber-400 group-hover:bg-amber-400 group-hover:text-ink-950 transition">
                        Trade &gt;
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </TradingShell>
  );
}

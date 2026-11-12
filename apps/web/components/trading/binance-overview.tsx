'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { TradingInstrumentView } from '@/lib/api/trading';
import { formatMinor, formatPercent } from '@/lib/api/trading';

interface BinanceOverviewProps {
  instruments: TradingInstrumentView[];
  balanceMinor: number;
  todayPnlMinor?: number;
  onSelectInstrument: (inst: TradingInstrumentView) => void;
  onTradeNowClick?: () => void;
}

export function BinanceOverview({
  instruments,
  balanceMinor,
  todayPnlMinor = 0,
  onSelectInstrument,
  onTradeNowClick,
}: BinanceOverviewProps) {
  const [showBalance, setShowBalance] = useState(true);
  const [activeTab, setActiveTab] = useState<'popular' | 'new' | 'stocks' | 'commodities'>('popular');
  const [showTutorial, setShowTutorial] = useState(false);

  // Compute BTC equivalent for balance (assuming BTC price around $75,800)
  const btcPrice = instruments.find((i) => i.symbol.includes('BTC'))?.currentPrice ?? 7586400;
  const btcBalance = (balanceMinor / btcPrice).toFixed(8);
  const fiatBalanceFormatted = formatMinor(balanceMinor);

  // Filter instruments for the tabs — use only valid crypto pairs in the popular list
  const popularList = instruments.filter((i) =>
    ['BTCUSD', 'ETHUSD', 'BNBUSD', 'XRPUSD', 'SOLUSD', 'DOGEUSD'].includes(i.symbol),
  );
  const stocksList = instruments.filter((i) => i.type === 'STOCK');
  const commoditiesList = instruments.filter((i) => i.type === 'COMMODITY');
  const newList = instruments.slice(3, 8);

  const activeList =
    activeTab === 'popular'
      ? popularList.length > 0 ? popularList : instruments.slice(0, 5)
      : activeTab === 'stocks'
      ? stocksList.length > 0 ? stocksList : instruments.slice(0, 5)
      : activeTab === 'commodities'
      ? commoditiesList.length > 0 ? commoditiesList : instruments.slice(0, 5)
      : newList.length > 0 ? newList : instruments.slice(0, 5);

  const newsItems = [
    {
      id: 1,
      title: "China's Foreign Exchange Reserves Reach $3.405178 Trillion at October-End, Up $4.927 Billion",
      source: 'Global Macro',
      time: '1h ago',
    },
    {
      id: 2,
      title: 'Hyperliquid Whales Hold $7.573B in Positions, Long-Short Ratio at 1.42',
      source: 'On-Chain Intel',
      time: '3h ago',
    },
    {
      id: 3,
      title: 'Bitcoin Crosses $75,000 Milestone with Institutional Spot ETF Inflows Surging',
      source: 'CoinDesk',
      time: '5h ago',
    },
  ];

  return (
    <div className="w-full rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#181d29] via-[#121622] to-[#0d1017] p-5 sm:p-7 shadow-2xl">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Hero: Headline, Balances, CTA buttons */}
        <div className="lg:col-span-7 flex flex-col justify-between space-y-6">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-300 mb-3">
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
              <span>Royale Exchange</span>
            </div>

            <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-white leading-tight">
              <span className="text-[#F0B90B] drop-shadow-sm">Trade 350+</span>{' '}
              <span className="text-white">Cryptocurrencies & Assets</span>
            </h1>

            <p className="mt-2 text-sm text-slate-300 max-w-xl">
              Experience ultra-low latency execution, real-time market depth, advanced risk
              management on Tanvion Royale Exchange.
            </p>
          </div>

          {/* User Estimated Balance Box */}
          <div className="rounded-xl border border-white/10 bg-[#0e121b]/80 p-4 sm:p-5 backdrop-blur">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">Your Estimated Balance</span>
                <button
                  type="button"
                  onClick={() => setShowBalance(!showBalance)}
                  className="text-slate-400 hover:text-white transition"
                  title={showBalance ? 'Hide balance' : 'Show balance'}
                >
                  {showBalance ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                    </svg>
                  )}
                </button>
              </div>
              <span className="text-[11px] text-emerald-400 font-mono flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live Portfolio
              </span>
            </div>

            <div className="flex flex-wrap items-baseline gap-2 font-mono">
              <span className="text-2xl sm:text-3xl font-extrabold text-white">
                {showBalance ? `${btcBalance} BTC` : '•••••••• BTC'}
              </span>
              <span className="text-sm text-slate-400">
                {showBalance ? `≈ ${fiatBalanceFormatted}` : '≈ $••••••'}
              </span>
            </div>

            <div className="mt-2 flex items-center gap-2 text-xs font-mono">
              <span className="text-slate-400">Today&apos;s PnL</span>
              <span
                className={`font-semibold ${
                  todayPnlMinor >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {todayPnlMinor >= 0 ? '+' : ''}
                {formatMinor(todayPnlMinor)} (+0.00%)
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-4 pt-1">
            <button
              type="button"
              onClick={onTradeNowClick}
              className="flex items-center gap-2 rounded-xl bg-[#F0B90B] px-7 py-3.5 text-sm font-extrabold text-black shadow-lg shadow-amber-500/25 transition-all hover:bg-[#fcd535] hover:shadow-amber-500/40 active:scale-95"
            >
              <span>Trade Now</span>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>

            <button
              type="button"
              onClick={() => setShowTutorial(true)}
              className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 py-3.5 text-sm font-bold text-white transition hover:bg-white/10 hover:border-white/30 active:scale-95"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-xs">
                ▶
              </span>
              <span>Watch Tutorial</span>
            </button>
          </div>
        </div>

        {/* Right Cards: Tabbed Market Highlights & News */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          {/* Tabbed Asset Card (Popular / New Listing / Stocks / Commodities) */}
          <div className="rounded-xl border border-white/10 bg-[#0e121b]/90 p-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-3 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setActiveTab('popular')}
                  className={`transition pb-1 ${
                    activeTab === 'popular'
                      ? 'border-b-2 border-[#F0B90B] text-[#F0B90B]'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Popular
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('new')}
                  className={`transition pb-1 ${
                    activeTab === 'new'
                      ? 'border-b-2 border-[#F0B90B] text-[#F0B90B]'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  New Listing
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('stocks')}
                  className={`transition pb-1 ${
                    activeTab === 'stocks'
                      ? 'border-b-2 border-[#F0B90B] text-[#F0B90B]'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Stocks
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('commodities')}
                  className={`transition pb-1 ${
                    activeTab === 'commodities'
                      ? 'border-b-2 border-[#F0B90B] text-[#F0B90B]'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  tCommodities
                </button>
              </div>

              <Link
                href="/trading/markets"
                className="text-[11px] font-semibold text-slate-400 hover:text-[#F0B90B] transition flex items-center gap-0.5"
              >
                View All &gt;
              </Link>
            </div>

            {/* List */}
            <div className="divide-y divide-white/5 pt-2">
              {activeList.map((inst) => {
                const change = inst.change24h ?? 0;
                const isUp = change >= 0;
                return (
                  <div
                    key={inst.id}
                    onClick={() => {
                      onSelectInstrument(inst);
                      onTradeNowClick?.();
                    }}
                    className="flex items-center justify-between py-2.5 px-2 rounded-lg hover:bg-white/5 cursor-pointer transition"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-tr from-amber-500/20 to-yellow-500/30 text-xs font-bold text-amber-300">
                        {inst.symbol.slice(0, 3)}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-black text-white text-xs">{inst.symbol}</span>
                          <span className="text-[10px] text-slate-400 truncate max-w-[90px]">
                            {inst.name}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right font-mono">
                      <div className="text-xs font-bold text-white">
                        ${(inst.currentPrice / 100).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </div>
                      <div
                        className={`text-[11px] font-semibold ${
                          isUp ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {formatPercent(change)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* News Card */}
          <div className="rounded-xl border border-white/10 bg-[#0e121b]/90 p-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5 mb-2.5">
              <span className="text-xs font-bold text-white">News</span>
              <span className="text-[11px] text-slate-400 hover:text-[#F0B90B] cursor-pointer">
                View All News &gt;
              </span>
            </div>

            <div className="space-y-2.5">
              {newsItems.map((n) => (
                <div key={n.id} className="group cursor-pointer">
                  <p className="text-xs text-slate-300 group-hover:text-amber-300 transition line-clamp-2 leading-relaxed">
                    {n.title}
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
                    <span>{n.source}</span>
                    <span>•</span>
                    <span>{n.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Tutorial Video Modal */}
      {showTutorial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-2xl rounded-2xl border border-amber-500/30 bg-[#121620] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="text-[#F0B90B]">⚡</span> How to Trade on Royale
              </h3>
              <button
                type="button"
                onClick={() => setShowTutorial(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs text-slate-300 leading-relaxed">
              <div className="rounded-lg bg-amber-500/10 p-3.5 border border-amber-500/20 text-amber-200">
                <span className="font-bold">1. Select Your Instrument:</span> Use the multi-tab bar or the Instruments sidebar to pick Crypto, Forex, Gold, or Stocks.
              </div>
              <div className="rounded-lg bg-white/5 p-3.5 border border-white/5">
                <span className="font-bold text-white">2. Place an Order:</span> Choose <strong>Buy</strong> (Long) or <strong>Sell</strong> (Short). Set your volume in Lots and configure optional Stop Loss / Take Profit.
              </div>
              <div className="rounded-lg bg-white/5 p-3.5 border border-white/5">
                <span className="font-bold text-white">3. Track Positions:</span> Monitor your open trades in real time at the bottom terminal. Close them whenever you wish to lock in profits!
              </div>
              <div className="rounded-lg bg-emerald-500/10 p-3.5 border border-emerald-500/20 text-emerald-200">
                <span className="font-bold">4. Fast Execution:</span> Enjoy high-speed order execution and transparent market depth!
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setShowTutorial(false)}
                className="rounded-xl bg-[#F0B90B] px-6 py-2.5 text-xs font-bold text-black hover:bg-[#fcd535]"
              >
                Got It! Let&apos;s Trade
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

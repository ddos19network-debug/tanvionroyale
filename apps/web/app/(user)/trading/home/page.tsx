'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TradingShell, Sparkline } from '@/components/trading/trading-shell';
import { listTradingInstruments, claimTradingFaucet, formatPrice, formatPercent, formatMinor } from '@/lib/api/trading';
import type { TradingInstrumentView } from '@/lib/api/trading';

interface FeatureCoin {
  symbol: string;
  name: string;
  price: number;
  change: number;
  high: number;
  low: number;
  volume: string;
  sparkline: number[];
  type: string;
}

const FEATURED_TICKERS: FeatureCoin[] = [
  {
    symbol: 'BTCUSD',
    name: 'Bitcoin',
    price: 7586000,
    change: 320,
    high: 7650000,
    low: 7420000,
    volume: '$18.45B',
    sparkline: [74200, 74600, 74300, 75100, 74900, 75600, 75860],
    type: 'CRYPTO',
  },
  {
    symbol: 'ETHUSD',
    name: 'Ethereum',
    price: 384000,
    change: 185,
    high: 391000,
    low: 375000,
    volume: '$9.23B',
    sparkline: [3750, 3770, 3760, 3810, 3790, 3820, 3840],
    type: 'CRYPTO',
  },
  {
    symbol: 'SOLUSD',
    name: 'Solana',
    price: 19850,
    change: -85,
    high: 20500,
    low: 19200,
    volume: '$4.12B',
    sparkline: [2050, 2030, 2010, 1990, 2020, 1970, 1985],
    type: 'CRYPTO',
  },
  {
    symbol: 'NVDA',
    name: 'NVIDIA Corp',
    price: 14200,
    change: 450,
    high: 14500,
    low: 13900,
    volume: '$5.21B',
    sparkline: [1390, 1400, 1395, 1410, 1415, 1430, 1420],
    type: 'STOCK',
  },
];

const TABLE_COINS: Record<string, FeatureCoin[]> = {
  hot: [
    { symbol: 'BTCUSD', name: 'Bitcoin', price: 7586000, change: 320, high: 7650000, low: 7420000, volume: '$18.45B', sparkline: [74200, 75000, 75860], type: 'CRYPTO' },
    { symbol: 'ETHUSD', name: 'Ethereum', price: 384000, change: 185, high: 391000, low: 375000, volume: '$9.23B', sparkline: [3750, 3800, 3840], type: 'CRYPTO' },
    { symbol: 'SOLUSD', name: 'Solana', price: 19850, change: -85, high: 20500, low: 19200, volume: '$4.12B', sparkline: [2050, 2000, 1985], type: 'CRYPTO' },
    { symbol: 'BNBUSD', name: 'BNB', price: 61500, change: 120, high: 62400, low: 60200, volume: '$3.10B', sparkline: [6020, 6100, 6150], type: 'CRYPTO' },
    { symbol: 'NVDA', name: 'NVIDIA Corp', price: 14200, change: 450, high: 14500, low: 13900, volume: '$5.21B', sparkline: [1390, 1410, 1420], type: 'STOCK' },
    { symbol: 'XAUUSD', name: 'Gold Spot', price: 274000, change: 42, high: 275500, low: 272800, volume: '$12.8B', sparkline: [2728, 2735, 2740], type: 'COMMODITY' },
  ],
  gainers: [
    { symbol: 'PEPEUSD', name: 'Pepe', price: 1, change: 1250, high: 1.2, low: 0.9, volume: '$1.42B', sparkline: [0.9, 1.0, 1.2], type: 'CRYPTO' },
    { symbol: 'SUIUSD', name: 'Sui', price: 320, change: 840, high: 345, low: 290, volume: '$920M', sparkline: [290, 310, 320], type: 'CRYPTO' },
    { symbol: 'NVDA', name: 'NVIDIA Corp', price: 14200, change: 450, high: 14500, low: 13900, volume: '$5.21B', sparkline: [1390, 1410, 1420], type: 'STOCK' },
    { symbol: 'BTCUSD', name: 'Bitcoin', price: 7586000, change: 320, high: 7650000, low: 7420000, volume: '$18.45B', sparkline: [74200, 75000, 75860], type: 'CRYPTO' },
    { symbol: 'TIAUSD', name: 'Celestia', price: 620, change: 210, high: 645, low: 595, volume: '$410M', sparkline: [595, 610, 620], type: 'CRYPTO' },
  ],
  volume: [
    { symbol: 'BTCUSD', name: 'Bitcoin', price: 7586000, change: 320, high: 7650000, low: 7420000, volume: '$18.45B', sparkline: [74200, 75000, 75860], type: 'CRYPTO' },
    { symbol: 'ETHUSD', name: 'Ethereum', price: 384000, change: 185, high: 391000, low: 375000, volume: '$9.23B', sparkline: [3750, 3800, 3840], type: 'CRYPTO' },
    { symbol: 'NVDA', name: 'NVIDIA Corp', price: 14200, change: 450, high: 14500, low: 13900, volume: '$5.21B', sparkline: [1390, 1410, 1420], type: 'STOCK' },
    { symbol: 'SOLUSD', name: 'Solana', price: 19850, change: -85, high: 20500, low: 19200, volume: '$4.12B', sparkline: [2050, 2000, 1985], type: 'CRYPTO' },
    { symbol: 'XAUUSD', name: 'Gold Spot', price: 274000, change: 42, high: 275500, low: 272800, volume: '$12.8B', sparkline: [2728, 2735, 2740], type: 'COMMODITY' },
  ],
  new: [
    { symbol: 'SUIUSD', name: 'Sui', price: 320, change: 840, high: 345, low: 290, volume: '$920M', sparkline: [290, 310, 320], type: 'CRYPTO' },
    { symbol: 'TIAUSD', name: 'Celestia', price: 620, change: 210, high: 645, low: 595, volume: '$410M', sparkline: [595, 610, 620], type: 'CRYPTO' },
    { symbol: 'APTUSD', name: 'Aptos', price: 980, change: -140, high: 1040, low: 960, volume: '$380M', sparkline: [1040, 990, 980], type: 'CRYPTO' },
    { symbol: 'PEPEUSD', name: 'Pepe', price: 1, change: 1250, high: 1.2, low: 0.9, volume: '$1.42B', sparkline: [0.9, 1.0, 1.2], type: 'CRYPTO' },
  ],
};

export default function TradingHomePage() {
  const [activeMarketTab, setActiveMarketTab] = useState<'hot' | 'gainers' | 'volume' | 'new'>('hot');
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  async function handleClaimDemoFunds() {
    setFaucetLoading(true);
    try {
      const acc = await claimTradingFaucet(1_000_000, false);
      setToastMessage(`Success! Claimed ${formatMinor(1_000_000, acc.currency)} demo funds.`);
      setTimeout(() => setToastMessage(null), 3500);
    } catch {
      setToastMessage('Please sign in to claim demo trading funds.');
      setTimeout(() => setToastMessage(null), 3500);
    } finally {
      setFaucetLoading(false);
    }
  }

  const tableData = TABLE_COINS[activeMarketTab] ?? TABLE_COINS.hot;

  return (
    <TradingShell>
      <div className="space-y-10 sm:space-y-14 py-4 sm:py-6">
        {toastMessage && (
          <div className="fixed top-16 right-4 z-50 rounded-xl bg-brand text-ink-950 px-4 py-2.5 text-xs font-bold shadow-2xl animate-fade-in flex items-center gap-2">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>{toastMessage}</span>
          </div>
        )}

        {/* 1. TOP LIVE TICKER MARQUEE (Binance-style) */}
        <div className="rounded-xl border border-ink-700/80 bg-ink-900/60 p-3 overflow-hidden flex items-center justify-between text-xs text-slate-300">
          <div className="flex items-center gap-2 shrink-0 pr-4 border-r border-ink-700">
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-bold text-white text-[11px] uppercase tracking-wider">Live Updates</span>
          </div>
          <div className="flex items-center gap-6 overflow-x-auto scrollbar-none px-4">
            <div className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="font-bold text-amber-400">BTC/USD</span>
              <span className="font-mono">$75,860.00</span>
              <span className="text-emerald-400 font-mono font-semibold">+3.20%</span>
            </div>
            <div className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="font-bold text-blue-400">ETH/USD</span>
              <span className="font-mono">$3,840.00</span>
              <span className="text-emerald-400 font-mono font-semibold">+1.85%</span>
            </div>
            <div className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="font-bold text-purple-400">SOL/USD</span>
              <span className="font-mono">$198.50</span>
              <span className="text-rose-400 font-mono font-semibold">-0.85%</span>
            </div>
            <div className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="font-bold text-emerald-400">NVDA</span>
              <span className="font-mono">$142.00</span>
              <span className="text-emerald-400 font-mono font-semibold">+4.50%</span>
            </div>
            <div className="flex items-center gap-1.5 whitespace-nowrap text-brand font-semibold">
              <span>★ 0% Maker Fees on Top Crypto Pairs</span>
            </div>
          </div>
        </div>

        {/* 2. HERO BANNER (Binance-style with Project Dark Teal/Gold Branding) */}
        <div className="relative rounded-3xl border border-ink-700/80 bg-gradient-to-br from-ink-900 via-ink-900 to-ink-950 p-6 sm:p-10 lg:p-14 overflow-hidden shadow-2xl">
          {/* Subtle Background Glow */}
          <div className="absolute top-0 right-0 -mt-16 -mr-16 h-80 w-80 rounded-full bg-brand/10 blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-1/3 -mb-20 h-60 w-60 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />

          <div className="relative z-10 max-w-3xl space-y-4 sm:space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand/40 bg-brand/10 px-3.5 py-1 text-xs font-bold text-brand">
              <span>★ TANVIONROYALE CRYPTO & DERIVATIVES EXCHANGE</span>
            </div>

            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black text-white tracking-tight leading-tight">
              Trade 100+ Cryptos &amp; Assets with{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-amber-300 to-brand">
                Ultra-Low Latency
              </span>
            </h1>

            <p className="text-sm sm:text-base text-slate-300 max-w-2xl leading-relaxed">
              Institutional-grade liquidity, deep market depth, and sub-10ms matching engine for
              Bitcoin, Ethereum, US Stocks, and Precious Metals. Practice risk-free with $10,000 demo funds or trade live.
            </p>

            {/* Hero CTAs */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link
                href="/trading"
                className="rounded-full bg-gradient-to-r from-amber-400 to-[#F0B90B] px-6 py-3 text-xs sm:text-sm font-bold text-ink-950 shadow-lg shadow-amber-500/25 hover:brightness-110 transition active:scale-95"
              >
                Start Trading Terminal &gt;
              </Link>

              <Link
                href="/trading/market"
                className="rounded-full border border-brand/50 bg-brand/10 px-6 py-3 text-xs sm:text-sm font-bold text-brand hover:bg-brand/20 transition active:scale-95"
              >
                Explore Markets
              </Link>

              <button
                type="button"
                onClick={handleClaimDemoFunds}
                disabled={faucetLoading}
                className="rounded-full border border-ink-700 bg-ink-800/80 px-5 py-3 text-xs sm:text-sm font-semibold text-slate-300 hover:text-white hover:border-ink-600 transition disabled:opacity-50"
              >
                {faucetLoading ? 'Claiming...' : 'Claim $10,000 Demo Faucet'}
              </button>
            </div>
          </div>

          {/* 4 FEATURED TICKER CARDS (Binance-style) */}
          <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mt-8 sm:mt-12">
            {FEATURED_TICKERS.map((coin) => {
              const isUp = coin.change >= 0;
              return (
                <Link
                  key={coin.symbol}
                  href={`/trading?symbol=${coin.symbol}`}
                  className="rounded-2xl border border-ink-700/80 bg-ink-900/90 p-4 hover:border-brand/50 hover:bg-ink-800/80 transition group shadow-md"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand">
                        {coin.symbol.slice(0, 3)}
                      </span>
                      <div>
                        <div className="font-bold text-white text-xs sm:text-sm">{coin.symbol}</div>
                        <div className="text-[10px] text-slate-400">{coin.name}</div>
                      </div>
                    </div>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-mono font-bold ${
                        isUp ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
                      }`}
                    >
                      {isUp ? '+' : ''}
                      {formatPercent(coin.change)}
                    </span>
                  </div>

                  <div className="mt-3 flex items-baseline justify-between">
                    <span className="text-base sm:text-lg font-bold font-mono text-white">
                      {formatPrice(coin.price, coin.symbol)}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">Vol: {coin.volume}</span>
                  </div>

                  <div className="mt-2 h-7 w-full overflow-hidden opacity-80 group-hover:opacity-100 transition">
                    <Sparkline points={coin.sparkline} height={28} width={180} />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* 3. POPULAR MARKETS TABLE (Binance-style with project UI) */}
        <div className="rounded-3xl border border-ink-700/80 bg-ink-900/90 p-5 sm:p-8 shadow-xl space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Popular Markets</h2>
              <p className="text-xs text-slate-400 mt-1">
                Real-time price quotes, 24h volume, and 1-click trade execution.
              </p>
            </div>

            <Link
              href="/trading/market"
              className="text-xs text-brand hover:text-brand-dark font-bold transition flex items-center gap-1"
            >
              <span>View All 100+ Markets</span>
              <span>&gt;</span>
            </Link>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-2 border-b border-ink-800 pb-3 overflow-x-auto scrollbar-none">
            {(
              [
                { key: 'hot', label: '🔥 Hot' },
                { key: 'gainers', label: '🚀 Top Gainers' },
                { key: 'volume', label: '📊 24h Volume' },
                { key: 'new', label: '✨ New Listings' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveMarketTab(tab.key)}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold whitespace-nowrap transition ${
                  activeMarketTab === tab.key
                    ? 'bg-brand text-ink-950 font-bold shadow'
                    : 'text-slate-400 hover:text-white hover:bg-ink-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[11px] font-medium text-slate-400 border-b border-ink-800 pb-2">
                  <th className="py-3 font-normal">Market / Pair</th>
                  <th className="py-3 text-right font-normal">Last Price</th>
                  <th className="py-3 text-right font-normal">24h Change</th>
                  <th className="py-3 text-right font-normal hidden sm:table-cell">24h High</th>
                  <th className="py-3 text-right font-normal hidden sm:table-cell">24h Low</th>
                  <th className="py-3 text-right font-normal hidden md:table-cell">24h Volume</th>
                  <th className="py-3 text-right font-normal">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800/80">
                {tableData.map((coin) => {
                  const isUp = coin.change >= 0;
                  return (
                    <tr key={coin.symbol} className="hover:bg-ink-800/50 transition">
                      <td className="py-3.5">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/10 font-bold text-brand text-xs">
                            {coin.symbol.slice(0, 3)}
                          </span>
                          <div>
                            <div className="font-bold text-white text-xs sm:text-sm">{coin.symbol}</div>
                            <div className="text-[10px] text-slate-400">{coin.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 text-right font-mono font-bold text-white sm:text-sm">
                        {formatPrice(coin.price, coin.symbol)}
                      </td>
                      <td className="py-3.5 text-right font-mono font-bold">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-xs ${
                            isUp ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
                          }`}
                        >
                          {isUp ? '+' : ''}
                          {formatPercent(coin.change)}
                        </span>
                      </td>
                      <td className="py-3.5 text-right font-mono text-slate-300 hidden sm:table-cell">
                        {formatPrice(coin.high, coin.symbol)}
                      </td>
                      <td className="py-3.5 text-right font-mono text-slate-300 hidden sm:table-cell">
                        {formatPrice(coin.low, coin.symbol)}
                      </td>
                      <td className="py-3.5 text-right font-mono text-slate-400 hidden md:table-cell">
                        {coin.volume}
                      </td>
                      <td className="py-3.5 text-right">
                        <Link
                          href={`/trading?symbol=${coin.symbol}`}
                          className="rounded-full bg-gradient-to-r from-amber-400 to-[#F0B90B] px-3.5 py-1 text-xs font-bold text-ink-950 hover:brightness-110 transition shadow-sm"
                        >
                          Trade
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 4. WHY TRADE ON ROYALE EXCHANGE (Binance Platform Highlights) */}
        <div className="space-y-6">
          <div className="text-center max-w-xl mx-auto space-y-2">
            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              Built for Professional &amp; Retail Traders
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              Experience ultra-low latency execution, transparent pricing, and world-class security.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-ink-700/80 bg-ink-900/80 p-5 space-y-3">
              <div className="h-10 w-10 rounded-xl bg-brand/10 border border-brand/30 flex items-center justify-center text-brand">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </div>
              <h3 className="font-bold text-white text-sm sm:text-base">Sub-10ms Matching Engine</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                High-throughput order matching handles millions of trades per second with zero lag.
              </p>
            </div>

            <div className="rounded-2xl border border-ink-700/80 bg-ink-900/80 p-5 space-y-3">
              <div className="h-10 w-10 rounded-xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center text-amber-400">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <h3 className="font-bold text-white text-sm sm:text-base">100% Asset Backing</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Cold-storage custody and verifiable proof of reserves guarantee customer safety.
              </p>
            </div>

            <div className="rounded-2xl border border-ink-700/80 bg-ink-900/80 p-5 space-y-3">
              <div className="h-10 w-10 rounded-xl bg-blue-400/10 border border-blue-400/30 flex items-center justify-center text-blue-400">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              </div>
              <h3 className="font-bold text-white text-sm sm:text-base">TradingView Pro Charts</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                50+ technical indicators, real-time depth order book, and flexible interval analysis.
              </p>
            </div>

            <div className="rounded-2xl border border-ink-700/80 bg-ink-900/80 p-5 space-y-3">
              <div className="h-10 w-10 rounded-xl bg-purple-400/10 border border-purple-400/30 flex items-center justify-center text-purple-400">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </div>
              <h3 className="font-bold text-white text-sm sm:text-base">Multi-Asset Ecosystem</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Trade Crypto, Forex, US Stocks, and Commodities from a single unified wallet.
              </p>
            </div>
          </div>
        </div>

        {/* 5. 3 SIMPLE STEPS TO START TRADING (Binance Onboarding) */}
        <div className="rounded-3xl border border-ink-700/80 bg-gradient-to-r from-ink-900 to-ink-950 p-6 sm:p-10 space-y-6">
          <div className="text-center max-w-lg mx-auto space-y-1">
            <h2 className="text-xl sm:text-2xl font-bold text-white">How to Get Started in 3 Steps</h2>
            <p className="text-xs text-slate-400">Start trading within 2 minutes.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-2">
            <div className="flex flex-col items-center text-center space-y-2.5">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 border border-brand/40 text-brand font-black text-lg">
                1
              </div>
              <h4 className="font-bold text-white text-sm">Create Free Account</h4>
              <p className="text-xs text-slate-400 max-w-xs">
                Quick sign-up with email or username. No lengthy verification needed for demo trading.
              </p>
            </div>

            <div className="flex flex-col items-center text-center space-y-2.5">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/10 border border-amber-400/40 text-amber-400 font-black text-lg">
                2
              </div>
              <h4 className="font-bold text-white text-sm">Claim $10,000 Demo Funds</h4>
              <p className="text-xs text-slate-400 max-w-xs">
                Instantly claim free virtual funds or deposit crypto into your secure wallet.
              </p>
            </div>

            <div className="flex flex-col items-center text-center space-y-2.5">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-400/10 border border-blue-400/40 text-blue-400 font-black text-lg">
                3
              </div>
              <h4 className="font-bold text-white text-sm">Trade &amp; Profit</h4>
              <p className="text-xs text-slate-400 max-w-xs">
                Execute market, limit, or stop orders and monitor live P&amp;L in real-time.
              </p>
            </div>
          </div>

          <div className="text-center pt-4">
            <Link
              href="/trading"
              className="inline-block rounded-full bg-brand px-8 py-3 text-xs sm:text-sm font-bold text-ink-950 hover:bg-brand-dark transition active:scale-95 shadow-md shadow-brand/20"
            >
              Launch Trading Terminal Now
            </Link>
          </div>
        </div>
      </div>
    </TradingShell>
  );
}

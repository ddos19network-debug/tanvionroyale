'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TradingShell } from '@/components/trading/trading-shell';

interface CoinItem {
  symbol: string;
  name: string;
  price: string;
  change: number;
  high?: string;
  low?: string;
  volume: string;
  marketCap: string;
  category: string[];
}

const ALL_COINS: CoinItem[] = [
  { symbol: 'BTC', name: 'Bitcoin', price: '$74,530.20', change: 1.02, volume: '$32.4B', marketCap: '$1.46T', category: ['All', 'Layer 1 / Layer 2', 'Payments'] },
  { symbol: 'ETH', name: 'Ethereum', price: '$2,084.50', change: 1.10, volume: '$18.2B', marketCap: '$251.2B', category: ['All', 'Layer 1 / Layer 2'] },
  { symbol: 'BNB', name: 'BNB', price: '$686.25', change: 1.56, volume: '$2.8B', marketCap: '$101.4B', category: ['All', 'BSC', 'Layer 1 / Layer 2'] },
  { symbol: 'SOL', name: 'Solana', price: '$84.97', change: 1.91, volume: '$4.1B', marketCap: '$40.1B', category: ['All', 'Solana', 'Layer 1 / Layer 2'] },
  { symbol: 'SNXXB', name: 'Synthetix Neo', price: '$4.45', change: 31.27, volume: '$120M', marketCap: '$1.4B', category: ['All', 'RWA', 'DeFi'] },
  { symbol: 'MUUB', name: 'Muubit Protocol', price: '$18.82', change: 26.99, volume: '$85M', marketCap: '$720M', category: ['All', 'AI', 'Seed'] },
  { symbol: 'CRWVB', name: 'Crowd Wave', price: '$60.33', change: 25.66, volume: '$210M', marketCap: '$2.3B', category: ['All', 'RWA', 'Launchpool'] },
  { symbol: 'APPB', name: 'Apple BStock', price: '$404.33', change: 2.28, volume: '$45M', marketCap: '$3.1B', category: ['All', 'bStocks', 'RWA'] },
  { symbol: 'BSPB', name: 'BioSys Pharma', price: '$40.29', change: -1.56, volume: '$12M', marketCap: '$450M', category: ['All', 'New', 'Seed'] },
  { symbol: 'GEVB', name: 'GenEnergy Vol', price: '$812.22', change: 2.84, volume: '$64M', marketCap: '$5.8B', category: ['All', 'tCommodities', 'RWA'] },
  { symbol: 'PEPE', name: 'Pepe', price: '$0.0000114', change: 14.20, volume: '$1.4B', marketCap: '$4.8B', category: ['All', 'MEME'] },
  { symbol: 'DOGE', name: 'Dogecoin', price: '$0.184', change: 5.80, volume: '$2.1B', marketCap: '$26.5B', category: ['All', 'MEME', 'Payments'] },
  { symbol: 'SHIB', name: 'Shiba Inu', price: '$0.000024', change: 3.40, volume: '$840M', marketCap: '$14.2B', category: ['All', 'MEME'] },
  { symbol: 'NEAR', name: 'NEAR Protocol', price: '$5.62', change: 4.15, volume: '$420M', marketCap: '$6.2B', category: ['All', 'AI', 'Layer 1 / Layer 2'] },
  { symbol: 'RENDER', name: 'Render Token', price: '$6.85', change: 8.90, volume: '$310M', marketCap: '$3.5B', category: ['All', 'AI', 'Solana'] },
  { symbol: 'FET', name: 'Artificial Superintelligence', price: '$1.42', change: 6.75, volume: '$280M', marketCap: '$3.6B', category: ['All', 'AI'] },
  { symbol: 'ONDO', name: 'Ondo Finance', price: '$0.95', change: 7.20, volume: '$190M', marketCap: '$1.3B', category: ['All', 'RWA'] },
  { symbol: 'PENDLE', name: 'Pendle Finance', price: '$4.80', change: 3.10, volume: '$95M', marketCap: '$760M', category: ['All', 'RWA', 'DeFi'] },
  { symbol: 'SUI', name: 'Sui Network', price: '$3.28', change: 12.40, volume: '$880M', marketCap: '$9.3B', category: ['All', 'Layer 1 / Layer 2'] },
  { symbol: 'APT', name: 'Aptos', price: '$9.84', change: -2.10, volume: '$310M', marketCap: '$4.8B', category: ['All', 'Layer 1 / Layer 2'] },
  { symbol: 'XRP', name: 'XRP', price: '$0.58', change: 0.85, volume: '$1.2B', marketCap: '$32.8B', category: ['All', 'Payments'] },
  { symbol: 'ADA', name: 'Cardano', price: '$0.42', change: -0.45, volume: '$450M', marketCap: '$15.1B', category: ['All', 'Layer 1 / Layer 2'] },
  { symbol: 'AVAX', name: 'Avalanche', price: '$27.80', change: 2.30, volume: '$520M', marketCap: '$11.2B', category: ['All', 'Layer 1 / Layer 2'] },
  { symbol: 'LINK', name: 'Chainlink', price: '$13.20', change: 1.80, volume: '$340M', marketCap: '$7.9B', category: ['All', 'DeFi', 'RWA'] },
  { symbol: 'GALA', name: 'Gala Games', price: '$0.024', change: 6.40, volume: '$150M', marketCap: '$820M', category: ['All', 'Gaming'] },
  { symbol: 'IMX', name: 'ImmutableX', price: '$1.48', change: 4.80, volume: '$110M', marketCap: '$2.3B', category: ['All', 'Gaming', 'Layer 1 / Layer 2'] },
  { symbol: 'AXS', name: 'Axie Infinity', price: '$5.40', change: 2.10, volume: '$85M', marketCap: '$780M', category: ['All', 'Gaming'] },
  { symbol: 'NVDA-S', name: 'NVIDIA Stock Token', price: '$142.50', change: 4.50, volume: '$85M', marketCap: '$3.5T', category: ['All', 'bStocks', 'RWA'] },
  { symbol: 'TSLA-S', name: 'Tesla Stock Token', price: '$218.00', change: -1.20, volume: '$62M', marketCap: '$690B', category: ['All', 'bStocks', 'RWA'] },
  { symbol: 'XAU-C', name: 'Gold Tokenized', price: '$2,740.00', change: 0.42, volume: '$140M', marketCap: '$8.2B', category: ['All', 'tCommodities', 'RWA'] },
  { symbol: 'XAG-C', name: 'Silver Tokenized', price: '$32.50', change: -0.80, volume: '$48M', marketCap: '$1.8B', category: ['All', 'tCommodities', 'RWA'] },
];

export default function TradingMarketPage() {
  const [topTab, setTopTab] = useState<'Overview' | 'Trading Data' | 'Token Unlock'>('Overview');
  const [marketType, setMarketType] = useState<string>('Cryptos');
  const [category, setCategory] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [timeframe, setTimeframe] = useState<'24h' | '7d' | '30d'>('24h');

  // Top 4 card categories
  const topCoins = [
    { symbol: 'BNB', price: '$686.25', change: 1.56, iconBg: 'bg-amber-400 text-black' },
    { symbol: 'BTC', price: '$74.53K', change: 1.02, iconBg: 'bg-orange-500 text-white' },
    { symbol: 'ETH', price: '$2.08K', change: 1.10, iconBg: 'bg-indigo-500 text-white' },
  ];

  const newCoins = [
    { symbol: 'APPB', price: '$404.33', change: 2.28, iconBg: 'bg-cyan-500 text-black' },
    { symbol: 'BSPB', price: '$40.29', change: -1.56, iconBg: 'bg-yellow-600 text-black' },
    { symbol: 'GEVB', price: '$812.22', change: 2.84, iconBg: 'bg-teal-500 text-black' },
  ];

  const gainerCoins = [
    { symbol: 'SNXXB', price: '$4.45', change: 31.27, iconBg: 'bg-rose-500 text-white' },
    { symbol: 'MUUB', price: '$18.82', change: 26.99, iconBg: 'bg-blue-600 text-white' },
    { symbol: 'CRWVB', price: '$60.33', change: 25.66, iconBg: 'bg-indigo-600 text-white' },
  ];

  const volumeCoins = [
    { symbol: 'BTC', price: '$74.53K', change: 1.02, iconBg: 'bg-orange-500 text-white' },
    { symbol: 'ETH', price: '$2.08K', change: 1.10, iconBg: 'bg-indigo-500 text-white' },
    { symbol: 'SOL', price: '$84.97', change: 1.91, iconBg: 'bg-violet-600 text-white' },
  ];

  const categories = [
    'All',
    'bStocks',
    'tCommodities',
    'BSC',
    'Solana',
    'RWA',
    'MEME',
    'Payments',
    'AI',
    'Layer 1 / Layer 2',
    'Seed',
    'Launchpool',
    'Megadrop',
    'Gaming',
    'DeFi',
  ];

  const marketTypes = [
    { id: 'Favorites', label: 'Favorites' },
    { id: 'Cryptos', label: 'Cryptos' },
    { id: 'Spot', label: 'Spot' },
    { id: 'Futures', label: 'Futures' },
    { id: 'TradFi', label: 'TradFi', isNew: true },
    { id: 'Alpha', label: 'Alpha' },
    { id: 'New', label: 'New' },
    { id: 'Zones', label: 'Zones' },
  ];

  const filteredCoins = ALL_COINS.filter((c) => {
    const matchSearch =
      c.symbol.toLowerCase().includes(search.toLowerCase()) ||
      c.name.toLowerCase().includes(search.toLowerCase());
    if (!matchSearch) return false;

    if (category === 'All') return true;
    return c.category.includes(category);
  });

  return (
    <TradingShell fullWidth>
      <div className="mx-auto max-w-7xl px-2 sm:px-4 py-4 space-y-6">

        {/* ── TOP SECTION: Overview / Trading Data / Token Unlock ── */}
        <div className="flex items-center gap-6 border-b border-white/5 pb-2">
          {(['Overview', 'Trading Data', 'Token Unlock'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setTopTab(tab)}
              className={`text-base sm:text-lg font-bold transition ${
                topTab === tab ? 'text-white border-b-2 border-white pb-2' : 'text-slate-400 hover:text-white'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* ── 4 BINANCE HIGHLIGHT CARDS (Top, New, Top Gainer, Top Volume) ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          
          {/* Card 1: Top */}
          <div className="rounded-2xl border border-white/10 bg-[#121620] p-4 shadow-lg space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400 font-semibold">
              <span className="text-white font-bold">Top</span>
              <button className="hover:text-amber-400 transition text-[11px] flex items-center">More &gt;</button>
            </div>
            <div className="space-y-2.5">
              {topCoins.map((coin) => (
                <div key={coin.symbol} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold ${coin.iconBg}`}>
                      {coin.symbol.slice(0, 3)}
                    </span>
                    <span className="font-bold text-white">{coin.symbol}</span>
                  </div>
                  <span className="font-mono text-slate-200">{coin.price}</span>
                  <span className={`font-mono text-xs font-bold ${coin.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {coin.change >= 0 ? '+' : ''}{coin.change}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Card 2: New */}
          <div className="rounded-2xl border border-white/10 bg-[#121620] p-4 shadow-lg space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400 font-semibold">
              <span className="text-white font-bold">New</span>
              <button className="hover:text-amber-400 transition text-[11px] flex items-center">More &gt;</button>
            </div>
            <div className="space-y-2.5">
              {newCoins.map((coin) => (
                <div key={coin.symbol} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold ${coin.iconBg}`}>
                      {coin.symbol.slice(0, 3)}
                    </span>
                    <span className="font-bold text-white">{coin.symbol}</span>
                  </div>
                  <span className="font-mono text-slate-200">{coin.price}</span>
                  <span className={`font-mono text-xs font-bold ${coin.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {coin.change >= 0 ? '+' : ''}{coin.change}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Card 3: Top Gainer */}
          <div className="rounded-2xl border border-white/10 bg-[#121620] p-4 shadow-lg space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400 font-semibold">
              <span className="text-white font-bold">Top Gainer</span>
              <button className="hover:text-amber-400 transition text-[11px] flex items-center">More &gt;</button>
            </div>
            <div className="space-y-2.5">
              {gainerCoins.map((coin) => (
                <div key={coin.symbol} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold ${coin.iconBg}`}>
                      {coin.symbol.slice(0, 3)}
                    </span>
                    <span className="font-bold text-white">{coin.symbol}</span>
                  </div>
                  <span className="font-mono text-slate-200">{coin.price}</span>
                  <span className={`font-mono text-xs font-bold ${coin.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    +{coin.change}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Card 4: Top Volume */}
          <div className="rounded-2xl border border-white/10 bg-[#121620] p-4 shadow-lg space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400 font-semibold">
              <span className="text-white font-bold">Top Volume</span>
              <button className="hover:text-amber-400 transition text-[11px] flex items-center">More &gt;</button>
            </div>
            <div className="space-y-2.5">
              {volumeCoins.map((coin) => (
                <div key={coin.symbol} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold ${coin.iconBg}`}>
                      {coin.symbol.slice(0, 3)}
                    </span>
                    <span className="font-bold text-white">{coin.symbol}</span>
                  </div>
                  <span className="font-mono text-slate-200">{coin.price}</span>
                  <span className={`font-mono text-xs font-bold ${coin.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    +{coin.change}%
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* ── MARKET TABS ROW (Favorites, Cryptos, Spot, Futures, TradFi, Alpha, New, Zones) ── */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-4 border-t border-white/5">
          <div className="flex items-center gap-4 sm:gap-6 overflow-x-auto scrollbar-none text-xs sm:text-sm font-semibold">
            {marketTypes.map((mt) => (
              <button
                key={mt.id}
                onClick={() => setMarketType(mt.id)}
                className={`flex items-center gap-1.5 transition pb-1 whitespace-nowrap ${
                  marketType === mt.id ? 'text-white border-b-2 border-amber-400 font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>{mt.label}</span>
                {mt.isNew && (
                  <span className="rounded bg-amber-400/20 px-1 py-0.2 text-[9px] font-bold text-amber-300">
                    New
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {/* Quick search input */}
            <div className="relative">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search coin..."
                className="h-8 w-36 sm:w-48 rounded-full border border-white/10 bg-[#121620] pl-8 pr-3 text-xs text-white placeholder:text-slate-500 outline-none focus:border-amber-400"
              />
              <svg
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <circle cx="11" cy="11" r="7" strokeWidth={2} />
                <path d="M20 20l-3.5-3.5" strokeWidth={2} strokeLinecap="round" />
              </svg>
            </div>

            <button
              type="button"
              className="p-1.5 rounded-full border border-white/10 bg-[#121620] text-slate-400 hover:text-white transition"
              title="Notifications"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── SUBCATEGORY PILLS (All, bStocks, tCommodities, BSC, Solana, RWA, MEME, AI, etc.) ── */}
        <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto scrollbar-none py-1">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap transition flex items-center gap-1 ${
                category === cat
                  ? 'bg-white/15 text-white font-bold border border-white/20'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span>{cat}</span>
              {cat === 'bStocks' && (
                <span className="text-[9px] font-bold text-amber-300 ml-0.5">New</span>
              )}
            </button>
          ))}
        </div>

        {/* ── TOP TOKENS HEADER BANNER ── */}
        <div className="space-y-1 pt-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base sm:text-lg font-bold text-white">Top Tokens by Market Capitalization</h2>
            <button className="text-xs text-slate-400 hover:text-amber-400 font-semibold transition flex items-center gap-0.5">
              <span>More</span>
              <span>&gt;</span>
            </button>
          </div>
          <p className="text-xs text-slate-400 max-w-4xl">
            Get a comprehensive snapshot of all cryptocurrencies available on Royale Exchange. This page displays the latest prices, 24-hour trading volume, price changes, and market capitalizations for all cryptocurrencies.
          </p>
        </div>

        {/* ── BINANCE-STYLE FULL MARKETS TABLE ── */}
        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#121620] shadow-xl">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-white/5 text-[11px] font-semibold text-slate-400">
              <tr>
                <th className="py-3 px-4 font-medium">Name ⇅</th>
                <th className="py-3 px-4 text-right font-medium">Price ⇅</th>
                <th className="py-3 px-4 text-right font-medium">
                  <div className="inline-flex items-center gap-1 rounded bg-white/5 px-2 py-0.5 text-[10px] text-white">
                    <span>{timeframe}</span>
                    <button
                      onClick={() => setTimeframe(t => t === '24h' ? '7d' : t === '7d' ? '30d' : '24h')}
                      className="text-slate-400 hover:text-white"
                    >
                      ▾
                    </button>
                  </div>{' '}
                  Change ⇅
                </th>
                <th className="py-3 px-4 text-right font-medium hidden sm:table-cell">24h Volume ⇅</th>
                <th className="py-3 px-4 text-right font-medium hidden md:table-cell">Market Cap ⇅</th>
                <th className="py-3 px-4 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredCoins.map((coin) => {
                const isUp = coin.change >= 0;
                return (
                  <tr key={coin.symbol} className="hover:bg-white/[0.02] transition">
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-400/10 font-bold text-amber-300 text-xs shadow-inner">
                          {coin.symbol.slice(0, 3)}
                        </span>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-white text-sm">{coin.symbol}</span>
                            <span className="text-[11px] text-slate-400 hidden xs:inline">{coin.name}</span>
                          </div>
                          <div className="text-[10px] text-slate-500 xs:hidden">{coin.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-white text-sm">
                      {coin.price}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-bold">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-xs ${
                          isUp ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
                        }`}
                      >
                        {isUp ? '+' : ''}{coin.change}%
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-300 hidden sm:table-cell">
                      {coin.volume}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-300 hidden md:table-cell">
                      {coin.marketCap}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <Link
                        href={`/trading?symbol=${coin.symbol}USD`}
                        className="rounded-lg bg-amber-400/15 px-3 py-1 font-bold text-amber-300 hover:bg-amber-400 hover:text-black transition text-xs active:scale-95 inline-block"
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
    </TradingShell>
  );
}

'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { TradingShell } from '@/components/trading/trading-shell';
import { getLiveMarketQuotes, type LiveMarketQuote } from '@/lib/api/live-rates';
import { listTradingInstruments, type TradingInstrumentView } from '@/lib/api/trading';

interface CoinItem {
  symbol: string;
  name: string;
  price: string;
  priceNum: number;
  change: number;
  high?: string;
  low?: string;
  volume: string;
  volumeNum: number;
  marketCap: string;
  category: string[];
  type?: string;
}

const DEFAULT_MARKET_COINS: CoinItem[] = [
  { symbol: 'BTC', name: 'Bitcoin', price: '$74,530.20', priceNum: 74530.20, change: 1.02, volume: '$32.4B', volumeNum: 32.4e9, marketCap: '$1.46T', category: ['All', 'Cryptos', 'Spot', 'Futures', 'Layer 1 / Layer 2', 'Payments'] },
  { symbol: 'ETH', name: 'Ethereum', price: '$2,084.50', priceNum: 2084.50, change: 1.10, volume: '$18.2B', volumeNum: 18.2e9, marketCap: '$251.2B', category: ['All', 'Cryptos', 'Spot', 'Futures', 'Layer 1 / Layer 2'] },
  { symbol: 'BNB', name: 'BNB', price: '$686.25', priceNum: 686.25, change: 1.56, volume: '$2.8B', volumeNum: 2.8e9, marketCap: '$101.4B', category: ['All', 'Cryptos', 'Spot', 'Futures', 'BSC', 'Layer 1 / Layer 2'] },
  { symbol: 'SOL', name: 'Solana', price: '$84.97', priceNum: 84.97, change: 1.91, volume: '$4.1B', volumeNum: 4.1e9, marketCap: '$40.1B', category: ['All', 'Cryptos', 'Spot', 'Futures', 'Solana', 'Layer 1 / Layer 2'] },
  { symbol: 'XRP', name: 'XRP', price: '$0.58', priceNum: 0.58, change: 0.85, volume: '$1.2B', volumeNum: 1.2e9, marketCap: '$32.8B', category: ['All', 'Cryptos', 'Spot', 'Payments'] },
  { symbol: 'DOGE', name: 'Dogecoin', price: '$0.184', priceNum: 0.184, change: 5.80, volume: '$2.1B', volumeNum: 2.1e9, marketCap: '$26.5B', category: ['All', 'Cryptos', 'MEME', 'Payments'] },
  { symbol: 'PEPE', name: 'Pepe', price: '$0.0000114', priceNum: 0.0000114, change: 14.20, volume: '$1.4B', volumeNum: 1.4e9, marketCap: '$4.8B', category: ['All', 'Cryptos', 'MEME'] },
  { symbol: 'NEAR', name: 'NEAR Protocol', price: '$5.62', priceNum: 5.62, change: 4.15, volume: '$420M', volumeNum: 420e6, marketCap: '$6.2B', category: ['All', 'Cryptos', 'AI', 'Layer 1 / Layer 2'] },
  { symbol: 'SUI', name: 'Sui Network', price: '$3.28', priceNum: 3.28, change: 12.40, volume: '$880M', volumeNum: 880e6, marketCap: '$9.3B', category: ['All', 'Cryptos', 'Layer 1 / Layer 2'] },
  { symbol: 'APT', name: 'Aptos', price: '$9.84', priceNum: 9.84, change: -2.10, volume: '$310M', volumeNum: 310e6, marketCap: '$4.8B', category: ['All', 'Cryptos', 'Layer 1 / Layer 2'] },
  { symbol: 'NVDA', name: 'NVIDIA Corp', price: '$142.50', priceNum: 142.50, change: 4.50, volume: '$8.5B', volumeNum: 8.5e9, marketCap: '$3.5T', category: ['All', 'TradFi', 'bStocks', 'RWA'] },
  { symbol: 'TSLA', name: 'Tesla Inc', price: '$218.00', priceNum: 218.00, change: -1.20, volume: '$6.2B', volumeNum: 6.2e9, marketCap: '$690B', category: ['All', 'TradFi', 'bStocks', 'RWA'] },
  { symbol: 'AAPL', name: 'Apple Inc', price: '$228.50', priceNum: 228.50, change: 0.65, volume: '$4.5B', volumeNum: 4.5e9, marketCap: '$3.4T', category: ['All', 'TradFi', 'bStocks', 'RWA'] },
  { symbol: 'XAUUSD', name: 'Gold Spot', price: '$2,740.00', priceNum: 2740.00, change: 0.42, volume: '$14.0B', volumeNum: 14.0e9, marketCap: '$17.2T', category: ['All', 'TradFi', 'tCommodities', 'RWA'] },
  { symbol: 'EURUSD', name: 'Euro / US Dollar', price: '1.0842', priceNum: 1.0842, change: 0.15, volume: '$88.0B', volumeNum: 88.0e9, marketCap: '—', category: ['All', 'TradFi', 'Forex'] },
];

export default function TradingMarketPage() {
  const [topTab, setTopTab] = useState<'Overview' | 'Trading Data' | 'Token Unlock'>('Overview');
  const [marketType, setMarketType] = useState<string>('Cryptos');
  const [category, setCategory] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'price' | 'change' | 'volume'>('volume');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [favorites, setFavorites] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('tr_market_favs');
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return ['BTC', 'ETH', 'SOL', 'NVDA'];
  });

  const [liveQuotes, setLiveQuotes] = useState<Record<string, LiveMarketQuote>>({});
  const [backendInstruments, setBackendInstruments] = useState<TradingInstrumentView[]>([]);

  // Fetch backend instruments once
  useEffect(() => {
    let mounted = true;
    listTradingInstruments()
      .then((insts) => {
        if (mounted && insts && insts.length > 0) {
          setBackendInstruments(insts);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  // Poll live market quotes every 3s
  useEffect(() => {
    let mounted = true;
    async function sync() {
      try {
        const q = await getLiveMarketQuotes();
        if (mounted && q && Object.keys(q).length > 0) setLiveQuotes(q);
      } catch {}
    }
    void sync();
    const interval = setInterval(() => void sync(), 3000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const toggleFavorite = (symbol: string) => {
    setFavorites((prev) => {
      const next = prev.includes(symbol)
        ? prev.filter((s) => s !== symbol)
        : [...prev, symbol];
      if (typeof window !== 'undefined') {
        localStorage.setItem('tr_market_favs', JSON.stringify(next));
      }
      return next;
    });
  };

  const getCoinPrice = (sym: string, fallback: string) => {
    const cleanSym = sym.replace(/-[A-Z]$/, '');
    const q = liveQuotes[cleanSym + 'USD'] || liveQuotes[cleanSym + 'USDT'] || liveQuotes[cleanSym] || liveQuotes[sym];
    if (q && q.currentPrice > 0) {
      const p = q.currentPrice / 100;
      if (p >= 1000) return `$${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      if (p >= 1) return `$${p.toFixed(2)}`;
      if (p > 0.001) return `$${p.toFixed(4)}`;
      return `$${p.toFixed(7)}`;
    }
    return fallback;
  };

  const getCoinChange = (sym: string, fallback: number) => {
    const cleanSym = sym.replace(/-[A-Z]$/, '');
    const q = liveQuotes[cleanSym + 'USD'] || liveQuotes[cleanSym + 'USDT'] || liveQuotes[cleanSym] || liveQuotes[sym];
    if (q) return q.change24h / 100;
    return fallback;
  };

  // Top highlight cards
  const topCoins = [
    { symbol: 'BNB', price: getCoinPrice('BNB', '$686.25'), change: getCoinChange('BNB', 1.56), iconBg: 'bg-amber-400 text-black' },
    { symbol: 'BTC', price: getCoinPrice('BTC', '$74,530.20'), change: getCoinChange('BTC', 1.02), iconBg: 'bg-[#F0B90B] text-black' },
    { symbol: 'ETH', price: getCoinPrice('ETH', '$2,084.50'), change: getCoinChange('ETH', 1.10), iconBg: 'bg-indigo-500 text-white' },
  ];

  const gainerCoins = [
    { symbol: 'PEPE', price: getCoinPrice('PEPE', '$0.0000114'), change: getCoinChange('PEPE', 14.20), iconBg: 'bg-emerald-500 text-white' },
    { symbol: 'SUI', price: getCoinPrice('SUI', '$3.28'), change: getCoinChange('SUI', 12.40), iconBg: 'bg-blue-400 text-white' },
    { symbol: 'DOGE', price: getCoinPrice('DOGE', '$0.184'), change: getCoinChange('DOGE', 5.80), iconBg: 'bg-amber-400 text-black' },
  ];

  const volumeCoins = [
    { symbol: 'BTC', price: getCoinPrice('BTC', '$74,530.20'), change: getCoinChange('BTC', 1.02), iconBg: 'bg-[#F0B90B] text-black' },
    { symbol: 'ETH', price: getCoinPrice('ETH', '$2,084.50'), change: getCoinChange('ETH', 1.10), iconBg: 'bg-indigo-500 text-white' },
    { symbol: 'SOL', price: getCoinPrice('SOL', '$84.97'), change: getCoinChange('SOL', 1.91), iconBg: 'bg-purple-500 text-white' },
  ];

  const categories = [
    'All',
    'Layer 1 / Layer 2',
    'bStocks',
    'tCommodities',
    'BSC',
    'Solana',
    'RWA',
    'MEME',
    'Payments',
    'AI',
    'DeFi',
  ];

  const marketTypes = [
    { id: 'Favorites', label: 'Favorites' },
    { id: 'Cryptos', label: 'Cryptos' },
    { id: 'Spot', label: 'Spot' },
    { id: 'Futures', label: 'Futures' },
    { id: 'TradFi', label: 'TradFi', isNew: true },
  ];

  // Merge backend instruments with DEFAULT_MARKET_COINS
  const mergedCoins = useMemo(() => {
    const list = [...DEFAULT_MARKET_COINS];
    backendInstruments.forEach((bi) => {
      const existing = list.find((c) => c.symbol === bi.symbol || c.symbol + 'USD' === bi.symbol);
      if (existing) {
        existing.priceNum = bi.currentPrice / 100;
        existing.change = (bi.change24h ?? 0) / 100;
        existing.high = `$${((bi.high24h ?? bi.currentPrice) / 100).toFixed(2)}`;
        existing.low = `$${((bi.low24h ?? bi.currentPrice) / 100).toFixed(2)}`;
      } else {
        list.push({
          symbol: bi.symbol,
          name: bi.name,
          price: `$${(bi.currentPrice / 100).toFixed(2)}`,
          priceNum: bi.currentPrice / 100,
          change: (bi.change24h ?? 0) / 100,
          high: `$${((bi.high24h ?? bi.currentPrice) / 100).toFixed(2)}`,
          low: `$${((bi.low24h ?? bi.currentPrice) / 100).toFixed(2)}`,
          volume: bi.volume24h ? `$${(bi.volume24h / 1e6).toFixed(2)}M` : '$10.0M',
          volumeNum: bi.volume24h || 10e6,
          marketCap: '$1.0B',
          category: ['All', bi.type === 'CRYPTO' ? 'Cryptos' : 'TradFi'],
          type: bi.type,
        });
      }
    });

    // Apply live quotes
    return list.map((c) => {
      const q = liveQuotes[c.symbol + 'USD'] || liveQuotes[c.symbol + 'USDT'] || liveQuotes[c.symbol];
      if (q && q.currentPrice > 0) {
        const p = q.currentPrice / 100;
        return {
          ...c,
          priceNum: p,
          price: p >= 1000 ? `$${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `$${p.toFixed(2)}`,
          change: q.change24h / 100,
        };
      }
      return c;
    });
  }, [backendInstruments, liveQuotes]);

  // Filtering & Sorting
  const filteredCoins = useMemo(() => {
    return mergedCoins
      .filter((coin) => {
        if (marketType === 'Favorites') {
          if (!favorites.includes(coin.symbol)) return false;
        } else if (marketType === 'TradFi') {
          if (!coin.category.includes('TradFi') && !coin.category.includes('bStocks') && !coin.category.includes('tCommodities')) return false;
        } else if (marketType === 'Cryptos') {
          if (!coin.category.includes('Cryptos')) return false;
        }

        if (category !== 'All' && !coin.category.includes(category)) {
          return false;
        }

        if (search.trim()) {
          const s = search.toLowerCase();
          return coin.symbol.toLowerCase().includes(s) || coin.name.toLowerCase().includes(s);
        }

        return true;
      })
      .sort((a, b) => {
        let cmp = 0;
        if (sortBy === 'name') cmp = a.symbol.localeCompare(b.symbol);
        else if (sortBy === 'price') cmp = a.priceNum - b.priceNum;
        else if (sortBy === 'change') cmp = a.change - b.change;
        else if (sortBy === 'volume') cmp = a.volumeNum - b.volumeNum;
        return sortOrder === 'asc' ? cmp : -cmp;
      });
  }, [mergedCoins, marketType, category, search, sortBy, sortOrder, favorites]);

  const handleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  return (
    <TradingShell>
      <div className="space-y-8 max-w-7xl mx-auto py-2">
        {/* Top Highlight Cards (Binance Style) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Card 1: Highlights */}
          <div className="rounded-2xl border border-ink-700/80 bg-ink-900/60 p-5 shadow-xl backdrop-blur space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-slate-400">
              <span className="text-white">Hot Market</span>
              <span className="text-[10px] text-amber-400">Live</span>
            </div>
            <div className="space-y-2.5">
              {topCoins.map((c) => (
                <Link
                  key={c.symbol}
                  href={`/trading?symbol=${c.symbol}USD`}
                  className="flex items-center justify-between hover:bg-white/5 p-1 rounded-lg transition"
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold ${c.iconBg}`}>
                      {c.symbol.slice(0, 2)}
                    </span>
                    <span className="font-bold text-xs text-white">{c.symbol}</span>
                  </div>
                  <div className="text-right font-mono text-xs">
                    <span className="text-white font-bold">{c.price}</span>
                    <span className={`ml-2 text-[11px] ${c.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {c.change >= 0 ? '+' : ''}{c.change.toFixed(2)}%
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Card 2: Top Gainers */}
          <div className="rounded-2xl border border-ink-700/80 bg-ink-900/60 p-5 shadow-xl backdrop-blur space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-slate-400">
              <span className="text-white">Top Gainers</span>
              <span className="text-[10px] text-emerald-400">24h</span>
            </div>
            <div className="space-y-2.5">
              {gainerCoins.map((c) => (
                <Link
                  key={c.symbol}
                  href={`/trading?symbol=${c.symbol}USD`}
                  className="flex items-center justify-between hover:bg-white/5 p-1 rounded-lg transition"
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold ${c.iconBg}`}>
                      {c.symbol.slice(0, 2)}
                    </span>
                    <span className="font-bold text-xs text-white">{c.symbol}</span>
                  </div>
                  <div className="text-right font-mono text-xs">
                    <span className="text-white font-bold">{c.price}</span>
                    <span className="ml-2 text-[11px] text-emerald-400 font-bold">
                      +{c.change.toFixed(2)}%
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Card 3: Top Volume */}
          <div className="rounded-2xl border border-ink-700/80 bg-ink-900/60 p-5 shadow-xl backdrop-blur space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-slate-400">
              <span className="text-white">Top Volume</span>
              <span className="text-[10px] text-purple-400">Turnover</span>
            </div>
            <div className="space-y-2.5">
              {volumeCoins.map((c) => (
                <Link
                  key={c.symbol}
                  href={`/trading?symbol=${c.symbol}USD`}
                  className="flex items-center justify-between hover:bg-white/5 p-1 rounded-lg transition"
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold ${c.iconBg}`}>
                      {c.symbol.slice(0, 2)}
                    </span>
                    <span className="font-bold text-xs text-white">{c.symbol}</span>
                  </div>
                  <div className="text-right font-mono text-xs">
                    <span className="text-white font-bold">{c.price}</span>
                    <span className={`ml-2 text-[11px] ${c.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {c.change >= 0 ? '+' : ''}{c.change.toFixed(2)}%
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* Market Filter Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-ink-800 pb-3">
          {/* Main Market Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
            {marketTypes.map((mt) => (
              <button
                key={mt.id}
                type="button"
                onClick={() => setMarketType(mt.id)}
                className={`rounded-xl px-4 py-2 text-xs font-bold transition whitespace-nowrap ${
                  marketType === mt.id
                    ? 'bg-amber-400/15 text-amber-400 border border-amber-400/40 shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                <span>{mt.label}</span>
                {mt.isNew && (
                  <span className="ml-1.5 rounded bg-amber-400/20 px-1 py-0.2 text-[9px] font-bold text-amber-300">
                    New
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search markets..."
              className="h-9 w-full sm:w-56 rounded-full border border-ink-700 bg-ink-950 pl-8 pr-3 text-xs text-white placeholder-slate-500 outline-none focus:border-amber-400 transition"
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
        </div>

        {/* Subcategories (Pills) */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-1">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold whitespace-nowrap transition ${
                category === cat
                  ? 'bg-white/15 text-white font-bold border border-white/20'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Markets Table */}
        <div className="overflow-x-auto rounded-2xl border border-ink-700/80 bg-ink-900/60 shadow-2xl backdrop-blur">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-ink-800 text-[11px] font-bold text-slate-400 uppercase tracking-wider bg-ink-950/40">
              <tr>
                <th className="py-3 px-4 w-10 text-center">★</th>
                <th
                  onClick={() => handleSort('name')}
                  className="py-3 px-4 font-semibold cursor-pointer hover:text-white transition"
                >
                  Pair {sortBy === 'name' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th
                  onClick={() => handleSort('price')}
                  className="py-3 px-4 text-right font-semibold cursor-pointer hover:text-white transition"
                >
                  Price {sortBy === 'price' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th
                  onClick={() => handleSort('change')}
                  className="py-3 px-4 text-right font-semibold cursor-pointer hover:text-white transition"
                >
                  24h Change {sortBy === 'change' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th
                  onClick={() => handleSort('volume')}
                  className="py-3 px-4 text-right font-semibold cursor-pointer hover:text-white transition hidden sm:table-cell"
                >
                  24h Volume {sortBy === 'volume' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th className="py-3 px-4 text-right font-semibold hidden md:table-cell">Market Cap</th>
                <th className="py-3 px-4 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800">
              {filteredCoins.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500 font-medium">
                    No market pairs found matching your criteria.
                  </td>
                </tr>
              ) : (
                filteredCoins.map((coin) => {
                  const isUp = coin.change >= 0;
                  const isFav = favorites.includes(coin.symbol);
                  const tradeLink = `/trading?symbol=${coin.symbol.includes('USD') ? coin.symbol : coin.symbol + 'USD'}`;

                  return (
                    <tr key={coin.symbol} className="hover:bg-white/[0.02] transition">
                      <td className="py-3 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => toggleFavorite(coin.symbol)}
                          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                          className={`text-sm transition ${isFav ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'}`}
                        >
                          {isFav ? '★' : '☆'}
                        </button>
                      </td>
                      <td className="py-3 px-4">
                        <Link href={tradeLink} className="flex items-center gap-2.5 group">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-400/10 font-bold text-amber-400 text-xs shadow-inner">
                            {coin.symbol.slice(0, 3)}
                          </span>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-white text-sm group-hover:text-amber-400 transition">
                                {coin.symbol}
                              </span>
                              <span className="text-[11px] text-slate-400 hidden xs:inline">{coin.name}</span>
                            </div>
                            <div className="text-[10px] text-slate-500 xs:hidden">{coin.name}</div>
                          </div>
                        </Link>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-white text-sm">
                        {coin.price}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold">
                        <span
                          className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${
                            isUp ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
                          }`}
                        >
                          {isUp ? '+' : ''}{coin.change.toFixed(2)}%
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-300 hidden sm:table-cell">
                        {coin.volume}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-400 hidden md:table-cell">
                        {coin.marketCap}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Link
                          href={tradeLink}
                          className="rounded-lg bg-amber-400/15 px-3 py-1 font-bold text-amber-300 hover:bg-amber-400 hover:text-ink-950 transition text-xs active:scale-95 inline-block"
                        >
                          Trade
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </TradingShell>
  );
}

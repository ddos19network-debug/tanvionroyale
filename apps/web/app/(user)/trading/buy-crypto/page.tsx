'use client';

import { useState } from 'react';
import { TradingShell } from '@/components/trading/trading-shell';

const CRYPTO_TABS = [
  { symbol: 'USDT', label: 'USDT', apr: '10.25% APR', hasApr: true },
  { symbol: 'BTC', label: 'BTC', apr: undefined, hasApr: false },
  { symbol: 'USDC', label: 'USDC', apr: undefined, hasApr: false },
  { symbol: 'FDUSD', label: 'FDUSD', apr: undefined, hasApr: false },
  { symbol: 'BNB', label: 'BNB', apr: undefined, hasApr: false },
  { symbol: 'ETH', label: 'ETH', apr: undefined, hasApr: false },
  { symbol: 'ADA', label: 'ADA', apr: undefined, hasApr: false },
  { symbol: 'SHIB', label: 'SHIB', apr: undefined, hasApr: false },
  { symbol: 'DOGE', label: 'DOGE', apr: undefined, hasApr: false },
  { symbol: 'TRX', label: 'TRX', apr: undefined, hasApr: false },
  { symbol: 'SOL', label: 'SOL', apr: undefined, hasApr: false },
  { symbol: 'PEPE', label: 'PEPE', apr: undefined, hasApr: false },
  { symbol: 'TRUMP', label: 'TRUMP', apr: undefined, hasApr: false },
  { symbol: 'DOLO', label: 'DOLO', apr: undefined, hasApr: false },
  { symbol: 'XPL', label: 'XPL', apr: undefined, hasApr: false },
  { symbol: 'ASTER', label: 'ASTER', apr: undefined, hasApr: false },
];

const ADVERTISERS = [
  {
    id: 1,
    name: 'Believers24H__SK',
    verified: true,
    orders: '7,400 orders',
    completion: '99.90%',
    positive: '99.89%',
    avgTime: '15 min',
    price: 'Tk. 130.08',
    available: '829.85 USDT',
    limit: '9,000 BDT - 49,100 BDT',
    payment: 'bKash',
    paymentColor: 'text-pink-400',
  },
  {
    id: 2,
    name: 'Safe--P2P--Exchange',
    verified: true,
    orders: '5,797 orders',
    completion: '99.90%',
    positive: '99.34%',
    avgTime: '15 min',
    price: 'Tk. 130.45',
    available: '1,198.08 USDT',
    limit: '15,000 BDT - 49,100 BDT',
    payment: 'bKash',
    paymentColor: 'text-pink-400',
  },
  {
    id: 3,
    name: 'CryptoKing24x7',
    verified: false,
    orders: '3,210 orders',
    completion: '98.45%',
    positive: '97.12%',
    avgTime: '22 min',
    price: 'Tk. 131.20',
    available: '2,450.00 USDT',
    limit: '5,000 BDT - 50,000 BDT',
    payment: 'Nagad',
    paymentColor: 'text-amber-400',
  },
  {
    id: 4,
    name: 'BDT_Trader_Pro',
    verified: true,
    orders: '12,500 orders',
    completion: '99.80%',
    positive: '99.55%',
    avgTime: '10 min',
    price: 'Tk. 129.85',
    available: '5,000.00 USDT',
    limit: '1,000 BDT - 100,000 BDT',
    payment: 'Rocket',
    paymentColor: 'text-emerald-400',
  },
  {
    id: 5,
    name: 'QuickP2P_BD',
    verified: false,
    orders: '1,890 orders',
    completion: '97.20%',
    positive: '95.80%',
    avgTime: '35 min',
    price: 'Tk. 132.10',
    available: '675.50 USDT',
    limit: '3,000 BDT - 30,000 BDT',
    payment: 'bKash',
    paymentColor: 'text-pink-400',
  },
];

export default function TradingBuyCryptoPage() {
  const [mode, setMode] = useState<'BUY' | 'SELL'>('BUY');
  const [activeTab, setActiveTab] = useState('USDT');
  const [amountFilter, setAmountFilter] = useState('Transaction amount');
  const [fiatCurrency, setFiatCurrency] = useState('BDT');
  const [paymentFilter, setPaymentFilter] = useState('All payment methods');
  const [sortBy, setSortBy] = useState('Price');

  return (
    <TradingShell>
      <div className="w-full py-4 sm:py-6 px-4 sm:px-6 lg:px-8">
        {/* P2P Header Tabs */}
        <div className="flex items-center justify-between px-2 mb-6">
          <div className="flex gap-1 rounded-lg border border-ink-800/50 bg-ink-900/50 p-1">
            <button
              onClick={() => setMode('BUY')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition ${mode === 'BUY' ? 'bg-ink-800 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              Buy
            </button>
            <button
              onClick={() => setMode('SELL')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition ${mode === 'SELL' ? 'bg-ink-800 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              Sell
            </button>
          </div>
        {/* Crypto Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide">
          {CRYPTO_TABS.map((tab) => (
            <button
              key={tab.symbol}
              onClick={() => setActiveTab(tab.symbol)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
                activeTab === tab.symbol
                  ? 'bg-brand/10 text-brand border border-brand/40'
                  : 'text-slate-400 hover:text-white hover:bg-ink-800/50'
              }`}
            >
              {tab.symbol}
              {tab.hasApr && (
                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
                  {tab.apr}
                </span>
              )}
            </button>
          ))}
          <button className="px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-ink-800/50 transition">
            More ▾
          </button>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-col lg:flex-row gap-3 items-start lg:items-center mb-6">
          <div className="flex gap-2">
            <div className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900/50">
              <select
                defaultValue={amountFilter}
                onChange={(e) => setAmountFilter(e.target.value)}
                className="bg-transparent px-3 py-2 text-xs text-slate-300 outline-none cursor-pointer"
              >
                {['Transaction amount', 'No limit', '1 - 1,000', '1,001 - 5,000', '5,001 - 10,000'].map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-ink-700 bg-ink-900/50">
              <div className="flex items-center gap-1 px-2">
                <div className="h-5 w-5 rounded-full bg-green-500 flex items-center justify-center text-[10px] text-white font-bold">
                  ₿
                </div>
                <span className="text-xs font-medium text-slate-300">{fiatCurrency}</span>
              </div>
              <select
                defaultValue={fiatCurrency}
                onChange={(e) => setFiatCurrency(e.target.value)}
                className="bg-transparent px-3 py-2 text-xs text-slate-300 outline-none cursor-pointer"
              >
                {['BDT', 'USD', 'EUR', 'GBP'].map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900/50">
            <span className="px-3 py-2 text-xs text-slate-400">All payment methods</span>
            <button className="px-3 py-2 text-xs text-slate-400 hover:text-white transition">
              ▾
            </button>
          </div>
          <button className="p-2.5 rounded-lg border border-ink-700 bg-ink-900/50 text-slate-400 hover:text-white transition">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6 6A1 1 0 0113 13H4a1 1 0 01-.707-.293l-6-6A1 1 0 011 6.586V4z" />
            </svg>
          </button>
          <div className="ml-auto flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900/50">
            <span className="px-3 py-2 text-xs text-slate-400">Sort By</span>
            <button className="px-3 py-2 text-xs text-slate-400 hover:text-white transition">
              Price ▾
            </button>
          </div>
        </div>

        {/* Table Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">
          <span>Advertisers</span>
          <span className="hidden sm:block">Price</span>
          <span className="hidden sm:block">Available/Order Limit</span>
          <span className="hidden sm:block">Payment</span>
          <span className="text-right">Trade</span>
        </div>

        {/* Advertiser List */}
        <div className="space-y-3">

              {ADVERTISERS.slice(0, 2).map((adv) => (
                <div
                  key={adv.id}
                  className="flex items-center justify-between px-3 py-3 rounded-2xl border border-white/10 bg-ink-900/50 hover:border-white/20 transition"
                >
                  {/* Advertiser Info */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative shrink-0">
                      <img
                        src="https://api.dicebear.com/7.x/avataaars/svg?seed=trader"
                        alt={adv.name}
                        className="w-8 h-8 rounded-full object-cover border border-white/10"
                      />
                      {adv.verified && (
                        <div className="absolute -right-1 -bottom-1 w-3 h-3 rounded-full border-2 border-ink-950 bg-emerald-500 flex items-center justify-center">
                          <svg className="h-2 w-2 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-white truncate">{adv.name}</span>
                        {adv.verified && (
                          <span className="h-2.5 w-2.5 text-emerald-400">
                            <svg className="h-2.5 w-2.5" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-slate-500">
                        <span>{adv.orders}</span>
                        <span>•</span>
                        <span>{adv.completion} completion</span>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-emerald-400">
                        <span>👍 {adv.positive}</span>
                        <span>•</span>
                        <span>{adv.avgTime}</span>
                      </div>
                    </div>
                  </div>

                  {/* Price */}
                  <div className="hidden sm:block min-w-[70px]">
                    <span className="text-sm font-bold text-white">{adv.price}</span>
                  </div>

                  {/* Available / Limit */}
                  <div className="hidden sm:block min-w-[120px] text-[11px]">
                    <span className="text-white font-medium block">{adv.available}</span>
                    <span className="text-slate-500">{adv.limit}</span>
                  </div>

                  {/* Payment Method */}
                  <div className="hidden sm:block min-w-[60px]">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-ink-800 border border-white/10 ${adv.paymentColor} text-[10px] font-bold`}>
                      {adv.payment}
                    </span>
                  </div>

                  {/* Trade Button */}
                  <div className="text-right shrink-0">
                    <button
                      className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-emerald-600/25 hover:bg-emerald-500 transition active:scale-95"
                    >
                      Buy {activeTab}
                    </button>
                  </div>
                </div>
              ))}

              {ADVERTISERS.slice(2, 5).map((adv) => (
                <div
                  key={adv.id}
                  className="flex items-center justify-between px-3 py-3 rounded-2xl border border-white/10 bg-ink-900/50 hover:border-white/20 transition"
                >
                  {/* Advertiser Info */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative shrink-0">
                      <img
                        src="https://api.dicebear.com/7.x/avataaars/svg?seed=trader"
                        alt={adv.name}
                        className="w-8 h-8 rounded-full object-cover border border-white/10"
                      />
                      {adv.verified && (
                        <div className="absolute -right-1 -bottom-1 w-3 h-3 rounded-full border-2 border-ink-950 bg-emerald-500 flex items-center justify-center">
                          <svg className="h-2 w-2 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-white truncate">{adv.name}</span>
                        {adv.verified && (
                          <span className="h-2.5 w-2.5 text-emerald-400">
                            <svg className="h-2.5 w-2.5" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-slate-500">
                        <span>{adv.orders}</span>
                        <span>•</span>
                        <span>{adv.completion} completion</span>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-emerald-400">
                        <span>👍 {adv.positive}</span>
                        <span>•</span>
                        <span>{adv.avgTime}</span>
                      </div>
                    </div>
                  </div>

                  {/* Price */}
                  <div className="hidden sm:block min-w-[70px]">
                    <span className="text-sm font-bold text-white">{adv.price}</span>
                  </div>

                  {/* Available / Limit */}
                  <div className="hidden sm:block min-w-[120px] text-[11px]">
                    <span className="text-white font-medium block">{adv.available}</span>
                    <span className="text-slate-500">{adv.limit}</span>
                  </div>

                  {/* Payment Method */}
                  <div className="hidden sm:block min-w-[60px]">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-ink-800 border border-white/10 ${adv.paymentColor} text-[10px] font-bold`}>
                      {adv.payment}
                    </span>
                  </div>

                  {/* Trade Button */}
                  <div className="text-right shrink-0">
                    <button
                      className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-emerald-600/25 hover:bg-emerald-500 transition active:scale-95"
                    >
                      Buy {activeTab}
                    </button>
                  </div>
                </div>
              ))}
        </div>
      </div>
      </div>
    </TradingShell>
  );
}

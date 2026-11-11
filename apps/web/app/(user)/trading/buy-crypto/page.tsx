'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TradingShell } from '@/components/trading/trading-shell';

const FIAT_CURRENCIES = [
  { code: 'USD', symbol: '$', rateToUsd: 1, label: 'USD - US Dollar' },
  { code: 'BDT', symbol: '৳', rateToUsd: 0.0083, label: 'BDT - Bangladeshi Taka' },
  { code: 'EUR', symbol: '€', rateToUsd: 1.08, label: 'EUR - Euro' },
  { code: 'GBP', symbol: '£', rateToUsd: 1.28, label: 'GBP - British Pound' },
];

const CRYPTO_COINS = [
  { symbol: 'USDT', name: 'Tether USD', priceUsd: 1.0, icon: '₮' },
  { symbol: 'BTC', name: 'Bitcoin', priceUsd: 75860.0, icon: '₿' },
  { symbol: 'ETH', name: 'Ethereum', priceUsd: 3840.0, icon: 'Ξ' },
  { symbol: 'SOL', name: 'Solana', priceUsd: 198.5, icon: '◎' },
  { symbol: 'BNB', name: 'BNB', priceUsd: 615.0, icon: '🔶' },
];

const PAYMENT_METHODS = [
  {
    id: 'card',
    name: 'Visa / Mastercard',
    badge: '0% Fee Promo',
    desc: 'Instant delivery to your trading wallet via credit or debit card.',
    icon: (
      <svg className="h-5 w-5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <line x1="2" y1="10" x2="22" y2="10" />
      </svg>
    ),
  },
  {
    id: 'bkash',
    name: 'bKash / Nagad / Rocket',
    badge: 'Instant BDT',
    desc: 'Instant mobile banking direct payment in BDT.',
    icon: (
      <svg className="h-5 w-5 text-pink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="5" y="2" width="14" height="20" rx="3" />
        <line x1="12" y1="18" x2="12.01" y2="18" />
      </svg>
    ),
  },
  {
    id: 'bank',
    name: 'Bank Transfer (SEPA / Wire)',
    badge: 'Lowest Rate',
    desc: 'Direct bank transfer from your verified bank account.',
    icon: (
      <svg className="h-5 w-5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 21h18M3 10h18M5 10v11M9 10v11M15 10v11M19 10v11M12 3l9 7H3z" />
      </svg>
    ),
  },
];

export default function TradingBuyCryptoPage() {
  const [mode, setMode] = useState<'BUY' | 'SELL'>('BUY');
  const [fiatAmount, setFiatAmount] = useState('500');
  const [selectedFiat, setSelectedFiat] = useState(FIAT_CURRENCIES[0]);
  const [selectedCrypto, setSelectedCrypto] = useState(CRYPTO_COINS[0]);
  const [selectedPayment, setSelectedPayment] = useState(PAYMENT_METHODS[0].id);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Compute crypto received based on exchange rate
  const spendNum = parseFloat(fiatAmount) || 0;
  const spendUsd = spendNum * selectedFiat.rateToUsd;
  const cryptoReceived =
    selectedCrypto.priceUsd > 0
      ? (spendUsd / selectedCrypto.priceUsd).toFixed(
          selectedCrypto.symbol === 'BTC' ? 6 : selectedCrypto.symbol === 'ETH' ? 5 : 2,
        )
      : '0.00';

  function handleBuy(e: React.FormEvent) {
    e.preventDefault();
    if (spendNum <= 0) return;
    setSuccessToast(
      `Order placed! ${cryptoReceived} ${selectedCrypto.symbol} will be credited to your trading wallet.`,
    );
    setTimeout(() => setSuccessToast(null), 4000);
  }

  return (
    <TradingShell>
      <div className="max-w-4xl mx-auto space-y-8 py-4 sm:py-6">
        {successToast && (
          <div className="fixed top-16 right-4 z-50 rounded-xl bg-emerald-500 text-ink-950 px-4 py-2.5 text-xs font-bold shadow-2xl animate-fade-in flex items-center gap-2">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>{successToast}</span>
          </div>
        )}

        {/* Top Header */}
        <div className="text-center max-w-xl mx-auto space-y-2">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand/10 px-3 py-0.5 text-xs font-semibold text-brand">
            <span>★ Instant Fiat to Crypto Onramp</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
            Buy &amp; Sell Crypto Instantly
          </h1>
          <p className="text-xs sm:text-sm text-slate-400">
            Purchase Bitcoin, USDT, and 50+ cryptocurrencies with Card, Mobile Banking, or Bank Transfer.
          </p>
        </div>

        {/* Buy / Sell Form Card (Binance-style) */}
        <div className="rounded-3xl border border-ink-700/80 bg-ink-900/90 p-6 sm:p-8 shadow-2xl max-w-xl mx-auto space-y-6">
          {/* Mode Switcher */}
          <div className="flex rounded-full bg-ink-800/80 p-1 border border-ink-700">
            <button
              type="button"
              onClick={() => setMode('BUY')}
              className={`flex-1 rounded-full py-2 text-xs font-bold transition ${
                mode === 'BUY'
                  ? 'bg-gradient-to-r from-amber-400 to-[#F0B90B] text-ink-950 shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Buy Crypto
            </button>
            <button
              type="button"
              onClick={() => setMode('SELL')}
              className={`flex-1 rounded-full py-2 text-xs font-bold transition ${
                mode === 'SELL'
                  ? 'bg-gradient-to-r from-amber-400 to-[#F0B90B] text-ink-950 shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Sell Crypto
            </button>
          </div>

          <form onSubmit={handleBuy} className="space-y-4">
            {/* Spend Input */}
            <div className="rounded-2xl border border-ink-700/80 bg-ink-800/60 p-3.5 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400">
                <span>I want to spend</span>
                <span>Min: $10</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <input
                  type="number"
                  value={fiatAmount}
                  onChange={(e) => setFiatAmount(e.target.value)}
                  placeholder="500"
                  className="w-full bg-transparent text-xl sm:text-2xl font-black font-mono text-white outline-none"
                />
                <select
                  value={selectedFiat.code}
                  onChange={(e) => {
                    const f = FIAT_CURRENCIES.find((c) => c.code === e.target.value);
                    if (f) setSelectedFiat(f);
                  }}
                  className="rounded-full border border-ink-700 bg-ink-900 px-3 py-1.5 text-xs font-bold text-white outline-none cursor-pointer hover:border-brand"
                >
                  {FIAT_CURRENCIES.map((f) => (
                    <option key={f.code} value={f.code}>
                      {f.code}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Quick Amount Buttons */}
            <div className="flex items-center gap-2">
              {['100', '250', '500', '1000'].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setFiatAmount(amt)}
                  className={`flex-1 rounded-full py-1 text-xs font-mono font-semibold transition border ${
                    fiatAmount === amt
                      ? 'border-brand bg-brand/10 text-brand font-bold'
                      : 'border-ink-700/80 bg-ink-800/40 text-slate-400 hover:text-white hover:border-ink-600'
                  }`}
                >
                  {selectedFiat.symbol}{amt}
                </button>
              ))}
            </div>

            {/* Receive Crypto Input */}
            <div className="rounded-2xl border border-ink-700/80 bg-ink-800/60 p-3.5 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400">
                <span>I will receive (Estimated)</span>
                <span>1 {selectedCrypto.symbol} ≈ ${selectedCrypto.priceUsd.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="w-full text-xl sm:text-2xl font-black font-mono text-emerald-400">
                  {cryptoReceived}
                </div>
                <select
                  value={selectedCrypto.symbol}
                  onChange={(e) => {
                    const c = CRYPTO_COINS.find((coin) => coin.symbol === e.target.value);
                    if (c) setSelectedCrypto(c);
                  }}
                  className="rounded-full border border-ink-700 bg-ink-900 px-3 py-1.5 text-xs font-bold text-white outline-none cursor-pointer hover:border-brand"
                >
                  {CRYPTO_COINS.map((c) => (
                    <option key={c.symbol} value={c.symbol}>
                      {c.symbol} - {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Payment Method Selector */}
            <div className="space-y-2 pt-2">
              <div className="text-xs font-semibold text-slate-300">Select Payment Method</div>
              <div className="space-y-2">
                {PAYMENT_METHODS.map((method) => (
                  <div
                    key={method.id}
                    onClick={() => setSelectedPayment(method.id)}
                    className={`flex items-center justify-between p-3 rounded-2xl border cursor-pointer transition ${
                      selectedPayment === method.id
                        ? 'border-brand bg-brand/10 text-white'
                        : 'border-ink-700/80 bg-ink-800/40 text-slate-300 hover:bg-ink-800/80'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-ink-900 border border-ink-700">{method.icon}</div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs sm:text-sm text-white">{method.name}</span>
                          <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
                            {method.badge}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400">{method.desc}</div>
                      </div>
                    </div>

                    <div
                      className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ${
                        selectedPayment === method.id ? 'border-brand bg-brand' : 'border-ink-600'
                      }`}
                    >
                      {selectedPayment === method.id && <div className="h-2 w-2 rounded-full bg-ink-950" />}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Summary Breakdown */}
            <div className="rounded-2xl border border-ink-700/60 bg-ink-900/60 p-3 space-y-1.5 text-xs text-slate-400">
              <div className="flex justify-between">
                <span>Fee</span>
                <span className="text-emerald-400 font-bold">$0.00 (Promotion)</span>
              </div>
              <div className="flex justify-between">
                <span>Estimated Arrival</span>
                <span className="text-white font-medium">Instant to Trading Wallet</span>
              </div>
            </div>

            {/* CTA Button */}
            <button
              type="submit"
              className="w-full rounded-full bg-gradient-to-r from-amber-400 to-[#F0B90B] py-3 text-sm font-bold text-ink-950 shadow-lg shadow-amber-500/25 hover:brightness-110 transition active:scale-95"
            >
              {mode === 'BUY' ? `Buy ${selectedCrypto.symbol} Now` : `Sell ${selectedCrypto.symbol}`}
            </button>
          </form>
        </div>
      </div>
    </TradingShell>
  );
}

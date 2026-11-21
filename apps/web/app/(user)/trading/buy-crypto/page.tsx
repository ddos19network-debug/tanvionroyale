'use client';

import { useState, useEffect, useCallback } from 'react';
import { TradingShell } from '@/components/trading/trading-shell';
import {
  listP2POffers,
  getP2PQuote,
  createP2POrder,
  getRoyalePayBalance,
  type ListP2POffersParams,
} from '@/lib/api/p2p';
import type {
  P2POfferView,
  P2PSymbol,
  P2PFiat,
  P2POrderSide,
  P2PPaymentMethodCode,
  P2POrderView,
  RoyalePayBalanceView,
} from '@tanvion-royale/types';
import { useAuth } from '@/src/lib/auth';
import Link from 'next/link';

const SUPPORTED_SYMBOLS: P2PSymbol[] = ['USDT', 'BTC', 'ETH', 'BNB'];
const SUPPORTED_FIATS: P2PFiat[] = ['BDT', 'USD', 'EUR'];
const PAYMENT_METHODS: { code: P2PPaymentMethodCode; label: string; color: string }[] = [
  { code: 'bkash', label: 'bKash', color: 'text-pink-400 bg-pink-500/10 border-pink-500/20' },
  { code: 'nagad', label: 'Nagad', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  { code: 'rocket', label: 'Rocket', color: 'text-purple-400 bg-purple-500/10 border-purple-500/20' },
  { code: 'upay', label: 'Upay', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
  { code: 'bank', label: 'Bank Transfer', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  { code: 'royale-pay', label: 'Royale Pay', color: 'text-amber-300 bg-amber-400/20 border-amber-400/40' },
];

export default function TradingBuyCryptoPage() {
  const { ready, isAuthenticated } = useAuth();
  const [side, setSide] = useState<P2POrderSide>('BUY');
  const [selectedSymbol, setSelectedSymbol] = useState<P2PSymbol>('USDT');
  const [selectedFiat, setSelectedFiat] = useState<P2PFiat>('BDT');
  const [selectedMethod, setSelectedMethod] = useState<string>('all');
  const [offers, setOffers] = useState<P2POfferView[]>([]);
  const [loading, setLoading] = useState(true);
  const [royaleBalance, setRoyaleBalance] = useState<RoyalePayBalanceView | null>(null);

  // Order creation modal state
  const [activeOffer, setActiveOffer] = useState<P2POfferView | null>(null);
  const [fiatInput, setFiatInput] = useState<string>('');
  const [calculatedCrypto, setCalculatedCrypto] = useState<number | null>(null);
  const [orderMethod, setOrderMethod] = useState<P2PPaymentMethodCode>('royale-pay');
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [completedOrder, setCompletedOrder] = useState<P2POrderView | null>(null);

  const fetchOffers = useCallback(async () => {
    setLoading(true);
    try {
      const params: ListP2POffersParams = {
        symbol: selectedSymbol,
        fiat: selectedFiat,
        side,
        sortBy: 'price',
      };
      if (selectedMethod !== 'all') {
        params.paymentMethod = selectedMethod as P2PPaymentMethodCode;
      }
      const res = await listP2POffers(params);
      setOffers(res.items || []);
    } catch {
      setOffers([]);
    } finally {
      setLoading(false);
    }
  }, [selectedSymbol, selectedFiat, side, selectedMethod]);

  useEffect(() => {
    void fetchOffers();
  }, [fetchOffers]);

  useEffect(() => {
    if (!ready || !isAuthenticated) return;
    getRoyalePayBalance()
      .then(setRoyaleBalance)
      .catch(() => {});
  }, [ready, isAuthenticated]);

  // Recalculate crypto whenever fiatInput or activeOffer changes
  useEffect(() => {
    if (!activeOffer || !fiatInput) {
      setCalculatedCrypto(null);
      return;
    }
    const num = parseFloat(fiatInput);
    if (isNaN(num) || num <= 0) {
      setCalculatedCrypto(null);
      return;
    }
    // Minor units calculation: fiat minor units / pricePerFiatUnit * 10^cryptoScale
    const fiatMinor = Math.round(num * 100);
    const crypto = (fiatMinor / activeOffer.pricePerFiatUnit);
    setCalculatedCrypto(crypto);
  }, [fiatInput, activeOffer]);

  const handleOpenTrade = (offer: P2POfferView) => {
    setActiveOffer(offer);
    setFiatInput(String(offer.minOrderFiat / 100));
    setOrderMethod(offer.paymentMethods[0] || 'royale-pay');
    setOrderError(null);
    setCompletedOrder(null);
  };

  const handleCreateOrder = async () => {
    if (!activeOffer) return;
    const num = parseFloat(fiatInput);
    if (isNaN(num) || num <= 0) {
      setOrderError('Please enter a valid fiat amount.');
      return;
    }
    const fiatMinor = Math.round(num * 100);
    if (fiatMinor < activeOffer.minOrderFiat) {
      setOrderError(`Minimum order amount is ${(activeOffer.minOrderFiat / 100).toFixed(2)} ${activeOffer.fiat}`);
      return;
    }
    if (fiatMinor > activeOffer.maxOrderFiat) {
      setOrderError(`Maximum order amount is ${(activeOffer.maxOrderFiat / 100).toFixed(2)} ${activeOffer.fiat}`);
      return;
    }

    setOrderLoading(true);
    setOrderError(null);
    try {
      const cryptoBase = Math.round((calculatedCrypto || 0) * Math.pow(10, activeOffer.cryptoScale));
      const idempotencyKey = `p2p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const order = await createP2POrder({
        symbol: activeOffer.symbol,
        fiat: activeOffer.fiat,
        side: activeOffer.side,
        fiatAmount: fiatMinor,
        cryptoAmount: cryptoBase,
        pricePerFiatUnit: activeOffer.pricePerFiatUnit,
        offerId: activeOffer.id,
        paymentMethod: orderMethod,
        idempotencyKey,
      });
      setCompletedOrder(order);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not create P2P order. Please try again.';
      setOrderError(msg);
    } finally {
      setOrderLoading(false);
    }
  };

  return (
    <TradingShell>
      <div className="space-y-6 max-w-7xl mx-auto py-2">
        {/* Header / Intro */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-ink-800 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-400/10 text-amber-400 text-sm">
                ⚡
              </span>
              <h1 className="text-2xl font-black text-white tracking-tight">
                P2P Crypto Marketplace & Express Buy
              </h1>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Zero fees. Buy and sell crypto directly with verified merchants using local payment methods.
            </p>
          </div>

          {/* Royale Pay Wallet Quick Status */}
          {isAuthenticated && royaleBalance && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 px-4 py-2 flex items-center gap-3">
              <div>
                <div className="text-[10px] uppercase font-bold text-amber-400 tracking-wider">
                  Royale Pay Balance
                </div>
                <div className="text-sm font-black text-white font-mono">
                  {(royaleBalance.availableBalance / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} {royaleBalance.currency}
                </div>
              </div>
              <Link
                href="/wallet/deposit"
                className="rounded-lg bg-amber-400 px-2.5 py-1 text-[11px] font-bold text-ink-950 hover:bg-amber-300 transition"
              >
                Top Up
              </Link>
            </div>
          )}
        </div>

        {/* Filter Toolbar (Binance P2P style) */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-ink-900/60 border border-ink-700/80 rounded-2xl p-3 backdrop-blur shadow-xl">
          {/* Buy/Sell Selector */}
          <div className="flex items-center rounded-xl bg-ink-950 border border-ink-800 p-1">
            <button
              type="button"
              onClick={() => setSide('BUY')}
              className={`rounded-lg px-5 py-1.5 text-xs font-bold transition ${
                side === 'BUY'
                  ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Buy
            </button>
            <button
              type="button"
              onClick={() => setSide('SELL')}
              className={`rounded-lg px-5 py-1.5 text-xs font-bold transition ${
                side === 'SELL'
                  ? 'bg-rose-500 text-white shadow-md shadow-rose-500/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Sell
            </button>
          </div>

          {/* Crypto Asset Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
            {SUPPORTED_SYMBOLS.map((sym) => (
              <button
                key={sym}
                type="button"
                onClick={() => setSelectedSymbol(sym)}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition whitespace-nowrap ${
                  selectedSymbol === sym
                    ? 'bg-amber-400/15 text-amber-400 border border-amber-400/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
                }`}
              >
                {sym}
              </button>
            ))}
          </div>

          {/* Fiat Currency Selector */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400 font-medium">Fiat:</span>
            <select
              value={selectedFiat}
              onChange={(e) => setSelectedFiat(e.target.value as P2PFiat)}
              aria-label="Select Fiat Currency"
              className="rounded-xl border border-ink-700 bg-ink-950 px-3 py-1.5 text-xs font-bold text-white outline-none focus:border-amber-400 cursor-pointer"
            >
              {SUPPORTED_FIATS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>

          {/* Payment Method Filter */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400 font-medium">Payment:</span>
            <select
              value={selectedMethod}
              onChange={(e) => setSelectedMethod(e.target.value)}
              aria-label="Select Payment Method"
              className="rounded-xl border border-ink-700 bg-ink-950 px-3 py-1.5 text-xs font-bold text-white outline-none focus:border-amber-400 cursor-pointer"
            >
              <option value="all">All Payment Methods</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m.code} value={m.code}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Offers Table / Grid */}
        <div className="rounded-2xl border border-ink-700/80 bg-ink-900/60 overflow-hidden shadow-2xl backdrop-blur">
          {/* Table Header on Desktop */}
          <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-3.5 border-b border-ink-800 text-[11px] font-bold text-slate-400 uppercase tracking-wider bg-ink-950/40">
            <div className="col-span-3">Advertiser (Merchant)</div>
            <div className="col-span-2">Price</div>
            <div className="col-span-3">Available / Limits</div>
            <div className="col-span-2">Payment Methods</div>
            <div className="col-span-2 text-right">Trade</div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
              <p className="text-xs font-medium text-slate-400">Loading marketplace offers...</p>
            </div>
          ) : offers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-4 space-y-4">
              <div className="h-14 w-14 rounded-full bg-ink-800 flex items-center justify-center text-slate-500 text-2xl">
                🏷️
              </div>
              <div className="space-y-1">
                <p className="font-bold text-white text-base">No Active P2P Offers Found</p>
                <p className="text-xs text-slate-400 max-w-md">
                  There are currently no live offers for {selectedSymbol} in {selectedFiat} with the selected filters.
                </p>
              </div>
              <Link
                href="/wallet/deposit"
                className="rounded-full bg-gradient-to-r from-amber-400 to-[#F0B90B] px-6 py-2.5 text-xs font-bold text-ink-950 hover:brightness-110 shadow-lg shadow-amber-500/20"
              >
                Instant Deposit via Wallet Gateway
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-ink-800">
              {offers.map((offer) => {
                const priceFormatted = (offer.pricePerFiatUnit / 100).toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                });
                const minFiat = (offer.minOrderFiat / 100).toLocaleString('en-US');
                const maxFiat = (offer.maxOrderFiat / 100).toLocaleString('en-US');
                const availCrypto = (offer.availableCrypto / Math.pow(10, offer.cryptoScale)).toFixed(2);

                return (
                  <div
                    key={offer.id}
                    className="flex flex-col md:grid md:grid-cols-12 gap-3 md:gap-4 p-4 md:px-6 md:py-4 items-start md:items-center hover:bg-white/[0.02] transition"
                  >
                    {/* Merchant Col */}
                    <div className="col-span-3 flex items-center gap-3">
                      <div className="relative flex-shrink-0">
                        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-amber-400/20 to-amber-600/30 border border-amber-400/30 flex items-center justify-center text-amber-400 font-bold text-xs uppercase font-mono">
                          {offer.merchant.displayName.slice(0, 2)}
                        </div>
                        {offer.merchant.verificationStatus === 'VERIFIED' && (
                          <span
                            title="Verified Merchant"
                            className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-emerald-500 border-2 border-ink-900 flex items-center justify-center text-white text-[8px]"
                          >
                            ✓
                          </span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-white text-xs sm:text-sm truncate">
                            {offer.merchant.displayName}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                          <span>{offer.merchant.totalOrders} orders</span>
                          <span>•</span>
                          <span className="text-emerald-400 font-mono">
                            {offer.merchant.completionRate}%
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Price Col */}
                    <div className="col-span-2">
                      <div className="text-[10px] md:hidden text-slate-500 uppercase">Price:</div>
                      <div className="font-mono font-black text-white text-sm sm:text-base">
                        {priceFormatted} <span className="text-xs font-bold text-amber-400">{offer.fiat}</span>
                      </div>
                    </div>

                    {/* Available & Limits */}
                    <div className="col-span-3 space-y-0.5">
                      <div className="text-[11px] text-slate-300">
                        <span className="text-slate-500">Available:</span>{' '}
                        <span className="font-mono font-bold text-white">{availCrypto} {offer.symbol}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        <span className="text-slate-500 font-sans">Limit:</span> {minFiat} - {maxFiat} {offer.fiat}
                      </div>
                    </div>

                    {/* Payment Methods */}
                    <div className="col-span-2 flex flex-wrap gap-1">
                      {offer.paymentMethods.map((m) => {
                        const def = PAYMENT_METHODS.find((pm) => pm.code === m);
                        return (
                          <span
                            key={m}
                            className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${
                              def ? def.color : 'text-slate-300 bg-ink-800 border-ink-700'
                            }`}
                          >
                            {def ? def.label : m}
                          </span>
                        );
                      })}
                    </div>

                    {/* Trade Action Button */}
                    <div className="col-span-2 md:text-right w-full md:w-auto mt-2 md:mt-0">
                      <button
                        type="button"
                        onClick={() => handleOpenTrade(offer)}
                        className={`w-full md:w-auto rounded-xl px-4 py-2 text-xs font-bold transition active:scale-95 shadow-md ${
                          side === 'BUY'
                            ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-emerald-500/20'
                            : 'bg-rose-500 hover:bg-rose-400 text-white shadow-rose-500/20'
                        }`}
                      >
                        {side === 'BUY' ? 'Buy' : 'Sell'} {offer.symbol}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Express Trade / Checkout Modal */}
        {activeOffer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
            <div className="relative w-full max-w-lg rounded-3xl border border-ink-700 bg-ink-900 p-6 sm:p-8 shadow-2xl space-y-6">
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-ink-800 pb-4">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${side === 'BUY' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                  <h3 className="text-lg font-black text-white">
                    {side === 'BUY' ? 'Buy' : 'Sell'} {activeOffer.symbol} with {activeOffer.fiat}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveOffer(null)}
                  className="rounded-full p-1 text-slate-400 hover:text-white hover:bg-white/10 transition"
                >
                  ✕
                </button>
              </div>

              {completedOrder ? (
                /* Order Completion State */
                <div className="text-center py-6 space-y-4">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-2xl">
                    ✓
                  </div>
                  <div>
                    <h4 className="text-lg font-bold text-white">P2P Order Created</h4>
                    <p className="text-xs text-slate-400 mt-1 font-mono">
                      Reference: {completedOrder.orderReference}
                    </p>
                  </div>
                  <div className="rounded-xl border border-ink-800 bg-ink-950 p-4 text-xs text-slate-300 space-y-2 text-left">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Total Amount:</span>
                      <span className="font-mono font-bold text-white">
                        {(completedOrder.fiatAmount / 100).toFixed(2)} {completedOrder.fiat}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Crypto Allocated:</span>
                      <span className="font-mono font-bold text-emerald-400">
                        {completedOrder.cryptoAmount} {completedOrder.symbol}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Status:</span>
                      <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-amber-400 font-bold font-mono">
                        {completedOrder.status}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveOffer(null)}
                    className="w-full rounded-xl bg-gradient-to-r from-amber-400 to-[#F0B90B] py-2.5 text-xs font-bold text-ink-950 hover:brightness-110 transition"
                  >
                    Done
                  </button>
                </div>
              ) : (
                /* Order Form */
                <div className="space-y-4">
                  {orderError && (
                    <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-400">
                      {orderError}
                    </div>
                  )}

                  {/* Merchant Brief */}
                  <div className="rounded-xl border border-ink-800 bg-ink-950 p-3 flex items-center justify-between text-xs">
                    <div>
                      <span className="text-slate-400">Merchant:</span>{' '}
                      <span className="font-bold text-white">{activeOffer.merchant.displayName}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Price:</span>{' '}
                      <span className="font-mono font-bold text-amber-400">
                        {(activeOffer.pricePerFiatUnit / 100).toFixed(2)} {activeOffer.fiat}
                      </span>
                    </div>
                  </div>

                  {/* Fiat Amount Input */}
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1.5">
                      I want to pay ({activeOffer.fiat}):
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        value={fiatInput}
                        onChange={(e) => setFiatInput(e.target.value)}
                        placeholder="0.00"
                        className="w-full rounded-xl border border-ink-700 bg-ink-950 px-4 py-3 text-base font-mono font-bold text-white placeholder-slate-600 outline-none focus:border-amber-400"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                        {activeOffer.fiat}
                      </span>
                    </div>
                    <div className="mt-1 flex justify-between text-[11px] text-slate-500 font-mono">
                      <span>Min: {(activeOffer.minOrderFiat / 100).toFixed(2)}</span>
                      <span>Max: {(activeOffer.maxOrderFiat / 100).toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Calculated Crypto Output */}
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1.5">
                      I will receive ({activeOffer.symbol}):
                    </label>
                    <div className="rounded-xl border border-ink-800 bg-ink-950 px-4 py-3 text-base font-mono font-bold text-emerald-400 flex justify-between items-center">
                      <span>{calculatedCrypto !== null ? calculatedCrypto.toFixed(6) : '0.000000'}</span>
                      <span className="text-xs font-bold text-slate-400">{activeOffer.symbol}</span>
                    </div>
                  </div>

                  {/* Payment Method Selector */}
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1.5">
                      Select Payment Method:
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {activeOffer.paymentMethods.map((m) => {
                        const def = PAYMENT_METHODS.find((pm) => pm.code === m);
                        const isSelected = orderMethod === m;
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setOrderMethod(m)}
                            className={`rounded-xl border p-2.5 text-xs font-bold transition flex items-center justify-between ${
                              isSelected
                                ? 'border-amber-400 bg-amber-400/10 text-amber-400'
                                : 'border-ink-800 bg-ink-950 text-slate-300 hover:bg-white/5'
                            }`}
                          >
                            <span>{def ? def.label : m}</span>
                            {isSelected && <span>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Action Button */}
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleCreateOrder}
                      disabled={orderLoading || !isAuthenticated}
                      className={`w-full rounded-xl py-3 text-xs font-bold transition active:scale-95 shadow-lg disabled:opacity-50 ${
                        side === 'BUY'
                          ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-emerald-500/25'
                          : 'bg-rose-500 hover:bg-rose-400 text-white shadow-rose-500/25'
                      }`}
                    >
                      {!isAuthenticated
                        ? 'Sign In to Trade'
                        : orderLoading
                        ? 'Creating Order...'
                        : `${side === 'BUY' ? 'Buy' : 'Sell'} ${activeOffer.symbol} Now`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </TradingShell>
  );
}

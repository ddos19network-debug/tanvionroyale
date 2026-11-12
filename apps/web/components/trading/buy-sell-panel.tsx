'use client';

import { useState } from 'react';
import type {
  TradingInstrumentView,
  TradingOrderResult,
  TradingOrderSide,
  TradingOrderType,
} from '@/lib/api/trading';
import {
  placeTradingOrder,
  formatMinor,
  formatPrice,
  claimTradingFaucet,
} from '@/lib/api/trading';
import { ApiClientError } from '@/lib/api/client';
import { getContractSpec } from '@/lib/api/trading-contracts';
import { playTradingSound } from '@/lib/trading/audio-synthesizer';

interface BuySellPanelProps {
  instrument: TradingInstrumentView;
  currency?: string;
  virtualBalance: number;
  selectedPrice?: number | null;
  isLoggedIn?: boolean;
  onOrderPlaced?: (result: TradingOrderResult) => void;
  onBalanceUpdated?: () => void;
}

export function BuySellPanel({
  instrument,
  currency = 'USD',
  virtualBalance,
  selectedPrice,
  isLoggedIn = true,
  onOrderPlaced,
  onBalanceUpdated,
}: BuySellPanelProps) {
  const [side, setSide] = useState<TradingOrderSide>('BUY');
  const [executionMode, setExecutionMode] = useState<'MARKET' | 'PENDING'>('MARKET');
  const [orderType, setOrderType] = useState<TradingOrderType>('MARKET');
  const [leverage, setLeverage] = useState<number>(10);
  const [lots, setLots] = useState<string>('2.00');
  const [customPrice, setCustomPrice] = useState<string>('');
  
  // Take Profit & Stop Loss
  const [tpEnabled, setTpEnabled] = useState(false);
  const [tpPrice, setTpPrice] = useState<string>('');
  const [slEnabled, setSlEnabled] = useState(false);
  const [slPrice, setSlPrice] = useState<string>('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Spread calculation (e.g. 0.008% spread for realistic Exness feel)
  const isForex = instrument.symbol.includes('EUR') || instrument.symbol.includes('JPY') || instrument.symbol.includes('AUD');
  const spreadMinor = isForex ? 2 : Math.max(1, Math.round(instrument.currentPrice * 0.000085));
  const bidPriceMinor = instrument.currentPrice;
  const askPriceMinor = instrument.currentPrice + spreadMinor;
  const spreadDisplay = (spreadMinor / 100).toFixed(isForex ? 4 : 2);

  // Price for execution
  const activePriceMinor = side === 'BUY' ? askPriceMinor : bidPriceMinor;
  const effectivePriceMinor =
    executionMode === 'MARKET'
      ? activePriceMinor
      : customPrice
      ? Math.round(Number.parseFloat(customPrice) * 100)
      : selectedPrice ?? activePriceMinor;

  const parsedLots = Number.parseFloat(lots) || 0.01;
  const spec = getContractSpec(instrument.symbol);
  const quantity = Math.max(1, Math.round(parsedLots));
  const notionalMinor = Math.round(parsedLots * spec.contractSize * (effectivePriceMinor / (spec.assetClass === 'FOREX' ? 1000 : 1)));
  const marginRequiredMinor = Math.round(notionalMinor / leverage);
  const estimatedFeeMinor = Math.round(notionalMinor * 0.0005); // 0.05%

  const liquidationPriceMinor =
    side === 'BUY'
      ? Math.max(1, Math.round(effectivePriceMinor * (1 - 0.9 / leverage)))
      : Math.round(effectivePriceMinor * (1 + 0.9 / leverage));

  // Audio chime feedback
  function playSuccessSound() {
    playTradingSound('orderExecution');
  }

  function adjustLots(delta: number) {
    const current = Number.parseFloat(lots) || 0.01;
    const next = Math.max(0.01, Math.round((current + delta) * 100) / 100);
    setLots(next.toFixed(2));
  }

  function adjustPrice(setter: (val: string) => void, currentVal: string, deltaMinor: number) {
    const curr = currentVal
      ? Number.parseFloat(currentVal) * 100
      : instrument.currentPrice;
    const next = Math.max(1, curr + deltaMinor);
    setter((next / 100).toFixed(isForex ? 4 : 2));
  }

  async function handleExecuteTrade(targetSide: TradingOrderSide) {
    if (!isLoggedIn) {
      setError('Please sign in to place trades with your virtual account.');
      return;
    }
    if (quantity <= 0) {
      setError('Please enter a valid lot size');
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const finalType = executionMode === 'MARKET' ? 'MARKET' : 'LIMIT';
      const limitPriceParam = executionMode === 'PENDING' ? effectivePriceMinor : undefined;

      const result = await placeTradingOrder(
        instrument.id,
        targetSide,
        quantity,
        finalType,
        limitPriceParam,
        undefined,
        leverage,
      );

      playSuccessSound();

      if (result.order.status === 'ACKNOWLEDGED') {
        setMessage(
          `Pending order set: ${targetSide} ${lots} Lots ${instrument.symbol} @ ${formatPrice(effectivePriceMinor, instrument.symbol)}.`,
        );
      } else {
        setMessage(
          `Order filled: ${targetSide} ${lots} Lots ${instrument.symbol} @ ${formatPrice(result.order.priceFilled ?? effectivePriceMinor, instrument.symbol)}!`,
        );
      }

      onOrderPlaced?.(result);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Could not execute the order. Check your margin and balance.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleQuickFaucet() {
    try {
      await claimTradingFaucet(1_000_000);
      onBalanceUpdated?.();
      setMessage('Added +$10,000 virtual funds to your balance!');
      setTimeout(() => setMessage(null), 3500);
    } catch {
      setError('Could not claim faucet. Please try again.');
    }
  }

  return (
    <div className="flex h-full w-full flex-col rounded-xl border border-white/10 bg-[#121620] overflow-hidden text-xs shadow-2xl">
      {/* Exness Panel Header */}
      <div className="flex items-center justify-between border-b border-white/10 bg-[#0e121b] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-400/20 text-xs font-black text-amber-300">
            {instrument.symbol.slice(0, 3)}
          </span>
          <span className="font-black text-white text-sm">{instrument.symbol}</span>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-slate-400 bg-white/5 px-2.5 py-1 rounded-md border border-white/5">
          <span>Regular form</span>
          <span>▾</span>
        </div>
      </div>

      <div className="p-4 space-y-4 flex-1 flex flex-col justify-between">
        <div>
          {/* EXNESS DUAL SELL & BUY BOX */}
          <div className="relative">
            <div className="grid grid-cols-2 gap-2">
              {/* Sell Box (Red) */}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setSide('SELL');
                  void handleExecuteTrade('SELL');
                }}
                className={`group relative flex flex-col items-center justify-center rounded-xl border-2 p-3.5 transition-all text-center ${
                  side === 'SELL'
                    ? 'border-rose-500 bg-rose-500/20 shadow-lg shadow-rose-950/50'
                    : 'border-rose-500/40 bg-rose-950/20 hover:border-rose-500 hover:bg-rose-500/10'
                }`}
              >
                <span className="text-[11px] font-bold uppercase tracking-wider text-rose-400 group-hover:text-rose-300">
                  Sell
                </span>
                <span className="mt-1 font-mono text-lg font-black text-white">
                  {formatPrice(bidPriceMinor, instrument.symbol)}
                </span>
              </button>

              {/* Buy Box (Blue / Exness Cyan) */}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setSide('BUY');
                  void handleExecuteTrade('BUY');
                }}
                className={`group relative flex flex-col items-center justify-center rounded-xl border-2 p-3.5 transition-all text-center ${
                  side === 'BUY'
                    ? 'border-blue-500 bg-blue-500/20 shadow-lg shadow-blue-950/50'
                    : 'border-blue-500/40 bg-blue-950/20 hover:border-blue-500 hover:bg-blue-500/10'
                }`}
              >
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-400 group-hover:text-blue-300">
                  Buy
                </span>
                <span className="mt-1 font-mono text-lg font-black text-white">
                  {formatPrice(askPriceMinor, instrument.symbol)}
                </span>
              </button>
            </div>

            {/* Floating Spread Pill */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
              <span className="rounded-md border border-white/20 bg-[#0e121b] px-2 py-0.5 text-[10px] font-mono font-bold text-slate-300 shadow-md">
                {spreadDisplay} {currency}
              </span>
            </div>
          </div>

          {/* Market Sentiment Bar (matching Exness 36% / 64%) */}
          <div className="mt-2.5">
            <div className="flex items-center justify-between text-[10px] font-bold mb-1">
              <span className="text-rose-400">36%</span>
              <span className="text-slate-400 text-[9px] uppercase tracking-wider">Buyer Sentiment</span>
              <span className="text-blue-400">64%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden flex">
              <div className="h-full bg-rose-500" style={{ width: '36%' }} />
              <div className="h-full bg-blue-500" style={{ width: '64%' }} />
            </div>
          </div>

          {/* Execution Mode Tabs (Market vs Pending) */}
          <div className="mt-4 grid grid-cols-2 rounded-lg bg-white/5 p-1 border border-white/5">
            <button
              type="button"
              onClick={() => setExecutionMode('MARKET')}
              className={`py-1.5 text-center font-bold text-xs rounded transition ${
                executionMode === 'MARKET'
                  ? 'bg-white/15 text-white font-black shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Market
            </button>
            <button
              type="button"
              onClick={() => setExecutionMode('PENDING')}
              className={`py-1.5 text-center font-bold text-xs rounded transition ${
                executionMode === 'PENDING'
                  ? 'bg-white/15 text-white font-black shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Pending
            </button>
          </div>

          {/* If Pending, Price input */}
          {executionMode === 'PENDING' && (
            <div className="mt-3">
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Order Price ({currency})
              </label>
              <div className="flex items-center rounded-lg border border-white/10 bg-[#0e121b] px-2 py-1">
                <button
                  type="button"
                  onClick={() => adjustPrice(setCustomPrice, customPrice, -100)}
                  className="h-7 w-7 rounded bg-white/5 text-slate-300 hover:bg-white/10 flex items-center justify-center font-bold"
                >
                  -
                </button>
                <input
                  type="number"
                  step="any"
                  value={customPrice}
                  placeholder={formatPrice(activePriceMinor, instrument.symbol)}
                  onChange={(e) => setCustomPrice(e.target.value)}
                  className="flex-1 bg-transparent px-2 text-center font-mono text-sm font-bold text-white focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => adjustPrice(setCustomPrice, customPrice, 100)}
                  className="h-7 w-7 rounded bg-white/5 text-slate-300 hover:bg-white/10 flex items-center justify-center font-bold"
                >
                  +
                </button>
              </div>
            </div>
          )}

          {/* Volume (Lots) with Stepper */}
          <div className="mt-3.5">
            <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
              <span>Volume</span>
              <span className="font-mono text-white">Lots</span>
            </div>
            <div className="flex items-center rounded-xl border border-white/10 bg-[#0e121b] p-1">
              <button
                type="button"
                onClick={() => adjustLots(-0.1)}
                className="h-8 w-9 rounded-lg bg-white/5 text-slate-200 hover:bg-white/15 flex items-center justify-center font-extrabold text-base transition active:scale-95"
              >
                -
              </button>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={lots}
                onChange={(e) => setLots(e.target.value)}
                className="flex-1 bg-transparent px-2 text-center font-mono text-sm font-black text-white focus:outline-none"
              />
              <span className="text-[11px] text-slate-500 font-bold pr-2">Lots</span>
              <button
                type="button"
                onClick={() => adjustLots(0.1)}
                className="h-8 w-9 rounded-lg bg-white/5 text-slate-200 hover:bg-white/15 flex items-center justify-center font-extrabold text-base transition active:scale-95"
              >
                +
              </button>
            </div>

            {/* Quick lot preset chips */}
            <div className="mt-1.5 flex items-center justify-between gap-1 text-[10px] font-mono text-slate-400">
              {[0.1, 0.5, 1.0, 2.0, 5.0].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setLots(val.toFixed(2))}
                  className={`flex-1 rounded py-0.5 border transition ${
                    Number.parseFloat(lots) === val
                      ? 'border-amber-400/50 bg-amber-400/10 text-amber-300 font-bold'
                      : 'border-white/5 bg-white/5 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {val.toFixed(2)}
                </button>
              ))}
            </div>
          </div>

          {/* Leverage Selector */}
          <div className="mt-3.5">
            <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
              <span>Leverage</span>
              <span className="font-mono text-amber-300 font-bold">{leverage}x</span>
            </div>
            <div className="grid grid-cols-6 gap-1 text-[10px] font-mono">
              {[1, 5, 10, 25, 50, 100].map((lev) => (
                <button
                  key={lev}
                  type="button"
                  onClick={() => setLeverage(lev)}
                  className={`rounded py-1 text-center font-bold border transition ${
                    leverage === lev
                      ? 'border-amber-400 bg-amber-400 text-black shadow-xs'
                      : 'border-white/5 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {lev === 1 ? '1x' : `${lev}x`}
                </button>
              ))}
            </div>
          </div>

          {/* Take Profit & Stop Loss inputs (matching Exness) */}
          <div className="mt-4 space-y-2 border-t border-white/5 pt-3">
            {/* Take Profit */}
            <div className="rounded-lg border border-white/5 bg-[#0e121b]/60 p-2.5">
              <div className="flex items-center justify-between text-[11px]">
                <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                  <input
                    type="checkbox"
                    checked={tpEnabled}
                    onChange={(e) => setTpEnabled(e.target.checked)}
                    className="rounded border-white/20 bg-slate-900 text-emerald-400 focus:ring-0"
                  />
                  <span className="font-bold">Take Profit</span>
                </label>
                <span className="text-[10px] text-slate-500 font-mono">
                  {tpEnabled ? 'Price ▼' : 'Not set'}
                </span>
              </div>
              {tpEnabled && (
                <div className="mt-2 flex items-center rounded-lg border border-white/10 bg-black/40 px-2 py-1">
                  <button
                    type="button"
                    onClick={() => adjustPrice(setTpPrice, tpPrice, -100)}
                    className="h-6 w-6 rounded bg-white/5 text-slate-300 hover:bg-white/10 flex items-center justify-center font-bold"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    step="any"
                    value={tpPrice}
                    placeholder={(activePriceMinor * 1.05 / 100).toFixed(2)}
                    onChange={(e) => setTpPrice(e.target.value)}
                    className="flex-1 bg-transparent px-2 text-center font-mono text-xs font-bold text-emerald-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => adjustPrice(setTpPrice, tpPrice, 100)}
                    className="h-6 w-6 rounded bg-white/5 text-slate-300 hover:bg-white/10 flex items-center justify-center font-bold"
                  >
                    +
                  </button>
                </div>
              )}
            </div>

            {/* Stop Loss */}
            <div className="rounded-lg border border-white/5 bg-[#0e121b]/60 p-2.5">
              <div className="flex items-center justify-between text-[11px]">
                <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                  <input
                    type="checkbox"
                    checked={slEnabled}
                    onChange={(e) => setSlEnabled(e.target.checked)}
                    className="rounded border-white/20 bg-slate-900 text-rose-400 focus:ring-0"
                  />
                  <span className="font-bold">Stop Loss</span>
                </label>
                <span className="text-[10px] text-slate-500 font-mono">
                  {slEnabled ? 'Price ▼' : 'Not set'}
                </span>
              </div>
              {slEnabled && (
                <div className="mt-2 flex items-center rounded-lg border border-white/10 bg-black/40 px-2 py-1">
                  <button
                    type="button"
                    onClick={() => adjustPrice(setSlPrice, slPrice, -100)}
                    className="h-6 w-6 rounded bg-white/5 text-slate-300 hover:bg-white/10 flex items-center justify-center font-bold"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    step="any"
                    value={slPrice}
                    placeholder={(activePriceMinor * 0.95 / 100).toFixed(2)}
                    onChange={(e) => setSlPrice(e.target.value)}
                    className="flex-1 bg-transparent px-2 text-center font-mono text-xs font-bold text-rose-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => adjustPrice(setSlPrice, slPrice, 100)}
                    className="h-6 w-6 rounded bg-white/5 text-slate-300 hover:bg-white/10 flex items-center justify-center font-bold"
                  >
                    +
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Order Details & Summary Footer */}
        <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
          <div className="space-y-1 text-[11px] text-slate-400 font-mono">
            <div className="flex justify-between">
              <span>Required Margin:</span>
              <span className="text-white font-bold">{formatMinor(marginRequiredMinor, currency)}</span>
            </div>
            <div className="flex justify-between">
              <span>Estimated Fee (0.05%):</span>
              <span className="text-slate-300">{formatMinor(estimatedFeeMinor, currency)}</span>
            </div>
            <div className="flex justify-between">
              <span>Est. Liquidation Price:</span>
              <span className="text-amber-400">{formatPrice(liquidationPriceMinor, instrument.symbol)}</span>
            </div>
          </div>

          {/* Feedback Messages */}
          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-center text-[11px] text-rose-300">
              {error}
            </div>
          )}
          {message && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-center text-[11px] text-emerald-300">
              {message}
            </div>
          )}

          {/* Big Execution Action Button */}
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleExecuteTrade(side)}
            className={`w-full py-3 rounded-xl font-black text-sm tracking-wide shadow-lg transition active:scale-95 disabled:opacity-50 ${
              side === 'BUY'
                ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-700/30'
                : 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-700/30'
            }`}
          >
            {busy
              ? 'Processing...'
              : `${side} ${lots} Lots ${instrument.symbol}`}
          </button>

          {/* Account Balance Bar */}
          <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
            <span>Free Balance:</span>
            <div className="flex items-center gap-1.5 font-mono text-white">
              <span>{formatMinor(virtualBalance, currency)}</span>
              <button
                type="button"
                onClick={handleQuickFaucet}
                className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-300 hover:bg-amber-500/30 transition"
                title="Quick Faucet +$10,000"
              >
                +Faucet
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

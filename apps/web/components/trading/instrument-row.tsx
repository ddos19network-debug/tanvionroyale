'use client';

import { useState } from 'react';
import { Button } from '@tanvion-royale/ui';
import {
  placeTradingOrder,
  formatMinor,
  type TradingInstrumentView,
  type TradingOrderResult,
} from '@/lib/api/trading';
import { ApiClientError } from '@/lib/api/client';

/**
 * One market row: live price + quantity + BUY/SELL.
 * All execution happens server-side; this form only submits the order.
 */
export function InstrumentTradeRow({
  instrument,
  currency = 'USD',
  onDone,
}: {
  instrument: TradingInstrumentView;
  currency?: string;
  onDone?: (result: TradingOrderResult) => void;
}) {
  const [quantity, setQuantity] = useState('1');
  const [busy, setBusy] = useState<'BUY' | 'SELL' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const qty = Number.parseInt(quantity, 10);
  const valid = Number.isInteger(qty) && qty > 0;
  const notional = valid ? instrument.currentPrice * qty : 0;
  async function trade(side: 'BUY' | 'SELL') {
    setBusy(side);
    setError(null);
    setMessage(null);
    try {
      const result = await placeTradingOrder(instrument.id, side, qty);
      setMessage(
        `${side} ${qty} ${instrument.symbol} @ ${formatMinor(result.order.priceFilled ?? 0, currency)} filled.`,
      );
      onDone?.(result);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Could not place the virtual order. Please try again.',
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-ink-800/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-white">
            {instrument.symbol}
            <span className="ml-2 text-xs font-normal uppercase tracking-wide text-slate-400">
              {instrument.type}
            </span>
          </p>
          <p className="text-sm text-slate-400">{instrument.name}</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg text-white">{formatMinor(instrument.currentPrice, currency)}</p>
          <p className="text-xs text-emerald-400 flex items-center justify-end gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live Market Feed
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-400">
          Qty
          <input
            type="number"
            min={1}
            step={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value.replace(/[^\d]/g, ''))}
            className="w-24 rounded-md border border-white/10 bg-ink-900 px-2 py-1.5 text-sm text-white"
            aria-label={`Quantity for ${instrument.symbol}`}
          />
        </label>
        <span className="text-xs text-slate-500">
          ≈ {formatMinor(notional, currency)} notional
        </span>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            loading={busy === 'BUY'}
            disabled={!valid || busy !== null}
            onClick={() => trade('BUY')}
          >
            Buy
          </Button>
          <Button
            size="sm"
            variant="outline"
            loading={busy === 'SELL'}
            disabled={!valid || busy !== null}
            onClick={() => trade('SELL')}
          >
            Sell
          </Button>
        </div>
      </div>

      {message && (
        <p className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
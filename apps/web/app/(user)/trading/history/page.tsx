'use client';

import { useCallback, useEffect, useState } from 'react';
import { TradingShell } from '@/components/trading/trading-shell';
import {
  listTradingOrders,
  listTradingHistory,
  formatMinor,
  formatPrice,
  type TradingOrderView,
  type TradingTransactionView,
} from '@/lib/api/trading';

export default function TradingHistoryPage() {
  const [orders, setOrders] = useState<TradingOrderView[] | null>(null);
  const [transactions, setTransactions] = useState<TradingTransactionView[] | null>(null);
  const [filterSide, setFilterSide] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  const [activeTab, setActiveTab] = useState<'orders' | 'ledger'>('orders');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, t] = await Promise.all([listTradingOrders(100), listTradingHistory(100)]);
      setOrders(o);
      setTransactions(t);
    } catch {
      setError('Could not load trading history. Please try again.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredOrders = (orders ?? []).filter((o) => {
    if (filterSide === 'ALL') return true;
    return o.side === filterSide;
  });

  return (
    <TradingShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black text-white sm:text-3xl tracking-tight">
            Orders & Transaction History
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Complete audit trail of all executed market orders, limit triggers, and balance mutations.
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
            {error}
          </div>
        )}

        {/* View Switcher & Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#121620] p-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('orders')}
              className={`rounded-lg px-4 py-1.5 text-xs font-bold transition ${
                activeTab === 'orders'
                  ? 'bg-amber-400 text-black font-extrabold shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              Virtual Orders ({(orders ?? []).length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('ledger')}
              className={`rounded-lg px-4 py-1.5 text-xs font-bold transition ${
                activeTab === 'ledger'
                  ? 'bg-amber-400 text-black font-extrabold shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              Paper Ledger ({(transactions ?? []).length})
            </button>
          </div>

          {activeTab === 'orders' && (
            <div className="flex items-center gap-1 text-xs">
              {(['ALL', 'BUY', 'SELL'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFilterSide(s)}
                  className={`rounded-md px-2.5 py-1 font-semibold transition ${
                    filterSide === s
                      ? 'bg-white/15 text-white font-bold'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Orders Table */}
        {activeTab === 'orders' && (
          <div className="rounded-xl border border-white/10 bg-[#121620] overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead className="bg-[#0e121b] text-slate-400 text-[11px] border-b border-white/10">
                  <tr>
                    <th className="py-3 px-4">Date & Time</th>
                    <th className="py-3 px-4">Symbol</th>
                    <th className="py-3 px-4">Side</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Execution Price</th>
                    <th className="py-3 px-4">Quantity</th>
                    <th className="py-3 px-4 text-right">Notional</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredOrders.map((ord) => {
                    const isBuy = ord.side === 'BUY';
                    const d = new Date(ord.createdAt);
                    return (
                      <tr key={ord.id} className="hover:bg-white/[0.03] transition">
                        <td className="py-3 px-4 text-slate-400">
                          {d.toLocaleDateString()} {d.toLocaleTimeString()}
                        </td>
                        <td className="py-3 px-4 font-bold text-white text-sm">
                          {ord.symbol}
                          {ord.leverage && ord.leverage > 1 && (
                            <span className="ml-1.5 rounded bg-amber-400/20 px-1 py-0.5 text-[9px] text-amber-300 font-bold">
                              {ord.leverage}x
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-bold">
                          <span
                            className={`rounded px-2 py-0.5 text-xs ${
                              isBuy
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-rose-500/20 text-rose-400'
                            }`}
                          >
                            {ord.side}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                              ord.status === 'FILLED'
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : ord.status === 'ACKNOWLEDGED'
                                ? 'bg-amber-400/20 text-amber-300'
                                : ord.status === 'CANCELLED'
                                ? 'bg-slate-500/20 text-slate-400'
                                : 'bg-rose-500/20 text-rose-400'
                            }`}
                          >
                            {ord.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-white font-medium">
                          {ord.priceFilled ? formatPrice(ord.priceFilled, ord.symbol) : '—'}
                        </td>
                        <td className="py-3 px-4 text-slate-300 font-medium">{ord.quantity} units</td>
                        <td className="py-3 px-4 text-right font-bold text-white">
                          {formatMinor(ord.notional)}
                        </td>
                      </tr>
                    );
                  })}

                  {filteredOrders.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400">
                        No orders recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Ledger Table */}
        {activeTab === 'ledger' && (
          <div className="rounded-xl border border-white/10 bg-[#121620] overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead className="bg-[#0e121b] text-slate-400 text-[11px] border-b border-white/10">
                  <tr>
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Transaction Type</th>
                    <th className="py-3 px-4">Reason / Description</th>
                    <th className="py-3 px-4 text-right">Amount (Minor Units)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {(transactions ?? []).map((tx) => {
                    const isPositive = tx.amount >= 0;
                    const d = new Date(tx.createdAt);
                    return (
                      <tr key={tx.id} className="hover:bg-white/[0.03] transition">
                        <td className="py-3 px-4 text-slate-400">
                          {d.toLocaleDateString()} {d.toLocaleTimeString()}
                        </td>
                        <td className="py-3 px-4 font-bold text-white">
                          <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-amber-300">
                            {tx.type}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-300">{tx.reason}</td>
                        <td className={`py-3 px-4 text-right font-bold text-sm ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isPositive ? '+' : ''}
                          {formatMinor(tx.amount)}
                        </td>
                      </tr>
                    );
                  })}

                  {(transactions ?? []).length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-12 text-center text-slate-400">
                        No ledger transactions found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </TradingShell>
  );
}

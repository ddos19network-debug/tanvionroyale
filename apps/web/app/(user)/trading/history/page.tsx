'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@tanvion-royale/ui';
import { TradingShell } from '@/components/trading/trading-shell';
import {
  listTradingOrders,
  listTradingHistory,
  formatMinor,
  type TradingOrderView,
  type TradingTransactionView,
} from '@/lib/api/trading';

export default function TradingHistoryPage() {
  const [orders, setOrders] = useState<TradingOrderView[] | null>(null);
  const [transactions, setTransactions] = useState<TradingTransactionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, t] = await Promise.all([listTradingOrders(50), listTradingHistory(50)]);
      setOrders(o);
      setTransactions(t);
    } catch {
      setError('Could not load your trading history. Please sign in and try again.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <TradingShell>
      <h1 className="text-2xl font-bold text-white sm:text-3xl">History</h1>
      <p className="mt-1 text-sm text-slate-400">
        Your virtual orders and the paper ledger of every balance change.
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-white">Virtual orders</CardTitle>
          </CardHeader>
          <CardContent>
            {orders === null ? null : orders.length === 0 ? (
              <p className="text-sm text-slate-400">No orders yet.</p>
            ) : (
              <ul className="divide-y divide-white/5 text-sm">
                {orders.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <p className="text-slate-200">
                        <span className={o.side === 'BUY' ? 'text-emerald-400' : 'text-amber-400'}>
                          {o.side}
                        </span>{' '}
                        {o.quantity} × {o.symbol}
                      </p>
                      <p className="text-xs text-slate-500">
                        {new Date(o.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span className="font-mono text-xs text-slate-300">
                      {o.priceFilled !== null ? formatMinor(o.priceFilled) : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-white">Paper ledger</CardTitle>
          </CardHeader>
          <CardContent>
            {transactions === null ? null : transactions.length === 0 ? (
              <p className="text-sm text-slate-400">No ledger entries yet.</p>
            ) : (
              <ul className="divide-y divide-white/5 text-sm">
                {transactions.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <p className="text-slate-200">{t.reason}</p>
                      <p className="text-xs text-slate-500">
                        {t.type} · {new Date(t.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span className={`font-mono text-xs ${t.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {formatMinor(t.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </TradingShell>
  );
}
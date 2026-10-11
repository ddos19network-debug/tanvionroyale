'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@tanvion-royale/ui';
import { TradingShell } from '@/components/trading/trading-shell';
import { InstrumentTradeRow } from '@/components/trading/instrument-row';
import {
  getTradingPortfolio,
  listTradingInstruments,
  formatMinor,
  type TradingPortfolioView,
  type TradingInstrumentView,
} from '@/lib/api/trading';

export default function TradingOverviewPage() {
  const [portfolio, setPortfolio] = useState<TradingPortfolioView | null>(null);
  const [instruments, setInstruments] = useState<TradingInstrumentView[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, list] = await Promise.all([getTradingPortfolio(), listTradingInstruments()]);
      setPortfolio(p);
      setInstruments(list);
    } catch {
      setError('Could not load your paper-trading account. Please sign in and try again.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <TradingShell>
      <h1 className="text-2xl font-bold text-white sm:text-3xl">Paper Trading</h1>
      <p className="mt-1 text-sm text-slate-400">
        Practice trading with virtual credits. Simulated fills, integer-safe accounting, zero real
        money.
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}

      {portfolio && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-slate-400">Virtual balance</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-white">
                {formatMinor(portfolio.account.virtualBalance, portfolio.account.currency)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-slate-400">Equity (incl. open P&L)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-white">
                {formatMinor(portfolio.equity, portfolio.account.currency)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-slate-400">Unrealized P&L</CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold ${portfolio.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatMinor(portfolio.unrealizedPnl, portfolio.account.currency)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-slate-400">Realized P&L</CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold ${portfolio.realizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatMinor(portfolio.realizedPnl, portfolio.account.currency)}
              </p>
              <p className="mt-1 text-xs text-slate-500">{portfolio.marketStatus.label}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Markets</h2>
        <Link href="/trading/markets" className="text-sm text-brand hover:underline">
          View all →
        </Link>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {instruments.slice(0, 4).map((inst) => (
          <InstrumentTradeRow
            key={inst.id}
            instrument={inst}
            currency={portfolio?.account.currency ?? 'USD'}
            onDone={() => void load()}
          />
        ))}
      </div>
      {instruments.length === 0 && !error && (
        <p className="mt-3 text-sm text-slate-400">
          No instruments are enabled yet. An admin can seed the demo catalog.
        </p>
      )}
    </TradingShell>
  );
}
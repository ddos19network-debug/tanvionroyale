'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@tanvion-royale/ui';
import { TradingShell } from '@/components/trading/trading-shell';
import {
  getTradingPortfolio,
  closeTradingPosition,
  formatMinor,
  type TradingPortfolioView,
} from '@/lib/api/trading';
import { ApiClientError } from '@/lib/api/client';

export default function TradingPortfolioPage() {
  const [portfolio, setPortfolio] = useState<TradingPortfolioView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPortfolio(await getTradingPortfolio());
    } catch {
      setError('Could not load your portfolio. Please sign in and try again.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onClose(positionId: string) {
    setBusyId(positionId);
    setError(null);
    setMessage(null);
    try {
      const result = await closeTradingPosition(positionId);
      const pnl = result.closedPosition?.realizedPnl ?? 0;
      setMessage(
        `Position closed. Realized P&L ${formatMinor(pnl, result.account.currency)}.`,
      );
      await load();
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Could not close the position.',
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <TradingShell>
      <h1 className="text-2xl font-bold text-white sm:text-3xl">Portfolio</h1>
      <p className="mt-1 text-sm text-slate-400">Open virtual positions and their live paper P&L.</p>

      {error && (
        <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300" role="status">
          {message}
        </p>
      )}

      {portfolio && (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-slate-400">Virtual balance</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold text-white">
                  {formatMinor(portfolio.account.virtualBalance, portfolio.account.currency)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-slate-400">Equity</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold text-white">
                  {formatMinor(portfolio.equity, portfolio.account.currency)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-slate-400">Unrealized P&L</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-xl font-bold ${portfolio.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {formatMinor(portfolio.unrealizedPnl, portfolio.account.currency)}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="mt-6 space-y-3">
            {portfolio.positions.length === 0 && (
              <p className="text-sm text-slate-400">No open positions. Place a trade from Markets.</p>
            )}
            {portfolio.positions.map((pos) => (
              <Card key={pos.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div>
                    <p className="font-semibold text-white">
                      {pos.side === 'BUY' ? 'LONG' : 'SHORT'} {pos.quantity} × {pos.symbol}
                    </p>
                    <p className="text-xs text-slate-400">
                      Entry {formatMinor(pos.avgEntryPrice)} → Now {formatMinor(pos.currentPrice)}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className={`font-mono ${pos.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {formatMinor(pos.unrealizedPnl)}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      loading={busyId === pos.id}
                      onClick={() => void onClose(pos.id)}
                    >
                      Close
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </TradingShell>
  );
}
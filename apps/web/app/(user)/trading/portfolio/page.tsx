'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { TradingShell } from '@/components/trading/trading-shell';
import {
  getTradingPortfolio,
  closeTradingPosition,
  claimTradingFaucet,
  formatMinor,
  formatPrice,
  type TradingPortfolioView,
} from '@/lib/api/trading';
import { ApiClientError } from '@/lib/api/client';

export default function TradingPortfolioPage() {
  const [portfolio, setPortfolio] = useState<TradingPortfolioView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [faucetLoading, setFaucetLoading] = useState(false);
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

  async function handleFaucet(amountMinor = 1_000_000, reset = false) {
    setFaucetLoading(true);
    try {
      await claimTradingFaucet(amountMinor, reset);
      await load();
      setMessage(reset ? 'Account reset to $10,000.' : 'Added +$10,000 demo funds!');
      setTimeout(() => setMessage(null), 4000);
    } catch {
      setError('Could not claim faucet.');
    } finally {
      setFaucetLoading(false);
    }
  }

  const positions = portfolio?.positions ?? [];

  return (
    <TradingShell onBalanceUpdated={() => void load()}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-white sm:text-3xl tracking-tight">
              Trading Portfolio & Margin
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Overview of your virtual assets, open positions, unrealized P&L, and equity.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={faucetLoading}
              onClick={() => void handleFaucet(1_000_000)}
              className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-bold text-black transition hover:bg-amber-300 shadow-md shadow-amber-500/10 active:scale-95"
            >
              {faucetLoading ? 'Adding...' : '⚡ Add +$10,000 Funds'}
            </button>
            <Link
              href="/trading"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/10"
            >
              Go to Terminal →
            </Link>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
            {error}
          </div>
        )}
        {message && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300 font-medium">
            {message}
          </div>
        )}

        {portfolio && (
          <>
            {/* Metric KPI Cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-white/10 bg-[#121620] p-4 shadow-lg font-mono">
                <span className="text-xs text-slate-400 block mb-1">Available Virtual Balance</span>
                <p className="text-2xl font-black text-white">
                  {formatMinor(portfolio.account.virtualBalance, portfolio.account.currency)}
                </p>
                <span className="text-[10px] text-slate-500 mt-1 block">Free margin for new trades</span>
              </div>

              <div className="rounded-xl border border-white/10 bg-[#121620] p-4 shadow-lg font-mono">
                <span className="text-xs text-slate-400 block mb-1">Total Equity (Balance + P&L)</span>
                <p className="text-2xl font-black text-amber-300">
                  {formatMinor(portfolio.equity, portfolio.account.currency)}
                </p>
                <span className="text-[10px] text-slate-500 mt-1 block">Net portfolio liquidation value</span>
              </div>

              <div className="rounded-xl border border-white/10 bg-[#121620] p-4 shadow-lg font-mono">
                <span className="text-xs text-slate-400 block mb-1">Unrealized P&L</span>
                <p
                  className={`text-2xl font-black ${
                    portfolio.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {portfolio.unrealizedPnl >= 0 ? '+' : ''}
                  {formatMinor(portfolio.unrealizedPnl, portfolio.account.currency)}
                </p>
                <span className="text-[10px] text-slate-500 mt-1 block">
                  From {positions.length} active position{positions.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="rounded-xl border border-white/10 bg-[#121620] p-4 shadow-lg font-mono">
                <span className="text-xs text-slate-400 block mb-1">Realized Net P&L</span>
                <p
                  className={`text-2xl font-black ${
                    portfolio.realizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {portfolio.realizedPnl >= 0 ? '+' : ''}
                  {formatMinor(portfolio.realizedPnl, portfolio.account.currency)}
                </p>
                <span className="text-[10px] text-slate-500 mt-1 block">Settled gains and losses</span>
              </div>
            </div>

            {/* Positions Section */}
            <div className="rounded-xl border border-white/10 bg-[#121620] overflow-hidden shadow-xl">
              <div className="flex items-center justify-between border-b border-white/10 bg-[#0e121b] px-4 py-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-white">Active Positions</h2>
                  <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-bold text-amber-300">
                    {positions.length}
                  </span>
                </div>
                <span className="text-xs text-slate-400 font-mono">Market execution with 0 spread slippage</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="bg-[#0e121b] text-slate-400 text-[11px] border-b border-white/5">
                    <tr>
                      <th className="py-3 px-4">Instrument</th>
                      <th className="py-3 px-4">Side</th>
                      <th className="py-3 px-4">Quantity</th>
                      <th className="py-3 px-4">Entry Price</th>
                      <th className="py-3 px-4">Current Price</th>
                      <th className="py-3 px-4">Liq. Price</th>
                      <th className="py-3 px-4">Unrealized P&L</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {positions.map((pos) => {
                      const isLong = pos.side === 'BUY';
                      const isProfit = pos.unrealizedPnl >= 0;
                      const roePct = (
                        (pos.unrealizedPnl / (pos.avgEntryPrice * pos.quantity)) *
                        100 *
                        (pos.leverage ?? 1)
                      ).toFixed(2);

                      return (
                        <tr key={pos.id} className="hover:bg-white/[0.03] transition">
                          <td className="py-3 px-4">
                            <span className="font-bold text-white text-sm">{pos.symbol}</span>
                            <span className="text-[11px] text-slate-500 block">{pos.name}</span>
                          </td>
                          <td className="py-3 px-4 font-bold">
                            <span
                              className={`rounded px-2 py-0.5 text-xs ${
                                isLong ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                              }`}
                            >
                              {isLong ? 'BUY / LONG' : 'SELL / SHORT'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-white font-medium">{pos.quantity} units</td>
                          <td className="py-3 px-4 text-slate-300 font-medium">
                            {formatPrice(pos.avgEntryPrice, pos.symbol)}
                          </td>
                          <td className="py-3 px-4 text-white font-bold">
                            {formatPrice(pos.currentPrice, pos.symbol)}
                          </td>
                          <td className="py-3 px-4 text-rose-400">
                            {pos.liquidationPrice ? formatPrice(pos.liquidationPrice, pos.symbol) : '—'}
                          </td>
                          <td className="py-3 px-4 font-bold">
                            <span className={isProfit ? 'text-emerald-400' : 'text-rose-400'}>
                              {isProfit ? '+' : ''}
                              {formatMinor(pos.unrealizedPnl)} ({isProfit ? '+' : ''}
                              {roePct}%)
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              disabled={busyId === pos.id}
                              onClick={() => void onClose(pos.id)}
                              className="rounded-lg bg-rose-500/20 border border-rose-500/30 px-3 py-1.5 text-xs font-bold text-rose-300 transition hover:bg-rose-500 hover:text-white disabled:opacity-50"
                            >
                              {busyId === pos.id ? 'Closing...' : 'Close Position'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}

                    {positions.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-slate-400">
                          No open paper positions. Open a trade from the{' '}
                          <Link href="/trading" className="text-amber-300 underline font-bold">
                            Trade Terminal
                          </Link>
                          .
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </TradingShell>
  );
}

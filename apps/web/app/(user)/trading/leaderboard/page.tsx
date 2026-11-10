'use client';

import { useCallback, useEffect, useState } from 'react';
import { TradingShell } from '@/components/trading/trading-shell';
import {
  getTradingLeaderboard,
  formatMinor,
  type TradingLeaderboardEntry,
} from '@/lib/api/trading';

export default function TradingLeaderboardPage() {
  const [entries, setEntries] = useState<TradingLeaderboardEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEntries(await getTradingLeaderboard(25));
    } catch {
      setError('Could not load the leaderboard. Please sign in and try again.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const top3 = (entries ?? []).slice(0, 3);
  const rest = (entries ?? []).slice(3);

  return (
    <TradingShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black text-white sm:text-3xl tracking-tight">
            Trader Leaderboard
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Top ranked paper trading accounts by portfolio equity and realized returns.
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
            {error}
          </div>
        )}

        {/* Top 3 Podium */}
        {top3.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-3">
            {top3.map((entry, idx) => {
              const medals = ['🥇 1st Place', '🥈 2nd Place', '🥉 3rd Place'];
              const borders = [
                'border-amber-400/50 bg-gradient-to-b from-amber-500/15 to-[#121620]',
                'border-slate-300/40 bg-gradient-to-b from-slate-300/10 to-[#121620]',
                'border-amber-700/40 bg-gradient-to-b from-amber-700/10 to-[#121620]',
              ];
              return (
                <div
                  key={`${entry.username}-${idx}`}
                  className={`rounded-xl border p-5 text-center shadow-xl font-mono ${borders[idx]}`}
                >
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-300 block mb-2">
                    {medals[idx]}
                  </span>
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-xl font-black text-white mb-2 shadow-inner">
                    {entry.username.slice(0, 2).toUpperCase()}
                  </div>
                  <h3 className="text-base font-bold text-white truncate px-2">{entry.username}</h3>
                  <p className="mt-2 text-2xl font-black text-white">
                    {formatMinor(entry.equity)}
                  </p>
                  <span
                    className={`mt-1 block text-xs font-bold ${
                      entry.realizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {entry.realizedPnl >= 0 ? '+' : ''}
                    {formatMinor(entry.realizedPnl)} Realized P&L
                  </span>
                  {entry.winRate != null && (
                    <span className="mt-1 block text-[11px] text-slate-400">
                      Win Rate: <span className="text-white font-bold">{entry.winRate}%</span>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Rankings Table */}
        <div className="rounded-xl border border-white/10 bg-[#121620] overflow-hidden shadow-xl">
          <div className="flex items-center justify-between border-b border-white/10 bg-[#0e121b] px-4 py-3">
            <h2 className="text-sm font-bold text-white">All Rankings</h2>
            <span className="text-xs text-slate-400 font-mono">Ranked by Total Equity</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead className="bg-[#0e121b] text-slate-400 text-[11px] border-b border-white/5">
                <tr>
                  <th className="py-3 px-4 w-16">Rank</th>
                  <th className="py-3 px-4">Trader</th>
                  <th className="py-3 px-4">Realized Returns</th>
                  <th className="py-3 px-4">Win Rate</th>
                  <th className="py-3 px-4 text-right">Total Equity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {(entries ?? []).map((entry, idx) => {
                  const isProfit = entry.realizedPnl >= 0;
                  return (
                    <tr key={`${entry.username}-${idx}`} className="hover:bg-white/[0.03] transition">
                      <td className="py-3 px-4 font-bold text-slate-400">
                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                      </td>
                      <td className="py-3 px-4 font-bold text-white text-sm">
                        {entry.username}
                      </td>
                      <td className="py-3 px-4 font-bold">
                        <span className={isProfit ? 'text-emerald-400' : 'text-rose-400'}>
                          {isProfit ? '+' : ''}
                          {formatMinor(entry.realizedPnl)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-300">
                        {entry.winRate != null ? `${entry.winRate}%` : '50%'}
                      </td>
                      <td className="py-3 px-4 text-right font-black text-white text-sm">
                        {formatMinor(entry.equity)}
                      </td>
                    </tr>
                  );
                })}

                {entries && entries.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400">
                      No traders on the leaderboard yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </TradingShell>
  );
}

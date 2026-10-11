'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@tanvion-royale/ui';
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
      setEntries(await getTradingLeaderboard(10));
    } catch {
      setError('Could not load the leaderboard. Please sign in and try again.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <TradingShell>
      <h1 className="text-2xl font-bold text-white sm:text-3xl">Leaderboard</h1>
      <p className="mt-1 text-sm text-slate-400">
        Top virtual accounts ranked by equity (virtual balance + open P&L + realized P&L).
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-white">Top paper traders</CardTitle>
        </CardHeader>
        <CardContent>
          {entries === null ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-slate-400">
              No paper accounts yet — be the first to place a virtual trade.
            </p>
          ) : (
            <ol className="divide-y divide-white/5 text-sm">
              {entries.map((entry, index) => (
                <li key={`${entry.username}-${index}`} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="flex items-center gap-3 text-slate-200">
                    <span className="w-6 text-right font-mono text-slate-500">{index + 1}</span>
                    {entry.username}
                  </span>
                  <span className="flex items-center gap-4">
                    <span className={`font-mono text-xs ${entry.realizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {formatMinor(entry.realizedPnl)} realized
                    </span>
                    <span className="font-mono font-bold text-white">{formatMinor(entry.equity)}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </TradingShell>
  );
}
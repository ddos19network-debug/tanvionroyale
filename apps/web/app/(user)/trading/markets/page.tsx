'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@tanvion-royale/ui';
import { TradingShell, Sparkline } from '@/components/trading/trading-shell';
import { InstrumentTradeRow } from '@/components/trading/instrument-row';
import {
  listTradingInstruments,
  getTradingInstrument,
  getTradingPortfolio,
  formatMinor,
  type TradingInstrumentView,
  type TradingInstrumentDetailView,
  type TradingPortfolioView,
} from '@/lib/api/trading';

export default function TradingMarketsPage() {
  const [portfolio, setPortfolio] = useState<TradingPortfolioView | null>(null);
  const [instruments, setInstruments] = useState<TradingInstrumentView[]>([]);
  const [detail, setDetail] = useState<TradingInstrumentDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, list] = await Promise.all([getTradingPortfolio(), listTradingInstruments()]);
      setPortfolio(p);
      setInstruments(list);
      if (list.length > 0 && !detail) {
        setDetail(await getTradingInstrument(list[0].id));
      }
    } catch {
      setError('Could not load markets. Please sign in and try again.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function selectInstrument(id: string) {
    try {
      setDetail(await getTradingInstrument(id));
    } catch {
      setError('Could not load the chart for this instrument.');
    }
  }

  return (
    <TradingShell>
      <h1 className="text-2xl font-bold text-white sm:text-3xl">Markets</h1>
      <p className="mt-1 text-sm text-slate-400">
        Virtual instruments with clearly-labelled prices. DEMO charts are synthetic and
        deterministic — never a live feed.
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}

      {detail && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center justify-between text-white">
              <span>
                {detail.symbol} · {detail.name}
              </span>
              <span className="font-mono text-xl">{formatMinor(detail.currentPrice)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Sparkline points={detail.history.map((h) => h.price)} />
            <p className="mt-2 text-xs text-amber-400">{detail.priceLabel}</p>
          </CardContent>
        </Card>
      )}

      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        {instruments.map((inst) => (
          <div key={inst.id}>
            <button
              type="button"
              onClick={() => void selectInstrument(inst.id)}
              className="mb-1 text-xs text-slate-400 underline-offset-2 hover:text-white hover:underline"
            >
              Show chart
            </button>
            <InstrumentTradeRow
              instrument={inst}
              currency={portfolio?.account.currency ?? 'USD'}
              onDone={() => void load()}
            />
          </div>
        ))}
      </div>
    </TradingShell>
  );
}
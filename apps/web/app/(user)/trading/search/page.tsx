'use client';

import { TradingShell } from '@/components/trading/trading-shell';

export default function TradingSearchPage() {
  return (
    <TradingShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black text-white sm:text-3xl tracking-tight">
            Search
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Search coins and instruments. Coming soon.
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#121620] p-6 text-center">
          <p className="text-slate-400 text-sm">Search page — under construction.</p>
        </div>
      </div>
    </TradingShell>
  );
}

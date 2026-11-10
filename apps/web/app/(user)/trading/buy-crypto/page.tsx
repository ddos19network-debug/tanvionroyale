'use client';

import { TradingShell } from '@/components/trading/trading-shell';

export default function TradingBuyCryptoPage() {
  return (
    <TradingShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black text-white sm:text-3xl tracking-tight">
            Buy Crypto
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Purchase cryptocurrency with fiat currency. Coming soon.
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#121620] p-6 text-center">
          <p className="text-slate-400 text-sm">Buy Crypto page — under construction.</p>
        </div>
      </div>
    </TradingShell>
  );
}

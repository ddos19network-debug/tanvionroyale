'use client';

import { Suspense } from 'react';
import { TradingShell } from '@/components/trading/trading-shell';
import { TradingTerminal } from '@/components/trading/trading-terminal';

export default function TradingPage() {
  return (
    <TradingShell fullWidth>
      <Suspense
        fallback={
          <div className="flex h-96 items-center justify-center font-mono text-sm text-slate-400">
            Loading Royale Exchange Terminal...
          </div>
        }
      >
        <TradingTerminal />
      </Suspense>
    </TradingShell>
  );
}

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { TradingShell } from '@/components/trading/trading-shell';
import Link from 'next/link';

export default function TradingDepositPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/wallet/deposit');
  }, [router]);

  return (
    <TradingShell>
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
        <p className="text-sm font-semibold text-slate-300">
          Redirecting to TANVIONROYALE Official Wallet Deposit...
        </p>
        <Link
          href="/wallet/deposit"
          className="rounded-full bg-gradient-to-r from-amber-400 to-[#F0B90B] px-5 py-2 text-xs font-bold text-ink-950 hover:brightness-110 shadow-lg shadow-amber-500/20"
        >
          Click here if not redirected
        </Link>
      </div>
    </TradingShell>
  );
}

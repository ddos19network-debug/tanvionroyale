'use client';

/**
 * Native Football page — TANVION's own responsive Football interface.
 *
 * Reuses the shared BetSlipProvider (mounted in the root layout) so staging
 * state here is the same temporary client state as everywhere else.
 */
import { BetSlipProvider } from '@/components/betting';
import { FootballBoard } from '@/components/football/football-board';

export default function FootballPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:pb-10">
      <h1 className="text-2xl font-bold text-white sm:text-3xl">Football</h1>
      <p className="mt-1 text-sm text-slate-400">
        Live and pre-match Football fixtures, competitions, markets and odds — served by the
        TANVION backend. Wagering is paused until a licensed provider is configured.
      </p>
      <BetSlipProvider>
        <FootballBoard />
      </BetSlipProvider>
    </main>
  );
}

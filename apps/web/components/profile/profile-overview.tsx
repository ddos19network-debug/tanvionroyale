'use client';
import Link from 'next/link';
import { Card, CardContent } from '@tanvion-royale/ui';
import type { ProfileSummary } from '@/lib/api/profile';
import { formatMoney } from '@/lib/betting';
import { EmptyState, ErrorBox } from './profile-ui';
import { Skeleton } from '@tanvion-royale/ui';

export function OverviewTab({ summary, error, onRetry }: { summary: ProfileSummary | null; error: string | null; onRetry: () => void }) {
  if (error) return <ErrorBox message={error} onRetry={onRetry} />;
  if (!summary) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  const cards = [
    { label: 'Wallet Balance', value: summary.wallet ? formatMoney(summary.wallet.availableBalance, summary.wallet.currency) : '—' },
    { label: 'Total Deposited', value: formatMoney(summary.totalDeposited, summary.currency) },
    { label: 'Total Withdrawn', value: formatMoney(summary.totalWithdrawn, summary.currency) },
    { label: 'Total Bets', value: String(summary.totalBets) },
    { label: 'Total Games', value: String(summary.totalGames + summary.totalCrashBets) },
    { label: 'Total Wins', value: String(summary.totalWins) },
    { label: 'Total Losses', value: String(summary.totalLosses) },
    { label: 'Total Staked', value: formatMoney(summary.totalStaked, summary.currency) },
    { label: 'Total Payout', value: formatMoney(summary.totalPayout, summary.currency) },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">{c.label}</p>
            <p className="mt-1 truncate text-xl font-bold">{c.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function CasinoTab() {
  return (
    <div className="space-y-2">
      <EmptyState title="No casino activity yet." hint="Third-party casino is not integrated on this deployment." actionHref="/games" actionLabel="Browse Games" />
      <EmptyState title="Live Casino activity will appear here when available." hint="No live-dealer provider is configured yet." />
      <EmptyState title="Royale Play history" hint="Royale Play maps to the free-play Games engine — see the Games tab." actionHref="/games/play" actionLabel="Open Royale Play" />
    </div>
  );
}

export function WalletCtas() {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <Link href="/wallet/deposit" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">Deposit</Link>
      <Link href="/wallet/withdraw" className="rounded-md border border-ink-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/5">Withdraw</Link>
      <Link href="/wallet/transactions" className="rounded-md border border-ink-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/5">All transactions</Link>
    </div>
  );
}

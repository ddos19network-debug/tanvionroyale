'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, Skeleton } from '@tanvion-royale/ui';
import { listMyBets } from '@/lib/api';
import type { MyBetsStatus } from '@/lib/api/betting';
import { ApiClientError } from '@/lib/api/client';
import { formatMoney } from '@/lib/betting';
import type { BetView } from '@tanvion-royale/types';

const FILTERS: MyBetsStatus[] = ['ALL', 'PENDING', 'ACCEPTED', 'REJECTED', 'SETTLED', 'VOID', 'CANCELLED'];

const STATUS_STYLE: Record<string, string> = {

  PENDING: 'bg-amber-500/15 text-amber-300',
  ACCEPTED: 'bg-emerald-500/15 text-emerald-300',
  SETTLED: 'bg-ink-700 text-slate-300',
  WIN: 'bg-emerald-500/15 text-emerald-300',
  LOSS: 'bg-red-500/15 text-red-300',
  CANCELLED: 'bg-ink-700 text-slate-500',
  REJECTED: 'bg-red-500/15 text-red-300',
  VOID: 'bg-ink-700 text-slate-500',

};

export default function MyBetsPage() {
  const [bets, setBets] = useState<BetView[] | null>(null);
  const [filter, setFilter] = useState<MyBetsStatus>('ALL');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listMyBets(filter)
      .then((data) => {
        if (!cancelled) setBets(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof ApiClientError && err.status === 401
              ? 'Please sign in to view your bets.'
              : err instanceof ApiClientError
                ? err.message
                : 'Something went wrong while loading your bets.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  return (
    <>
      <main className="mx-auto max-w-4xl px-4 py-8 pb-40">
        <h1 className="text-2xl font-bold">My Bets</h1>
        <p className="mt-1 text-sm text-slate-300">Track the bets you have placed.</p>

        <div className="mt-4 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-sm font-medium transition ${
                filter === f
                  ? 'bg-indigo-600 text-white'
                  : 'bg-ink-700 text-slate-300 hover:bg-white/15'
              }`}
            >
              {f.charAt(0) + f.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="mt-6 space-y-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : error ? (
          <p className="mt-6 rounded-md bg-red-950/50 px-4 py-3 text-sm text-red-300" role="alert">
            {error}
          </p>
        ) : !bets || bets.length === 0 ? (
          <p className="mt-6 text-sm text-slate-500">
            No bets found.{' '}
            <Link href="/events" className="underline">
              Browse events
            </Link>{' '}
            to place your first bet.
          </p>
        ) : (
          <div className="mt-6 space-y-3">
            {bets.map((bet) => (
              <Link key={bet.id} href={`/my-bets/${bet.id}`} className="block">
                <Card className="transition hover:shadow-md">
                  <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        {bet.selections[0]?.selectionName ?? 'Bet'}
                      </p>
                      <p className="text-xs text-slate-500">
                        {bet.selections[0]?.eventName} · Odds{' '}
                        {bet.selections[0]?.priceAtPlacement ?? '—'} ·{' '}
                        {new Date(bet.createdAt).toLocaleString([], {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-sm sm:flex-col sm:items-end sm:gap-1">
                      <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[bet.status] ?? 'bg-ink-700'}`}>
                        {bet.status === 'SETTLED' && bet.result ? bet.result : bet.status}
                      </span>
                      <span className="font-semibold">
                        {bet.status === 'SETTLED' && bet.payout !== null
                          ? `${bet.result === 'LOSS' ? 'Lost' : 'Paid'} ${formatMoney(bet.payout, bet.currency)}`
                          : `${formatMoney(bet.stake)} → ${formatMoney(bet.potentialPayout)}`}
                      </span>
                      <span className="text-xs text-slate-400">#{bet.id.slice(0, 8)}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
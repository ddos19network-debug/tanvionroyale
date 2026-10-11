'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@tanvion-royale/ui';
import { getBet } from '@/lib/api';
import { ApiClientError } from '@/lib/api/client';
import { formatMoney } from '@/lib/betting';
import type { BetView } from '@tanvion-royale/types';

export default function BetDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : '';
  const [bet, setBet] = useState<BetView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getBet(id)
      .then((data) => {
        if (!cancelled) setBet(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof ApiClientError && err.status === 404
              ? 'This bet does not exist or is not yours.'
              : 'Something went wrong while loading this bet. Please try again.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <>
      <main className="mx-auto max-w-3xl px-4 py-8 pb-40">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-72" />
            <Skeleton className="h-48" />
          </div>
        ) : error ? (
          <p className="rounded-md bg-red-950/50 px-4 py-3 text-sm text-red-300" role="alert">
            {error}{' '}
            <Link href="/my-bets" className="underline">
              Back to My Bets
            </Link>
          </p>
        ) : bet ? (
          <>
            <nav className="text-sm text-slate-500">
              <Link href="/my-bets" className="hover:underline">
                My Bets
              </Link>{' '}
              / <span className="text-slate-300">Bet #{bet.id.slice(0, 8)}</span>
            </nav>
            <h1 className="mt-2 text-2xl font-bold">Bet details</h1>

            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>{bet.status}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>
                  <span className="text-slate-500">Created:</span>{' '}
                  {new Date(bet.createdAt).toLocaleString()}
                </p>
                <p>
                  <span className="text-slate-500">Updated:</span>{' '}
                  {new Date(bet.updatedAt).toLocaleString()}
                </p>
                <p>
                  <span className="text-slate-500">Type:</span> {bet.type}
                </p>
                <p>
                  <span className="text-slate-500">Stake:</span>{' '}
                  <span className="font-medium">{formatMoney(bet.stake, bet.currency)}</span>
                </p>
                <p>
                  <span className="text-slate-500">Potential payout:</span>{' '}
                  <span className="font-medium">{formatMoney(bet.potentialPayout, bet.currency)}</span>
                </p>
                {bet.status === 'SETTLED' && bet.result && (
                  <>
                    <p>
                      <span className="text-slate-500">Result:</span>{' '}
                      <span className="font-semibold">{bet.result}</span>
                    </p>
                    <p>
                      <span className="text-slate-500">
                        {bet.result === 'LOSS' ? 'Lost stake' : 'Paid'}:
                      </span>{' '}
                      <span className="font-medium">{formatMoney(bet.payout ?? 0, bet.currency)}</span>
                    </p>
                    {bet.settledAt && (
                      <p>
                        <span className="text-slate-500">Settled:</span>{' '}
                        {new Date(bet.settledAt).toLocaleString()}
                      </p>
                    )}
                  </>
                )}
                {bet.providerReference && (
                  <p>
                    <span className="text-slate-500">Provider reference:</span>{' '}
                    <span className="font-mono text-xs">{bet.providerReference}</span>
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Selections</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {bet.selections.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-md border border-white/10 p-3 text-sm"
                  >
                    <p className="font-medium">{s.selectionName}</p>
                    <p className="text-slate-500">
                      {s.eventName} · {s.marketName}
                    </p>
                    <p>
                      <span className="text-slate-500">Odds at placement:</span>{' '}
                      <span className="font-semibold">{s.priceAtPlacement}</span>
                      <span className="ml-2 text-xs text-slate-400">v{s.oddsVersion}</span>
                      {s.result && (
                        <span
                          className={`ml-2 rounded px-2 py-0.5 text-xs ${
                            s.result === 'WIN'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : s.result === 'LOSS'
                                ? 'bg-red-500/15 text-red-300'
                                : 'bg-ink-700 text-slate-500'
                          }`}
                        >
                          {s.result}
                        </span>
                      )}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        ) : null}
      </main>
    </>
  );
}
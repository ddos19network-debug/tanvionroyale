'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@tanvion-royale/ui';
import { listSports } from '@/lib/api/sports';
import { ApiClientError } from '@/lib/api/client';
import type { PublicSport } from '@tanvion-royale/types';
import { WinHouseBook } from '@/components/sports/winhouse-book';

const SPORT_ICONS: Record<string, string> = {
  football: '⚽',
  cricket: '🏏',
  basketball: '🏀',
  tennis: '🎾',
  baseball: '⚾',
  hockey: '🏒',
  rugby: '🏉',
  volleyball: '🏐',
  'table-tennis': '🏓',
  boxing: '🥊',
  mma: '🥋',
  golf: '⛳',
  'motor-sports': '🏎️',
  esports: '🎮',
  olympics: '🏅',
};

const SPORT_GRADIENTS: Record<string, string> = {
  football: 'from-emerald-600 to-teal-900',
  cricket: 'from-cyan-600 to-teal-900',
  basketball: 'from-orange-600 to-red-900',
  tennis: 'from-lime-600 to-emerald-900',
  baseball: 'from-red-600 to-rose-900',
  hockey: 'from-sky-600 to-blue-900',
  rugby: 'from-indigo-600 to-purple-900',
  volleyball: 'from-fuchsia-600 to-purple-900',
  'table-tennis': 'from-teal-600 to-cyan-900',
  boxing: 'from-amber-600 to-orange-900',
  mma: 'from-slate-600 to-slate-900',
  golf: 'from-green-600 to-emerald-900',
  'motor-sports': 'from-red-600 to-orange-900',
  esports: 'from-fuchsia-600 to-purple-900',
  olympics: 'from-yellow-600 to-amber-900',
};

/** Sports hub — the entry point for browsing sports, competitions and events. */
export default function SportsPage() {
  const [sports, setSports] = useState<PublicSport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumped by the retry button to re-run the load effect.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listSports()
      .then((data) => {
        if (!cancelled) setSports(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof ApiClientError
              ? err.message
              : 'Something went wrong while loading sports. Please try again.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return (
    <>
      <main className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:pb-10">
        <h1 className="text-2xl font-bold text-white sm:text-3xl">Sports</h1>
        <p className="mt-1 text-sm text-slate-400">
          Browse sports, competitions and live events. Select a sport to see its matches.
        </p>

        {/* BIG SPORT sportsbook — the external provider's book, embedded with its
            own loader (inside this existing container; nothing else on the page
            changes). Renders ONLY for a signed-in player and ONLY when the
            provider is configured: otherwise it renders nothing at all. */}
        <WinHouseBook />

        {loading ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        ) : error ? (
          <p className="mt-6 rounded-md bg-red-950/50 px-4 py-3 text-sm text-red-300" role="alert">
            {error}{' '}
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="underline"
            >
              Retry
            </button>
          </p>
        ) : !sports || sports.length === 0 ? (
          <p className="mt-6 text-sm text-slate-500">
            No sports are available right now. Please check back later.
          </p>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sports.map((sport) => {
              const icon = SPORT_ICONS[sport.slug] ?? '🏆';
              const gradient = SPORT_GRADIENTS[sport.slug] ?? 'from-teal-600 to-cyan-900';
              return (
                <Link key={sport.id} href={`/sports/${sport.slug}`} className="group">
                  <Card className="h-full overflow-hidden transition group-hover:-translate-y-1 group-hover:border-brand/60 group-hover:shadow-[0_8px_30px_rgba(20,184,166,0.15)]">
                    <div className={`relative flex h-24 items-center justify-center bg-gradient-to-br ${gradient}`}>
                      <span className="text-4xl drop-shadow" aria-hidden>
                        {icon}
                      </span>
                    </div>
                    <CardHeader>
                      <CardTitle className="text-white">{sport.name}</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-slate-400">
                      {sport.description ?? 'Explore games and events.'}
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
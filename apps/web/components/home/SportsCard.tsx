'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Skeleton } from '@tanvion-royale/ui';
import { listSports } from '@/lib/api/sports';
import { ApiClientError } from '@/lib/api/client';
import { sportGradient, sportIcon } from '@/lib/data/sports';
import type { PublicSport } from '@tanvion-royale/types';

/**
 * Sports card — REAL catalog data only (GET /sports). Event counts are never
 * invented on the client; the detail page (Sports → Sport → Events) shows the
 * authoritative event list from the backend.
 */
export function SportsCard({ sport }: { sport: PublicSport }) {
  return (
    <article className="group relative overflow-hidden rounded-xl border border-white/10 bg-ink-800 transition duration-200 hover:-translate-y-1 hover:border-brand/60 hover:shadow-[0_8px_30px_rgba(20,184,166,0.15)]">
      <div className={`relative aspect-[16/9] w-full bg-gradient-to-br ${sportGradient(sport.slug)}`}>
        <span className="absolute inset-0 flex items-center justify-center text-4xl drop-shadow sm:text-5xl" aria-hidden>
          {sportIcon(sport.slug)}
        </span>
        <span className="absolute left-3 top-3 rounded-md bg-black/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90">
          {sport.status}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-white">{sport.name}</h3>
          <p className="truncate text-[11px] text-slate-400">{sport.description ?? 'Explore games and events.'}</p>
        </div>
        <Link
          href={`/sports/${sport.slug}`}
          className="shrink-0 rounded-lg border border-brand/50 px-2.5 py-1 text-xs font-semibold text-brand transition hover:bg-brand hover:text-ink-950"
          aria-label={`View ${sport.name} events`}
        >
          View events
        </Link>
      </div>
    </article>
  );
}

/**
 * Sports section — loads the REAL sport catalog from the backend with explicit
 * loading / error / empty states. Never fabricates sports to fill the grid.
 */
export function SportsSection() {
  const [sports, setSports] = useState<PublicSport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
    <section aria-labelledby="sports-heading">
      <div className="mb-4 flex items-end justify-between gap-4">
        <h2 id="sports-heading" className="text-lg font-bold text-white sm:text-xl">
          Sports
        </h2>
        <Link href="/sports" className="text-xs font-semibold text-brand hover:underline sm:text-sm">
          All sports →
        </Link>
      </div>

      {loading ? (
        <div className="no-scrollbar -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:px-0 lg:grid-cols-4">
          {[0, 1, 2, 3].map((n) => (
            <Skeleton key={n} className="h-44 w-52 shrink-0 snap-start sm:w-auto" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-md border border-white/10 bg-ink-800 px-4 py-3 text-sm text-slate-300" role="alert">
          {error}{' '}
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="underline text-brand"
          >
            Retry
          </button>
        </div>
      ) : !sports || sports.length === 0 ? (
        <p className="text-sm text-slate-500">
          No sports are available right now. Please check back later.
        </p>
      ) : (
        <ul className="no-scrollbar -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:px-0 lg:grid-cols-4">
          {sports.map((sport) => (
            <li key={sport.id} className="w-52 shrink-0 snap-start sm:w-auto">
              <SportsCard sport={sport} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
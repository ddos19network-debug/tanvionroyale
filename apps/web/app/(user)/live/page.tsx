'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Card, CardContent, Skeleton } from '@tanvion-royale/ui';
import { listEvents, getPartnerRedirect } from '@/lib/api/betting';
import { ApiClientError } from '@/lib/api/client';
import type { PublicEvent } from '@tanvion-royale/types';

/**
 * Live sports events page. Shows only LIVE events (authoritative from the
 * backend/provider). Partner events show [Open Match] (server-side redirect);
 * native events open the event detail page. Betting itself is temporarily
 * paused in the UI (config/features.ts) — this listing stays read-only.
 */
export default function LivePage() {
  const [events, setEvents] = useState<PublicEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirectingId, setRedirectingId] = useState<string | null>(null);
  // Bumped by the retry button to re-run the load effect.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listEvents('LIVE')
      .then((data) => {
        if (!cancelled) setEvents(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof ApiClientError
              ? err.message
              : 'Something went wrong while loading live events. Please try again.',
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

  async function handlePartnerRedirect(event: PublicEvent) {
    if (!event.partner) return;
    setRedirectingId(event.id);
    try {
      const res = await getPartnerRedirect(event.id);
      // Server-side resolved, allowlisted destination only.
      window.location.href = res.url;
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to open this match on the partner platform. Please try again.',
      );
      setRedirectingId(null);
    }
  }

  return (
    <>
      <main className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:pb-10">
        <h1 className="text-2xl font-bold text-white sm:text-3xl">Live</h1>
        <p className="mt-1 text-sm text-slate-400">
          Live sports events happening right now.
        </p>

        {loading ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
        ) : !events || events.length === 0 ? (
          <p className="mt-6 text-sm text-slate-500">
            No live events right now. Check back soon.
          </p>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => {
              const isPartner = event.bettingMode === 'PARTNER';
              return (
                <Card key={event.id} className="overflow-hidden">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {event.sport?.name ? `${event.sport.name} · ` : ''}
                        {event.competition?.name ?? 'Competition'}
                      </span>
                      <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs font-bold text-red-300">
                        LIVE
                      </span>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">
                          {event.homeName ?? event.name}
                        </p>
                        <p className="text-xs text-slate-500">vs</p>
                        <p className="truncate text-sm font-semibold text-white">
                          {event.awayName ?? ''}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs text-slate-400">
                          {new Date(event.startTime).toLocaleString([], {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </p>
                        {isPartner && event.partner && (
                          <span className="mt-1 inline-block rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                            Partner: {event.partner.name}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-3">
                      {isPartner ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          loading={redirectingId === event.id}
                          onClick={() => handlePartnerRedirect(event)}
                        >
                          Open Match
                        </Button>
                      ) : (
                        <Link href={`/events/${event.id}`} className="block">
                          <Button variant="primary" size="sm" className="w-full">
                            View Match
                          </Button>
                        </Link>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
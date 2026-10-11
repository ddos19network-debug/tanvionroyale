'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@tanvion-royale/ui';
import { listEvents, getPartnerRedirect } from '@/lib/api';
import { ApiClientError } from '@/lib/api/client';
import { BET_SLIP_ENABLED } from '@/config/features';
import type { PublicEvent } from '@tanvion-royale/types';

type Filter = 'ALL' | 'LIVE' | 'UPCOMING';

export default function EventsPage() {
  const [events, setEvents] = useState<PublicEvent[] | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirectingId, setRedirectingId] = useState<string | null>(null);
  // Bumped by the retry button to re-run the load effect.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listEvents(filter === 'ALL' ? 'ALL' : filter)
      .then((data) => {
        if (!cancelled) setEvents(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof ApiClientError
              ? err.message
              : 'Something went wrong while loading events. Please try again.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter, attempt]);

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

  const statusBadge = (event: PublicEvent) => {
    if (event.status === 'LIVE' || event.live) {
      return <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs font-bold text-red-300">LIVE</span>;
    }
    const map: Record<PublicEvent['status'], string> = {
      SCHEDULED: 'bg-ink-700 text-slate-300',
      LIVE: 'bg-red-500/15 text-red-300',
      SUSPENDED: 'bg-amber-500/15 text-amber-300',
      FINISHED: 'bg-ink-700 text-slate-500',
      CANCELLED: 'bg-ink-700 text-slate-500',
    };
    return <span className={`rounded px-2 py-0.5 text-xs ${map[event.status]}`}>{event.status}</span>;
  };

  return (
    <>
      <main className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:pb-10">
        <h1 className="text-2xl font-bold text-white sm:text-3xl">Events</h1>
        <p className="mt-1 text-sm text-slate-400">
          {BET_SLIP_ENABLED
            ? 'Pick an event, choose a market and add a selection to your bet slip.'
            : 'Browse the live and upcoming events available on the platform.'}
        </p>

        {/* LIVE / UPCOMING / ALL filter */}
        <div className="mt-6 flex gap-2" role="tablist" aria-label="Event filters">
          {(['ALL', 'LIVE', 'UPCOMING'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                filter === f
                  ? 'bg-brand text-ink-950'
                  : 'border border-white/10 bg-ink-800 text-slate-300 hover:bg-white/5'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
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
            No events are available right now. Please check back later.
          </p>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => {
              const isPartner = event.bettingMode === 'PARTNER';
              const isSuspended = event.status === 'SUSPENDED';
              return (
                <Card key={event.id} className="overflow-hidden">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-base text-white">
                        {event.competition?.name ?? event.name}
                      </CardTitle>
                      {statusBadge(event)}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-slate-400">
                    <p className="font-semibold text-white">
                      {event.homeName ?? event.name}
                      {event.awayName ? ` vs ${event.awayName}` : ''}
                    </p>
                    <p>
                      {new Date(event.startTime).toLocaleString([], {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </p>
                    {isPartner && event.partner && (
                      <span className="inline-block rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                        Partner: {event.partner.name}
                      </span>
                    )}
                    <div className="pt-1">
                      {isSuspended ? (
                        <Button variant="outline" size="sm" className="w-full" disabled>
                          Suspended
                        </Button>
                      ) : isPartner ? (
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
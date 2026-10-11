'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button, Card, CardContent, Skeleton } from '@tanvion-royale/ui';
import { AppBackButton } from '@/components/navigation';
import { getSport, getSportCompetitions } from '@/lib/api/sports';
import { listEvents, getPartnerRedirect } from '@/lib/api/betting';
import { ApiClientError } from '@/lib/api/client';
import type { PublicCompetition, PublicEvent, SportWithGames } from '@tanvion-royale/types';

type Filter = 'ALL' | 'LIVE' | 'UPCOMING';

/**
 * Sport detail page — the sports-hub navigation level below a sport. Shows the
 * sport, its competitions and LIVE/UPCOMING events. Partner events show
 * [Open Match] (server-side allowlisted redirect); native events show
 * [View Match] (which opens the event detail page — betting itself is
 * temporarily paused in the UI, see config/features.ts). Suspended events stay
 * clearly disabled.
 */
export default function SportDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = typeof params?.slug === 'string' ? params.slug : '';
  const [sport, setSport] = useState<SportWithGames | null>(null);
  const [competitions, setCompetitions] = useState<PublicCompetition[]>([]);
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [competitionSlug, setCompetitionSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirectingId, setRedirectingId] = useState<string | null>(null);
  // Bumped by the retry button to re-run the load effect.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Server-side sport scoping: only events for THIS sport are loaded.
    Promise.all([getSport(slug), getSportCompetitions(slug), listEvents('ALL', slug)])
      .then(([sportData, competitionData, eventData]) => {
        if (!cancelled) {
          setSport(sportData);
          setCompetitions(competitionData);
          setEvents(eventData);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof ApiClientError && err.status === 404
              ? 'This sport does not exist or is not available.'
              : 'Something went wrong while loading this sport. Please try again.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, attempt]);

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

  const visibleEvents = events.filter((e) => {
    if (competitionSlug && e.competition?.slug !== competitionSlug) return false;
    if (filter === 'LIVE') return e.status === 'LIVE' || e.live;
    if (filter === 'UPCOMING') return e.status === 'SCHEDULED' && !e.live;
    return true;
  });

  const liveCount = events.filter((e) => e.status === 'LIVE' || e.live).length;
  const upcomingCount = events.filter((e) => e.status === 'SCHEDULED' && !e.live).length;

  function statusBadge(event: PublicEvent) {
    if (event.status === 'LIVE' || event.live) {
      return (
        <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs font-bold text-red-300">LIVE</span>
      );
    }
    if (event.status === 'SUSPENDED') {
      return (
        <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-300">
          SUSPENDED
        </span>
      );
    }
    return (
      <span className="rounded bg-ink-700 px-2 py-0.5 text-xs text-slate-300">
        {event.status}
      </span>
    );
  }

  const renderEventCard = (event: PublicEvent) => {
    const isPartner = event.bettingMode === 'PARTNER';
    const isSuspended = event.status === 'SUSPENDED';
    return (
      <Card key={event.id} className="overflow-hidden">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {event.competition?.name ?? 'Competition'}
            </span>
            {statusBadge(event)}
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
  };

  return (
    <>
      <main className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:pb-10">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-24" />
            <Skeleton className="h-40" />
          </div>
        ) : error ? (
          <div className="mt-6 rounded-md bg-red-950/50 px-4 py-3 text-sm text-red-300" role="alert">
            <p>{error}</p>
            <div className="mt-3 flex gap-3">
              <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-800"
              >
                Retry
              </button>
              <AppBackButton label="Back to sports" fallback="/sports" />
            </div>
          </div>
        ) : sport ? (
          <>
            <div className="flex items-center gap-2">
              <AppBackButton label="Back" fallback="/sports" />
              <nav className="text-sm text-slate-500">
                <span className="hover:underline">Sports</span>
                {' / '}
                <span className="text-slate-300">{sport.name}</span>
              </nav>
            </div>
            <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">{sport.name}</h1>
            <p className="mt-1 text-sm text-slate-400">
              {sport.description ?? 'Explore games and events.'}
            </p>

            {/* LIVE / UPCOMING / ALL filter */}
            <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Event filters">
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
                  {f === 'ALL' ? `All (${events.length})` : f === 'LIVE' ? `Live (${liveCount})` : `Upcoming (${upcomingCount})`}
                </button>
              ))}
            </div>

            {/* Competition filter — Sports → Sport → Competition → Events */}
            {competitions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Competition filter">
                <button
                  type="button"
                  onClick={() => setCompetitionSlug(null)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    competitionSlug === null
                      ? 'bg-brand text-ink-950'
                      : 'border border-white/10 bg-ink-800 text-slate-300 hover:bg-white/5'
                  }`}
                >
                  All competitions
                </button>
                {competitions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCompetitionSlug((prev) => (prev === c.slug ? null : c.slug))}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                      competitionSlug === c.slug
                        ? 'bg-brand text-ink-950'
                        : 'border border-white/10 bg-ink-800 text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}

            {visibleEvents.length === 0 ? (
              <p className="mt-6 text-sm text-slate-500">
                No {filter === 'LIVE' ? 'live' : filter === 'UPCOMING' ? 'upcoming' : ''} events
                {competitionSlug ? ' in this competition' : ''} for this sport right now.
              </p>
            ) : (
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {visibleEvents.map(renderEventCard)}
              </div>
            )}
          </>
        ) : null}
      </main>
    </>
  );
}
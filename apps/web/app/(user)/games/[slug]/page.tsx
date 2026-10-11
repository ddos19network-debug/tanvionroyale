'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@tanvion-royale/ui';
import { getGame, listEvents } from '@/lib/api';
import { ApiClientError } from '@/lib/api/client';
import type { PublicEvent, PublicGame } from '@tanvion-royale/types';

/**
 * Game detail page — public view only. Never exposes internal provider
 * identifiers, credentials or database internals beyond the public contract.
 */
export default function GameDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = typeof params?.slug === 'string' ? params.slug : '';
  const [game, setGame] = useState<PublicGame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<PublicEvent[]>([]);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    getGame(slug)
      .then((data) => {
        if (!cancelled) setGame(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof ApiClientError && err.status === 404
              ? 'This game does not exist or is not available.'
              : 'Something went wrong while loading this game. Please try again.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Load bettable events so gambling-enabled games can link through to them.
  useEffect(() => {
    let cancelled = false;
    listEvents()
      .then((data) => {
        if (!cancelled && game) setEvents(data.filter((e) => e.gameId === game.id));
      })
      .catch(() => {
        // events are optional on the public game page
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reload when the resolved game id changes
  }, [game?.id]);

  const gamblingAvailable = game?.availability?.gamblingAvailable ?? false;

  return (
    <>
      <main className="mx-auto max-w-4xl px-4 py-8">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-72" />
            <Skeleton className="h-40" />
          </div>
        ) : error ? (
          <p className="rounded-md bg-red-950/50 px-4 py-3 text-sm text-red-300" role="alert">
            {error}{' '}
            <Link href="/sports" className="underline">
              Back to sports
            </Link>
          </p>
        ) : game ? (
          <>
            <nav className="text-sm text-slate-500">
              <Link href="/sports" className="hover:underline">
                Sports
              </Link>{' '}
              /{' '}
              <Link href={`/sports/${slug.split('-')[0]}`} className="hover:underline">
                Sport
              </Link>{' '}
              / <span className="text-slate-300">{game.name}</span>
            </nav>
            <h1 className="mt-2 text-2xl font-bold">{game.name}</h1>

            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Game details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  <span className="text-slate-500">Description:</span>{' '}
                  {game.description ?? 'No description available.'}
                </p>
                <p>
                  <span className="text-slate-500">Status:</span>{' '}
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      game.status === 'ACTIVE'
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-ink-700 text-slate-300'
                    }`}
                  >
                    {game.status}
                  </span>
                </p>
                <p>
                  <span className="text-slate-500">Availability:</span>{' '}
                  {gamblingAvailable
                    ? 'Gambling-enabled'
                    : game.availability?.gamblingEnabled
                      ? 'Gambling configured but not currently available'
                      : 'Non-gambling'}
                </p>
                {gamblingAvailable && game.providerName && (
                  <p>
                    <span className="text-slate-500">Provider:</span> {game.providerName}
                  </p>
                )}
              </CardContent>
            </Card>

            {gamblingAvailable && (
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>Events</CardTitle>
                </CardHeader>
                <CardContent>
                  {events.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      No events are available for this game right now.
                    </p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {events.map((event) => (
                        <Link key={event.id} href={`/events/${event.id}`} className="group">
                          <div className="rounded-md border border-white/10 p-3 transition">
                            <p className="text-sm font-medium">{event.name}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {new Date(event.startTime).toLocaleString([], {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              })}
                              <span className="ml-2 rounded bg-ink-700 px-2 py-0.5 text-slate-300">
                                {event.status}
                              </span>
                            </p>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        ) : null}
      </main>
    </>
  );
}

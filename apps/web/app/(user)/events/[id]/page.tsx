'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@tanvion-royale/ui';
import { useBetSlip } from '@/components/betting';
import type { BetSlipSelection } from '@/components/betting';
import { getEvent, getPartnerRedirect } from '@/lib/api';
import { ApiClientError } from '@/lib/api/client';
import { BET_SLIP_ENABLED } from '@/config/features';
import type { PublicEventDetail, PublicSelection } from '@tanvion-royale/types';

/**
 * Event detail page.
 *
 * The Bet Slip checkout is TEMPORARILY DISABLED site-wide (see
 * config/features.ts). While BET_SLIP_ENABLED is false the page still renders
 * the AUTHORITATIVE event/market/selection data it receives from the backend
 * (so nothing is faked), but the "Add to Bet Slip" action is not offered and
 * the real odds are presented as information only. Flipping the flag back to
 * true restores the previous behaviour with no other change.
 */
export default function EventDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : '';
  const { addSelection } = useBetSlip();

  const [event, setEvent] = useState<PublicEventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getEvent(id)
      .then((data) => {
        if (!cancelled) setEvent(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof ApiClientError && err.status === 404
              ? 'This event does not exist or is not available.'
              : 'Something went wrong while loading this event. Please try again.',
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

  async function handlePartnerRedirect() {
    if (!event?.partner) return;
    setRedirecting(true);
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
      setRedirecting(false);
    }
  }

  function handleAdd(selection: PublicSelection, eventId: string, eventName: string, marketId: string, marketName: string) {
    if (!selection.odds) return;
    const slipSelection: BetSlipSelection = {
      selectionId: selection.id,
      eventId,
      eventName,
      marketId,
      marketName,
      selectionName: selection.name,
      price: selection.odds.price,
      oddsVersion: selection.odds.oddsVersion,
    };
    addSelection(slipSelection);
  }

  const isPartner = event?.bettingMode === 'PARTNER';

  return (
    <>
      <main
        className={`mx-auto max-w-4xl px-4 py-8 ${
          BET_SLIP_ENABLED ? 'pb-40' : 'pb-24 sm:pb-10'
        }`}
      >
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-80" />
            <Skeleton className="h-40" />
          </div>
        ) : error ? (
          <p className="rounded-md bg-red-950/50 px-4 py-3 text-sm text-red-300" role="alert">
            {error}{' '}
            <Link href="/events" className="underline">
              Back to events
            </Link>
          </p>
        ) : event ? (
          <>
            <nav className="text-sm text-slate-500">
              <Link href="/events" className="hover:underline">
                Events
              </Link>{' '}
              / <span className="text-slate-300">{event.name}</span>
            </nav>
            <h1 className="mt-2 text-2xl font-bold text-white">{event.name}</h1>
            <p className="mt-1 text-sm text-slate-400">
              {event.competition?.name ? `${event.competition.name} · ` : ''}
              {new Date(event.startTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
              {event.status}
              {event.live ? ' · LIVE' : ''}
            </p>

            {isPartner ? (
              <Card className="mt-6">
                <CardContent className="p-6">
                  <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-white">
                        {event.homeName ?? ''} vs {event.awayName ?? ''}
                      </h2>
                      <p className="mt-1 text-sm text-slate-400">
                        This match is hosted by our betting partner
                        {event.partner ? ` (${event.partner.name})` : ''}. Continue to the partner
                        to place your bet.
                      </p>
                    </div>
                    <Button
                      variant="primary"
                      loading={redirecting}
                      onClick={handlePartnerRedirect}
                      className="shrink-0"
                    >
                      Open in Partner
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Bet Slip disabled → real odds only, clearly labelled as
                    information. No fake wagering controls are shown. */}
                {!BET_SLIP_ENABLED ? (
                  <p className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                    Betting is temporarily paused. Market and odds data shown below is provided
                    by the platform for information only.
                  </p>
                ) : null}

                {event.markets.length === 0 ? (
                  <p className="mt-6 text-sm text-slate-500">
                    No markets are available for this event yet.
                  </p>
                ) : (
                  event.markets.map((market) => (
                    <Card key={market.id} className="mt-6">
                      <CardHeader>
                        <CardTitle>{market.name}</CardTitle>
                        {market.status !== 'OPEN' && (
                          <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
                            {market.status}
                          </span>
                        )}
                      </CardHeader>
                      <CardContent>
                        {market.selections.length === 0 ? (
                          <p className="text-sm text-slate-500">No selections available.</p>
                        ) : (
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {market.selections.map((selection) => {
                              const available =
                                market.status === 'OPEN' &&
                                selection.status === 'ACTIVE' &&
                                selection.odds !== null;
                              return (
                                <div
                                  key={selection.id}
                                  className="flex items-center justify-between rounded-md border border-white/10 px-3 py-2"
                                >
                                  <div>
                                    <p className="text-sm font-medium">{selection.name}</p>
                                    <p className="text-xs text-slate-500">
                                      {selection.odds ? selection.odds.price : '—'}
                                    </p>
                                  </div>
                                  {BET_SLIP_ENABLED ? (
                                    <Button
                                      variant={available ? 'primary' : 'outline'}
                                      size="sm"
                                      disabled={!available}
                                      onClick={() =>
                                        handleAdd(
                                          selection,
                                          event.id,
                                          event.name,
                                          market.id,
                                          market.name,
                                        )
                                      }
                                    >
                                      {available ? 'Add to Bet Slip' : 'Unavailable'}
                                    </Button>
                                  ) : (
                                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                      {available ? 'Betting paused' : 'Unavailable'}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))
                )}
              </>
            )}
          </>
        ) : null}
      </main>
    </>
  );
}
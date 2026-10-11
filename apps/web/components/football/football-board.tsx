'use client';

/**
 * Native Football board — TANVION's own provider-independent Football interface.
 *
 * Data comes ONLY from the existing backend (GET /events?sport=football,
 * GET /sports/football/competitions, GET /events/:id). Nothing is fabricated:
 * loading / empty / error states render instead of invented fixtures or odds.
 *
 * Wagering stays provider-gated: selection staging uses the EXISTING
 * BetSlip context (temporary client state, never authoritative). Submission
 * stays DISABLED while BET_SLIP_ENABLED is false (no licensed-operator
 * adapter configured — see docs/NATIVE_FOOTBALL_PROVIDER_CONTRACT.md).
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@tanvion-royale/ui';
import { useBetSlip, type BetSlipSelection } from '@/components/betting/bet-slip-context';
import { BET_SLIP_ENABLED } from '@/config/features';
import { getEvent, getPartnerRedirect, listEvents } from '@/lib/api/betting';
import { ApiClientError, apiFetch } from '@/lib/api/client';
import { getSportCompetitions } from '@/lib/api/sports';
import { getWalletBalance } from '@/lib/api/wallet';
import { calculatePotentialReturn, formatMoney, majorToMinor, minorToMajor } from '@/lib/betting';
import { useAuth } from '@/src/lib/auth';
import type { PublicCompetition, PublicEvent, PublicEventDetail } from '@tanvion-royale/types';
import { FixtureCard } from './fixture-card';

type BoardFilter = 'ALL' | 'LIVE' | 'UPCOMING';

interface ProviderStatus {
  available: boolean;
  provider: string | null;
  message: string | null;
}

async function getProviderStatus(): Promise<ProviderStatus> {
  return apiFetch<ProviderStatus>('/partner/status');
}

function statusBadge(event: PublicEvent) {
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
}

export function FootballBoard() {
  const { ready, isAuthenticated, user } = useAuth();
  const slip = useBetSlip();
  const [events, setEvents] = useState<PublicEvent[] | null>(null);
  const [competitions, setCompetitions] = useState<PublicCompetition[]>([]);
  const [filter, setFilter] = useState<BoardFilter>('ALL');
  const [competitionSlug, setCompetitionSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PublicEventDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [redirectingId, setRedirectingId] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState(false);
  const [pendingOdds, setPendingOdds] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([listEvents('ALL', 'football'), getSportCompetitions('football')])
      .then(([eventData, competitionData]) => {
        if (!cancelled) {
          setEvents(eventData);
          setCompetitions(competitionData);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiClientError ? err.message : 'Fixture load failed.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    let cancelled = false;
    getProviderStatus()
      .then((data) => {
        if (!cancelled) setProvider(data);
      })
      .catch(() => {
        if (!cancelled) setProvider({ available: false, provider: null, message: 'Provider temporarily unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    if (!ready || !isAuthenticated) {
      setBalance(null);
      setBalanceError(false);
      return;
    }
    let cancelled = false;
    getWalletBalance()
      .then((data) => {
        if (!cancelled) setBalance(data.availableBalance);
      })
      .catch(() => {
        if (!cancelled) setBalanceError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, isAuthenticated]);

  const visibleEvents = useMemo(() => {
    const list = events ?? [];
    return list.filter((e) => {
      if (competitionSlug && e.competition?.slug !== competitionSlug) return false;
      if (filter === 'LIVE') return e.status === 'LIVE' || e.live;
      if (filter === 'UPCOMING') return e.status === 'SCHEDULED';
      return true;
    });
  }, [events, filter, competitionSlug]);

  const liveCount = useMemo(() => (events ?? []).filter((e) => e.status === 'LIVE' || e.live).length, [events]);
  const upcomingCount = useMemo(() => (events ?? []).filter((e) => e.status === 'SCHEDULED').length, [events]);

  async function toggleExpand(event: PublicEvent) {
    if (expandedId === event.id) {
      setExpandedId(null);
      setDetail(null);
      setDetailError(null);
      return;
    }
    setExpandedId(event.id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const data = await getEvent(event.id);
      setDetail(data);
    } catch (err) {
      setDetailError(err instanceof ApiClientError ? err.message : 'Could not load match markets.');
    } finally {
      setDetailLoading(false);
    }
  }

  async function handlePartnerRedirect(event: PublicEvent) {
    if (!event.partner) return;
    setRedirectingId(event.id);
    try {
      const res = await getPartnerRedirect(event.id);
      window.location.href = res.url;
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to open this match.');
      setRedirectingId(null);
    }
  }

  function toggleSelection(input: BetSlipSelection) {
    if (slip.selection?.selectionId === input.selectionId) {
      slip.removeSelection();
      return;
    }
    slip.addSelection(input);
    setPendingOdds(null);
  }

  const verificationNotice = useMemo(() => {
    if (!ready || !isAuthenticated || !user) return null;
    if (user.status !== 'ACTIVE') return 'Your account is not active, so betting is unavailable.';
    if (!user.emailVerified && !user.phoneVerified) return 'Verify your email or phone before placing bets.';
    return null;
  }, [ready, isAuthenticated, user]);

  async function confirmOdds() {
    if (!slip.selection || slip.status === 'placing') return;
    slip.setStatus('placing');
    slip.setMessage(null);
    try {
      const fresh = await getEvent(slip.selection.eventId);
      const fm = fresh.markets.find((m) => m.id === slip.selection?.marketId) ?? null;
      const fs = fm?.selections.find((s) => s.id === slip.selection?.selectionId) ?? null;
      const current = fm?.status === 'OPEN' && fs?.status === 'ACTIVE' ? fs.odds : null;
      if (!current) {
        slip.setStatus('suspended');
        slip.setMessage('This market is no longer available.');
        return;
      }
      if (current.price !== slip.selection.price) {
        slip.updatePrice(current.price, current.oddsVersion);
        setPendingOdds(current.price);
        slip.setStatus('odds_changed');
        slip.setMessage(`Odds changed to ${current.price}. Review the updated odds first.`);
        return;
      }
      setPendingOdds(null);
      slip.setStatus('idle');
      slip.setMessage('Odds confirmed. Wagering is paused until a licensed provider is configured.');
    } catch (err) {
      slip.setStatus('error');
      slip.setMessage(err instanceof ApiClientError ? err.message : 'Could not revalidate odds.');
    }
  }

  const stakingBlockedReason = !isAuthenticated ? 'Sign in to stage selections.' : verificationNotice;

  return (
    <div>
      <div className="mt-4 space-y-2" aria-live="polite">
        {provider && !provider.available && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
            {provider.message ?? 'Betting provider is not configured yet.'} Fixtures and odds below are
            read-only until a licensed provider is connected.
          </p>
        )}
        {!isAuthenticated && ready && (
          <p className="rounded-lg border border-white/10 bg-ink-800 px-4 py-2.5 text-sm text-slate-300">
            <Link href="/login" className="font-semibold text-brand hover:underline">Sign in</Link>
            {' '}to stage selections and view your wallet balance.
          </p>
        )}
        {verificationNotice && (
          <p className="rounded-lg border border-white/10 bg-ink-800 px-4 py-2.5 text-sm text-slate-300">
            {verificationNotice}{' '}
            <Link href="/verification" className="font-semibold text-brand hover:underline">Verify now</Link>
          </p>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Football filters">
        {(['ALL', 'LIVE', 'UPCOMING'] as BoardFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              filter === f ? 'bg-brand text-ink-950' : 'border border-white/10 bg-ink-800 text-slate-300'
            }`}
          >
            {f === 'ALL' ? `All (${events?.length ?? 0})` : f === 'LIVE' ? `Live (${liveCount})` : `Pre-match (${upcomingCount})`}
          </button>
        ))}
      </div>
      {competitions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Competition filter">
          <button
            type="button"
            onClick={() => setCompetitionSlug(null)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${competitionSlug === null ? 'bg-brand text-ink-950' : 'border border-white/10 bg-ink-800 text-slate-300'}`}
          >
            All competitions
          </button>
          {competitions.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCompetitionSlug((prev) => (prev === c.slug ? null : c.slug))}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${competitionSlug === c.slug ? 'bg-brand text-ink-950' : 'border border-white/10 bg-ink-800 text-slate-300'}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : error ? (
        <p className="mt-6 rounded-md bg-red-950/50 px-4 py-3 text-sm text-red-300" role="alert">
          {error}{' '}
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="underline">
            Retry
          </button>
        </p>
      ) : visibleEvents.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">
          No {filter === 'LIVE' ? 'live' : filter === 'UPCOMING' ? 'pre-match' : ''} Football fixtures
          {competitionSlug ? ' in this competition' : ''} right now.
        </p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleEvents.map((event) => (
            <FixtureCard
              key={event.id}
              event={event}
              expanded={expandedId === event.id}
              detail={detail && detail.id === event.id ? detail : null}
              detailLoading={expandedId === event.id && detailLoading}
              detailError={expandedId === event.id ? detailError : null}
              stagedSelectionId={slip.selection?.selectionId ?? null}
              canStage={isAuthenticated && !verificationNotice}
              redirecting={redirectingId === event.id}
              onToggle={() => toggleExpand(event)}
              onRedirect={() => handlePartnerRedirect(event)}
              onToggleSelection={toggleSelection}
            />
          ))}
        </div>
      )}

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Football bet slip</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {stakingBlockedReason ? (
            <p className="rounded-md border border-white/10 bg-ink-800 px-3 py-2 text-sm text-slate-300">
              {stakingBlockedReason}
            </p>
          ) : null}
          <p className="text-sm text-slate-400">
            Wallet balance:{' '}
            <span className="font-semibold text-white">
              {!isAuthenticated
                ? '— (sign in to view)'
                : balanceError
                  ? 'Unavailable'
                  : balance === null
                    ? 'Loading…'
                    : formatMoney(balance)}
            </span>
          </p>
          {!slip.selection ? (
            <p className="text-sm text-slate-500">
              No selection staged. Pick a price above to stage it here — nothing is submitted from this panel.
            </p>
          ) : (
            <>
              <div className="rounded-md border border-white/10 p-3 text-sm">
                <p className="font-medium text-white">{slip.selection.selectionName}</p>
                <p className="text-slate-500">
                  {slip.selection.eventName} · {slip.selection.marketName}
                </p>
                <p className="mt-1">
                  <span className="text-slate-500">Odds:</span>{' '}
                  <span className="font-semibold text-white">{slip.selection.price}</span>
                  {pendingOdds && (
                    <span className="ml-2 rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
                      updated to {pendingOdds} — confirm before submitting
                    </span>
                  )}
                </p>
              </div>
              <label className="block text-sm">
                <span className="text-slate-300">Stake (BDT)</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="decimal"
                  value={minorToMajor(slip.stakeMinor)}
                  onChange={(e) => slip.setStakeMinor(majorToMinor(e.target.value))}
                  className="mt-1 w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-100"
                  aria-label="Stake in BDT"
                />
              </label>
              <p className="text-sm">
                <span className="text-slate-500">Potential return:</span>{' '}
                <span className="font-semibold text-white">
                  {formatMoney(calculatePotentialReturn(slip.stakeMinor, slip.selection.price))}
                </span>
              </p>
              {slip.message && (
                <p className="rounded-md border border-white/10 bg-ink-800 px-3 py-2 text-sm text-slate-200" role="status">
                  {slip.message}
                </p>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="outline" size="sm" onClick={slip.clearSlip} className="whitespace-nowrap">
                  Clear
                </Button>
                <Button variant="outline" size="sm" onClick={slip.removeSelection} className="whitespace-nowrap">
                  Remove selection
                </Button>
                <Button
                  size="sm"
                  className="flex-1"
                  loading={slip.status === 'placing'}
                  disabled={Boolean(stakingBlockedReason) || slip.status === 'placing'}
                  onClick={confirmOdds}
                >
                  Confirm odds
                </Button>
              </div>
              {!BET_SLIP_ENABLED && (
                <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  Real-money submission is disabled: no licensed provider adapter is configured. This
                  panel only stages and revalidates odds — it never places a bet.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}



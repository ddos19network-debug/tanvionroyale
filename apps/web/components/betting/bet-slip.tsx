'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@tanvion-royale/ui';
import { ApiClientError, placeBet } from '@/lib/api';
import { formatMoney, majorToMinor, minorToMajor } from '@/lib/betting';
import { useBetSlip } from './bet-slip-context';

/**
 * Responsive bet slip panel. Rendered globally (see app/layout.tsx) ONLY when
 * BET_SLIP_ENABLED is true (config/features.ts) — it is currently switched OFF
 * site-wide, so this component is preserved but not mounted anywhere.
 *
 * It uses client-only temporary state; the backend revalidates everything on
 * submit.
 *
 * Desktop: fixed right-bottom panel (does not block match content).
 * Mobile: collapsible bottom sheet with a compact collapsed state.
 */
export function BetSlip() {
  const {
    selection,
    stakeMinor,
    setStakeMinor,
    potentialPayout,
    removeSelection,
    clearSlip,
    updatePrice,
    status,
    setStatus,
    setMessage,
    message,
    placedBetId,
    setPlacedBetId,
  } = useBetSlip();

  const [collapsed, setCollapsed] = useState(false);
  const busy = status === 'placing';

  async function onSubmit() {
    if (!selection || busy) return;
    const idempotencyKey =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `bet-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    setStatus('placing');
    setMessage(null);
    try {
      const res = await placeBet({
        eventId: selection.eventId,
        marketId: selection.marketId,
        selectionId: selection.selectionId,
        stake: stakeMinor,
        requestedOdds: selection.price,
        idempotencyKey,
      });
      clearSlip();
      setPlacedBetId(res.bet.id);
      setStatus('accepted');
      setMessage('Bet accepted.');
    } catch (err) {
      if (err instanceof ApiClientError) {
        switch (err.code) {
          case 'ODDS_CHANGED': {
            const details = err.details as { currentOdds?: string } | undefined;
            if (details?.currentOdds) updatePrice(details.currentOdds);
            setStatus('odds_changed');
            setMessage('Odds have changed. Review the updated odds and place your bet again.');
            break;
          }
          case 'MARKET_SUSPENDED':
          case 'SELECTION_UNAVAILABLE':
          case 'EVENT_UNAVAILABLE':
          case 'GAMBLING_DISABLED':
            setStatus('suspended');
            setMessage(err.message);
            break;
          case 'INSUFFICIENT_BALANCE':
            setStatus('insufficient');
            setMessage(err.message);
            break;
          case 'PROVIDER_UNAVAILABLE':
            setStatus('unavailable');
            setMessage(err.message);
            break;
          case 'BET_REJECTED':
            setStatus('rejected');
            setMessage(err.message);
            break;
          default:
            setStatus('error');
            setMessage(err.message);
        }
      } else {
        setStatus('error');
        setMessage('Something went wrong placing your bet. Please try again.');
      }
    }
  }

  const banner = (() => {
    if (status === 'accepted' && placedBetId) {
      return (
        <div className="rounded-md bg-emerald-950/50 px-3 py-2 text-sm text-emerald-300" role="status">
          {message}{' '}
          <Link href={`/my-bets/${placedBetId}`} className="underline">
            View your bet
          </Link>
        </div>
      );
    }
    if (status === 'odds_changed') {
      return (
        <div className="rounded-md bg-amber-950/50 px-3 py-2 text-sm text-amber-300" role="alert">
          {message} {selection && <span className="font-semibold">Updated odds: {selection.price}</span>}
        </div>
      );
    }
    if (
      status === 'suspended' ||
      status === 'insufficient' ||
      status === 'rejected' ||
      status === 'unavailable' ||
      status === 'error'
    ) {
      return (
        <div className="rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-300" role="alert">
          {message}
        </div>
      );
    }
    return null;
  })();

  // Compact collapsed state — a small pill that does not block content.
  if (collapsed) {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-3 sm:justify-end sm:pr-6">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-ink-800 px-4 py-2 text-sm font-semibold text-white shadow-lg transition hover:bg-ink-700"
          aria-label="Expand bet slip"
        >
          <span className="text-brand">🎫</span>
          Bet Slip
          {selection && (
            <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold text-ink-950">
              1
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-3 sm:justify-end sm:pr-6">
      <Card className="pointer-events-auto w-full max-w-md shadow-lg">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Bet slip</CardTitle>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-white/10 hover:text-white"
              aria-label="Collapse bet slip"
            >
              —
            </button>
            {selection && (
              <Button variant="ghost" size="sm" onClick={removeSelection}>
                Remove
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {banner}

          {!selection ? (
            <p className="text-sm text-slate-500">Add a selection from an event to build your bet.</p>
          ) : (
            <>
              <div className="rounded-md border border-white/10 p-3 text-sm">
                <p className="font-medium">{selection.selectionName}</p>
                <p className="text-slate-500">
                  {selection.eventName} · {selection.marketName}
                </p>
                <p className="mt-1">
                  <span className="text-slate-500">Odds:</span>{' '}
                  <span className="font-semibold">{selection.price}</span>
                </p>
              </div>

              <label className="block text-sm">
                <span className="text-slate-300">Stake (BDT)</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="decimal"
                  value={minorToMajor(stakeMinor)}
                  onChange={(e) => setStakeMinor(majorToMinor(e.target.value))}
                  className="mt-1 w-full rounded-md border border-ink-600 px-3 py-2 text-sm"
                  aria-label="Stake in BDT"
                />
              </label>

              <p className="text-sm">
                <span className="text-slate-500">Potential payout:</span>{' '}
                <span className="font-semibold">{formatMoney(potentialPayout)}</span>
              </p>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearSlip}
                  disabled={busy}
                  className="whitespace-nowrap"
                >
                  Clear
                </Button>
                <Button loading={busy} onClick={onSubmit} className="flex-1">
                  Place Bet
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
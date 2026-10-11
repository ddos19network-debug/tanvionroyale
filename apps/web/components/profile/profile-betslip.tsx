'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@tanvion-royale/ui';
import { useBetSlip } from '@/components/betting';
import { listMyBets } from '@/lib/api/betting';
import { ApiClientError } from '@/lib/api/client';
import { formatMoney } from '@/lib/betting';
import type { BetView } from '@tanvion-royale/types';
import { StatusBadge, fmtDate, shortId, copyText } from './profile-helpers';
import { EmptyState, ErrorBox, LoadingRows } from './profile-ui';

/**
 * Profile "Bet Slip" tab.
 *
 * Two parts, both driven by real state (no invented data):
 *  1. "Current selection" — mirrors the live client-side bet slip
 *     (useBetSlip, same context the floating BetSlip widget reads). If the
 *     customer has an unplaced selection queued up anywhere on the site, it
 *     shows here too, with a link back to the match to finish placing it.
 *  2. "Recent bet slips" — the customer's most recently PLACED bets, read
 *     from the real backend (GET /bets via listMyBets), same data source as
 *     the Betting tab. Every bet placed anywhere on the platform is written
 *     by the backend the moment it's accepted, so this list is always
 *     automatically up to date the next time the tab is opened — no extra
 *     wiring needed when a new bet is placed.
 */

const RECENT_LIMIT = 10;

export function BetSlipTab() {
  const { selection, stakeMinor, potentialPayout, clearSlip } = useBetSlip();

  const [items, setItems] = useState<BetView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listMyBets({ status: 'ALL', result: 'ALL', limit: RECENT_LIMIT, page: 1 });
      setItems(res);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to load your bet slip history.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <section aria-label="Current selection">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Current selection
        </h2>
        {!selection ? (
          <EmptyState
            title="Your bet slip is empty."
            hint="Pick an odds selection on any sports match and it will appear here and in the bet slip panel."
            actionHref="/sports"
            actionLabel="Explore Sports"
          />
        ) : (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{selection.selectionName}</CardTitle>
              <Button variant="ghost" size="sm" onClick={clearSlip}>
                Clear
              </Button>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-slate-500">
                {selection.eventName} · {selection.marketName}
              </p>
              <p>
                <span className="text-slate-500">Odds:</span>{' '}
                <span className="font-semibold">{selection.price}</span>
              </p>
              <p>
                <span className="text-slate-500">Stake:</span>{' '}
                <span className="font-semibold">{formatMoney(stakeMinor)}</span>
              </p>
              <p>
                <span className="text-slate-500">Potential payout:</span>{' '}
                <span className="font-semibold">{formatMoney(potentialPayout)}</span>
              </p>
              <p className="text-xs text-slate-500">
                Not placed yet — review the stake and confirm from the bet slip panel, or open{' '}
                <Link href={`/events/${selection.eventId}`} className="underline">
                  the match
                </Link>{' '}
                to change your pick.
              </p>
            </CardContent>
          </Card>
        )}
      </section>

      <section aria-label="Recent bet slips">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Recent bet slips
        </h2>
        {loading ? (
          <LoadingRows />
        ) : error ? (
          <ErrorBox message={error} onRetry={() => void load()} />
        ) : items.length === 0 ? (
          <EmptyState
            title="No bet slips yet."
            hint="Every bet you place is saved here automatically."
            actionHref="/sports"
            actionLabel="Explore Sports"
          />
        ) : (
          <div className="space-y-2">
            {items.map((bet) => (
              <Link key={bet.id} href={`/my-bets/${bet.id}`} className="block">
                <Card className="transition hover:shadow-md">
                  <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {bet.selections.length > 1
                          ? `${bet.selections.length}-fold · ${bet.selections[0]?.selectionName}`
                          : (bet.selections[0]?.selectionName ?? 'Bet')}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {bet.selections[0]?.eventName} · {bet.selections[0]?.marketName} ·{' '}
                        {fmtDate(bet.createdAt)}
                      </p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                        <span className="break-anywhere">Bet {shortId(bet.id)}</span>
                        <button
                          type="button"
                          aria-label={`Copy bet id ${bet.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            copyText(bet.id);
                          }}
                          className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] hover:bg-white/10"
                        >
                          Copy
                        </button>
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-sm sm:flex-col sm:items-end sm:gap-1">
                      <StatusBadge value={bet.status === 'SETTLED' && bet.result ? bet.result : bet.status} />
                      <span className="font-semibold">
                        {bet.status === 'SETTLED' && bet.payout !== null
                          ? `${bet.result === 'LOSS' ? 'Lost' : 'Paid'} ${formatMoney(bet.payout, bet.currency)}`
                          : `${formatMoney(bet.stake, bet.currency)} → ${formatMoney(bet.potentialPayout, bet.currency)}`}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
            <p className="text-center text-xs text-slate-500">
              Showing your {items.length} most recent bet slips ·{' '}
              <Link href="/my-bets" className="underline">
                View full history
              </Link>
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { Button, Skeleton } from '@tanvion-royale/ui';
import type { BetSlipSelection } from '@/components/betting/bet-slip-context';
import type { PublicEvent, PublicEventDetail } from '@tanvion-royale/types';

interface FixtureMarketsProps {
  event: PublicEvent;
  detail: PublicEventDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  stagedSelectionId: string | null;
  canStage: boolean;
  onToggleSelection: (input: BetSlipSelection) => void;
}


export function FixtureMarkets(props: FixtureMarketsProps) {
  const { event } = props;
  if (props.detailLoading) {
    return (
      <div className="space-y-2 pt-2">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  }
  if (props.detailError) {
    return (
      <p className="mt-2 rounded-md bg-red-950/50 px-3 py-2 text-xs text-red-300" role="alert">
        {props.detailError}
      </p>
    );
  }
  if (!props.detail) return null;
  if (props.detail.markets.length === 0) {
    return <p className="pt-2 text-xs text-slate-500">No markets are available for this match yet.</p>;
  }
  return (
    <div className="space-y-3 pt-2">
      {props.detail.markets.map((market) => (
        <div key={market.id}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">{market.name}</p>
            {market.status !== 'OPEN' && (
              <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">
                {market.status} — suspended
              </span>
            )}
          </div>
          <div className="mt-1.5 grid gap-1.5">
            {market.selections.map((selection) => {
              const available =
                market.status === 'OPEN' && selection.status === 'ACTIVE' && selection.odds !== null;
              const staged = props.stagedSelectionId === selection.id;
              return (
                <div
                  key={selection.id}
                  className={`flex items-center justify-between rounded-md border px-3 py-2 ${
                    staged ? 'border-brand/60 bg-brand/10' : 'border-white/10'
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium text-white">{selection.name}</p>
                    <p className="text-xs text-slate-500">{selection.odds ? selection.odds.price : '—'}</p>
                  </div>
                  <Button
                    variant={staged ? 'outline' : available ? 'primary' : 'outline'}
                    size="sm"
                    disabled={!available || !props.canStage}
                    onClick={() => {
                      if (!selection.odds) return;
                      props.onToggleSelection({
                        selectionId: selection.id,
                        eventId: event.id,
                        eventName:
                          event.homeName && event.awayName
                            ? `${event.homeName} vs ${event.awayName}`
                            : event.name,
                        marketId: market.id,
                        marketName: market.name,
                        selectionName: selection.name,
                        price: selection.odds.price,
                        oddsVersion: selection.odds.oddsVersion,
                      });
                    }}
                    aria-pressed={staged}
                  >
                    {!available ? 'Suspended' : staged ? 'Remove' : 'Select'}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <Link href={`/events/${event.id}`} className="inline-block text-xs font-semibold text-brand hover:underline">
        Full match detail →
      </Link>
    </div>
  );
}

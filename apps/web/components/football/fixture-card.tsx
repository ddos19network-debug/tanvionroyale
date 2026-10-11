'use client';

import Link from 'next/link';
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@tanvion-royale/ui';
import type { BetSlipSelection } from '@/components/betting/bet-slip-context';
import type { PublicEvent, PublicEventDetail } from '@tanvion-royale/types';
import { FixtureMarkets } from './fixture-markets';

interface FixtureCardProps {
  event: PublicEvent;
  expanded: boolean;
  detail: PublicEventDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  stagedSelectionId: string | null;
  canStage: boolean;
  redirecting: boolean;
  onToggle: () => void;
  onRedirect: () => void;
  onToggleSelection: (input: BetSlipSelection) => void;
}

export function FixtureCard(props: FixtureCardProps) {
  const { event } = props;
  const isPartner = event.bettingMode === 'PARTNER';
  const isSuspended = event.status === 'SUSPENDED';
  const live = event.status === 'LIVE' || event.live;

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base text-white">{event.competition?.name ?? event.name}</CardTitle>
          {live ? (
            <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs font-bold text-red-300">LIVE</span>
          ) : (
            <span className="rounded bg-ink-700 px-2 py-0.5 text-xs text-slate-300">{event.status}</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-slate-400">
        <p className="font-semibold text-white">
          {event.homeName ?? event.name}
          {event.awayName ? ` vs ${event.awayName}` : ''}
        </p>
        <p>{new Date(event.startTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p>
        {isPartner && event.partner && (
          <span className="inline-block rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
            Partner: {event.partner.name}
          </span>
        )}
        <div className="flex gap-2 pt-1">
          {isSuspended ? (
            <Button variant="outline" size="sm" className="w-full" disabled>
              Suspended
            </Button>
          ) : isPartner ? (
            <Button variant="outline" size="sm" className="w-full" loading={props.redirecting} onClick={props.onRedirect}>
              Open Match
            </Button>
          ) : (
            <Button
              variant={props.expanded ? 'outline' : 'primary'}
              size="sm"
              className="w-full"
              onClick={props.onToggle}
              aria-expanded={props.expanded}
            >
              {props.expanded ? 'Hide Markets' : 'View Markets'}
            </Button>
          )}
        </div>
        {props.expanded && !isPartner && !isSuspended && (
          <FixtureMarkets
            event={event}
            detail={props.detail}
            detailLoading={props.detailLoading}
            detailError={props.detailError}
            stagedSelectionId={props.stagedSelectionId}
            canStage={props.canStage}
            onToggleSelection={props.onToggleSelection}
          />
        )}
      </CardContent>
    </Card>
  );
}


/**
 * Frontend betting API (Phase 5).
 * All calls go through the TANVIONROYALE backend — never to a provider directly.
 * Money is in integer MINOR UNITS; odds are decimal strings.
 */
import { apiFetch, authFetch } from './client';
import type {
  BetView,
  PlaceBetResponse,
  PublicEvent,
  PublicEventDetail,
  PublicMarket,
  PublicSelection,
} from '@tanvion-royale/types';

export type EventStatusFilter = 'LIVE' | 'UPCOMING' | 'ALL';

export async function listEvents(
  status: EventStatusFilter = 'ALL',
  sport?: string,
  competition?: string,
): Promise<PublicEvent[]> {
  const params = new URLSearchParams();
  if (status !== 'ALL') params.set('status', status);
  if (sport) params.set('sport', sport);
  if (competition) params.set('competition', competition);
  const qs = params.toString();
  return apiFetch<PublicEvent[]>(`/events${qs ? `?${qs}` : ''}`);
}

/** Resolve the approved partner destination for a PARTNER event (server-side). */
export async function getPartnerRedirect(
  eventId: string,
): Promise<{ url: string; provider: string; externalEventId: string }> {
  return authFetch<{ url: string; provider: string; externalEventId: string }>(
    `/events/${encodeURIComponent(eventId)}/redirect`,
  );
}

export async function getEvent(id: string): Promise<PublicEventDetail> {
  return apiFetch<PublicEventDetail>(`/events/${encodeURIComponent(id)}`);
}

export async function listEventMarkets(id: string): Promise<PublicMarket[]> {
  return apiFetch<PublicMarket[]>(`/events/${encodeURIComponent(id)}/markets`);
}

export async function getEventOdds(id: string): Promise<PublicEventDetail['markets']> {
  return apiFetch<PublicEventDetail['markets']>(`/events/${encodeURIComponent(id)}/odds`);
}

export async function getMarketSelections(marketId: string): Promise<PublicSelection[]> {
  return apiFetch<PublicSelection[]>(`/markets/${encodeURIComponent(marketId)}/selections`);
}

export interface PlaceBetInput {
  eventId: string;
  marketId: string;
  selectionId: string;
  stake: number; // minor units
  requestedOdds: string;
  currency?: string;
  idempotencyKey: string;
}

export async function placeBet(input: PlaceBetInput): Promise<PlaceBetResponse> {
  return authFetch<PlaceBetResponse>('/bets', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export type MyBetsStatus = 'ALL' | 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'SETTLED' | 'VOID';

export interface MyBetsFilters {
  status?: MyBetsStatus;
  result?: 'ALL' | 'WIN' | 'LOSS' | 'VOID' | 'PUSH';
  limit?: number;
  page?: number;
  search?: string;
}

export async function listMyBets(arg: MyBetsStatus | MyBetsFilters = 'ALL' as MyBetsStatus): Promise<BetView[]> {
  const f: MyBetsFilters = typeof arg === 'string' ? { status: arg } : arg;
  const params = new URLSearchParams();
  if (f.status && f.status !== 'ALL') params.set('status', f.status);
  if (f.result && f.result !== 'ALL') params.set('result', f.result);
  if (f.limit) params.set('limit', String(f.limit));
  if (f.page) params.set('page', String(f.page));
  if (f.search?.trim()) params.set('search', f.search.trim());
  const qs = params.toString();
  return authFetch<BetView[]>(`/bets${qs ? `?${qs}` : ''}`);
}

export async function getBet(id: string): Promise<BetView> {
  return authFetch<BetView>(`/bets/${encodeURIComponent(id)}`);
}
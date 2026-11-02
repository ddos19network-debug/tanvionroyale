/**
 * Frontend free-play games API (internally developed, no real money).
 * All calls go through the TANVIONROYALE backend — never to a provider.
 * Sessions/actions require the signed-in user; the backend enforces ownership.
 */
import { apiFetch, authFetch } from './client';

export interface PublicFreePlayGame {
  slug: string;
  title: string;
  description: string;
  kind: 'FREE_PLAY';
  tagline?: string;
}

export interface FreePlaySessionView {
  id: string;
  gameSlug: string;
  status: 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
  /** Server-authoritative engine state view (engine-specific fields). */
  state: Record<string, unknown>;
  endedAt: string | null;
  createdAt: string;
}

export interface FreePlayActionResultView {
  session: FreePlaySessionView;
  finished: boolean;
  result: { outcome: string; score: number; message: string } | null;
}

export interface FreePlayResultView {
  id: string;
  gameSlug: string;
  score: number;
  outcome: string;
  message: string | null;
  createdAt: string;
}

/**
 * The signed-in user's FREE-PLAY points balance.
 *
 * Read from the ONE existing free-play points ledger (`CrashFreePlayWallet`).
 * These points are NEVER money: they live in a separate table with their own
 * `FREEPLAY` currency code and have no deposit or withdrawal path, so they
 * must never be presented as, or commingled with, a real wallet balance.
 * The server is the only source of truth — the client never mutates this.
 */
export interface FreePlayPointsView {
  points: number;
  currency: string;
  mode: 'FREE_PLAY';
}

export async function getFreePlayPoints(): Promise<FreePlayPointsView> {
  return authFetch<FreePlayPointsView>('/games/crash/free-play/points');
}

export async function getFreePlayGame(
  slug: string,
): Promise<PublicFreePlayGame> {
  return apiFetch<PublicFreePlayGame>(`/games/play/${encodeURIComponent(slug)}`);
}

export async function startFreePlaySession(
  slug: string,
  payload?: Record<string, unknown>,
): Promise<FreePlaySessionView> {
  return authFetch<FreePlaySessionView>(`/games/play/${encodeURIComponent(slug)}/sessions`, {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
  });
}

export async function getActiveFreePlaySession(
  slug: string,
): Promise<FreePlaySessionView | null> {
  return authFetch<FreePlaySessionView | null>(
    `/games/play/${encodeURIComponent(slug)}/sessions/active`,
  );
}

export async function getFreePlaySession(
  slug: string,
  sessionId: string,
): Promise<FreePlaySessionView> {
  return authFetch<FreePlaySessionView>(
    `/games/play/${encodeURIComponent(slug)}/sessions/${encodeURIComponent(sessionId)}`,
  );
}

export async function sendFreePlayAction(
  slug: string,
  sessionId: string,
  action: { type: string; payload?: Record<string, unknown> },
): Promise<FreePlayActionResultView> {
  return authFetch<FreePlayActionResultView>(
    `/games/play/${encodeURIComponent(slug)}/sessions/${encodeURIComponent(sessionId)}/actions`,
    {
      method: 'POST',
      body: JSON.stringify(action),
    },
  );
}

export async function listFreePlayResults(slug: string): Promise<FreePlayResultView[]> {
  return authFetch<FreePlayResultView[]>(
    `/games/play/${encodeURIComponent(slug)}/results`,
  );
}
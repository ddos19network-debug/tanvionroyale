/**
 * Royale Fly crash-game client (REST + WebSocket).
 *
 * The browser is ONLY a client: it renders the server snapshot, interpolates
 * between server multiplier updates, and never decides multiplier, crash
 * point, cash-out value, or balances. On reconnect it re-fetches the
 * authoritative snapshot instead of inventing missed events.
 */

import { io, type Socket } from 'socket.io-client';
import { authFetch, getApiBaseUrl } from './client';
import { getAccessToken } from '@/lib/auth/session';

/** Server origin (strip the /api/v1 base path for the WS namespace). */
function getWsOrigin(): string {
  const base = getApiBaseUrl().replace(/\/api\/v1\/?$/, '');
  return base || (typeof window !== 'undefined' ? window.location.origin : '');
}

// ---------------------------------------------------------------------------
// View types (mirror the API views — no secrets, no other users' private data)
// ---------------------------------------------------------------------------

export type CrashRoundStatus =
  | 'CREATED'
  | 'BETTING_OPEN'
  | 'RUNNING'
  | 'CRASHED'
  | 'SETTLED'
  | 'COMPLETED';

export type CrashSequenceMode =
  | 'PROVABLY_FAIR'
  | 'ORIGINAL'
  | 'REPEAT'
  | 'REPEAT_EXTENDED'
  | 'NEW_SEQUENCE';

export interface CrashSequencePublic {
  active: boolean;
  mode: CrashSequenceMode;
  lastIndex: number | null;
  label: string | null;
}

export interface CrashRoundView {
  id: string;
  gameSlug: string;
  mode: 'FREE_PLAY' | 'REAL_MONEY';
  status: CrashRoundStatus;
  roundNumber: number;
  startAt: string;
  startedAt: string | null;
  bettingCloseAt: string;
  crashAt: string | null;
  crashMultiplier: number | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  algorithmVersion: string;
  /** PROVABLY_FAIR (seed-derived) or CONFIGURED (operator sequence). */
  crashSource: 'PROVABLY_FAIR' | 'CONFIGURED';
  /** Sequence phase + consumed position of this round (null for seed rounds). */
  sequenceMode: CrashSequenceMode | null;
  sequenceIndex: number | null;
  bettingOpen: boolean;
  serverTime: string;
  currentMultiplier: number | null;
  revealedSeed: string | null;
  crashed: boolean;
}

export interface CrashBetView {
  id: string;
  roundId: string;
  roundNumber: number;
  mode: 'FREE_PLAY' | 'REAL_MONEY';
  stake: number;
  currency: string;
  status: 'ACTIVE' | 'CASHED_OUT' | 'LOST' | 'REFUNDED';
  cashoutMultiplier: number | null;
  payout: number;
  result: 'CASHED_OUT' | 'LOST' | 'REFUNDED' | null;
  placedAt: string;
  cashoutAt: string | null;
  settledAt: string | null;
}

export interface CrashSnapshotView {
  gameSlug: string;
  mode: 'FREE_PLAY' | 'REAL_MONEY';
  enabled: boolean;
  realMoneyAvailable: boolean;
  round: CrashRoundView | null;
  myBet: CrashBetView | null;
  myBets?: CrashBetView[];
  lastCrash: {
    roundId: string;
    roundNumber: number;
    crashMultiplier: number;
    crashedAt: string;
    mode: string;
  } | null;
  /** Operator sequence phase + consumed position (never future multipliers). */
  sequence: CrashSequencePublic;
  config: {
    minStake: number;
    maxStake: number;
    currency: string;
    bettingDurationMs: number;
    nextRoundDelayMs: number;
  };
}

export interface CrashHistoryEntry {
  roundId: string;
  roundNumber: number;
  crashMultiplier: number;
  crashedAt: string;
  mode: string;
}

export interface CrashPlayerHistoryEntry {
  roundNumber: number;
  createdAt: string;
  stake: number;
  currency: string;
  status: string;
  result: string | null;
  cashoutMultiplier: number | null;
  payout: number;
}

export interface AnonymizedLiveBet {
  player: string;
  stake: number;
  cashoutMultiplier: number | null;
  payout: number;
  cashedOut: boolean;
}

export interface CrashVerificationView {
  roundId: string;
  roundNumber: number;
  serverSeedHash: string;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  algorithmVersion: string;
  crashMultiplier: number | null;
  derivedHash: string;
  derivedMultiplier: number;
  verified: boolean;
}

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

export function getCrashSnapshot(): Promise<CrashSnapshotView> {
  return authFetch<CrashSnapshotView>('/games/crash/current');
}

export function getCrashHistory(limit = 20): Promise<{ history: CrashHistoryEntry[] }> {
  return authFetch<{ history: CrashHistoryEntry[] }>(`/games/crash/history?limit=${limit}`);
}

export function getCrashMyHistory(limit = 25): Promise<{ history: CrashPlayerHistoryEntry[] }> {
  return authFetch<{ history: CrashPlayerHistoryEntry[] }>(
    `/games/crash/my-history?limit=${limit}`,
  );
}

export function getCrashLiveBets(
  roundId: string,
): Promise<{ roundId: string; bets: AnonymizedLiveBet[] }> {
  return authFetch<{ roundId: string; bets: AnonymizedLiveBet[] }>(
    `/games/crash/rounds/${roundId}/bets`,
  );
}

export function placeCrashBet(
  stake: number,
  clientRequestId: string,
): Promise<{ bet: CrashBetView }> {
  return authFetch<{ bet: CrashBetView }>('/games/crash/bets', {
    method: 'POST',
    body: JSON.stringify({ stake, clientRequestId }),
  });
}

export function cashOutCrashBet(
  betId: string,
  clientRequestId?: string,
): Promise<{ bet: CrashBetView }> {
  return authFetch<{ bet: CrashBetView }>(`/games/crash/bets/${betId}/cashout`, {
    method: 'POST',
    body: JSON.stringify(clientRequestId ? { clientRequestId } : {}),
  });
}

export function verifyCrashRound(roundNumber: number): Promise<CrashVerificationView> {
  return authFetch<CrashVerificationView>(`/games/crash/rounds/verify?roundNumber=${roundNumber}`);
}

// ---------------------------------------------------------------------------
// WebSocket — namespace /games/crash, JWT via handshake auth payload
// ---------------------------------------------------------------------------

export interface MultiplierUpdateEvent {
  roundId: string;
  roundNumber: number;
  state: CrashRoundStatus;
  serverTime: number;
  startAt: number;
  bettingCloseAt: number;
  /** Operator sequence context (phase + consumed position only). */
  sequenceMode?: CrashSequenceMode | null;
  sequenceIndex?: number | null;
  crashAt?: number;
  multiplier?: number;
}

export interface PlayerBetUpdateEvent {
  roundId: string;
  roundNumber: number;
  betId: string;
  stake: number;
  currency: string;
  serverTime: number;
}

export interface PlayerCashoutEvent {
  roundId: string;
  roundNumber: number;
  betId: string;
  cashoutMultiplier: number;
  payout: number;
  serverTime: number;
}

export interface RoundCrashedEvent {
  roundId: string;
  roundNumber: number;
  crashMultiplier: number | null;
  crashAt: number;
  voided?: boolean;
  serverTime: number;
}

/** Connects (and reconnects automatically) to the Royale Fly room. */
export function createCrashSocket(): Socket {
  return io(`${getWsOrigin()}/games/crash`, {
    auth: { token: getAccessToken() ?? undefined },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    withCredentials: true,
  });
}

/** Random UUID for idempotency keys (crypto-secure where available). */
export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random()
    .toString(16)
    .slice(2)}`;
}

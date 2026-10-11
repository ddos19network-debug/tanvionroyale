/**
 * Frontend Royale Play API client — original TANVION ROYALE games
 * (Plinko + Mines). All calls go through the TANVION ROYALE backend; every
 * route requires a signed-in customer and the server ENFORCES ownership.
 *
 * The client only ever SENDS a stake, a board choice, a tile index and an
 * idempotency key. Outcomes, multipliers, payouts, seeds and balances are
 * ALWAYS server-authoritative — nothing here invents or predicts a result.
 */
import { authFetch } from './client';

export type RoyaleMode = 'FREE_PLAY' | 'REAL_MONEY';
export type PlinkoRisk = 'LOW' | 'MEDIUM' | 'HIGH';
export type MinesStatus = 'ACTIVE' | 'CASHED_OUT' | 'BUSTED' | 'VOIDED';

export interface RoyaleConfigView {
  enabled: boolean;
  mode: RoyaleMode;
  realMoneyAvailable: boolean;
  realMoneyReason: string;
  minStake: number;
  maxStake: number;
  currency: string;
  rtpBp: number;
  maxMultiplierBp: number;
  algorithmVersion: string;
  plinko: { minRows: number; maxRows: number; risks: PlinkoRisk[] };
  mines: { grids: number[]; minMines: number; maxMines: number };
}

export interface RoyalePlinkoRoundView {
  id: string;
  gameSlug: string;
  mode: RoyaleMode;
  status: 'SETTLED';
  rows: number;
  risk: string;
  stake: number;
  currency: string;
  path: number[];
  binIndex: number;
  multiplierBp: number;
  payout: number;
  serverSeedHash: string;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  transactionId: string | null;
  createdAt: string;
  settledAt: string;
}

export interface RoyaleMinesRoundView {
  id: string;
  gameSlug: string;
  mode: RoyaleMode;
  status: MinesStatus;
  gridSize: number;
  minesCount: number;
  stake: number;
  currency: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  revealed: number[];
  safeCount: number;
  currentMultiplierBp: number;
  potentialPayout: number;
  payout: number;
  /** Revealed seed — null while ACTIVE. */
  serverSeed: string | null;
  /** Mine positions — only for CASHED_OUT / BUSTED; null while ACTIVE/VOIDED. */
  minesRevealed: number[] | null;
  transactionId: string | null;
  createdAt: string;
  updatedAt: string;
  settledAt: string | null;
}

export interface MinesRevealResultView {
  round: RoyaleMinesRoundView;
  hit: boolean;
  duplicate: boolean;
  voided: boolean;
}

export interface PlinkoPayoutTableView {
  rows: number;
  risk: PlinkoRisk;
  multipliersBp: number[];
  rtpBp: number;
  evBp: number;
  maxMultiplierBp: number;
  note: string;
}

function newClientRequestId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Fallback for very old browsers; a UUID is only used for idempotency.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getRoyaleConfig(): Promise<RoyaleConfigView> {
  return authFetch<RoyaleConfigView>('/games/royale/config');
}

// ---------------------------------------------------------------------------
// Plinko
// ---------------------------------------------------------------------------

export async function getPlinkoPayoutTable(
  rows: number,
  risk: PlinkoRisk,
): Promise<PlinkoPayoutTableView> {
  const q = `rows=${rows}&risk=${risk}`;
  return authFetch<PlinkoPayoutTableView>(`/games/royale/plinko/payout-table?${q}`);
}

export async function dropPlinko(
  stake: number,
  rows: number,
  risk: PlinkoRisk,
  clientRequestId: string = newClientRequestId(),
): Promise<RoyalePlinkoRoundView> {
  const res = await authFetch<{ round: RoyalePlinkoRoundView }>('/games/royale/plinko/drop', {
    method: 'POST',
    body: JSON.stringify({ stake, rows, risk, clientRequestId }),
  });
  return res.round;
}

export async function getPlinkoHistory(limit = 25): Promise<RoyalePlinkoRoundView[]> {
  const res = await authFetch<{ rounds: RoyalePlinkoRoundView[] }>(
    `/games/royale/plinko/history?limit=${limit}`,
  );
  return res.rounds;
}

export async function verifyPlinko(roundId: string): Promise<Record<string, unknown>> {
  return authFetch<Record<string, unknown>>(
    `/games/royale/plinko/rounds/${encodeURIComponent(roundId)}/verify`,
  );
}

// ---------------------------------------------------------------------------
// Mines
// ---------------------------------------------------------------------------

export async function getActiveMinesRound(): Promise<RoyaleMinesRoundView | null> {
  const res = await authFetch<{ round: RoyaleMinesRoundView | null }>('/games/royale/mines/active');
  return res.round;
}

export async function startMinesRound(
  stake: number,
  gridSize: number,
  minesCount: number,
  clientRequestId: string = newClientRequestId(),
): Promise<RoyaleMinesRoundView> {
  const res = await authFetch<{ round: RoyaleMinesRoundView }>('/games/royale/mines/start', {
    method: 'POST',
    body: JSON.stringify({ stake, gridSize, minesCount, clientRequestId }),
  });
  return res.round;
}

export async function revealMinesTile(
  roundId: string,
  tile: number,
): Promise<MinesRevealResultView> {
  return authFetch<MinesRevealResultView>(
    `/games/royale/mines/${encodeURIComponent(roundId)}/reveal`,
    { method: 'POST', body: JSON.stringify({ tile }) },
  );
}

export async function cashoutMines(roundId: string): Promise<MinesRevealResultView> {
  return authFetch<MinesRevealResultView>(
    `/games/royale/mines/${encodeURIComponent(roundId)}/cashout`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export async function forfeitMines(roundId: string): Promise<MinesRevealResultView> {
  return authFetch<MinesRevealResultView>(
    `/games/royale/mines/${encodeURIComponent(roundId)}/forfeit`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export async function getMinesHistory(limit = 25): Promise<RoyaleMinesRoundView[]> {
  const res = await authFetch<{ rounds: RoyaleMinesRoundView[] }>(
    `/games/royale/mines/history?limit=${limit}`,
  );
  return res.rounds;
}

export async function verifyMines(roundId: string): Promise<Record<string, unknown>> {
  return authFetch<Record<string, unknown>>(
    `/games/royale/mines/rounds/${encodeURIComponent(roundId)}/verify`,
  );
}

/** Basis-points multiplier (10000 = 1.00x) as a readable string, e.g. "2.50x". */
export function formatBp(multiplierBp: number): string {
  return `${(multiplierBp / 10_000).toFixed(2)}x`;
}

/**
 * Frontend Royale Ace (royale-ace) API client — original TANVION ROYALE game.
 *
 * The client is a DUMB REPLAYER. It sends ONLY a stake, an optional currency,
 * an idempotency key and presentation flags. The server derives the ENTIRE
 * round (initial grid, every cascade step, golden→wild placements, the
 * multiplier ladder, the scatter trigger, the full free-spin sequence and the
 * capped total win) and settles money server-side; this client animates the
 * returned `result` and never invents, predicts or alters an outcome.
 */
import { authFetch } from './client';

export type AceMode = 'FREE_PLAY' | 'REAL_MONEY';
export type AceSymbol = 'SPADE' | 'HEART' | 'DIAMOND' | 'CLUB' | 'J' | 'Q' | 'K' | 'A' | 'WILD' | 'SCATTER';

/** One reel position as returned by the server (client never fabricates it). */
export interface AceCell {
  symbol: AceSymbol;
  golden: boolean;
}

export interface AceCellRef {
  reel: number;
  row: number;
}

export interface AceWinGroup {
  symbol: AceSymbol;
  runLength: number;
  ways: number;
  cells: AceCellRef[];
  payBp: number;
}

export interface AceCascadeStep {
  index: number;
  grid: AceCell[][];
  wins: AceWinGroup[];
  removed: AceCellRef[];
  goldenToWild: AceCellRef[];
  multiplierBp: number;
  payBp: number;
  wayPayBp: number;
  scatterPayBp: number;
  scatterCount: number;
  scatterTriggered: boolean;
}

export interface AceSpinResult {
  steps: AceCascadeStep[];
  totalPayBp: number;
  maxMultiplierBp: number;
  cascadeDepth: number;
  scatterCount: number;
  freeSpinsAwarded: number;
}

export interface AceRoundResult {
  baseSpin: AceSpinResult;
  freeSpins: AceSpinResult[];
  totalPayBp: number;
  maxMultiplierBp: number;
  freeSpinsPlayed: number;
  retriggered: boolean;
  capped: boolean;
}

export interface AceBetLevels {
  minStake: number;
  maxStake: number;
  step: number;
}

export interface AceConfigView {
  gameSlug: string;
  enabled: boolean;
  mode: AceMode;
  realMoneyAvailable: boolean;
  realMoneyReason: string;
  configVersion: number;
  configName: string;
  targetRtpBp: number;
  volatilityLabel: string;
  maxWinBp: number;
  reels: number;
  rows: number;
  ways: number;
  goldenToWild: boolean;
  baseLadderBp: number[];
  freeSpinLadderBp: number[];
  scatterPayBp: number[];
  freeSpins: {
    awardByScatterCount: number[];
    retriggerUsesAwardTable: boolean;
    maxSpinsPerRound: number;
    creditMode: string;
  };
  paytableBp: Record<Exclude<AceSymbol, 'WILD' | 'SCATTER'>, number[]>;
  betLevels: Record<string, AceBetLevels>;
  freePlayBetLevels: AceBetLevels;
  allowedCurrencies: string[];
  country: string | null;
  dailyWinCapMinorUnits: Record<string, number>;
}

export interface AceRoundView {
  id: string;
  gameSlug: string;
  mode: AceMode;
  status: 'ACTIVE' | 'SETTLED' | 'VOIDED';
  stake: number;
  currency: string;
  payout: number | null;
  totalPayBp: number;
  maxMultiplierBp: number;
  capped: boolean;
  result: AceRoundResult;
  configVersion: number;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  serverSeed: string | null;
  transactionId: string | null;
  createdAt: string;
  settledAt: string | null;
}

export interface AceAutoplayLimits {
  spinCount: number;
  lossLimit: number;
  winLimit: number;
}

function newClientRequestId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getAceConfig(): Promise<AceConfigView> {
  return authFetch<AceConfigView>('/games/royale-ace/config');
}

export async function aceSpin(
  stake: number,
  options: {
    currency?: string;
    clientRequestId?: string;
    turbo?: boolean;
  } = {},
): Promise<AceRoundView> {
  const res = await authFetch<{ round: AceRoundView }>('/games/royale-ace/spin', {
    method: 'POST',
    body: JSON.stringify({
      stake,
      currency: options.currency,
      clientRequestId: options.clientRequestId ?? newClientRequestId(),
      turbo: options.turbo,
    }),
  });
  return res.round;
}

export async function getAceHistory(limit = 25): Promise<AceRoundView[]> {
  const res = await authFetch<{ rounds: AceRoundView[] }>(
    `/games/royale-ace/history?limit=${limit}`,
  );
  return res.rounds;
}

export async function verifyAce(roundId: string): Promise<Record<string, unknown>> {
  return authFetch<Record<string, unknown>>(
    `/games/royale-ace/rounds/${encodeURIComponent(roundId)}/verify`,
  );
}

export async function submitAceAutoplayLimits(
  limits: AceAutoplayLimits,
): Promise<Record<string, unknown>> {
  return authFetch<Record<string, unknown>>('/games/royale-ace/autoplay/limits', {
    method: 'POST',
    body: JSON.stringify(limits),
  });
}

/** Basis-points multiplier (10000 = 1.00x) as a readable string, e.g. "2.50x". */
export function formatBp(multiplierBp: number): string {
  return `${(multiplierBp / 10_000).toFixed(2)}x`;
}

/** Format minor units into a currency string (no auto-FX; display only). */
export function formatMinor(minor: number, currency: string): string {
  const major = minor / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency}`;
  }
}

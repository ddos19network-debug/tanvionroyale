/**
 * Row shapes (Prisma) and API-safe views for the crash engine. Views never
 * leak the unrevealed server seed or any private user data.
 */

import type { CrashMode } from './crash.config';
import type { CrashPointSource, CrashSequenceMode } from '../../generated/prisma';
import type { RoundStatus } from './round-state';

export interface CrashRoundRow {
  id: string;
  gameSlug: string;
  mode: CrashMode;
  status: RoundStatus;
  roundNumber: number;
  serverSeedHash: string;
  serverSeed: string | null;
  crashPointSeedEnc: string | null;
  clientSeed: string;
  nonce: number;
  algorithmVersion: string;
  /** Operator-sequence fields (see CrashSequenceState / crash-sequence-core). */
  crashSource: CrashPointSource;
  sequenceMode: CrashSequenceMode | null;
  sequenceIndex: number | null;
  /** Predetermined configured multiplier — server-only, never exposed live. */
  crashPointConfigured: number | null;
  startAt: Date;
  bettingCloseAt: Date;
  crashAt: Date | null;
  crashMultiplier: number | null;
  crashedAt: Date | null;
  settledAt: Date | null;
  bettingClosedAt: Date | null;
  createdAt: Date;
}

export interface CrashBetRow {
  id: string;
  roundId: string;
  userId: string;
  mode: CrashMode;
  stake: number;
  currency: string;
  status: 'ACTIVE' | 'CASHED_OUT' | 'LOST' | 'REFUNDED';
  cashoutMultiplier: number | null;
  payout: number | null;
  transactionId: string | null;
  idempotencyKey: string;
  placedAt: Date;
  cashoutAt: Date | null;
  settledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  settlement?: {
    result: 'CASHED_OUT' | 'LOST' | 'REFUNDED';
    cashoutMultiplier: number | null;
    payout: number;
  } | null;
}

export interface CrashRoundView {
  id: string;
  gameSlug: string;
  mode: CrashMode;
  status: RoundStatus;
  roundNumber: number;
  /** ISO timestamps (null until the phase applies). */
  startAt: string | null;
  startedAt: string | null;
  bettingCloseAt: string | null;
  crashAt: string | null;
  crashMultiplier: number | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  algorithmVersion: string;
  /** PROVABLY_FAIR (seed-derived) or CONFIGURED (operator sequence). */
  crashSource: CrashPointSource;
  /** Sequence phase + 1-based position of THIS round (null for seed rounds). */
  sequenceMode: CrashSequenceMode | null;
  sequenceIndex: number | null;
  bettingOpen: boolean;
  serverTime: string;
  /** Authoritative multiplier for RUNNING rounds (null when not derivable). */
  currentMultiplier: number | null;
  /** Revealed after the round crashed — never before. */
  revealedSeed: string | null;
  crashed: boolean;
}

export interface CrashVerificationView {
  roundId: string;
  roundNumber: number;
  serverSeedHash: string;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  algorithmVersion: string;
  crashMultiplier: number;
  derivedCommitmentHash: string;
  derivedHash: string;
  derivedMultiplier: number;
  verified: boolean;
  /**
   * Fairness labeling (honesty first):
   *  - PROVABLY_FAIR: the multiplier IS derived from the revealed seed
   *    (HMAC-SHA256 commit/reveal) — `verified` recomputes it.
   *  - CONFIGURED: the multiplier was set by the operator's persisted
   *    sequence. The seed commitment does NOT determine the outcome; `verified`
   *    only confirms the seed material's integrity. See `fairnessModel`/`note`.
   */
  crashSource: CrashPointSource;
  fairnessModel: 'HMAC_SHA256_COMMIT_REVEAL' | 'ADMIN_SEQUENCE';
  note: string;
  sequenceMode: CrashSequenceMode | null;
  sequenceIndex: number | null;
}

export interface CrashBetView {
  id: string;
  roundId: string;
  roundNumber: number;
  mode: CrashMode;
  stake: number;
  currency: string;
  status: CrashBetRow['status'];
  cashoutMultiplier: number | null;
  payout: number | null;
  result: CrashBetResult | null;
  placedAt: string;
  cashoutAt: string | null;
  settledAt: string | null;
}

export interface AnonymizedLiveBet {
  /** Masked username, e.g. "d***8" — never the full identifier. */
  player: string;
  stake: number;
  cashoutMultiplier: number | null;
  payout: number | null;
  cashedOut: boolean;
}

export interface CrashHistoryEntry {
  roundId: string;
  roundNumber: number;
  crashMultiplier: number;
  crashedAt: string;
  mode: CrashMode;
}

export interface CrashPlayerHistoryEntry {
  roundNumber: number;
  createdAt: string;
  stake: number;
  currency: string;
  status: CrashBetRow['status'];
  result: CrashBetResult | null;
  cashoutMultiplier: number | null;
  payout: number | null;
}

/** Public snapshot of the current round (also served over WebSocket). */
export interface CrashSnapshotView {
  gameSlug: string;
  mode: CrashMode;
  enabled: boolean;
  realMoneyAvailable: boolean;
  round: CrashRoundView | null;
  myBet: CrashBetView | null;
  myBets?: CrashBetView[];
  lastCrash: CrashHistoryEntry | null;
  /** Operator sequence phase + consumed position (never future multipliers). */
  sequence: {
    active: boolean;
    mode: CrashSequenceMode;
    lastIndex: number | null;
    label: string | null;
  };
  config: {
    minStake: number;
    maxStake: number;
    currency: string;
    bettingDurationMs: number;
    nextRoundDelayMs: number;
  };
}

export interface CrashStateSnap {
  round?: CrashRoundRow | null;
  timing?: { crashAtMs: number; crashMultiplier: number } | null;
}

/** Mask a username for public/anonymized leaderboards. */
export function maskUsername(username: string): string {
  if (!username) return '***';
  if (username.length <= 2) return `${username[0]}***`;
  const head = username.slice(0, 1);
  const tail = username.slice(-1);
  return `${head}${'*'.repeat(Math.min(4, Math.max(1, username.length - 2)))}${tail}`;
}

/** Final settlement result of a bet. */
export type CrashBetResult = 'CASHED_OUT' | 'LOST' | 'REFUNDED';

export const CRASH_FREE_PLAY_CURRENCY = 'FREEPLAY';
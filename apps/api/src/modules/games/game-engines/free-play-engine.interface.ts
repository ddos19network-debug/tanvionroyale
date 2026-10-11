/**
 * Free-play game engine contract.
 *
 * Free-play games are INTERNALLY DEVELOPED, clearly labelled, zero-money
 * games. They never touch the wallet, never place bets and never present
 * fabricated odds. Score/points are free-play only.
 *
 * An engine is a pure, stateless function over the persisted `state` JSONB:
 *  - `createInitialState(payload)` builds the starting state once per session.
 *  - `applyAction(state, action, at)` returns the next state plus, when the
 *    round ends, a scored result.
 *  - `snapshot(state, at)` returns the server-authoritative view of the state
 *    (what the frontend polls).
 */
export type FreePlayState = Record<string, unknown>;

export type FreePlayRoundOutcome = 'WIN' | 'LOSS' | 'VOID';

export interface FreePlayRoundResult {
  outcome: FreePlayRoundOutcome;
  /** Free-play points earned (never money). */
  score: number;
  message: string;
}

export interface FreePlayActionResult {
  state: FreePlayState;
  /** True when the round ended and a GameResult must be written. */
  finished: boolean;
  result?: FreePlayRoundResult;
}

export interface FreePlayAction {
  type: string;
  /** Optional client timestamp (ms) — engines always normalize to Date.now(). */
  at?: number;
  payload?: Record<string, unknown>;
}

export interface PublicFreePlayGame {
  slug: string;
  title: string;
  description: string;
  kind: 'FREE_PLAY';
  /** Human label used to badge the tile/card. */
  tagline?: string;
}

export interface FreePlayGameEngine {
  readonly meta: PublicFreePlayGame;
  readonly allowedActions: readonly string[];
  createInitialState(payload?: Record<string, unknown>): FreePlayState;
  applyAction(
    state: FreePlayState,
    action: FreePlayAction,
    at?: number,
  ): FreePlayActionResult;
  snapshot(state: FreePlayState, at?: number): Record<string, unknown>;
}
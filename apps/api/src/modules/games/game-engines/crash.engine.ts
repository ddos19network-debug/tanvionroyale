import { randomInt } from 'node:crypto';
import type {
  FreePlayActionResult,
  FreePlayAction,
  FreePlayGameEngine,
  FreePlayState,
} from './free-play-engine.interface';
import { PlayerActionError } from './engine-errors';

/**
 * Sky Rocket — internally developed free-play crash game.
 *
 * FREE PLAY ONLY. A multiplier climbs while the round runs; the player "cashes
 * out" before the hidden crash point is reached. Points are free-play only
 * (multiplier × 100, integer). There is NO stake, NO wallet movement, NO odds.
 *
 * The crash point is generated server-side with node:crypto (uniform random)
 * and stored in the session state; the current multiplier is a pure function
 * of elapsed time, so the frontend just polls the authoritative snapshot.
 */

export interface CrashState {
  phase: 'WAITING' | 'RUNNING' | 'CASHED_OUT' | 'CRASHED';
  /** Round starts ONLY after the client fires `START`. */
  crashPoint: number;
  /** Epoch ms the current round began climbing (0 while WAITING). */
  startedAt: number;
  /** Last computed multiplier (2 dp). */
  multiplier: number;
  score: number;
  outcome: 'WIN' | 'LOSS' | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Hidden crash point, in the classic crash-curve family:
 *   crash = 0.98 / (1 - r)  for uniform r in [0,1)
 * clamped to [1.02, 10.00] so rounds end in a reasonable window and retain
 * rare high multipliers. Free-play randomness — NEVER a gambling RNG.
 */
export function generateCrashPoint(): number {
  const r = randomInt(2, 1_000_000) / 1_000_000; // (0,1)
  const raw = 0.98 / (1 - r);
  return round2(Math.min(10.0, Math.max(1.02, raw)));
}

/** Time-based multiplier: 1.0 at t=0, +0.6 per second, accelerating gently. */
export function multiplierAt(state: CrashState, now: number): number {
  if (state.phase !== 'RUNNING' || state.startedAt <= 0) return round2(state.multiplier || 1);
  const elapsed = Math.max(0, now - state.startedAt) / 1000;
  const mul = 1 + Math.pow(elapsed, 1.35) * 0.8;
  return round2(mul);
}

function snapshotOf(state: CrashState, now: number): FreePlayState {
  const crashed =
    state.phase === 'RUNNING' && multiplierAt(state, now) >= state.crashPoint;
  const phase = crashed ? 'CRASHED' : state.phase;
  const multiplier =
    state.phase === 'RUNNING' ? multiplierAt(state, now) : state.multiplier;
  const finished = phase === 'CASHED_OUT' || phase === 'CRASHED';
  return {
    phase,
    // The crash point is SERVER-ONLY while a round is live — a client that
    // could read it could always cash out just before the crash. It is
    // revealed in the snapshot only after the round has finished.
    ...(finished ? { crashPoint: state.crashPoint } : {}),
    multiplier,
    score: state.score,
    outcome: state.outcome,
  } as unknown as FreePlayState;
}

/**
 * A RUNNING round is only live when its clock anchor exists. A state that
 * claims RUNNING without `startedAt` is corrupt/legacy — settle it as a loss
 * instead of paying a frozen multiplier.
 */
function isLiveRound(state: CrashState): boolean {
  return state.phase === 'RUNNING' && Number.isFinite(state.startedAt) && state.startedAt > 0;
}

export class CrashEngine implements FreePlayGameEngine {
  readonly meta = {
    slug: 'sky-rocket',
    title: 'Sky Rocket',
    description:
      'Free-play crash game. Cash out before the rocket crashes to bank your multiplier — built by TANVIONROYALE, no real money.',
    kind: 'FREE_PLAY' as const,
    tagline: 'Free-play — no real money',
  };
  readonly allowedActions = ['START', 'TICK', 'CASH_OUT', 'CONCEDE'];

  createInitialState(): FreePlayState {
    const state: CrashState = {
      phase: 'WAITING',
      crashPoint: generateCrashPoint(),
      startedAt: 0,
      multiplier: 1,
      score: 0,
      outcome: null,
    };
    return state as unknown as FreePlayState;
  }

  applyAction(
    rawState: FreePlayState,
    action: FreePlayAction,
    at = Date.now(),
  ): FreePlayActionResult {
    const state = rawState as unknown as CrashState;
    if (!this.allowedActions.includes(action.type)) {
      throw new PlayerActionError(`Unsupported action "${action.type}" for sky-rocket`);
    }

    switch (action.type) {
      case 'START': {
        if (state.phase !== 'WAITING') {
          throw new PlayerActionError('This round has already started');
        }
        return {
          state: this.applyStart(state, at),
          finished: false,
        };
      }
      case 'CASH_OUT': {
        if (state.phase !== 'RUNNING') {
          throw new PlayerActionError('The round is not running');
        }
        if (!isLiveRound(state)) {
          // Corrupt/legacy RUNNING state without a clock anchor — settle as a
          // loss rather than paying a frozen multiplier.
          return this.finish({ ...state, phase: 'CRASHED', multiplier: round2(state.crashPoint) });
        }
        const mul = multiplierAt(state, at);
        if (mul >= state.crashPoint) {
          // Crashed underneath the player: free-play LOSS.
          return this.finish({ ...state, phase: 'CRASHED', multiplier: round2(state.crashPoint) });
        }
        const score = Math.floor(mul * 100); // free-play points only
        return this.finish({
          ...state,
          phase: 'CASHED_OUT',
          multiplier: mul,
          score,
          outcome: 'WIN',
        });
      }
      case 'TICK': {
        if (state.phase !== 'RUNNING') {
          // Keep the persisted canonical state untouched — returning the
          // display snapshot here would overwrite engine-only fields
          // (startedAt) in the database and freeze the round.
          return { state: rawState, finished: false };
        }
        if (!isLiveRound(state) || multiplierAt(state, at) >= state.crashPoint) {
          return this.finish({
            ...state,
            phase: 'CRASHED',
            multiplier: round2(state.crashPoint),
          });
        }
        // Persist the CANONICAL internal state (startedAt/crashPoint intact).
        // The client never sees this raw form — the service responds with the
        // engine's display snapshot, which hides the crash point.
        return {
          state: { ...state, multiplier: multiplierAt(state, at) } as unknown as FreePlayState,
          finished: false,
        };
      }
      case 'CONCEDE': {
        if (state.phase === 'CASHED_OUT' || state.phase === 'CRASHED') {
          return {
            state: snapshotOf(state, at),
            finished: false,
            result:
              state.outcome === 'WIN'
                ? { outcome: 'WIN', score: state.score, message: 'Round already cashed out' }
                : { outcome: 'LOSS', score: 0, message: 'Round already finished' },
          };
        }
        return this.finish(
          { ...state, phase: 'CRASHED', score: 0, outcome: 'LOSS' },
          { outcome: 'LOSS', score: 0, message: 'Round abandoned before cash-out' },
        );
      }
      default:
        throw new PlayerActionError(`Unsupported action "${action.type}"`);
    }
  }

  snapshot(rawState: FreePlayState, at = Date.now()): FreePlayState {
    return snapshotOf(rawState as unknown as CrashState, at);
  }

  private applyStart(state: CrashState, at: number): FreePlayState {
    return { ...state, phase: 'RUNNING', startedAt: at, multiplier: 1.0 } as unknown as FreePlayState;
  }

  private finish(
    state: CrashState,
    override?: { outcome: 'WIN' | 'LOSS'; score: number; message: string },
  ): FreePlayActionResult {
    const result =
      override ??
      (state.outcome === 'WIN'
        ? {
            outcome: 'WIN' as const,
            score: state.score,
            message: `Cashed out at ${state.multiplier.toFixed(2)}× — ${state.score} free-play points`,
          }
        : {
            outcome: 'LOSS' as const,
            score: 0,
            message: `Crashed at ${round2(state.crashPoint).toFixed(2)}× — no points`,
          });
    return {
      state: state as unknown as FreePlayState,
      finished: true,
      result,
    };
  }
}
import { randomInt } from 'node:crypto';
import type {
  FreePlayActionResult,
  FreePlayAction,
  FreePlayGameEngine,
  FreePlayState,
} from './free-play-engine.interface';
import { PlayerActionError } from './engine-errors';

/**
 * Wheel Spin — free-play. A fair wheel with fixed prize segments (0..100 pts)
 * is spun server-side. FREE PLAY ONLY, never money.
 */
export const WHEEL_SEGMENTS: readonly number[] = [0, 10, 25, 0, 50, 100, 0, 20, 5, 75];

export interface WheelSpinState {
  index: number | null;
  prize: number | null;
  phase: 'READY' | 'SPUN';
  outcome: 'WIN' | 'LOSS' | null;
}

export class WheelSpinEngine implements FreePlayGameEngine {
  readonly meta = {
    slug: 'wheel-spin',
    title: 'Wheel Spin',
    description:
      'Free-play wheel. Spin for free-play points from a fair wheel — built by TANVIONROYALE, no real money.',
    kind: 'FREE_PLAY' as const,
    tagline: 'Free-play — no real money',
  };
  readonly allowedActions = ['SPIN', 'CONCEDE'];

  createInitialState(): FreePlayState {
    return { index: null, prize: null, phase: 'READY', outcome: null } as unknown as FreePlayState;
  }

  applyAction(rawState: FreePlayState, action: FreePlayAction): FreePlayActionResult {
    const state = rawState as unknown as WheelSpinState;
    if (!this.allowedActions.includes(action.type)) {
      throw new PlayerActionError(`Unsupported action "${action.type}" for wheel-spin`);
    }
    if (action.type === 'CONCEDE') {
      if (state.phase !== 'READY') {
        return {
          state: this.snapshot(state as unknown as FreePlayState),
          finished: false,
          result: { outcome: 'LOSS', score: state.prize ?? 0, message: 'Round already finished' },
        };
      }
      return {
        state: { ...state, phase: 'SPUN', outcome: 'LOSS', prize: 0 } as unknown as FreePlayState,
        finished: true,
        result: { outcome: 'LOSS', score: 0, message: 'Round abandoned before spinning' },
      };
    }
    if (action.type !== 'SPIN') {
      throw new PlayerActionError(`Unsupported action "${action.type}"`);
    }
    if (state.phase !== 'READY') {
      throw new PlayerActionError('This wheel has already been spun');
    }
    const index = randomInt(0, WHEEL_SEGMENTS.length);
    const prize = WHEEL_SEGMENTS[index];
    const win = prize > 0;
    const finished: WheelSpinState = {
      ...state,
      index,
      prize,
      phase: 'SPUN',
      outcome: win ? 'WIN' : 'LOSS',
    };
    return {
      state: finished as unknown as FreePlayState,
      finished: true,
      result: {
        outcome: win ? 'WIN' : 'LOSS',
        score: prize,
        message: win
          ? `The wheel landed on ${prize} points — +${prize} pts`
          : 'The wheel landed on an empty segment — no points',
      },
    };
  }

  snapshot(rawState: FreePlayState): FreePlayState {
    const state = rawState as unknown as WheelSpinState;
    return {
      index: state.index,
      prize: state.prize,
      phase: state.phase,
      outcome: state.outcome,
      segments: WHEEL_SEGMENTS,
    } as unknown as FreePlayState;
  }
}
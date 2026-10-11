import { randomInt } from 'node:crypto';
import type {
  FreePlayActionResult,
  FreePlayAction,
  FreePlayGameEngine,
  FreePlayState,
} from './free-play-engine.interface';
import { PlayerActionError } from './engine-errors';

/**
 * Higher or Lower — free-play. A starting number is drawn; guess whether the
 * next number is higher or lower. Win = 100 free-play points. FREE PLAY ONLY.
 */
export interface HigherLowerState {
  current: number;
  next: number | null;
  phase: 'READY' | 'REVEALED';
  score: number;
  outcome: 'WIN' | 'LOSS' | null;
}

function draw(): number {
  return randomInt(1, 101); // 1..100
}

export class HigherLowerEngine implements FreePlayGameEngine {
  readonly meta = {
    slug: 'higher-or-lower',
    title: 'Higher or Lower',
    description:
      'Free-play guessing game. Is the next number higher or lower than the current one? Built by TANVIONROYALE, no real money.',
    kind: 'FREE_PLAY' as const,
    tagline: 'Free-play — no real money',
  };
  readonly allowedActions = ['GUESS', 'CONCEDE'];

  createInitialState(): FreePlayState {
    return {
      current: draw(),
      next: null,
      phase: 'READY',
      score: 0,
      outcome: null,
    } as unknown as FreePlayState;
  }

  applyAction(rawState: FreePlayState, action: FreePlayAction): FreePlayActionResult {
    const state = rawState as unknown as HigherLowerState;
    if (!this.allowedActions.includes(action.type)) {
      throw new PlayerActionError(`Unsupported action "${action.type}" for higher-or-lower`);
    }
    if (action.type === 'CONCEDE') {
      if (state.phase !== 'READY') {
        return {
          state: this.snapshot(state as unknown as FreePlayState),
          finished: false,
          result: {
            outcome: state.outcome ?? 'LOSS',
            score: state.score,
            message: 'Round already finished',
          },
        };
      }
      return {
        state: { ...state, phase: 'REVEALED', outcome: 'LOSS', score: 0 } as unknown as FreePlayState,
        finished: true,
        result: { outcome: 'LOSS', score: 0, message: 'Round abandoned before guessing' },
      };
    }
    if (state.phase !== 'READY') {
      throw new PlayerActionError('This round has already been resolved');
    }
    const guessHigher = action.payload?.guess === 'GUESS_HIGH';
    let next = draw();
    while (next === state.current) next = draw();
    const win = guessHigher ? next > state.current : next < state.current;
    const finished: HigherLowerState = {
      ...state,
      next,
      phase: 'REVEALED',
      score: win ? 100 : 0,
      outcome: win ? 'WIN' : 'LOSS',
    };
    return {
      state: finished as unknown as FreePlayState,
      finished: true,
      result: {
        outcome: win ? 'WIN' : 'LOSS',
        score: finished.score,
        message: win
          ? `${state.current} → ${next} (${guessHigher ? 'higher' : 'lower'}) — +100 pts`
          : `${state.current} → ${next} (${guessHigher ? 'higher' : 'lower'}) — no points`,
      },
    };
  }

  snapshot(rawState: FreePlayState): FreePlayState {
    return rawState as unknown as FreePlayState;
  }
}
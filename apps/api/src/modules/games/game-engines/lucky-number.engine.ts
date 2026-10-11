import { randomInt } from 'node:crypto';
import type {
  FreePlayActionResult,
  FreePlayAction,
  FreePlayGameEngine,
  FreePlayState,
} from './free-play-engine.interface';
import { PlayerActionError } from './engine-errors';

/**
 * Lucky Number — free-play. Pick 1..10; the server draws 1..10. A match =
 * 150 points. FREE PLAY ONLY.
 */
export interface LuckyNumberState {
  pick: number | null;
  phase: 'READY' | 'DRAWN';
  drawn: number | null;
  score: number;
  outcome: 'WIN' | 'LOSS' | null;
}

export class LuckyNumberEngine implements FreePlayGameEngine {
  readonly meta = {
    slug: 'lucky-number',
    title: 'Lucky Number',
    description:
      'Free-play luck game. Pick a number 1–10 and see if it is drawn — built by TANVIONROYALE, no real money.',
    kind: 'FREE_PLAY' as const,
    tagline: 'Free-play — no real money',
  };
  readonly allowedActions = ['DRAW', 'CONCEDE'];

  createInitialState(payload?: Record<string, unknown>): FreePlayState {
    const raw = payload?.pick;
    const n = typeof raw === 'number' ? Math.trunc(raw) : Number.parseInt(String(raw ?? ''), 10);
    const pick = Number.isInteger(n) && n >= 1 && n <= 10 ? n : 1;
    return { pick, phase: 'READY', drawn: null, score: 0, outcome: null } as unknown as FreePlayState;
  }

  applyAction(rawState: FreePlayState, action: FreePlayAction): FreePlayActionResult {
    const state = rawState as unknown as LuckyNumberState;
    if (!this.allowedActions.includes(action.type)) {
      throw new PlayerActionError(`Unsupported action "${action.type}" for lucky-number`);
    }
    if (action.type === 'CONCEDE') {
      if (state.phase !== 'READY') {
        return {
          state: this.snapshot(state as unknown as FreePlayState),
          finished: false,
          result: { outcome: 'LOSS', score: state.score, message: 'Round already finished' },
        };
      }
      return {
        state: { ...state, phase: 'DRAWN', outcome: 'LOSS', score: 0 } as unknown as FreePlayState,
        finished: true,
        result: { outcome: 'LOSS', score: 0, message: 'Round abandoned' },
      };
    }
    if (action.type !== 'DRAW') {
      throw new PlayerActionError(`Unsupported action "${action.type}"`);
    }
    if (state.phase !== 'READY') {
      throw new PlayerActionError('This round has already been drawn');
    }
    const drawn = randomInt(1, 11);
    const win = drawn === state.pick;
    const finished: LuckyNumberState = {
      ...state,
      drawn,
      phase: 'DRAWN',
      score: win ? 150 : 0,
      outcome: win ? 'WIN' : 'LOSS',
    };
    return {
      state: finished as unknown as FreePlayState,
      finished: true,
      result: {
        outcome: win ? 'WIN' : 'LOSS',
        score: finished.score,
        message: win ? `Drawn ${drawn} — +150 pts` : `Drawn ${drawn} — no points`,
      },
    };
  }

  snapshot(rawState: FreePlayState): FreePlayState {
    return rawState as unknown as FreePlayState;
  }
}
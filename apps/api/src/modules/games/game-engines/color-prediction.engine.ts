import { randomInt } from 'node:crypto';
import type {
  FreePlayActionResult,
  FreePlayAction,
  FreePlayGameEngine,
  FreePlayState,
} from './free-play-engine.interface';
import { PlayerActionError } from './engine-errors';

/**
 * Color Prediction — free-play. Pick RED / GREEN / VIOLET. The server draws a
 * weighted colour (RED 2:1, GREEN 2:1, VIOLET 1:1 — fair). Red/Green win
 * 50 pts, Violet wins 100. FREE PLAY ONLY.
 */
export type ColorChoice = 'RED' | 'GREEN' | 'VIOLET';

const COLORS: readonly ColorChoice[] = ['RED', 'RED', 'GREEN', 'GREEN', 'VIOLET'];

export interface ColorPredictionState {
  pick: ColorChoice | null;
  phase: 'READY' | 'DRAWN';
  drawn: ColorChoice | null;
  score: number;
  outcome: 'WIN' | 'LOSS' | null;
}

export class ColorPredictionEngine implements FreePlayGameEngine {
  readonly meta = {
    slug: 'color-prediction',
    title: 'Color Prediction',
    description:
      'Free-play colour prediction. Pick RED, GREEN or VIOLET and watch the draw — built by TANVIONROYALE, no real money.',
    kind: 'FREE_PLAY' as const,
    tagline: 'Free-play — no real money',
  };
  readonly allowedActions = ['DRAW', 'CONCEDE'];

  createInitialState(payload?: Record<string, unknown>): FreePlayState {
    const pick = payload?.pick;
    const side: ColorChoice = COLORS.includes(pick as ColorChoice)
      ? (pick as ColorChoice)
      : 'RED';
    return { pick: side, phase: 'READY', drawn: null, score: 0, outcome: null } as unknown as FreePlayState;
  }

  applyAction(rawState: FreePlayState, action: FreePlayAction): FreePlayActionResult {
    const state = rawState as unknown as ColorPredictionState;
    if (!this.allowedActions.includes(action.type)) {
      throw new PlayerActionError(`Unsupported action "${action.type}" for color-prediction`);
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
    const drawn: ColorChoice = COLORS[randomInt(0, COLORS.length)];
    const win = drawn === state.pick;
    const score = win && drawn === 'VIOLET' ? 100 : win ? 50 : 0;
    const finished: ColorPredictionState = {
      ...state,
      drawn,
      phase: 'DRAWN',
      score,
      outcome: win ? 'WIN' : 'LOSS',
    };
    return {
      state: finished as unknown as FreePlayState,
      finished: true,
      result: {
        outcome: win ? 'WIN' : 'LOSS',
        score,
        message: win
          ? `It's ${drawn} — +${score} pts`
          : `It's ${drawn} — no points`,
      },
    };
  }

  snapshot(rawState: FreePlayState): FreePlayState {
    return rawState as unknown as FreePlayState;
  }
}
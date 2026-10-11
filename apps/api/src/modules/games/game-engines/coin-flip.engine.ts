import { randomInt } from 'node:crypto';
import type {
  FreePlayActionResult,
  FreePlayAction,
  FreePlayGameEngine,
  FreePlayState,
} from './free-play-engine.interface';
import { PlayerActionError } from './engine-errors';

/**
 * Coin Flip — free-play. Player picks HEADS or TAILS; a fair coin is flipped
 * server-side with node:crypto. FREE PLAY ONLY: points, never money.
 */
export type CoinSide = 'HEADS' | 'TAILS';

export interface CoinFlipState {
  pick: CoinSide | null;
  phase: 'READY' | 'FLIPPED';
  result: CoinSide | null;
  score: number;
  outcome: 'WIN' | 'LOSS' | null;
}

const SIDES: readonly CoinSide[] = ['HEADS', 'TAILS'];

export class CoinFlipEngine implements FreePlayGameEngine {
  readonly meta = {
    slug: 'coin-flip',
    title: 'Coin Flip',
    description:
      'Free-play coin flip. Call heads or tails and flip — built by TANVIONROYALE, no real money.',
    kind: 'FREE_PLAY' as const,
    tagline: 'Free-play — no real money',
  };
  readonly allowedActions = ['FLIP', 'CONCEDE'];

  createInitialState(payload?: Record<string, unknown>): FreePlayState {
    const pick = payload?.pick;
    const side: CoinSide = SIDES.includes(pick as CoinSide) ? (pick as CoinSide) : 'HEADS';
    return { pick: side, phase: 'READY', result: null, score: 0, outcome: null } as unknown as FreePlayState;
  }

  applyAction(rawState: FreePlayState, action: FreePlayAction): FreePlayActionResult {
    const state = rawState as unknown as CoinFlipState;
    if (!this.allowedActions.includes(action.type)) {
      throw new PlayerActionError(`Unsupported action "${action.type}" for coin-flip`);
    }
    if (action.type === 'CONCEDE') {
      if (state.phase !== 'READY') {
        return {
          state: this.snapshot(state as unknown as FreePlayState),
          finished: false,
          result:
            state.outcome === 'WIN'
              ? { outcome: 'WIN', score: state.score, message: 'Round already finished' }
              : { outcome: 'LOSS', score: 0, message: 'Round already finished' },
        };
      }
      return {
        state: { ...state, phase: 'FLIPPED', outcome: 'LOSS', score: 0 } as unknown as FreePlayState,
        finished: true,
        result: { outcome: 'LOSS', score: 0, message: 'Round abandoned before the flip' },
      };
    }
    if (action.type !== 'FLIP') {
      throw new PlayerActionError(`Unsupported action "${action.type}"`);
    }
    if (state.phase !== 'READY') {
      throw new PlayerActionError('This round has already been flipped');
    }
    if (!state.pick) {
      throw new PlayerActionError('Choose HEADS or TAILS first');
    }
    const result: CoinSide = SIDES[randomInt(0, SIDES.length)];
    const win = result === state.pick;
    const finished: CoinFlipState = {
      ...state,
      phase: 'FLIPPED',
      result,
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
          ? `It's ${result}! +100 free-play points`
          : `It's ${result} — no points`,
      },
    };
  }

  snapshot(rawState: FreePlayState): FreePlayState {
    return rawState as unknown as FreePlayState;
  }
}
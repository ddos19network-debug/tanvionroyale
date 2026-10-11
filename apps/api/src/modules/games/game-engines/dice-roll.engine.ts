import { randomInt } from 'node:crypto';
import type {
  FreePlayActionResult,
  FreePlayAction,
  FreePlayGameEngine,
  FreePlayState,
} from './free-play-engine.interface';
import { PlayerActionError } from './engine-errors';

/**
 * Dice Roll — free-play. Pick a number 1..6; roll one fair dice. A match =
 * 100 points. Distinct from Lightning Dice (no target-odds, single die).
 */
export interface DiceRollState {
  pick: number | null;
  phase: 'READY' | 'ROLLED';
  dice: number | null;
  score: number;
  outcome: 'WIN' | 'LOSS' | null;
}

export class DiceRollEngine implements FreePlayGameEngine {
  readonly meta = {
    slug: 'dice-roll',
    title: 'Dice Roll',
    description:
      'Free-play single dice. Guess the number and roll — built by TANVIONROYALE, no real money.',
    kind: 'FREE_PLAY' as const,
    tagline: 'Free-play — no real money',
  };
  readonly allowedActions = ['ROLL', 'CONCEDE'];

  createInitialState(payload?: Record<string, unknown>): FreePlayState {
    const raw = payload?.pick;
    const n = typeof raw === 'number' ? Math.trunc(raw) : Number.parseInt(String(raw ?? ''), 10);
    const pick = Number.isInteger(n) && n >= 1 && n <= 6 ? n : 1;
    return { pick, phase: 'READY', dice: null, score: 0, outcome: null } as unknown as FreePlayState;
  }

  applyAction(rawState: FreePlayState, action: FreePlayAction): FreePlayActionResult {
    const state = rawState as unknown as DiceRollState;
    if (!this.allowedActions.includes(action.type)) {
      throw new PlayerActionError(`Unsupported action "${action.type}" for dice-roll`);
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
        state: { ...state, phase: 'ROLLED', outcome: 'LOSS', score: 0 } as unknown as FreePlayState,
        finished: true,
        result: { outcome: 'LOSS', score: 0, message: 'Round abandoned before rolling' },
      };
    }
    if (action.type !== 'ROLL') {
      throw new PlayerActionError(`Unsupported action "${action.type}"`);
    }
    if (state.phase !== 'READY') {
      throw new PlayerActionError('This round has already been rolled');
    }
    const dice = randomInt(1, 7);
    const win = dice === state.pick;
    const finished: DiceRollState = {
      ...state,
      dice,
      phase: 'ROLLED',
      score: win ? 100 : 0,
      outcome: win ? 'WIN' : 'LOSS',
    };
    return {
      state: finished as unknown as FreePlayState,
      finished: true,
      result: {
        outcome: win ? 'WIN' : 'LOSS',
        score: finished.score,
        message: win ? `Rolled ${dice} — +100 pts` : `Rolled ${dice} — no points`,
      },
    };
  }

  snapshot(rawState: FreePlayState): FreePlayState {
    return rawState as unknown as FreePlayState;
  }
}
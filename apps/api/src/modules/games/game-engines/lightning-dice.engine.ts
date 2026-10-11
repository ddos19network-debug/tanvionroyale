import { randomInt } from 'node:crypto';
import type {
  FreePlayActionResult,
  FreePlayAction,
  FreePlayGameEngine,
  FreePlayState,
} from './free-play-engine.interface';
import { PlayerActionError } from './engine-errors';

/**
 * Lightning Dice — internally developed free-play dice game.
 *
 * FREE PLAY ONLY. Pick a target (OVER_7 / UNDER_7 / EXACT_7), then roll two
 * fair dice generated server-side with node:crypto. Points are free-play only
 * (OVER/UNDER 100, EXACT 7 = 250). NO stake, NO wallet movement, NO odds.
 */

export type DiceTarget = 'OVER_7' | 'UNDER_7' | 'EXACT_7';

export interface DiceState {
  target: DiceTarget;
  phase: 'READY' | 'ROLLED';
  dice: [number, number] | null;
  score: number;
  outcome: 'WIN' | 'LOSS' | null;
}

export const DICE_TARGETS: readonly DiceTarget[] = ['OVER_7', 'UNDER_7', 'EXACT_7'];

function rollDice(): [number, number] {
  return [randomInt(1, 7), randomInt(1, 7)];
}

function evaluate(target: DiceTarget, sum: number): { win: boolean; points: number } {
  if (target === 'EXACT_7') {
    return { win: sum === 7, points: sum === 7 ? 250 : 0 };
  }
  if (target === 'OVER_7') {
    return { win: sum > 7, points: sum > 7 ? 100 : 0 };
  }
  return { win: sum < 7, points: sum < 7 ? 100 : 0 };
}

export class LightningDiceEngine implements FreePlayGameEngine {
  readonly meta = {
    slug: 'lightning-dice',
    title: 'Lightning Dice',
    description:
      'Free-play dice game. Choose over 7, under 7 or exactly 7, then roll two fair dice — built by TANVIONROYALE, no real money.',
    kind: 'FREE_PLAY' as const,
    tagline: 'Free-play — no real money',
  };
  readonly allowedActions = ['ROLL', 'CONCEDE'];

  createInitialState(payload?: Record<string, unknown>): FreePlayState {
    const rawTarget = payload?.target;
    const target: DiceTarget = DICE_TARGETS.includes(rawTarget as DiceTarget)
      ? (rawTarget as DiceTarget)
      : 'OVER_7';
    const state: DiceState = {
      target,
      phase: 'READY',
      dice: null,
      score: 0,
      outcome: null,
    };
    return state as unknown as FreePlayState;
  }

  applyAction(
    rawState: FreePlayState,
    action: FreePlayAction,
    _at = Date.now(),
  ): FreePlayActionResult {
    const state = rawState as unknown as DiceState;
    if (!this.allowedActions.includes(action.type)) {
      throw new PlayerActionError(`Unsupported action "${action.type}" for lightning-dice`);
    }

    if (action.type === 'ROLL') {
      if (state.phase !== 'READY') {
        throw new PlayerActionError('This round has already been rolled');
      }
      const dice = rollDice();
      const sum = dice[0] + dice[1];
      const { win, points } = evaluate(state.target, sum);
      const finished: DiceState = {
        ...state,
        phase: 'ROLLED',
        dice,
        score: points,
        outcome: win ? 'WIN' : 'LOSS',
      };
      return {
        state: finished as unknown as FreePlayState,
        finished: true,
        result: {
          outcome: win ? 'WIN' : 'LOSS',
          score: points,
          message: win
            ? `Rolled ${dice[0]} + ${dice[1]} = ${sum} — ${points} free-play points`
            : `Rolled ${dice[0]} + ${dice[1]} = ${sum} — no points`,
        },
      };
    }

    if (action.type === 'CONCEDE') {
      if (state.phase !== 'READY') {
        return {
          state: snapshotOf(state),
          finished: false,
          result:
            state.outcome === 'WIN'
              ? { outcome: 'WIN', score: state.score, message: 'Roll already finished' }
              : { outcome: 'LOSS', score: 0, message: 'Round already finished' },
        };
      }
      return {
        state: { ...state, phase: 'ROLLED', outcome: 'LOSS', score: 0 } as unknown as FreePlayState,
        finished: true,
        result: { outcome: 'LOSS', score: 0, message: 'Round abandoned before rolling' },
      };
    }

    throw new PlayerActionError(`Unsupported action "${action.type}"`);
  }

  snapshot(rawState: FreePlayState): FreePlayState {
    return snapshotOf(rawState as unknown as DiceState);
  }
}

function snapshotOf(state: DiceState): FreePlayState {
  return {
    target: state.target,
    phase: state.phase,
    dice: state.dice,
    score: state.score,
    outcome: state.outcome,
  } as unknown as FreePlayState;
}
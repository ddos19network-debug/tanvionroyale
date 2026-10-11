import { randomInt } from 'node:crypto';
import type {
  FreePlayActionResult,
  FreePlayAction,
  FreePlayGameEngine,
  FreePlayState,
} from './free-play-engine.interface';
import { PlayerActionError } from './engine-errors';

/**
 * Number Guess — free-play. Guess the secret 1..100 in as few attempts as
 * possible. Fewer attempts = more points (max 200, min 20). FREE PLAY ONLY.
 */
export interface NumberGuessState {
  secret: number;
  attempts: number;
  phase: 'READY' | 'GUESSED';
  lastGuess: number | null;
  hint: 'LOW' | 'HIGH' | 'CORRECT' | null;
  score: number;
  outcome: 'WIN' | 'LOSS' | null;
}

export class NumberGuessEngine implements FreePlayGameEngine {
  readonly meta = {
    slug: 'number-guess',
    title: 'Number Guess',
    description:
      'Free-play guessing game. Guess the secret number between 1 and 100 with hints. Fewer attempts earns more points — no real money.',
    kind: 'FREE_PLAY' as const,
    tagline: 'Free-play — no real money',
  };
  readonly allowedActions = ['GUESS', 'CONCEDE'];

  createInitialState(): FreePlayState {
    return {
      secret: randomInt(1, 101),
      attempts: 0,
      phase: 'READY',
      lastGuess: null,
      hint: null,
      score: 0,
      outcome: null,
    } as unknown as FreePlayState;
  }

  applyAction(rawState: FreePlayState, action: FreePlayAction): FreePlayActionResult {
    const state = rawState as unknown as NumberGuessState;
    if (!this.allowedActions.includes(action.type)) {
      throw new PlayerActionError(`Unsupported action "${action.type}" for number-guess`);
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
        state: { ...state, phase: 'GUESSED', outcome: 'LOSS', score: 0 } as unknown as FreePlayState,
        finished: true,
        result: { outcome: 'LOSS', score: 0, message: 'Round abandoned before guessing' },
      };
    }
    if (action.type !== 'GUESS') {
      throw new PlayerActionError(`Unsupported action "${action.type}"`);
    }
    if (state.phase !== 'READY') {
      throw new PlayerActionError('This round has already been resolved');
    }
    const raw = action.payload?.n;
    const n = typeof raw === 'number' ? Math.trunc(raw) : Number.parseInt(String(raw ?? ''), 10);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      throw new PlayerActionError('Guess must be a whole number between 1 and 100');
    }
    const attempts = state.attempts + 1;
    if (n === state.secret) {
      const score = Math.max(20, 220 - attempts * 20);
      const finished = {
        ...state,
        attempts,
        lastGuess: n,
        hint: 'CORRECT' as const,
        phase: 'GUESSED' as const,
        score,
        outcome: 'WIN' as const,
      };
      return {
        state: finished as unknown as FreePlayState,
        finished: true,
        result: {
          outcome: 'WIN',
          score,
          message: `Correct! The number was ${state.secret} in ${attempts} attempt${attempts === 1 ? '' : 's'} — ${score} pts`,
        },
      };
    }
    const hint: 'LOW' | 'HIGH' = n < state.secret ? 'LOW' : 'HIGH';
    const updated = {
      ...state,
      attempts,
      lastGuess: n,
      hint,
    };
    // Return unfinished so the player keeps guessing on the same session.
    return { state: updated as unknown as FreePlayState, finished: false };
  }

  snapshot(rawState: FreePlayState): FreePlayState {
    const state = rawState as unknown as NumberGuessState;
    return {
      attempts: state.attempts,
      phase: state.phase,
      lastGuess: state.lastGuess,
      hint: state.hint,
      score: state.score,
      outcome: state.outcome,
    } as unknown as FreePlayState;
  }
}
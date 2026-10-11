import { randomInt } from 'node:crypto';
import type {
  FreePlayActionResult,
  FreePlayAction,
  FreePlayGameEngine,
  FreePlayState,
} from './free-play-engine.interface';
import { PlayerActionError } from './engine-errors';

/**
 * Rock Paper Scissors — free-play. Pick ROCK/PAPER/SCISSORS; the server draws
 * a fair move. Win = 100 points, draw = 20. FREE PLAY ONLY.
 */
export type RpsMove = 'ROCK' | 'PAPER' | 'SCISSORS';

export interface RpsState {
  playerMove: RpsMove | null;
  phase: 'READY' | 'PLAYED';
  cpuMove: RpsMove | null;
  score: number;
  outcome: 'WIN' | 'LOSS' | 'DRAW' | null;
}

const MOVES: readonly RpsMove[] = ['ROCK', 'PAPER', 'SCISSORS'];

function beats(a: RpsMove, b: RpsMove): boolean {
  return (
    (a === 'ROCK' && b === 'SCISSORS') ||
    (a === 'PAPER' && b === 'ROCK') ||
    (a === 'SCISSORS' && b === 'PAPER')
  );
}

export class RpsEngine implements FreePlayGameEngine {
  readonly meta = {
    slug: 'rock-paper-scissors',
    title: 'Rock Paper Scissors',
    description:
      'Free-play Rock Paper Scissors against the computer — built by TANVIONROYALE, no real money.',
    kind: 'FREE_PLAY' as const,
    tagline: 'Free-play — no real money',
  };
  readonly allowedActions = ['PLAY', 'CONCEDE'];

  createInitialState(): FreePlayState {
    return {
      playerMove: null,
      phase: 'READY',
      cpuMove: null,
      score: 0,
      outcome: null,
    } as unknown as FreePlayState;
  }

  applyAction(rawState: FreePlayState, action: FreePlayAction): FreePlayActionResult {
    const state = rawState as unknown as RpsState;
    if (!this.allowedActions.includes(action.type)) {
      throw new PlayerActionError(`Unsupported action "${action.type}" for rock-paper-scissors`);
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
        state: { ...state, phase: 'PLAYED', outcome: 'LOSS', score: 0 } as unknown as FreePlayState,
        finished: true,
        result: { outcome: 'LOSS', score: 0, message: 'Round abandoned' },
      };
    }
    if (action.type !== 'PLAY') {
      throw new PlayerActionError(`Unsupported action "${action.type}"`);
    }
    if (state.phase !== 'READY') {
      throw new PlayerActionError('This round has already been played');
    }
    const playerMove = action.payload?.move;
    if (!MOVES.includes(playerMove as RpsMove)) {
      throw new PlayerActionError('Choose ROCK, PAPER or SCISSORS');
    }
    const cpuMove: RpsMove = MOVES[randomInt(0, MOVES.length)];
    let outcome: 'WIN' | 'LOSS' | 'DRAW';
    if (playerMove === cpuMove) outcome = 'DRAW';
    else outcome = beats(playerMove as RpsMove, cpuMove) ? 'WIN' : 'LOSS';
    const score = outcome === 'WIN' ? 100 : outcome === 'DRAW' ? 20 : 0;
    const finished = {
      ...state,
      playerMove: playerMove as RpsMove,
      cpuMove,
      phase: 'PLAYED' as const,
      score,
      outcome,
    };
    return {
      state: finished as unknown as FreePlayState,
      finished: true,
      result: {
        outcome: outcome === 'DRAW' ? 'LOSS' : outcome,
        score,
        message: `${playerMove} vs ${cpuMove} — ${outcome}${score ? ` (+${score} pts)` : ''}`,
      },
    };
  }

  snapshot(rawState: FreePlayState): FreePlayState {
    return rawState as unknown as FreePlayState;
  }
}
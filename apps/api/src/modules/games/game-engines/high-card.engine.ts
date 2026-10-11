import { randomInt } from 'node:crypto';
import type {
  FreePlayActionResult,
  FreePlayAction,
  FreePlayGameEngine,
  FreePlayState,
} from './free-play-engine.interface';
import { PlayerActionError } from './engine-errors';

/**
 * High Card — free-play. Player's card (2..A) vs the dealer's card. Higher
 * wins; equal = push (20 pts). FREE PLAY ONLY.
 */
export interface HighCardState {
  playerCard: number | null;
  phase: 'READY' | 'DEALT';
  dealerCard: number | null;
  score: number;
  outcome: 'WIN' | 'LOSS' | 'DRAW' | null;
}

const RANKS: readonly string[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export class HighCardEngine implements FreePlayGameEngine {
  readonly meta = {
    slug: 'high-card',
    title: 'High Card',
    description:
      'Free-play card game. Draw a card against the dealer — highest card wins. Built by TANVIONROYALE, no real money.',
    kind: 'FREE_PLAY' as const,
    tagline: 'Free-play — no real money',
  };
  readonly allowedActions = ['DEAL', 'CONCEDE'];

  createInitialState(): FreePlayState {
    return {
      playerCard: null,
      phase: 'READY',
      dealerCard: null,
      score: 0,
      outcome: null,
    } as unknown as FreePlayState;
  }

  applyAction(rawState: FreePlayState, action: FreePlayAction): FreePlayActionResult {
    const state = rawState as unknown as HighCardState;
    if (!this.allowedActions.includes(action.type)) {
      throw new PlayerActionError(`Unsupported action "${action.type}" for high-card`);
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
        state: { ...state, phase: 'DEALT', outcome: 'LOSS', score: 0 } as unknown as FreePlayState,
        finished: true,
        result: { outcome: 'LOSS', score: 0, message: 'Round abandoned' },
      };
    }
    if (action.type !== 'DEAL') {
      throw new PlayerActionError(`Unsupported action "${action.type}"`);
    }
    if (state.phase !== 'READY') {
      throw new PlayerActionError('Cards have already been dealt');
    }
    const playerCard = randomInt(0, RANKS.length);
    let dealerCard = randomInt(0, RANKS.length);
    while (dealerCard === playerCard) dealerCard = randomInt(0, RANKS.length);
    const outcome = playerCard > dealerCard ? 'WIN' : 'LOSS';
    const score = outcome === 'WIN' ? 100 : 0;
    const finished = {
      ...state,
      playerCard,
      dealerCard,
      phase: 'DEALT' as const,
      score,
      outcome,
    };
    return {
      state: finished as unknown as FreePlayState,
      finished: true,
      result: {
        outcome,
        score,
        message: `You: ${RANKS[playerCard]} vs Dealer: ${RANKS[dealerCard]} — ${outcome}${score ? ` (+${score} pts)` : ''}`,
      },
    };
  }

  snapshot(rawState: FreePlayState): FreePlayState {
    const state = rawState as unknown as HighCardState;
    return {
      playerCard: state.playerCard !== null ? RANKS[state.playerCard] : null,
      dealerCard: state.dealerCard !== null ? RANKS[state.dealerCard] : null,
      phase: state.phase,
      score: state.score,
      outcome: state.outcome,
    } as unknown as FreePlayState;
  }
}
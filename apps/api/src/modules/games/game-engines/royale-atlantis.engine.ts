import { randomInt } from 'node:crypto';
import type { FreePlayGameEngine, FreePlayActionResult, FreePlayState, FreePlayRoundResult } from './free-play-engine.interface';
import { PlayerActionError } from './engine-errors';
import { createGrid, evaluateClusters, dropAndRefill, processCascade } from './royale-atlantis.math';
import { ATLANTIS_SLUG, ATLANTIS_CONFIG } from './royale-atlantis.types';


function seedSource(): () => number {
  const state: number[] = [];
  return () => {
    if (state.length === 0) {
      state.push(randomInt(0, 255));
      state.push(randomInt(0, 255));
    }
    let h = 14695981039346656037;
    for (const b of state) {
      h ^= b;
      h = Math.imul(h, 1597334677);
    }
    const x = randomInt(0, 255);
    state.push(x);
    return (h >>> 0) / 4294967296;
  };
}

export class RoyaleAtlantisEngine {
  public readonly meta = {
    slug: ATLANTIS_SLUG,
    title: 'Royale Atlantis',
    description: 'Lost Ocean Kingdom cascading cluster-pay slot.',
    kind: 'FREE_PLAY' as const,
    tagline: 'Free-play · Ancient water kingdom',
  };

  public readonly allowedActions = ['SPIN'] as const;

  private readonly random: () => number;

  constructor() {
    this.random = seedSource();
  }

  createInitialState(): Record<string, unknown> {
    return {
      phase: 'READY',
      grid: null,
      totalBet: 0,
      totalWin: 0,
      remainingFreeSpins: 0,
      bonusEvents: [],
      cascadeSteps: [],
      featureEvents: [],
    };
  }

  applyAction(state: Record<string, unknown>, action: { type: string; payload?: Record<string, unknown> }): FreePlayActionResult {
    if (action.type !== 'SPIN') throw new PlayerActionError(`Unsupported action "${action.type}" for Royale Atlantis`);

    const grid = createGrid();
    const cascadeSteps = processCascade(grid);
    for (const step of cascadeSteps) step.winningClusters = step.winningClusters.filter((cl) => cl.symbolCount >= ATLANTIS_CONFIG.minClusterSize);

    const totalWin = cascadeSteps.reduce((sum, s) => sum + s.stepWin, 0);
    const message = totalWin > 0 ? `Win ${totalWin} ocean coins` : 'No win this tide';

    const stateRes: Record<string, unknown> = {
      phase: 'SPUN',
      grid,
      totalBet: 1,
      totalWin,
      remainingFreeSpins: 0,
      bonusEvents: [],
      cascadeSteps,
      featureEvents: [],
    };

    const result: FreePlayRoundResult = {
      outcome: totalWin > 0 ? 'WIN' : 'LOSS',
      score: totalWin,
      message,
    };

    return { state: stateRes, finished: true, result };
  }

  snapshot(state: Record<string, unknown>): Record<string, unknown> {
    return {
      phase: state.phase,
      grid: state.grid,
      totalBet: state.totalBet,
      totalWin: state.totalWin,
      remainingFreeSpins: state.remainingFreeSpins,
      bonusEvents: state.bonusEvents,
      cascadeSteps: state.cascadeSteps,
      featureEvents: state.featureEvents,
    };
  }
}

export const royaleAtlantisEngine = new RoyaleAtlantisEngine();

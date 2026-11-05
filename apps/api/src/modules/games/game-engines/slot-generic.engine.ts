import { randomInt } from 'node:crypto';
import type { FreePlayActionResult, FreePlayAction, FreePlayGameEngine, FreePlayState } from './free-play-engine.interface';
import { PlayerActionError } from './engine-errors';

export interface SlotConfig {
  slug: string;
  title: string;
  description: string;
  tagline: string;
  symbols: readonly string[];
  reels: number;
  rows: number;
}

export function createSlotEngine(cfg: SlotConfig): FreePlayGameEngine {
  const symbols = cfg.symbols;
  return {
    meta: { slug: cfg.slug, title: cfg.title, description: cfg.description, kind: 'FREE_PLAY' as const, tagline: cfg.tagline },
    allowedActions: ['SPIN'] as readonly string[],
    createInitialState() {
      return { phase: 'READY', grid: null, score: 0, outcome: null, message: null } as unknown as FreePlayState;
    },
    applyAction(rawState: FreePlayState, action: FreePlayAction): FreePlayActionResult {
      const state = rawState as any;
      if (!this.allowedActions.includes(action.type)) throw new PlayerActionError(`Unsupported action "${action.type}"`);
      if (action.type !== 'SPIN') throw new PlayerActionError('Unsupported');
      const grid: string[][] = [];
      for (let r = 0; r < cfg.rows; r++) {
        const row: string[] = [];
        for (let c = 0; c < cfg.reels; c++) row.push(symbols[randomInt(0, symbols.length)]);
        grid.push(row);
      }
      let win = 0;
      for (const row of grid) {
        if (row.every((s) => s === row[0])) win += 50;
      }
      const score = win;
      const outcome = (win > 0 ? 'WIN' : 'LOSS') as 'WIN' | 'LOSS';
      const next = { phase: 'SPUN', grid, score, outcome, message: win > 0 ? `Win ${win} points` : 'No win' };
      return { state: next as unknown as FreePlayState, finished: true, result: { outcome, score, message: next.message } };
    },
    snapshot(rawState: FreePlayState): Record<string, unknown> {
      return rawState as unknown as Record<string, unknown>;
    },
  };
}

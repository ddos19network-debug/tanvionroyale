import { CrashEngine } from './crash.engine';
import { LightningDiceEngine } from './lightning-dice.engine';
import { CoinFlipEngine } from './coin-flip.engine';
import { HigherLowerEngine } from './higher-lower.engine';
import { NumberGuessEngine } from './number-guess.engine';
import { RpsEngine } from './rps.engine';
import { WheelSpinEngine } from './wheel-spin.engine';
import { DiceRollEngine } from './dice-roll.engine';
import { HighCardEngine } from './high-card.engine';
import { ColorPredictionEngine } from './color-prediction.engine';
import { LuckyNumberEngine } from './lucky-number.engine';
import { SLOT_ENGINES } from './slot-engines.config';
import type { FreePlayGameEngine, PublicFreePlayGame } from './free-play-engine.interface';

/**
 * Registry of internally developed FREE-PLAY game engines.
 *
 * Only engines listed here are playable. Demo presentation tiles and
 * third-party games (future provider launches) live outside this registry —
 * this is deliberately the single source of truth for free-play games.
 */
const ENGINES: readonly FreePlayGameEngine[] = [
  new CrashEngine(),
  new LightningDiceEngine(),
  new CoinFlipEngine(),
  new HigherLowerEngine(),
  new NumberGuessEngine(),
  new RpsEngine(),
  new WheelSpinEngine(),
  new DiceRollEngine(),
  new HighCardEngine(),
  new ColorPredictionEngine(),
  new LuckyNumberEngine(),
  ...SLOT_ENGINES,
];

const BY_SLUG: ReadonlyMap<string, FreePlayGameEngine> = new Map(
  ENGINES.map((engine) => [engine.meta.slug, engine]),
);

export function getFreePlayEngine(slug: string): FreePlayGameEngine | null {
  return BY_SLUG.get(slug) ?? null;
}

export function listFreePlayEngines(): FreePlayGameEngine[] {
  return [...ENGINES];
}

export function listFreePlayGameMeta(): PublicFreePlayGame[] {
  return ENGINES.map((engine) => engine.meta);
}

export function getFreePlayGameMeta(slug: string): PublicFreePlayGame | null {
  return BY_SLUG.get(slug)?.meta ?? null;
}
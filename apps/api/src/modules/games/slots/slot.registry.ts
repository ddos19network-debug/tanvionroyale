/**
 * Slot registry — slug -> config + hooks wiring for all 10 games.
 */

import type { SlotGameConfig } from './core/types';
import type { GameHooks } from './core/round';
import { getHooksForSlug } from './core/features/game-hooks';

import { PHARAOH_CONFIG, PHARAOH_SLUG } from './games/pharaoh.config';
import { ATLANTIS_CONFIG, ATLANTIS_SLUG } from './games/atlantis.config';
import { NEON_CONFIG, NEON_SLUG } from './games/neon-cyber-rush.config';
import { MYSTIC_CONFIG, MYSTIC_SLUG } from './games/mystic-forest.config';
import { SAMURAI_CONFIG, SAMURAI_SLUG } from './games/samurai-fortune.config';
import { COSMIC_CONFIG, COSMIC_SLUG } from './games/cosmic-odyssey.config';
import { DRAGONS_CONFIG, DRAGONS_SLUG } from './games/dragons-kingdom.config';
import { TROPICAL_CONFIG, TROPICAL_SLUG } from './games/tropical-paradise.config';
import { STEAMPUNK_CONFIG, STEAMPUNK_SLUG } from './games/steampunk-revolution.config';
import { FROZEN_CONFIG, FROZEN_SLUG } from './games/frozen-empire.config';
import type { SlotConfigView } from '@tanvion-royale/types';

export interface RegisteredSlot {
  config: SlotGameConfig;
  hooks: GameHooks;
}

const REGISTRY = new Map<string, RegisteredSlot>();

function register(config: SlotGameConfig) {
  REGISTRY.set(config.slug, {
    config,
    hooks: getHooksForSlug(config.slug),
  });
}

register(PHARAOH_CONFIG);
register(ATLANTIS_CONFIG);
register(NEON_CONFIG);
register(MYSTIC_CONFIG);
register(SAMURAI_CONFIG);
register(COSMIC_CONFIG);
register(DRAGONS_CONFIG);
register(TROPICAL_CONFIG);
register(STEAMPUNK_CONFIG);
register(FROZEN_CONFIG);

export function getSlot(slug: string): RegisteredSlot | null {
  return REGISTRY.get(slug) ?? null;
}

export function listSlotSlugs(): string[] {
  return [...REGISTRY.keys()];
}

export function slotToPublicConfigView(config: SlotGameConfig): SlotConfigView {
  const paytable = Object.entries(config.paytableBp).map(([symbolId, payBp]) => ({
    symbolId,
    payBp,
  }));

  const features = Object.entries(config.features).map(([id]) => ({
    id,
    name: id.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()),
    description: `Feature: ${id}`,
  }));

  return {
    gameSlug: config.slug,
    title: config.title,
    winModel: config.winModel,
    reels: config.reels,
    rows: config.rows,
    lineCount: config.paylines?.length,
    symbols: config.symbols.map((s) => ({
      id: s.id,
      name: s.name,
      tier: s.tier,
      asset: s.asset,
      glyph: s.glyph,
    })),
    paytable,
    stakeLevels: config.stakeLevels,
    features,
    maxWinBp: config.maxWinBp,
    freeSpins: {
      triggerCount: config.freeSpins.triggerCount,
      awarded: config.freeSpins.awarded,
      retriggerCount: config.freeSpins.retriggerCount,
      retriggerAwarded: config.freeSpins.retriggerAwarded,
    },
  };
}

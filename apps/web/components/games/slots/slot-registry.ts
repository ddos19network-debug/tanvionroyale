import { SLOT_THEMES, type SlotTheme } from './slot-themes';

export const ROYALE_SLOT_SLUGS = [
  'royale-pharaoh',
  'royale-atlantis',
  'neon-cyber-rush',
  'mystic-forest',
  'samurai-fortune',
  'cosmic-odyssey',
  'dragons-kingdom',
  'tropical-paradise',
  'steampunk-revolution',
  'frozen-empire',
] as const;

export type RoyaleSlotSlug = (typeof ROYALE_SLOT_SLUGS)[number];

export function isRoyaleSlotSlug(slug: string): slug is RoyaleSlotSlug {
  return ROYALE_SLOT_SLUGS.includes(slug as RoyaleSlotSlug);
}

export function getSlotMetadata(slug: string): SlotTheme | null {
  return SLOT_THEMES[slug] ?? null;
}

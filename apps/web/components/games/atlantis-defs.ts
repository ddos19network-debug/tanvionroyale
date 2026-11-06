export type AtlasSymbolId =
  | 'ocean_king'
  | 'mermaid_queen'
  | 'golden_trident'
  | 'royal_pearl'
  | 'atlantis_palace'
  | 'sea_dragon'
  | 'dolphin'
  | 'sea_turtle'
  | 'seahorse'
  | 'magic_jellyfish'
  | 'starfish'
  | 'octopus'
  | 'royal_crab'
  | 'coral_reef'
  | 'royal_shell'
  | 'ocean_coin'
  | 'ocean_crystal'
  | 'tidal_wild'
  | 'atlantis_gate'
  | 'treasure_chest'
  | 'kraken_emblem';

export interface AtlasSymbolMeta {
  id: AtlasSymbolId;
  name: string;
  category: string;
  asset: string;
  color: string;
}

export const ATLANTIS_BOARD_ROWS = 7;
export const ATLANTIS_BOARD_COLS = 7;

export const SYMBOL_META: AtlasSymbolMeta[] = [
  { id: 'ocean_king', name: 'Ocean King', category: 'Premium', asset: '/assets/image/royale-atlantis/symbols/01_ocean_king.png', color: 'text-cyan-300' },
  { id: 'mermaid_queen', name: 'Mermaid Queen', category: 'Premium', asset: '/assets/image/royale-atlantis/symbols/02_mermaid_queen.png', color: 'text-amber-300' },
  { id: 'golden_trident', name: 'Golden Trident', category: 'Premium', asset: '/assets/image/royale-atlantis/symbols/03_golden_trident.png', color: 'text-amber-400' },
  { id: 'royal_pearl', name: 'Royal Pearl', category: 'Premium', asset: '/assets/image/royale-atlantis/symbols/04_royal_pearl.png', color: 'text-amber-200' },
  { id: 'atlantis_palace', name: 'Atlantis Palace', category: 'Premium', asset: '/assets/image/royale-atlantis/symbols/05_atlantis_palace.png', color: 'text-cyan-200' },
  { id: 'sea_dragon', name: 'Sea Dragon', category: 'Premium', asset: '/assets/image/royale-atlantis/symbols/06_sea_dragon.png', color: 'text-amber-400' },
  { id: 'dolphin', name: 'Dolphin', category: 'Regular', asset: '/assets/image/royale-atlantis/symbols/07_dolphin.png', color: 'text-cyan-200' },
  { id: 'sea_turtle', name: 'Sea Turtle', category: 'Regular', asset: '/assets/image/royale-atlantis/symbols/08_sea_turtle.png', color: 'text-cyan-300' },
  { id: 'seahorse', name: 'Seahorse', category: 'Regular', asset: '/assets/image/royale-atlantis/symbols/09_seahorse.png', color: 'text-emerald-300' },
  { id: 'magic_jellyfish', name: 'Magic Jellyfish', category: 'Regular', asset: '/assets/image/royale-atlantis/symbols/10_magic_jellyfish.png', color: 'text-fuchsia-300' },
  { id: 'starfish', name: 'Starfish', category: 'Regular', asset: '/assets/image/royale-atlantis/symbols/11_starfish.png', color: 'text-yellow-300' },
  { id: 'octopus', name: 'Octopus', category: 'Regular', asset: '/assets/image/royale-atlantis/symbols/12_octopus.png', color: 'text-teal-300' },
  { id: 'royal_crab', name: 'Royal Crab', category: 'Regular', asset: '/assets/image/royale-atlantis/symbols/13_royal_crab.png', color: 'text-amber-300' },
  { id: 'coral_reef', name: 'Coral Reef', category: 'Regular', asset: '/assets/image/royale-atlantis/symbols/14_coral_reef.png', color: 'text-rose-300' },
  { id: 'royal_shell', name: 'Royal Shell', category: 'Regular', asset: '/assets/image/royale-atlantis/symbols/15_royal_shell.png', color: 'text-white' },
  { id: 'ocean_coin', name: 'Ocean Coin', category: 'Regular', asset: '/assets/image/royale-atlantis/symbols/16_ocean_coin.png', color: 'text-amber-200' },
  { id: 'ocean_crystal', name: 'Ocean Crystal', category: 'Regular', asset: '/assets/image/royale-atlantis/symbols/17_ocean_crystal.png', color: 'text-cyan-400' },
  { id: 'tidal_wild', name: 'Tidal Wild', category: 'Wild', asset: '/assets/image/royale-atlantis/symbols/18_tidal_wild.png', color: 'text-yellow-300' },
  { id: 'atlantis_gate', name: 'Atlantis Gate', category: 'Scatter', asset: '/assets/image/royale-atlantis/symbols/19_atlantis_gate_scatter.png', color: 'text-cyan-400' },
  { id: 'treasure_chest', name: 'Treasure Chest', category: 'Bonus', asset: '/assets/image/royale-atlantis/symbols/20_treasure_chest.png', color: 'text-yellow-400' },
  { id: 'kraken_emblem', name: 'Kraken Emblem', category: 'Bonus', asset: '/assets/image/royale-atlantis/symbols/21_kraken_emblem.png', color: 'text-fuchsia-400' },
];

export function symbolMetaById(id: AtlasSymbolId): AtlasSymbolMeta | undefined {
  return SYMBOL_META.find((s) => s.id === id);
}

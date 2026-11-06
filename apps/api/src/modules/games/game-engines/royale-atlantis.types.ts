/** Royal Atlantis shared type constants.

 * The engine module owns the authoritative game math. Frontend may mirror
 * these definitions for UI rendering, but every result must be computed
 * and validated server-side.
 */
export const ATLANTIS_SLUG = "royale-atlantis";
export const ATLANTIS_BOARD_ROWS = 7;
export const ATLANTIS_BOARD_COLS = 7;
export const ATLANTIS_MAX_CASCADE = 12;

export type AtlantisSymbolId =
  | "ocean_king"
  | "mermaid_queen"
  | "golden_trident"
  | "royal_pearl"
  | "atlantis_palace"
  | "sea_dragon"
  | "dolphin"
  | "sea_turtle"
  | "seahorse"
  | "magic_jellyfish"
  | "starfish"
  | "octopus"
  | "royal_crab"
  | "coral_reef"
  | "royal_shell"
  | "ocean_coin"
  | "ocean_crystal"
  | "tidal_wild"
  | "atlantis_gate"
  | "treasure_chest"
  | "kraken_emblem";

export type AtlantisSymbolCategory =
  | "premium"
  | "regular"
  | "wild"
  | "scatter"
  | "bonus";

export interface AtlantisSymbolDefinition {
  id: AtlantisSymbolId;
  name: string;
  category: AtlantisSymbolCategory;
}

export const ATLANTIS_SYMBOLS: AtlantisSymbolDefinition[] = [
  { id: "ocean_king", name: "Ocean King", category: "premium" },
  { id: "mermaid_queen", name: "Mermaid Queen", category: "premium" },
  { id: "golden_trident", name: "Golden Trident", category: "premium" },
  { id: "royal_pearl", name: "Royal Pearl", category: "premium" },
  { id: "atlantis_palace", name: "Atlantis Palace", category: "premium" },
  { id: "sea_dragon", name: "Sea Dragon", category: "premium" },
  { id: "dolphin", name: "Dolphin", category: "regular" },
  { id: "sea_turtle", name: "Sea Turtle", category: "regular" },
  { id: "seahorse", name: "Seahorse", category: "regular" },
  { id: "magic_jellyfish", name: "Magic Jellyfish", category: "regular" },
  { id: "starfish", name: "Starfish", category: "regular" },
  { id: "octopus", name: "Octopus", category: "regular" },
  { id: "royal_crab", name: "Royal Crab", category: "regular" },
  { id: "coral_reef", name: "Coral Reef", category: "regular" },
  { id: "royal_shell", name: "Royal Shell", category: "regular" },
  { id: "ocean_coin", name: "Ocean Coin", category: "regular" },
  { id: "ocean_crystal", name: "Ocean Crystal", category: "regular" },
  { id: "tidal_wild", name: "Tidal Wild", category: "wild" },
  { id: "atlantis_gate", name: "Atlantis Gate", category: "scatter" },
  { id: "treasure_chest", name: "Treasure Chest", category: "bonus" },
  { id: "kraken_emblem", name: "Kraken's Emblem", category: "bonus" },
];

export const ATLANTIS_SYMBOL_WEIGHTS: Record<AtlantisSymbolId, number> = {
  ocean_king: 4,
  mermaid_queen: 5,
  golden_trident: 6,
  royal_pearl: 6,
  atlantis_palace: 6,
  sea_dragon: 6,
  dolphin: 28,
  sea_turtle: 28,
  seahorse: 28,
  magic_jellyfish: 24,
  starfish: 26,
  octopus: 22,
  royal_crab: 20,
  coral_reef: 24,
  royal_shell: 20,
  ocean_coin: 26,
  ocean_crystal: 18,
  tidal_wild: 3,
  atlantis_gate: 6,
  treasure_chest: 2,
  kraken_emblem: 1,
};

export const ATLANTIS_CLUSTER_PAYTABLE: Record<AtlantisSymbolId, number> = {
  ocean_king: 12,
  mermaid_queen: 10,
  golden_trident: 8,
  royal_pearl: 8,
  atlantis_palace: 9,
  sea_dragon: 9,
  dolphin: 2,
  sea_turtle: 2,
  seahorse: 2,
  magic_jellyfish: 3,
  starfish: 3,
  octopus: 3,
  royal_crab: 2,
  coral_reef: 3,
  royal_shell: 2,
  ocean_coin: 3,
  ocean_crystal: 3,
  tidal_wild: 1,
  atlantis_gate: 1,
  treasure_chest: 1,
  kraken_emblem: 1,
};

export const ATLANTIS_CONFIG = {
  slug: "royale-atlantis",
  title: "Royale Atlantis",
  description: "Lost Ocean Kingdom cascading cluster-pay slot.",
  tagline: "Free-play · Ancient water kingdom",
  symbolIds: ATLANTIS_SYMBOLS.map((s) => s.id),
  boardRows: ATLANTIS_BOARD_ROWS,
  boardColumns: ATLANTIS_BOARD_COLS,
  minClusterSize: 3,
  maxCascadeCount: ATLANTIS_MAX_CASCADE,
  featureEnabled: {
    wildSubstitutionEnabled: true,
    scatterTriggerCount: 6,
    freeSpinAwards: { 6: 3 },
    tidalWaveEnabled: true,
    oceanExpansionEnabled: true,
    treasureBonusEnabled: true,
    krakenBonusEnabled: true,
  },
} as const;

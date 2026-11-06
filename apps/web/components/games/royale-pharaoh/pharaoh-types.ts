export type PharaohSymbolId =
  | "pharaoh-mask"
  | "anubis"
  | "cleopatra"
  | "golden-scarab"
  | "sarcophagus"
  | "ankh"
  | "eye-of-horus"
  | "golden-coin"
  | "papyrus"
  | "wild"
  | "scatter";

export interface PharaohSymbol {
  id: PharaohSymbolId;
  name: string;
  image: string;
  type: "premium" | "regular" | "wild" | "scatter";
}

export const PHARAOH_SYMBOLS: PharaohSymbol[] = [
  { id: "pharaoh-mask", name: "Pharaoh Mask", image: "/games/royale-pharaoh/symbols/pharaoh-mask.png", type: "premium" },
  { id: "anubis", name: "Anubis", image: "/games/royale-pharaoh/symbols/anubis.png", type: "premium" },
  { id: "cleopatra", name: "Cleopatra", image: "/games/royale-pharaoh/symbols/cleopatra.png", type: "premium" },
  { id: "golden-scarab", name: "Golden Scarab", image: "/games/royale-pharaoh/symbols/golden-scarab.png", type: "premium" },
  { id: "sarcophagus", name: "Royal Sarcophagus", image: "/games/royale-pharaoh/symbols/sarcophagus.png", type: "premium" },
  { id: "ankh", name: "Ankh", image: "/games/royale-pharaoh/symbols/ankh.png", type: "regular" },
  { id: "eye-of-horus", name: "Eye of Horus", image: "/games/royale-pharaoh/symbols/eye-of-horus.png", type: "regular" },
  { id: "golden-coin", name: "Golden Coin", image: "/games/royale-pharaoh/symbols/golden-coin.png", type: "regular" },
  { id: "papyrus", name: "Ancient Papyrus", image: "/games/royale-pharaoh/symbols/papyrus.png", type: "regular" },
  { id: "wild", name: "Ancient Wild", image: "/games/royale-pharaoh/symbols/wild.png", type: "wild" },
  { id: "scatter", name: "Golden Scatter", image: "/games/royale-pharaoh/symbols/scatter.png", type: "scatter" },
];

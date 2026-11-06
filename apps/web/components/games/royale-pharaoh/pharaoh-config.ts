export const ROYALE_PHARAOH_CONFIG = {
  id: "royale-pharaoh",
  slug: "royale-pharaoh",
  name: "ROYALE PHARAOH",
  subtitle: "CURSE OF THE GOLDEN KINGDOM",

  reels: 5,
  rows: 4,

  theme: {
    background: "bg-slate-950",
    frame: "border-amber-500",
    accent: "text-amber-400",
    secondary: "text-cyan-300",
  },

  features: {
    cascadingReels: true,
    freeSpins: true,
    goldenTombBonus: true,
    pharaohCurse: true,
    wildSymbol: true,
    scatterSymbol: true,
  },

  symbols: [
    "pharaoh-mask",
    "anubis",
    "cleopatra",
    "golden-scarab",
    "sarcophagus",
    "ankh",
    "eye-of-horus",
    "golden-coin",
    "papyrus",
    "wild",
    "scatter",
  ],
} as const;

export interface SlotTheme {
  slug: string;
  title: string;
  tagline: string;
  bgGradient: string;
  frameBorderColor: string;
  frameGlowColor: string;
  accentColor: string;
  spinButtonBg: string;
}

export const SLOT_THEMES: Record<string, SlotTheme> = {
  'royale-pharaoh': {
    slug: 'royale-pharaoh',
    title: 'ROYALE PHARAOH',
    tagline: 'Curse of the Golden Kingdom · Free-play',
    bgGradient: 'bg-gradient-to-b from-amber-950 via-yellow-950 to-slate-950',
    frameBorderColor: 'border-amber-400/70',
    frameGlowColor: 'rgba(251,191,36,0.25)',
    accentColor: 'text-amber-300',
    spinButtonBg: 'bg-amber-400 hover:bg-amber-300 text-slate-950',
  },
  'royale-atlantis': {
    slug: 'royale-atlantis',
    title: 'ROYALE ATLANTIS',
    tagline: 'The Lost Ocean Kingdom · Free-play',
    bgGradient: 'bg-gradient-to-b from-cyan-950 via-blue-950 to-slate-950',
    frameBorderColor: 'border-cyan-400/70',
    frameGlowColor: 'rgba(34,211,238,0.25)',
    accentColor: 'text-cyan-300',
    spinButtonBg: 'bg-cyan-400 hover:bg-cyan-300 text-slate-950',
  },
  'neon-cyber-rush': {
    slug: 'neon-cyber-rush',
    title: 'ROYALE NEON CYBER RUSH',
    tagline: 'Futuristic Cyberpunk Metropolis · Free-play',
    bgGradient: 'bg-gradient-to-b from-purple-950 via-fuchsia-950 to-slate-950',
    frameBorderColor: 'border-fuchsia-400/70',
    frameGlowColor: 'rgba(232,121,249,0.25)',
    accentColor: 'text-fuchsia-300',
    spinButtonBg: 'bg-fuchsia-500 hover:bg-fuchsia-400 text-white',
  },
  'mystic-forest': {
    slug: 'mystic-forest',
    title: 'ROYALE MYSTIC FOREST',
    tagline: 'Enchanted Magical Woodland · Free-play',
    bgGradient: 'bg-gradient-to-b from-emerald-950 via-green-950 to-slate-950',
    frameBorderColor: 'border-emerald-400/70',
    frameGlowColor: 'rgba(52,211,153,0.25)',
    accentColor: 'text-emerald-300',
    spinButtonBg: 'bg-emerald-400 hover:bg-emerald-300 text-slate-950',
  },
  'samurai-fortune': {
    slug: 'samurai-fortune',
    title: 'ROYALE SAMURAI FORTUNE',
    tagline: 'Honor of the Katana Empire · Free-play',
    bgGradient: 'bg-gradient-to-b from-rose-950 via-red-950 to-slate-950',
    frameBorderColor: 'border-rose-400/70',
    frameGlowColor: 'rgba(251,113,133,0.25)',
    accentColor: 'text-rose-300',
    spinButtonBg: 'bg-rose-500 hover:bg-rose-400 text-white',
  },
  'cosmic-odyssey': {
    slug: 'cosmic-odyssey',
    title: 'ROYALE COSMIC ODYSSEY',
    tagline: 'Intergalactic Star Adventure · Free-play',
    bgGradient: 'bg-gradient-to-b from-indigo-950 via-purple-950 to-slate-950',
    frameBorderColor: 'border-indigo-400/70',
    frameGlowColor: 'rgba(129,140,248,0.25)',
    accentColor: 'text-indigo-300',
    spinButtonBg: 'bg-indigo-400 hover:bg-indigo-300 text-slate-950',
  },
  'dragons-kingdom': {
    slug: 'dragons-kingdom',
    title: "ROYALE DRAGON'S KINGDOM",
    tagline: 'Medieval Fire & Castle Fortress · Free-play',
    bgGradient: 'bg-gradient-to-b from-red-950 via-orange-950 to-slate-950',
    frameBorderColor: 'border-orange-500/70',
    frameGlowColor: 'rgba(249,115,22,0.25)',
    accentColor: 'text-orange-400',
    spinButtonBg: 'bg-orange-500 hover:bg-orange-400 text-slate-950',
  },
  'tropical-paradise': {
    slug: 'tropical-paradise',
    title: 'ROYALE TROPICAL PARADISE',
    tagline: 'Island Oasis & Exotic Wildlife · Free-play',
    bgGradient: 'bg-gradient-to-b from-amber-950 via-orange-950 to-slate-950',
    frameBorderColor: 'border-amber-400/70',
    frameGlowColor: 'rgba(251,191,36,0.25)',
    accentColor: 'text-amber-300',
    spinButtonBg: 'bg-amber-400 hover:bg-amber-300 text-slate-950',
  },
  'steampunk-revolution': {
    slug: 'steampunk-revolution',
    title: 'ROYALE STEAMPUNK REVOLUTION',
    tagline: 'Steam Engines, Brass & Gears · Free-play',
    bgGradient: 'bg-gradient-to-b from-stone-950 via-amber-950 to-slate-950',
    frameBorderColor: 'border-amber-600/70',
    frameGlowColor: 'rgba(217,119,6,0.25)',
    accentColor: 'text-amber-200',
    spinButtonBg: 'bg-amber-600 hover:bg-amber-500 text-white',
  },
  'frozen-empire': {
    slug: 'frozen-empire',
    title: 'ROYALE FROZEN EMPIRE',
    tagline: 'Ice Queen Fortress & Glacial Frost · Free-play',
    bgGradient: 'bg-gradient-to-b from-sky-950 via-blue-950 to-slate-950',
    frameBorderColor: 'border-sky-300/70',
    frameGlowColor: 'rgba(125,211,252,0.25)',
    accentColor: 'text-sky-200',
    spinButtonBg: 'bg-sky-400 hover:bg-sky-300 text-slate-950',
  },
};

export function getSlotTheme(slug: string): SlotTheme {
  return (
    SLOT_THEMES[slug] ?? {
      slug,
      title: slug.toUpperCase(),
      tagline: 'Royale Play · Free-play',
      bgGradient: 'bg-gradient-to-b from-slate-900 to-black',
      frameBorderColor: 'border-slate-400',
      frameGlowColor: 'rgba(255,255,255,0.1)',
      accentColor: 'text-white',
      spinButtonBg: 'bg-white hover:bg-slate-200 text-slate-950',
    }
  );
}

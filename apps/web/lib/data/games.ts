/**
 * TANVIONROYALE — game catalog.
 *
 * Architecture separation (three distinct layers, never mixed):
 *   1. `demo`       — presentation-only tiles (this file). Placeholder artwork,
 *                     no playable game behind them → they route to the
 *                     /games/demo-preview explainer.
 *   2. `freeplay`   — INTERNALLY developed, genuinely playable free-play games
 *                     (see apps/api/src/modules/games + /games/play/[slug]).
 *                     Real engine, real sessions/results (free-play points
 *                     only — never money).
 *   3. `third-party`— reserved for future licensed third-party game launches
 *                     (no provider is integrated yet; never fabricated).
 *
 * Server-owned data (wallet, bets, user, free-play results) is always fetched
 * through lib/api clients, never from here.
 */

export type GameKind =
  | 'demo'
  | 'freeplay'
  | 'multiplayer'
  | 'partner'
  | 'third-party';

export interface Game {
  id: string;
  title: string;
  provider: string;
  category: string;
  /** CSS gradient class used as an original placeholder artwork tile. */
  image: string;
  badge?: 'HOT' | 'NEW' | 'LIVE';
  featured?: boolean;
  /** Demo tile, internally developed free-play game, or future third-party game. */
  kind: GameKind;
  /** Free-play engine slug (only for kind === 'freeplay'). */
  slug?: string;
  /** Custom logo or cover image artwork URL. */
  coverImage?: string;
}

export interface GameSectionData {
  title: string;
  subtitle?: string;
  games: Game[];
}

const G = (a: number, b: number): string => `from-[hsl(${a},70%,45%)] to-[hsl(${b},80%,30%)]`;

function makeGame(
  id: number,
  title: string,
  provider: string,
  category: string,
  hue: number,
  badge?: Game['badge'],
  featured?: boolean,
  kind: GameKind = 'demo',
  slug?: string,
  coverImage?: string,
): Game {
  return {
    id: `game-${id}`,
    title,
    provider,
    category,
    image: G(hue, hue + 40),
    badge,
    featured,
    kind,
    slug,
    coverImage,
  };
}

export const games: Game[] = [
  makeGame(1, 'Teal Fortune', 'Provider One', 'Slots', 168, 'HOT', true),
  makeGame(2, 'Crystal Mines', 'Provider Two', 'Arcade', 200, 'NEW'),
  makeGame(3, 'Royale Fly', 'TANVIONROYALE', 'Crash', 190, 'LIVE', true, 'freeplay', 'royale-fly', '/assets/image/royale-fly-theme.png'),
  makeGame(4, 'Royal Aces', 'Provider One', 'Table Games', 260),
  makeGame(5, 'Neon Spin', 'Provider Four', 'Slots', 300, 'HOT'),
  makeGame(6, 'Jade Temple', 'Provider Five', 'Slots', 150, 'NEW', true),
  makeGame(7, 'Lightning Dice', 'Provider Two', 'Live Games', 40),
  makeGame(8, 'Fruit Nova', 'Provider Six', 'Mini Games', 20, 'HOT'),
  makeGame(9, 'Ocean Gold', 'Provider Three', 'Arcade', 210),
  makeGame(10, 'Rocket Rush', 'Provider Four', 'Crash', 15, 'LIVE'),
  makeGame(11, 'Emerald Blitz', 'Provider Five', 'Slots', 160),
  makeGame(12, 'Vegas Nights', 'Provider One', 'Table Games', 280, 'NEW'),
  makeGame(13, 'Mega Wheel', 'Provider Two', 'Live Games', 350, 'HOT'),
  makeGame(14, 'Pixel Pirate', 'Provider Six', 'Mini Games', 190),
  makeGame(15, 'Solar Strike', 'Provider Three', 'Crash', 30, 'NEW'),
  makeGame(16, 'Diamond Duo', 'Provider Four', 'Slots', 320),
  makeGame(17, 'Cobalt Cards', 'Provider Five', 'Table Games', 220),
  makeGame(18, 'Turbo Tower', 'Provider One', 'Arcade', 100, 'HOT'),
  makeGame(19, 'Aurora Reels', 'Provider Two', 'Slots', 175, 'NEW'),
  makeGame(20, 'Cosmic Crash', 'Provider Six', 'Crash', 270),
  makeGame(21, 'Lucky Lantern', 'Provider Three', 'Mini Games', 10),
  makeGame(22, 'Quantum Roulette', 'Provider Four', 'Live Games', 240, 'LIVE'),
  makeGame(23, 'Mystic Mahjong', 'Provider Five', 'Arcade', 130),
  makeGame(24, 'Golden Goal', 'Provider One', 'Mini Games', 90),
  // --- TANVION ROYALE — Royale Play ---
  makeGame(
    36,
    'Royale Ace',
    'TANVIONROYALE',
    'Slots',
    220,
    'NEW',
    true,
    'freeplay',
    'royale-ace',
    '/assets/image/royale-ace-logo.png',
  ),
  makeGame(37, "Royale Time", "TANVIONROYALE", "Live Games", 45, "LIVE", true, "freeplay", "royale-time", "/assets/image/royale-time-cover.svg"),
  makeGame(100, "Pharaoh's Legacy", "TANVIONROYALE", "Slots", 45, "NEW", true, "freeplay", "pharaohs-legacy"),
  makeGame(101, "Atlantis Treasure", "TANVIONROYALE", "Slots", 200, "NEW", true, "freeplay", "atlantis-treasure"),
  makeGame(102, "Neon Cyber Rush", "TANVIONROYALE", "Slots", 300, "NEW", true, "freeplay", "neon-cyber-rush"),
  makeGame(103, "Mystic Forest", "TANVIONROYALE", "Slots", 150, "NEW", true, "freeplay", "mystic-forest"),
  makeGame(104, "Samurai Fortune", "TANVIONROYALE", "Slots", 15, "NEW", true, "freeplay", "samurai-fortune"),
  makeGame(105, "Cosmic Odyssey", "TANVIONROYALE", "Slots", 270, "NEW", true, "freeplay", "cosmic-odyssey"),
  makeGame(106, "Dragon's Kingdom", "TANVIONROYALE", "Slots", 10, "NEW", true, "freeplay", "dragons-kingdom"),
  makeGame(107, "Tropical Paradise", "TANVIONROYALE", "Slots", 20, "NEW", true, "freeplay", "tropical-paradise"),
  makeGame(108, "Steampunk Revolution", "TANVIONROYALE", "Slots", 30, "NEW", true, "freeplay", "steampunk-revolution"),
  makeGame(109, "Frozen Empire", "TANVIONROYALE", "Slots", 210, "NEW", true, "freeplay", "frozen-empire"),
];

export function gamesByCategory(category: string): Game[] {
  if (category === 'All Games' || category === 'all') return games;
  if (category === 'Favorites') return games.filter((g) => g.featured);
  if (category === 'Popular') return games.filter((g) => g.badge === 'HOT');
  if (category === 'New') return games.filter((g) => g.badge === 'NEW');
  return games.filter((g) => g.category === category);
}

export function searchGames(query: string): Game[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return games.filter(
    (g) =>
      g.title.toLowerCase().includes(q) ||
      g.provider.toLowerCase().includes(q) ||
      g.category.toLowerCase().includes(q),
  );
}

export const gameCategories = [
  'All Games',
  'Popular',
  'New',
  'Slots',
  'Arcade',
  'Crash',
  'Table Games',
  'Live Games',
  'Mini Games',
  'Sports',
  'Favorites',
] as const;

/** Data-driven sections — reused by one GameSection component (no duplicated JSX). */
export const gameSections: GameSectionData[] = [
  { title: 'Popular Games', subtitle: 'What everyone is playing right now', games: games.filter((g) => g.badge === 'HOT') },
  { title: 'New Games', subtitle: 'Fresh arrivals this week', games: games.filter((g) => g.badge === 'NEW') },
  { title: 'Live Games', subtitle: 'Real-time tables and studios', games: games.filter((g) => g.badge === 'LIVE') },
  { title: 'Recommended', subtitle: 'Picked for you', games: games.filter((g) => g.featured) },
  { title: 'Trending', subtitle: 'Climbing the charts', games: games.filter((g) => g.category === 'Crash' || g.category === 'Arcade') },
  { title: 'Recently Viewed', subtitle: 'Pick up where you left off', games: games.slice(0, 6) },
];

/** Internally developed, genuinely playable free-play games only. */
export function freeplayGames(): Game[] {
  return games.filter((g) => g.kind === 'freeplay');
}

/** Look up an internally developed free-play game by its engine slug. */
export function getFreePlayGame(slug: string): Game | undefined {
  if (slug === 'sky-rocket') {
    return games.find((g) => g.kind === 'freeplay' && (g.slug === 'royale-fly' || g.slug === 'sky-rocket'));
  }
  return games.find((g) => g.kind === 'freeplay' && g.slug === slug);
}
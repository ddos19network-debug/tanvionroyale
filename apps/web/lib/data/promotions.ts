/**
 * TANVIONROYALE — demo promotional content for the ticker and promotions page.
 * General platform messaging only — no monetary bonus claims, since no
 * promotion/bonus system is configured server-side in this UI phase.
 */

export interface Promotion {
  id: string;
  title: string;
  description: string;
  tag: string;
  image: string;
}

export const tickerMessages: string[] = [
  'Welcome to TANVIONROYALE',
  'New games available every week',
  'Daily promotions — check the promotions page',
  'Special events coming soon',
  'Follow your favorite games with the ★ button',
];

export const promotions: Promotion[] = [
  {
    id: 'welcome',
    tag: 'Ongoing',
    title: 'Welcome to TANVIONROYALE',
    description: 'Create your free account and explore the full games and sports catalog.',
    image: 'from-teal-600 to-cyan-900',
  },
  {
    id: 'new-games',
    tag: 'New',
    title: 'New Games Weekly',
    description: 'Fresh titles from all six providers land every week. Try the latest releases.',
    image: 'from-emerald-600 to-teal-900',
  },
  {
    id: 'daily',
    tag: 'Daily',
    title: 'Daily Promotions',
    description: 'Check back every day for rotating in-game events across the catalog.',
    image: 'from-cyan-600 to-blue-900',
  },
  {
    id: 'events',
    tag: 'Special',
    title: 'Special Events',
    description: 'Seasonal tournaments and leaderboard events for popular games.',
    image: 'from-indigo-600 to-violet-900',
  },
];
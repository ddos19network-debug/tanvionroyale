/**
 * TANVIONROYALE — sport presentation helpers for the marketing home section.
 *
 * This file deliberately contains NO fake event counts or invented matches:
 * the home sports section renders the REAL sport catalog from the API
 * (GET /sports) and shows an honest empty state when none is configured.
 */

/** Emoji icon per known sport slug (falls back to a generic trophy). */
export const SPORT_ICONS: Record<string, string> = {
  football: '⚽',
  cricket: '🏏',
  basketball: '🏀',
  tennis: '🎾',
  baseball: '⚾',
  hockey: '🏒',
  rugby: '🏉',
  volleyball: '🏐',
  'table-tennis': '🏓',
  boxing: '🥊',
  mma: '🥋',
  golf: '⛳',
  'motor-sports': '🏎️',
  esports: '🎮',
  olympics: '🏅',
};

export function sportIcon(slug: string): string {
  return SPORT_ICONS[slug] ?? '🏆';
}

/** CSS gradient class per known sport slug (falls back to a neutral teal). */
export const SPORT_GRADIENTS: Record<string, string> = {
  football: 'from-emerald-600 to-teal-900',
  cricket: 'from-cyan-600 to-teal-900',
  basketball: 'from-orange-600 to-red-900',
  tennis: 'from-lime-600 to-emerald-900',
  baseball: 'from-red-600 to-rose-900',
  hockey: 'from-sky-600 to-blue-900',
  rugby: 'from-indigo-600 to-purple-900',
  volleyball: 'from-fuchsia-600 to-purple-900',
  'table-tennis': 'from-teal-600 to-cyan-900',
  boxing: 'from-amber-600 to-orange-900',
  mma: 'from-slate-600 to-slate-900',
  golf: 'from-green-600 to-emerald-900',
  'motor-sports': 'from-red-600 to-orange-900',
  esports: 'from-fuchsia-600 to-purple-900',
  olympics: 'from-yellow-600 to-amber-900',
};

export function sportGradient(slug: string): string {
  return SPORT_GRADIENTS[slug] ?? 'from-teal-600 to-cyan-900';
}
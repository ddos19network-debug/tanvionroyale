/**
 * Shared user-panel navigation definition.
 *
 * SINGLE SOURCE OF TRUTH for the desktop left sidebar (UserSidebar) and the
 * existing mobile top-right hamburger menu (AppHeader). Both render the same
 * items pointing at the same real routes, so the desktop and mobile user
 * navigation can never drift apart.
 *
 * Four product sections (BIG CASINO / BIG SPORT / BIG LIVE CASINO / ROYALE
 * PLAY) reuse EXISTING routes — navigation labels changed, no parallel routes.
 * ROYALE PLAY = internal free-play games only (/games/play).
 * BIG CASINO = partner casino catalog (/games?product=casino).
 * BIG LIVE CASINO = partner live-dealer catalog (/games?product=live).
 * BIG SPORT = sportsbook hub (/sports).
 * Live sports events stay on /live (unchanged route, not a product section).
 */

export interface UserNavItem {
  /** Stable key used for rendering. */
  key: string;
  label: string;
  /** BIG product pill rendered beside the primary product labels. */
  pill?: string;
  /** Real destination. `null` means the feature does not exist yet. */
  href: string | null;
  /** Short availability note shown for `href === null` items. */
  note?: string;
  /** 24x24 stroke icon path in the TANVIONROYALE inline-SVG icon style. */
  icon: string;
  /**
   * Active-state predicate evaluated against the REAL current route
   * (pathname + the `/games` catalog product/category query params).
   */
  active: (pathname: string, category: string | null, product?: string | null) => boolean;
}

/** BIG CASINO category helper — kept in sync with the user-nav predicates. */
export function isCasinoCategory(category: string | null): boolean {
  if (!category) return false;
  const normalized = category.trim().toLowerCase();
  return (
    normalized === 'slots' ||
    normalized === 'table games' ||
    normalized === 'live games' ||
    normalized === 'mini games' ||
    normalized === 'crash' ||
    normalized === 'arcade'
  );
}

/** Active-state helper shared by Casino / Live Casino / Games nav predicates. */
export function catalogProduct(pathname: string, product: string | null | undefined): string | null {
  if (pathname !== '/games') return null;
  if (product === 'casino' || product === 'live') return product;
  return null;
}

export interface UserNavSection {
  title: string;
  items: readonly UserNavItem[];
}

/**
 * Partner-vs-internal catalog product. `INTERNAL` (Royale Play) is the only
 * product backed by the in-repo free-play catalog; CASINO/LIVE_CASINO rows
 * come from the partner sync and are never fabricated here.
 */
export type ProductScope = 'casino' | 'live' | 'internal' | 'all';

/** User menu groups — order and labels follow the navigation spec exactly. */
export const userNavSections: readonly UserNavSection[] = [
  {
    title: 'MAIN',
    items: [
      {
        key: 'home',
        label: 'Home',
        href: '/',
        icon: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9z',
        active: (p) => p === '/' || p === '/home',
      },
      {
        key: 'dashboard',
        label: 'Dashboard',
        href: '/dashboard',
        icon: 'M6 5h12v14H6V19zM7 12h10v3H7V15z',
        active: (p) => p === '/dashboard',
      },
      {
        key: 'big-sport',
        label: 'BIG SPORT',
        href: '/sports',
        note: 'Sportsbook — browse sports, competitions and live events.',
        icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12z',
        active: (p) => p.startsWith('/sports') || p.startsWith('/events') || p === '/live',
      },
      {
        key: 'big-casino',
        label: 'BIG CASINO',
        href: '/games?product=casino',
        note: 'Partner casino — slots, table games and more from the integrated casino provider.',
        icon: 'M4 6h16v3H4V9zM4 11h16v3H4V14zM4 16h16v3H4V19z',
        active: (p, _c, product) =>
          p === '/games' && (product === 'casino' || product === null || product === undefined),
      },
      {
        key: 'big-live-casino',
        label: 'BIG LIVE CASINO',
        href: '/games?product=live',
        note: 'Partner live-dealer tables — availability follows the configured provider.',
        icon: 'M9 5l8 14-8 0z',
        active: (p, _c, product) => p === '/games' && product === 'live',
      },
      {
        key: 'royale-play',
        label: 'ROYALE PLAY',
        href: '/games/play',
        note: 'Playable TANVIONROYALE-owned games only (real engines, real results).',
        icon: 'M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z',
        active: (p) => p === '/games/play' || p.startsWith('/games/play/'),
      },
    ],
  },
  {
    title: 'ACCOUNT',
    items: [
      {
        key: 'notification',
        label: 'Notifications',
        href: '/notifications',
        note: 'In-app notification center (also the destination for browser push).',
        icon: 'M11 5h2v3H11V8zM11 13h3v6H11V19z',
        active: (p) => p.startsWith('/notifications'),
      },
      {
        key: 'deposit',
        label: 'Deposit',
        href: '/wallet/deposit',
        icon: 'M12 4v6l-3 3 6 0-3-3zM6 16h12v3H6V19z',
        active: (p) => p === '/wallet/deposit',
      },
      {
        key: 'withdraw',
        label: 'Withdraw',
        href: '/wallet/withdraw',
        icon: 'M12 20v-6l-3-3 6 0-3 3zM6 5h12v3H6V8z',
        active: (p) => p === '/wallet/withdraw',
      },
      {
        key: 'wallet',
        label: 'Wallet',
        href: '/wallet',
        icon: 'M6 5h12v10H6V15zM6 8h7v2H6V10z',
        active: (p) => p === '/wallet' || p === '/wallet/transactions',
      },
      {
        key: 'saved-favourite',
        label: 'Saved Favourite',
        href: '/favorites',
        icon: 'M8 4h8v12H8V16zM8 4l4-4 4 4z',
        active: (p) => p === '/favorites',
      },
    ],
  },
  {
    title: 'SERVICE',
    items: [
      {
        key: 'support',
        label: 'Support',
        href: '/support',
        icon: 'M5 4h14v3H5V7zM5 7l7 12 7-12z',
        active: (p) => p === '/support',
      },
      {
        key: 'live-chat',
        label: 'Live Chat',
        href: '/support/chat',
        note: 'Chat with the TANVIONROYALE support team.',
        icon: 'M6 7h12v7H6V14zM18 14v-3l4 0z',
        active: (p) => p === '/support/chat' || p.startsWith('/support/chat/'),
      },
      {
        key: 'report-problem',
        label: 'Report a Problem',
        href: '/support/report',
        note: 'Report an issue to support with an optional screenshot.',
        icon: 'M12 4L3 19h18L12 4zm0 5v4m0 3v1',
        active: (p) =>
          p === '/support/report' ||
          p.startsWith('/support/report/') ||
          p.startsWith('/support/reports'),
      },
    ],
  },
  {
    title: 'PERSONAL',
    items: [
      {
        // "Affiliate With Us" — the affiliate program landing page. It sits at
        // the END of the navigation, immediately BEFORE the settings area, so
        // it is reached last rather than competing with the product sections.
        //
        // ONE ENTRY ONLY: `userNavSections` is the single source of truth
        // consumed by BOTH the desktop `UserSidebar` and the mobile
        // `AppHeader` drawer, so declaring it here is exactly what makes it
        // appear on desktop AND mobile with no second, drifting data source.
        key: 'affiliate',
        label: 'Affiliate With Us',
        href: '/affiliate',
        note: 'Share your referral link, track your referrals and earn rewards.',
        icon: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5V11z',
        active: (p) => p === '/affiliate' || p.startsWith('/affiliate/'),
      },
      {
        key: 'settings',
        label: 'Settings',
        href: '/settings',
        icon: 'M6 5h12v14H6V19zM12 5v14M6 12h12z',
        active: (p) => p === '/settings',
      },
    ],
  },
];

/**
 * User-panel route prefixes that get the desktop left sidebar.
 *
 * Allow-list (rather than admin-deny-list) so the sidebar can never leak into
 * the Admin panel, the auth screens or static/legal pages. The platform home
 * route `/` lives in the `(user)` route group (app/(user)/page.tsx) alongside
 * every other user-panel page, so it gets the shared top navigation AND this
 * sidebar exactly like /wallet, /notifications, /games, ... Admin keeps its
 * own dedicated AdminShell sidebar untouched.
 */
const USER_PANEL_PREFIXES = [
  '/dashboard',
  '/sports',
  '/games',
  '/live',
  '/events',
  '/wallet',
  '/settings',
  '/verification',
  '/support',
  '/favorites',
  '/my-bets',
  '/promotions',
  // In-app notification center — must stay inside the user shell (desktop
  // sidebar + mobile header) exactly like every other account page.
  '/notifications',
  // Affiliate program ("Affiliate With Us"). It must live inside the user
  // shell exactly like every other account page, so it gets the shared top
  // navigation AND the desktop sidebar.
  '/affiliate',
  // Home — the platform home view. It lives in the `(user)` route group
  // (app/(user)/home/page.tsx, still served at /home) alongside every other
  // user-panel page, so it gets the shared top navigation AND this sidebar.
  '/home',
] as const;

/** True when the pathname belongs to the normal user-facing panel. */
export function isUserPanelRoute(pathname: string): boolean {
  if (!pathname || pathname === '/') return true;
  if (pathname.startsWith('/admin')) return false;
  return USER_PANEL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
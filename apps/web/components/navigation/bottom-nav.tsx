'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useMobileNavVisibility } from '@/components/navigation/use-mobile-nav-visibility';

interface BottomNavItem {
  href: string;
  label: string;
  icon: string;
  /** Route prefixes that mark this item as active. */
  match: (pathname: string) => boolean;
  /** Opens in a new browser tab. */
  newTab?: boolean;
}

/**
 * The ONE bottom menu of the whole platform. Same five items on every page
 * (main site, /profile, /trading/*). It is rendered once from the root layout.
 */
const ITEMS: readonly BottomNavItem[] = [
  {
    href: '/',
    label: 'Home',
    icon: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9z',
    match: (p) => p === '/' || p === '/home' || p.startsWith('/home/'),
  },
  {
    href: '/games',
    label: 'Game',
    icon: 'M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z',
    match: (p) => p === '/games' || p.startsWith('/games/'),
  },
  {
    href: '/sports',
    label: 'Sports',
    icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12z',
    match: (p) => p === '/sports' || p.startsWith('/sports/'),
  },
  {
    // Trading is a separate product: it always opens in a NEW tab.
    href: '/trading',
    label: 'Trade',
    icon: 'M3 17l6-6 4 4 8-8M15 7h6v6',
    match: (p) => p === '/trading' || p.startsWith('/trading/'),
    newTab: true,
  },
  {
    href: '/profile',
    label: 'Profile',
    icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z',
    match: (p) => p === '/profile' || p.startsWith('/profile/'),
  },
];

/**
 * Mobile-only bottom navigation (hidden from 768px up, same breakpoint as the
 * hamburger menus).
 *
 * Visibility comes from the shared mobile navigation controller (same rule as
 * every top bar): hides while scrolling down, comes back on scroll up, at the
 * top / end of the page, and while the keyboard is closed.
 */
export function BottomNav() {
  const pathname = usePathname() || '';
  const { bottomVisible } = useMobileNavVisibility();

  return (
    <nav
      aria-label="Mobile navigation"
      aria-hidden={!bottomVisible}
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur transition-transform duration-200 ease-out md:hidden ${
        bottomVisible ? 'translate-y-0' : 'translate-y-full'
      }`}
    >
      <ul className="mx-auto flex max-w-lg">
        {ITEMS.map((item) => {
          const active = item.match(pathname);
          return (
            <li key={item.label} className="flex-1">
              <Link
                href={item.href}
                target={item.newTab ? '_blank' : undefined}
                rel={item.newTab ? 'noopener noreferrer' : undefined}
                tabIndex={bottomVisible ? 0 : -1}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition ${
                  active ? 'text-brand' : 'text-slate-400 hover:text-white'
                }`}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d={item.icon}
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
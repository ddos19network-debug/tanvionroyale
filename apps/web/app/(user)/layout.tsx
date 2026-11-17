"use client";

import { AppHeader } from '@/components/layout/app-header';
import { usePathname } from 'next/navigation';

/**
 * Shared layout for EVERY TANVIONROYALE user-panel route.
 *
 * Top navigation (<AppHeader />):
 * - Hidden on game-play pages (/games/play/*).
 * - Hidden on trading pages (/trading/*): trading renders its own TradingShell
 *   top menu, so the main-site top menu is never shown there (desktop + mobile).
 * - /profile: main-site top menu on desktop; on MOBILE it is hidden, because the
 *   profile has its own mobile header (back + title + hamburger) whose left menu
 *   holds the whole profile sidebar.
 * - Every other page: main-site top menu (desktop bar + mobile hamburger).
 */
export default function UserPanelLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const isGamePlay = pathname.startsWith('/games/play/');
  const isTrading = pathname.startsWith('/trading');
  const isProfile = pathname === '/profile' || pathname.startsWith('/profile/');

  const showHeader = !isGamePlay && !isTrading;

  let contentSpacing: string;
  if (isGamePlay || isTrading) {
    contentSpacing = 'pt-0 pb-0';
  } else if (isProfile) {
    // Mobile: no main top menu (profile header handles it) -> no top offset.
    // Desktop: main top menu is visible -> keep the normal offset.
    contentSpacing =
      'pt-0 pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pt-16 md:pb-0';
  } else {
    // Mobile keeps room for the bottom menu so the last content is never covered.
    contentSpacing =
      'pt-14 pb-[calc(3.5rem+env(safe-area-inset-bottom))] sm:pt-16 md:pb-0 lg:pb-0';
  }

  return (
    <>
      {showHeader && <AppHeader hideOnMobile={isProfile} />}

      {/* Content column */}
      <div className={`w-full min-w-0 flex-1 ${contentSpacing}`}>{children}</div>
    </>
  );
}
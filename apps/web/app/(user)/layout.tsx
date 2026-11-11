"use client";

import { AppHeader } from '@/components/layout/app-header';
import { usePathname } from 'next/navigation';

/**
 * Shared layout for EVERY TANVIONROYALE user-panel route.
 *
 * Top navigation (<AppHeader />):
 * - Hidden on game-play pages (/games/play/*) and trading pages (/trading/*)
 *   so trading gets its own dedicated TradingShell header.
 * - Always visible on normal pages AND /profile so /profile gets the main platform's
 *   top navigation as requested.
 */
export default function UserPanelLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const isGamePlay = pathname.startsWith('/games/play/');
  const isTrading = pathname.startsWith('/trading');

  return (
    <>
      {/* Top navigation: rendered here for the user panel.
          Hidden on game-play and trading routes. Visible on /profile. */}
      {!isGamePlay && !isTrading && <AppHeader />}

      {/* Content column */}
      <div
        className={`w-full min-w-0 flex-1 ${
          isGamePlay || isTrading
            ? 'pt-0 pb-0'
            : 'pt-14 pb-[calc(var(--bottom-nav-height,0)+env(safe-area-inset-bottom))] sm:pt-16 md:pb-0 lg:pb-0'
        }`}
      >
        {children}
      </div>
    </>
  );
}

'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function usePathnameComponent() {
  const pathname = usePathname() || '';
  const isGamePlay = pathname.startsWith('/games/play/');
  const isTrading = pathname.startsWith('/trading');
  const isProfile = pathname === '/profile' || pathname.startsWith('/profile/');

  return { pathname, isGamePlay, isTrading, isProfile };
}

/**
 * Client component that hides the main platform sidebar and chrome when the
 * current route is a full-screen game-play page (`/games/play/*`), a trading
 * page (`/trading/*`), or a profile page (`/profile/*`).
 */
export function HideOnGamePlay({ children }: { children: ReactNode }) {
  const { isGamePlay, isTrading, isProfile } = usePathnameComponent();
  if (isGamePlay || isTrading || isProfile) return null;
  return <>{children}</>;
}

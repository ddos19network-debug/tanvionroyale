'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function usePathnameComponent() {
  const pathname = usePathname();
  const isGamePlay = pathname.startsWith('/games/play/');
  const isTrading = pathname.startsWith('/trading');

  return { pathname, isGamePlay, isTrading };
}

/**
 * Client component that hides its children when the current route is a
 * full-screen game-play page (`/games/play/*`) or a trading page (`/trading/*`).
 * Keeps the root layout a Server Component by moving the `usePathname` call
 * behind a client boundary.
 */
export function HideOnGamePlay({ children }: { children: ReactNode }) {
  const { isGamePlay, isTrading } = usePathnameComponent();
  if (isGamePlay || isTrading) return null;
  return <>{children}</>;
}
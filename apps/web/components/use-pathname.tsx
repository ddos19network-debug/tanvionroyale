'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function usePathnameComponent() {
  const pathname = usePathname();
  const isGamePlay = pathname.startsWith('/games/play/');

  return { pathname, isGamePlay };
}

/**
 * Client component that hides its children when the current route is a
 * full-screen game-play page (`/games/play/*`). Keeps the root layout a
 * Server Component by moving the `usePathname` call behind a client boundary.
 */
export function HideOnGamePlay({ children }: { children: ReactNode }) {
  const { isGamePlay } = usePathnameComponent();
  if (isGamePlay) return null;
  return <>{children}</>;
}
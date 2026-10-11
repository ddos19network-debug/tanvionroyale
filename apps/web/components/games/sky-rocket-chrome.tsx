'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** Hide platform chrome only on the dedicated Sky Rocket play route. */
export function SkyRocketChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return pathname?.replace(/\/$/, '') === '/games/play/sky-rocket' ? null : <>{children}</>;
}

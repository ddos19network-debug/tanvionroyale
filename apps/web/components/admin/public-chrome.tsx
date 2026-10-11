'use client';

/**
 * Public-site chrome visibility helpers.
 *
 * HideOnAdmin hides the site-wide chrome (bottom nav) inside the /admin
 * section, which has its own dedicated shell. BetSlipVisibility additionally
 * restricts the floating bet slip to betting-relevant routes only, so it no
 * longer floats over non-betting pages (/register, /login, /profile, /, the
 * demo game catalog, legal pages, ...).
 *
 * NOTE: the floating Bet Slip is currently switched OFF site-wide by
 * BET_SLIP_ENABLED (config/features.ts), so the root layout does not render it
 * through BetSlipVisibility at all. This helper is intentionally kept — it is
 * the route allowlist used again the moment the flag is flipped back on.
 */
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function HideOnAdmin({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname.startsWith('/admin')) return null;
  return <>{children}</>;
}

/**
 * Betting-route allowlist for the floating Bet Slip — mirrors the routes where
 * a customer can actually build or review a bet:
 * - /sports and /sports/...        (sport + game listings)
 * - /events and /events/...        (event listing + event detail, where selections are added)
 * - /live                          (live events listing — native events open the bet slip)
 * - /my-bets and /my-bets/...      (bet history + bet detail)
 * - /games/...                     (backend game detail pages only; the bare /games catalog
 *                                   and /games/demo-preview are demo/presentation pages)
 */
function isBettingRoute(pathname: string): boolean {
  if (pathname === '/sports' || pathname.startsWith('/sports/')) return true;
  if (pathname === '/events' || pathname.startsWith('/events/')) return true;
  if (pathname === '/live') return true;
  if (pathname === '/my-bets' || pathname.startsWith('/my-bets/')) return true;
  if (pathname.startsWith('/games/') && !pathname.startsWith('/games/demo-preview')) return true;
  return false;
}

/** Renders children only on betting-relevant routes (see isBettingRoute). */
export function BetSlipVisibility({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (!isBettingRoute(pathname)) return null;
  return <>{children}</>;
}

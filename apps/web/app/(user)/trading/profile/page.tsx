'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/src/lib/auth';
import { TradingShell } from '@/components/trading/trading-shell';
import { UnifiedProfile } from '@/components/profile/unified-profile';

/**
 * /trading/profile
 *
 * Desktop: trading top menu (back, logo, Home, Market, Buy Crypto, Trade, Earn,
 *          search, Deposit, Notification, Profile) + profile left sidebar.
 * Mobile:  the trading top menu is hidden; the profile's own mobile header
 *          (back + title + hamburger) opens the profile left menu.
 *
 * Requires sign-in — unauthenticated visitors are redirected to /login,
 * matching the guard used by /dashboard, /notifications and /settings.
 */
export default function TradingProfilePage() {
  const router = useRouter();
  const { ready, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!ready) return;
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
  }, [ready, isAuthenticated, router]);

  if (!ready || !isAuthenticated) return null;

  return (
    <TradingShell fullWidth hideHeaderOnMobile>
      <UnifiedProfile />
    </TradingShell>
  );
}
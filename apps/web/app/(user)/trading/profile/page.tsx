'use client';

import { TradingShell } from '@/components/trading/trading-shell';
import { UnifiedProfile } from '@/components/profile/unified-profile';

/**
 * /trading/profile
 *
 * Desktop: trading top menu (back, logo, Home, Market, Buy Crypto, Trade, Earn,
 *          search, Deposit, Notification, Profile) + profile left sidebar.
 * Mobile:  the trading top menu is hidden; the profile's own mobile header
 *          (back + title + hamburger) opens the profile left menu.
 */
export default function TradingProfilePage() {
  return (
    <TradingShell fullWidth hideHeaderOnMobile>
      <UnifiedProfile />
    </TradingShell>
  );
}
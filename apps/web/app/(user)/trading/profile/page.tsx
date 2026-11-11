'use client';

import { TradingShell } from '@/components/trading/trading-shell';
import { UnifiedProfile } from '@/components/profile/unified-profile';

export default function TradingProfilePage() {
  return (
    <TradingShell fullWidth>
      <UnifiedProfile />
    </TradingShell>
  );
}

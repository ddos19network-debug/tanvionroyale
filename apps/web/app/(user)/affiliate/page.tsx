import type { Metadata } from 'next';
import { AffiliateDashboard } from '@/components/affiliate/affiliate-dashboard';

export const metadata: Metadata = {
  title: 'Affiliate With Us | TANVIONROYALE',
  description: 'Share your referral link and earn rewards on every qualified referral.',
  // A private account page: never indexed.
  robots: { index: false, follow: false },
};

/**
 * `/affiliate` — the "Affiliate With Us" user page.
 *
 * It lives in the `(user)` route group, so it gets the shared top navigation
 * AND the desktop left sidebar, exactly like /wallet and /profile. The parent
 * group is parenthesised, so this still serves the plain path `/affiliate`.
 *
 * The page is CLIENT-SIDE on purpose: every figure it shows is personal,
 * fetched per-request over the authenticated API, so it is never statically
 * prerendered into shared HTML or cached across users.
 */
export default function AffiliatePage() {
  return (
    <main className="w-full">
      <AffiliateDashboard />
    </main>
  );
}

import { SkyRocketChrome } from '@/components/games/sky-rocket-chrome';

import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import './globals.css';
import { AuthProvider } from '@/src/lib/auth';
import { FcmRegistrar } from '@/components/notifications/fcm-registrar';
import { BetSlipProvider } from '@/components/betting';
import { BetSlip } from '@/components/betting';
import { BottomNav } from '@/components/navigation/bottom-nav';
import { UserSidebar } from '@/components/navigation/user-sidebar';
import { BetSlipVisibility, HideOnAdmin } from '@/components/admin/public-chrome';
import { siteConfig, siteUrl } from '@/config/site';
import { BET_SLIP_ENABLED } from '@/config/features';

/**
 * Root metadata for the TANVIONROYALE web app.
 *
 * The canonical base URL comes from NEXT_PUBLIC_SITE_URL (see config/site.ts) —
 * no host is hardcoded here. The Open Graph / Twitter share image is provided
 * by the app-router file convention (app/opengraph-image.tsx), and the icons
 * by app/favicon.ico, app/icon.svg and app/apple-icon.png.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: siteConfig.title,
  description: siteConfig.description,
  applicationName: siteConfig.name,
  keywords: ['TANVIONROYALE', 'online gaming', 'games', 'sports', 'events', 'entertainment platform'],
  alternates: {
    canonical: siteUrl('/'),
  },
  openGraph: {
    type: 'website',
    siteName: siteConfig.name,
    locale: 'en_US',
    url: siteUrl('/'),
    title: siteConfig.title,
    description: siteConfig.description,
  },
  twitter: {
    card: 'summary_large_image',
    title: siteConfig.title,
    description: siteConfig.description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  appleWebApp: {
    capable: true,
    title: siteConfig.name,
    statusBarStyle: 'black-translucent',
  },
  /*
   * Chrome (and the HTML spec) deprecated `apple-mobile-web-app-capable` in
   * favour of the unprefixed `mobile-web-app-capable`, and warns on every
   * page load. Emitting BOTH keeps iOS/Safari behaviour identical (it still
   * reads the Apple key) while silencing the warning for every other engine.
   * Purely a head/metadata cleanup — nothing here touches the auth flow.
   */
  other: {
    'mobile-web-app-capable': 'yes',
  },
  category: 'entertainment',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#06131a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink-950 text-slate-100 antialiased">
        <AuthProvider>
          <FcmRegistrar />
          <BetSlipProvider>
            {/* The bet-slip provider stays mounted unconditionally: slip state is
                TEMPORARY client state (never authoritative) and pages read it
                through useBetSlip(). Only the visible widget is gated by
                BET_SLIP_ENABLED (see config/features.ts). */}

            {/* Desktop user sidebar (left) + page content. The sidebar returns
                null on every non-user-panel route (admin/auth/static/legal),
                where this row simply behaves like the previous single-column
                layout — the Admin shell is never touched by it.

                Scroll model (desktop, lg+): the row is locked to the viewport
                height and clips its own overflow, so the ONLY scrollable box in
                it is the main content column below. The sidebar therefore stays
                fixed next to the viewport while the page content scrolls on its
                own, and the sidebar's own menu list scrolls internally (see the
                `overflow-y-auto` list in UserSidebar). Below lg the row is a
                normal document-flow container again, so mobile keeps the usual
                single page scroll (and the header hide-on-scroll behaviour). */}
            <div className="flex min-h-screen lg:h-screen lg:overflow-hidden">
              {/* Suspense boundary: UserSidebar reads useSearchParams() (for the
                  casino category active state), which Next.js 14 requires to be
                  wrapped in a suspense boundary during prerendering — same
                  pattern as the /verification page. */}
              <Suspense fallback={null}>
                <SkyRocketChrome><UserSidebar /></SkyRocketChrome>
              </Suspense>
              <div className="flex min-w-0 flex-1 flex-col lg:overflow-y-auto lg:overscroll-contain">
                {children}
              </div>
            </div>
            <HideOnAdmin>
              {/* Floating bet slip — TEMPORARILY DISABLED site-wide while
                  BET_SLIP_ENABLED is false (see config/features.ts): nothing is
                  rendered, so no empty panel and no reserved blank space is
                  left behind. The provider above stays mounted so the existing
                  Bet Slip components keep compiling/working if the flag is
                  flipped back on. The bottom nav stays site-wide (admin shell
                  excluded). */}
              {BET_SLIP_ENABLED ? (
                <BetSlipVisibility>
                  <BetSlip />
                </BetSlipVisibility>
              ) : null}
              <SkyRocketChrome>
                <BottomNav />
              </SkyRocketChrome>
            </HideOnAdmin>
          </BetSlipProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
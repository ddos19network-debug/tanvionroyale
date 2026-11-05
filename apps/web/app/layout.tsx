
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
import { HideOnGamePlay } from '@/components/use-pathname';
import { siteConfig, siteUrl } from '@/config/site';
import { BET_SLIP_ENABLED } from '@/config/features';

/** Root metadata for the TANVIONROYALE web app.
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
    <html lang='en'>
      <body className='min-h-screen bg-ink-950 text-slate-100 antialiased'>
        <AuthProvider>
          <FcmRegistrar />
          <BetSlipProvider>
            <div className='flex min-h-screen lg:h-screen lg:overflow-hidden'>
              <HideOnGamePlay>
                <UserSidebar />
              </HideOnGamePlay>
              <div className='flex min-w-0 flex-1 flex-col lg:overflow-y-auto lg:overscroll-contain pt-[var(--header-height,0)] lg:pt-[var(--header-height-lg,0)]'>
                {children}
              </div>
            </div>
            <HideOnAdmin>
              {BET_SLIP_ENABLED ? (
                <BetSlipVisibility>
                  <BetSlip />
                </BetSlipVisibility>
              ) : null}
              <HideOnGamePlay>
                <BottomNav />
              </HideOnGamePlay>
            </HideOnAdmin>
          </BetSlipProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
﻿
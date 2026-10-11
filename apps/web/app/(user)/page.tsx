import type { Metadata } from 'next';
import { HomeContent } from '@/components/home/HomeContent';
import { siteConfig, siteUrl } from '@/config/site';

/**
 * TANVIONROYALE home — served at `/`.
 *
 * LIVES IN THE `(user)` ROUTE GROUP. The group folder is parenthesised, so it
 * is transparent to routing and the URL stays exactly `/` — but the page now
 * inherits the shared top navigation from app/(user)/layout.tsx instead of
 * rendering its own <AppHeader/>. That keeps `/` inside the SAME shared layout
 * as every other user-panel route (/wallet, /notifications, /games, ...), so
 * the desktop left sidebar (rendered once by the root layout, visible on
 * user-panel routes) never unmounts/hides when navigating Top Menu → Home,
 * on direct `/` refresh, or on Home → other page → Home trips.
 *
 * Public page: no authentication is required or checked here.
 */
export const metadata: Metadata = {
  title: { absolute: siteConfig.title },
  description: siteConfig.description,
  alternates: { canonical: siteUrl('/') },
  openGraph: {
    type: 'website',
    siteName: siteConfig.name,
    locale: 'en_US',
    url: siteUrl('/'),
    title: siteConfig.title,
    description: siteConfig.description,
    images: [
      {
        url: siteConfig.ogImagePath,
        width: 1200,
        height: 630,
        alt: 'TANVIONROYALE logo',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: siteConfig.title,
    description: siteConfig.description,
    images: [siteConfig.ogImagePath],
  },
};

export default function HomePage() {
  return <HomeContent />;
}

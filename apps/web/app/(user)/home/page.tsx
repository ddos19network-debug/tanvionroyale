import type { Metadata } from 'next';
import { HomeContent } from '@/components/home/HomeContent';
import { siteUrl } from '@/config/site';

/**
 * TANVIONROYALE home alias — served at `/home`.
 *
 * LIVES IN THE `(user)` ROUTE GROUP alongside the canonical platform home
 * (app/(user)/page.tsx, served at `/`). Both URLs render the SAME HomeContent
 * inside the SAME shared layout, so Top Menu → Home (`/`), direct `/` or
 * `/home` refresh, and Home → other page → Home trips all keep the desktop
 * left sidebar mounted and visible.
 *
 * Public page: no authentication is required or checked here.
 */
export const metadata: Metadata = {
  alternates: { canonical: siteUrl('/home') },
};

export default function HomeAliasPage() {
  return <HomeContent />;
}

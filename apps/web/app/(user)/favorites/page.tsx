import type { Metadata } from 'next';
import { AppFooter } from '@/components/layout/app-footer';
import { PromotionTicker } from '@/components/home/PromotionTicker';
import { FavoritesContent } from '@/components/home/FavoritesContent';

export const metadata: Metadata = {
  title: 'Favorites — TANVIONROYALE',
  description: 'Your saved TANVIONROYALE games.',
};

/** Favorites page — client-side saved games list. */
export default function FavoritesPage() {
  return (
    <>
      <PromotionTicker />
      <main className="mx-auto max-w-7xl px-4 py-6 pb-24 sm:pb-10">
        <h1 className="text-2xl font-bold text-white sm:text-3xl">Favorites</h1>
        <p className="mt-1 text-sm text-slate-400">
          Games you starred across the catalog, saved on this device.
        </p>
        <div className="mt-6">
          <FavoritesContent />
        </div>
      </main>
      <AppFooter />
    </>
  );
}
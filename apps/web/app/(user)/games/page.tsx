import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AppFooter } from '@/components/layout/app-footer';
import { CasinoCatalogBrowser } from '@/components/casino/casino-catalog-browser';
import { GamesBrowser } from '@/components/home/GamesBrowser';
import { PromotionTicker } from '@/components/home/PromotionTicker';

export const metadata: Metadata = {
  title: 'Games — TANVIONROYALE',
  description: 'Browse the TANVIONROYALE game catalog by category.',
};

/**
 * /games is the shared catalog entry point for the partner product sections:
 *
 *   /games?product=casino  → BIG CASINO       (partner casino catalog)
 *   /games?product=live    → BIG LIVE CASINO  (partner live-dealer catalog)
 *   /games (no product)    → existing TANVIONROYALE catalog browser, unchanged
 *
 * The legacy (parameterless) view and every existing `?category=`/`?provider=`
 * link keep working exactly as before, so bookmarks and the internal catalog
 * are untouched. The partner catalog itself is served by the TANVIONROYALE
 * backend — the browser never talks to a provider.
 */
type GamesSearchParams = { product?: string | string[] };

function normalizeProduct(value: string | string[] | undefined): 'casino' | 'live' | null {
  const single = Array.isArray(value) ? value[0] : value;
  if (single === 'casino') return 'casino';
  if (single === 'live') return 'live';
  return null;
}

export default function GamesPage({
  searchParams,
}: {
  searchParams?: GamesSearchParams;
}) {
  const product = normalizeProduct(searchParams?.product);

  return (
    <>
      <PromotionTicker />
      <main className="mx-auto max-w-7xl px-4 py-6 pb-24 sm:pb-10">
        <Suspense
          fallback={<div className="h-64 animate-pulse rounded-xl bg-ink-800" aria-hidden />}
        >
          {product === 'casino' && (
            <CasinoCatalogBrowser
              product="casino"
              heading="BIG CASINO"
              description="Partner casino games — slots, table games and more. Every game is played from your TANVIONROYALE wallet."
            />
          )}

          {product === 'live' && (
            <CasinoCatalogBrowser
              product="live"
              heading="BIG LIVE CASINO"
              description="Live-dealer tables from the integrated provider. Only tables the provider actually supplies are listed — nothing is invented."
            />
          )}

          {product === null && (
            <>
              <h1 className="text-2xl font-bold text-white sm:text-3xl">Games</h1>
              <p className="mt-1 text-sm text-slate-400">
                Browse the full catalog. Filter by category, and star games to save them to your
                favorites.
              </p>
              <div className="mt-6">
                <GamesBrowser />
              </div>
            </>
          )}
        </Suspense>
      </main>
      <AppFooter />
    </>
  );
}

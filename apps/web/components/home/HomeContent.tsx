'use client';

import { Suspense, useMemo } from 'react';
import { HeroBanner, type HeroSlide } from './HeroBanner';
import { PromotionTicker } from './PromotionTicker';
import { GameSection } from './GameSection';
import { SportsSection } from './SportsCard';
import { AppFooter } from '@/components/layout/app-footer';
import { CasinoCatalogSection } from '@/components/casino/casino-catalog-section';
import { useFavorites } from '@/hooks/use-favorites';
import { freeplayGames } from '@/lib/data/games';

export const heroSlides: HeroSlide[] = [
  {
    id: 'slide-1',
    title: 'Your TANVIONROYALE Starts Here',
    subtitle: 'Explore hundreds of games and sports categories in one modern platform.',
    ctaLabel: 'Explore games',
    ctaHref: '/games',
    image: 'from-teal-700 via-ink-800 to-ink-950',
  },
  {
    id: 'slide-2',
    title: 'New Releases Every Week',
    subtitle: 'Fresh titles from all six providers — find your next favorite.',
    ctaLabel: 'See what is new',
    ctaHref: '/games?category=New',
    image: 'from-cyan-700 via-ink-800 to-ink-950',
  },
  {
    id: 'slide-3',
    title: 'Follow All the Action',
    subtitle: 'Football, cricket, tennis, basketball, esports and more.',
    ctaLabel: 'Browse sports',
    ctaHref: '/sports',
    image: 'from-emerald-700 via-ink-800 to-ink-950',
  },
  {
    id: 'slide-4',
    title: 'Save Your Favorites',
    subtitle: 'Tap the star on any game to keep it one tap away.',
    ctaLabel: 'Open favorites',
    ctaHref: '/favorites',
    image: 'from-indigo-700 via-ink-800 to-ink-950',
  },
];

/**
 * Interactive home content: the REAL partner-casino catalog + internal games.
 *
 * The headline game grid is NO LONGER a hard-coded list. It is the live public
 * catalog (`GET /api/v1/casino/catalog?product=casino`) rendered by
 * `CasinoCatalogSection`, so every game of every ACTIVE/visible provider appears
 * here exactly as it does on the Games page. The section defaults to
 * "All providers" — it never defaults to one provider.
 *
 * The only in-file data left is `freeplayGames()`, which is genuinely playable
 * in-house free-play content (real sessions on /games/play/[slug]), not a
 * placeholder. The old decorative demo tiles ("Teal Fortune" / "Provider One",
 * which had no provider behind them) are not shown here any more: they are not
 * real games and must never be mistaken for synced provider content.
 *
 * Layout, dark theme and section order are unchanged.
 */
export function HomeContent() {
  const { favorites, toggleFavorite } = useFavorites();

  // In-house free-play titles are genuinely playable, so they stay on Home.
  const visibleInternal = useMemo(() => freeplayGames(), []);

  return (
    <>
      <PromotionTicker />
      <main className="mx-auto max-w-7xl px-4 py-6 pb-24 sm:pb-10">
        <HeroBanner slides={heroSlides} />

        {/*
          REAL provider catalog — the section that used to render the hard-coded
          placeholder tiles. No provider is preselected, so this means ALL active
          providers. The STUDIO selector above the grid is driven by the public
          provider endpoint and writes `?provider=<id>` into this page's URL, so
          the choice survives a refresh, the back button and a shared link.

          Suspense boundary: the catalog reads `useSearchParams()` for that
          URL state, which Next.js 14 requires to be wrapped during
          prerendering (same pattern as the sidebar in app/layout.tsx and the
          /games page). The fallback mirrors the catalog's own skeleton.
        */}
        <div className="mt-8">
          <Suspense
            fallback={
              <div
                className="h-72 animate-pulse rounded-xl border border-white/10 bg-ink-800"
                aria-hidden
              />
            }
          >
            <CasinoCatalogSection
              product="casino"
              heading="Casino Games"
              description="Every game from every active provider, served by the TANVIONROYALE backend."
              limit={12}
              showProviders
            />
          </Suspense>
        </div>

        <div className="mt-10">
          {/* Real catalog data from GET /sports (loading/error/empty states). */}
          <SportsSection />
        </div>

        {visibleInternal.length > 0 && (
          <div className="mt-10">
            <GameSection
              title="Royale Play"
              subtitle="Free-play games built and hosted by TANVIONROYALE"
              games={visibleInternal}
              favorites={favorites}
              onToggleFavorite={toggleFavorite}
              layout="scroll"
            />
          </div>
        )}
      </main>
      <AppFooter />
    </>
  );
}
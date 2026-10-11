'use client';

import { Suspense } from 'react';
import { AppFooter } from '@/components/layout/app-footer';
import { GameSection } from '@/components/home/GameSection';
import { useFavorites } from '@/hooks/use-favorites';
import { freeplayGames } from '@/lib/data/games';

/**
 * Royale Play lobby (/games/play).
 *
 * Lists ONLY the internally developed, genuinely playable TANVIONROYALE
 * free-play games (kind === 'freeplay' in the catalog). Every tile here links
 * to a real backend-driven game page (/games/play/<slug>) that runs a full
 * game session: login → session → user action → backend validation → server
 * result → database persistence → result → play again.
 *
 * Presentation-only demo tiles are deliberately NOT listed — they have no
 * playable game behind them and stay on the /games catalog as clearly
 * labelled demo previews. Nothing here is invented.
 */
export default function RoyalePlayPage() {
  const games = freeplayGames();
  const { favorites, toggleFavorite } = useFavorites();

  return (
    <>
      <main className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:pb-10">
        <h1 className="text-2xl font-bold text-white sm:text-3xl">Royale Play</h1>
        <p className="mt-1 text-sm text-slate-400">
          Genuinely playable TANVIONROYALE games — every title runs a real game
          session with server-side validation and persisted results.
        </p>
        <div className="mt-6">
          <Suspense
            fallback={<div className="h-64 animate-pulse rounded-xl bg-ink-800" aria-hidden />}
          >
            <GameSection
              title="Playable games"
              subtitle={`${games.length} game${games.length === 1 ? '' : 's'} · real engine, real results`}
              games={games}
              favorites={favorites}
              onToggleFavorite={toggleFavorite}
              limit={games.length}
            />
            {games.length === 0 && (
              <p className="rounded-lg border border-white/10 bg-ink-800/60 p-4 text-sm text-slate-400">
                No playable games are available right now. Please check back later.
              </p>
            )}
          </Suspense>
        </div>
      </main>
      <AppFooter />
    </>
  );
}
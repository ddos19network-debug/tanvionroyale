import type { Metadata } from 'next';
import Link from 'next/link';
import { AppFooter } from '@/components/layout/app-footer';

export const metadata: Metadata = {
  title: 'Demo preview — TANVIONROYALE',
  description:
    'About the TANVIONROYALE demo game catalog: presentation tiles only — no playable game, real money, or wagering behind them.',
};

/**
 * Honest landing page for the demo game tiles (lib/data/games.ts).
 *
 * The home/catalog tiles are a presentation-only demo catalog with placeholder
 * artwork and NO backend game behind them, so every game card routes here
 * instead of a dead end or a 404. The page explains what the tile is and links
 * on to the real, backend-driven experiences: /sports (gambling-enabled games
 * and bettable events) and /games (the full tile catalog).
 */
export default function GameDemoPreviewPage({
  searchParams,
}: {
  searchParams?: { title?: string | string[] };
}) {
  const rawTitle = searchParams?.title;
  const title = typeof rawTitle === 'string' && rawTitle.trim() !== '' ? rawTitle.trim() : '';

  return (
    <>
      <main className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-2xl font-bold text-white sm:text-3xl">
          {title ? `${title} is a demo preview tile` : 'Demo preview tile'}
        </h1>

        <div className="mt-6 rounded-xl border border-white/10 bg-ink-800 p-6 text-sm text-slate-300">
          <p>
            The game tiles on the home page, the catalog, and search are a presentation-only
            demo catalog (placeholder artwork, no playable game behind them). There is no real
            money, wagering, or payment functionality attached to them.
          </p>
          <p className="mt-3">
            The real, backend-driven experience is the sports &amp; betting side of TANVIONROYALE:
            sports pages, game detail pages, and bettable events served by the TANVIONROYALE API.
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/sports"
            className="rounded-lg bg-brand px-4 py-2 text-center text-sm font-semibold text-ink-950 transition hover:bg-brand-dark"
          >
            Browse real sports &amp; bettable games
          </Link>
          <Link
            href="/games"
            className="rounded-lg border border-white/10 px-4 py-2 text-center text-sm font-semibold text-white transition hover:bg-white/10"
          >
            Back to the game catalog
          </Link>
        </div>
      </main>
      <AppFooter />
    </>
  );
}
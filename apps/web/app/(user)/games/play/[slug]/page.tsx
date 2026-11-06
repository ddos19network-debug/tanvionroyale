'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AppFooter } from '@/components/layout/app-footer';
import { RoyaleFlyGame } from '@/components/games/crash-game';
import RoyaleAceSlot from '@/components/games/ace-slot-game';
import { RoyaleTimeGame } from '@/components/games/roulette/roulette-game';
import { PharaohGame } from '@/components/games/royale-pharaoh/PharaohGame';
import { AtlantisGame } from '@/components/games/atlantis-game';
import { SlotGame } from '@/components/games/slot-game';
import { getFreePlayGame } from '@/lib/data/games';

/**
 * Free-play game launcher.
 *
 * ONLY internally developed free-play games (kind 'freeplay' in the catalog)
 * are playable here — every other tile remains a clearly-labelled demo preview
 * (see /games/demo-preview). Unknown slugs fall back to a 404-style message.
 */
export default function FreePlayGamePage() {
  const params = useParams<{ slug: string }>();
  const slug = typeof params?.slug === 'string' ? params.slug : '';
  const game = getFreePlayGame(slug);

  if (!game) {
    return (
      <>
        <main className="mx-auto max-w-2xl px-4 py-16 text-center">
          <h1 className="text-2xl font-bold text-white">Game not found</h1>
          <p className="mt-2 text-sm text-slate-400">
            This game is not available for free play. Try the free-play catalog instead.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link href="/games" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brand-dark">
              Back to games
            </Link>
            <Link href="/games/demo-preview" className="rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
              About demo tiles
            </Link>
          </div>
        </main>
        <AppFooter />
      </>
    );
  }

  if (game.slug === 'royale-fly' || game.slug === 'sky-rocket') {
    return (
      <main className="h-screen max-h-screen w-full bg-[#0b0c10] overflow-y-auto lg:overflow-hidden">
        <RoyaleFlyGame />
      </main>
    );
  }

  if (game.slug === 'royale-ace') {
    return (
      <main className="min-h-[100dvh] w-full bg-[#071522] pb-[env(safe-area-inset-bottom)]">
        <RoyaleAceSlot />
      </main>
    );
  }

  if (game.slug === 'royale-time') {
    return (
      <main className="min-h-[100dvh] w-full bg-[#070b14] pb-[env(safe-area-inset-bottom)]">
        <RoyaleTimeGame />
      </main>
    );
  }

  if (game.slug === 'royale-pharaoh') {
    return (
      <main className="min-h-[100dvh] w-full bg-slate-950 pb-[env(safe-area-inset-bottom)]">
        <PharaohGame />
      </main>
    );
  }

  if (game.slug === 'royale-atlantis') {
    return (
      <main className="min-h-[100dvh] w-full bg-slate-950 pb-[env(safe-area-inset-bottom)]">
        <AtlantisGame />
      </main>
    );
  }

  const slotSlugs = ['neon-cyber-rush','mystic-forest','samurai-fortune','cosmic-odyssey','dragons-kingdom','tropical-paradise','steampunk-revolution','frozen-empire'];
  if (slotSlugs.includes(game.slug ?? '')) {
    return (
      <main className="min-h-[100dvh] w-full bg-[#0b0c10] pb-[env(safe-area-inset-bottom)]">
        <SlotGame slug={game.slug!} title={game.title} />
      </main>
    );
  }


  return (
    <>
      <main className="mx-auto max-w-4xl px-4 py-8 pb-24 sm:pb-10">
        <nav className="text-sm text-slate-500">
          <Link href="/games" className="hover:underline">Games</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-300">{game.title}</span>
        </nav>
        <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">{game.title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">{game.provider} · {game.category}</p>

        <div className="mt-6">
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            This free-play game is registered in the catalog but has no playable engine yet.
          </p>
        </div>
      </main>
      <AppFooter />
    </>
  );
}

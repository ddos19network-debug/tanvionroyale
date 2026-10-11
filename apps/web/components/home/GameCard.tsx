'use client';

import Link from 'next/link';
import type { Game } from '@/lib/data/games';

interface GameCardProps {
  game: Game;
  favorite?: boolean;
  onToggleFavorite?: (id: string) => void;
}

const badgeStyles: Record<NonNullable<Game['badge']>, string> = {
  HOT: 'bg-red-500 text-white',
  NEW: 'bg-brand text-ink-950',
  LIVE: 'bg-amber-400 text-ink-950',
};

/** FREE PLAY badge — only shown for internally developed, truly playable games. */
const FREE_PLAY_BADGE = 'bg-emerald-500 text-ink-950';

/**
 * Reusable game card. Responsive grid sizing is controlled by the parent
 * grid (grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6) — the
 * card itself never forces a fixed width, avoiding horizontal overflow.
 *
 * Catalog entries are separated by `kind`:
 *  - `demo`      → placeholder tiles with no backend game; the card routes to
 *                  /games/demo-preview (an honest explainer).
 *  - `freeplay`  → internally developed, REAL playable games; the card routes
 *                  to /games/play/<slug> (full engine + persisted results).
 *  - `third-party` (future) → reserved; falls back to demo-preview until a
 *                  licensed launch flow exists.
 * A stretched cover link makes the artwork area clickable without nesting
 * interactive elements inside an anchor; the favorite button and play action
 * sit above it (z-10).
 */
export function GameCard({ game, favorite = false, onToggleFavorite }: GameCardProps) {
  const isFreePlay = game.kind === 'freeplay' && Boolean(game.slug);
  const demoHref = `/games/demo-preview?title=${encodeURIComponent(game.title)}`;
  const playHref = isFreePlay && game.slug ? `/games/play/${game.slug}` : demoHref;
  const playLabel = isFreePlay ? 'Play free' : 'Play demo';
  const openLabel = isFreePlay ? `Launch ${game.title} free play` : `Open ${game.title} demo preview`;
  return (
    <article className="group relative overflow-hidden rounded-xl border border-white/10 bg-ink-800 transition duration-200 hover:-translate-y-1 hover:border-brand/60 hover:shadow-[0_8px_30px_rgba(20,184,166,0.15)]">
      {/* Placeholder artwork: original CSS gradient tile, no external assets */}
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-gradient-to-br sm:aspect-square">
        <div className={`absolute inset-0 bg-gradient-to-br ${game.image} transition duration-300 group-hover:scale-105`} />
        <div className="absolute inset-0 flex items-center justify-center p-2">
          <span className="text-center text-sm font-extrabold uppercase tracking-wide text-white/90 drop-shadow line-clamp-3 sm:text-base">
            {game.title}
          </span>
        </div>

        {game.badge && (
          <span
            className={`absolute left-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${badgeStyles[game.badge]}`}
          >
            {game.badge}
          </span>
        )}

        {isFreePlay && (
          <span
            className={`absolute left-2 z-10 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${FREE_PLAY_BADGE} ${
              game.badge ? 'top-8' : 'top-2'
            }`}
          >
            FREE PLAY
          </span>
        )}

        {/* Stretched cover link — makes the whole artwork area clickable while
            the heart and play actions stay above it (z-10). */}
        <Link href={playHref} className="absolute inset-0 z-0">
          <span className="sr-only">{openLabel}</span>
        </Link>

        <button
          type="button"
          aria-label={favorite ? `Remove ${game.title} from favorites` : `Add ${game.title} to favorites`}
          aria-pressed={favorite}
          onClick={() => onToggleFavorite?.(game.id)}
          className={`absolute right-2 top-2 z-10 rounded-full p-1.5 transition ${
            favorite ? 'bg-red-500/90 text-white' : 'bg-black/40 text-white/80 hover:bg-black/60 hover:text-white'
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={favorite ? 'currentColor' : 'none'} aria-hidden>
            <path
              d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
        </button>

        {/* Hover overlay with play/demo action */}
        <div className="absolute inset-x-0 bottom-0 z-10 flex translate-y-full items-center justify-center bg-gradient-to-t from-black/80 to-transparent p-3 transition duration-200 group-hover:translate-y-0 focus-within:translate-y-0">
          <Link
            href={playHref}
            className="w-full rounded-lg bg-brand px-3 py-1.5 text-center text-xs font-semibold text-ink-950 transition hover:bg-brand-dark"
            aria-label={openLabel}
          >
            {playLabel}
          </Link>
        </div>
      </div>

      <div className="p-2.5 sm:p-3">
        <h3 className="truncate text-xs font-semibold text-white sm:text-sm">{game.title}</h3>
        <p className="mt-0.5 truncate text-[11px] text-slate-400">
          {game.provider} · {game.category}
        </p>
      </div>
    </article>
  );
}
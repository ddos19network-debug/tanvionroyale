/**
 * Partner game card — BIG CASINO / BIG LIVE CASINO tiles.
 *
 * Reuses the EXACT TANVIONROYALE card shell (rounded-xl, white/10 border,
 * ink-800 background, brand hover) from GameCard so the new sections look like
 * the same website. Partner thumbnails are remote images; when the provider
 * supplies none (sync not run / no thumbnail), the same gradient-tile style is
 * used as a loading shell — never a fake game list.
 */
'use client';

import Link from 'next/link';
import type { CatalogGame } from '@tanvion-royale/types';

interface CasinoGameCardProps {
  game: CatalogGame;
  product: 'casino' | 'live';
  href: string | null;
  favorite?: boolean;
  onToggleFavorite?: (id: string) => void;
}

export function CasinoGameCard({ game, href, favorite = false, onToggleFavorite }: CasinoGameCardProps) {
  const launchLabel = href ? `Launch ${game.name}` : `${game.name} is currently unavailable`;
  return (
    <article className="group relative overflow-hidden rounded-xl border border-white/10 bg-ink-800 transition duration-200 hover:-translate-y-1 hover:border-brand/60 hover:shadow-[0_8px_30px_rgba(20,184,166,0.15)]">
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-gradient-to-br from-ink-700 to-ink-900 sm:aspect-square">
        {game.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote provider art; next/image allowlist must not be widened for untrusted hosts
          <img
            src={game.thumbnail}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <>
            <div className="absolute inset-0 bg-gradient-to-br from-teal-700/60 to-ink-900 transition duration-300 group-hover:scale-105" />
            <div className="absolute inset-0 flex items-center justify-center p-2">
              <span className="line-clamp-3 text-center text-sm font-extrabold uppercase tracking-wide text-white/90 drop-shadow sm:text-base">
                {game.name}
              </span>
            </div>
          </>
        )}

        {game.isFeatured && (
          <span className="absolute left-2 top-2 rounded-md bg-brand px-1.5 py-0.5 text-[10px] font-bold text-ink-950">
            FEATURED
          </span>
        )}

        {href ? (
          <Link href={href} className="absolute inset-0 z-0">
            <span className="sr-only">{launchLabel}</span>
          </Link>
        ) : (
          <span className="absolute inset-0 z-0" aria-hidden />
        )}

        <button
          type="button"
          aria-label={favorite ? `Remove ${game.name} from favorites` : `Add ${game.name} to favorites`}
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

        <div className="absolute inset-x-0 bottom-0 z-10 flex translate-y-full items-center justify-center bg-gradient-to-t from-black/80 to-transparent p-3 transition duration-200 group-hover:translate-y-0 focus-within:translate-y-0">
          {href ? (
            <Link
              href={href}
              className="w-full rounded-lg bg-brand px-3 py-1.5 text-center text-xs font-semibold text-ink-950 transition hover:bg-brand-dark"
              aria-label={launchLabel}
            >
              Play now
            </Link>
          ) : (
            <span className="w-full rounded-lg bg-ink-700 px-3 py-1.5 text-center text-xs font-semibold text-slate-400">
              Unavailable
            </span>
          )}
        </div>
      </div>

      <div className="p-2.5 sm:p-3">
        <h3 className="truncate text-xs font-semibold text-white sm:text-sm">{game.name}</h3>
        <p className="mt-0.5 truncate text-[11px] text-slate-400">
          {game.provider} · {game.category ?? 'Casino'}
        </p>
      </div>
    </article>
  );
}

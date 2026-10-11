'use client';

import { GameCard } from './GameCard';
import type { Game } from '@/lib/data/games';

interface GameSectionProps {
  title: string;
  subtitle?: string;
  games: Game[];
  favorites?: Set<string>;
  onToggleFavorite?: (id: string) => void;
  /** "grid" renders a responsive grid; "scroll" renders a horizontal scroller. */
  layout?: 'grid' | 'scroll';
  limit?: number;
}

/**
 * Data-driven, reusable section — every game section on the home page
 * renders through this component (no per-section JSX duplication).
 * Desktop: 4–6 per row depending on width; tablet 3–4; mobile 2.
 */
export function GameSection({
  title,
  subtitle,
  games,
  favorites,
  onToggleFavorite,
  layout = 'grid',
  limit = 6,
}: GameSectionProps) {
  const items = games.slice(0, limit);

  return (
    <section aria-labelledby={`section-${title.replace(/\s+/g, '-').toLowerCase()}`}>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 id={`section-${title.replace(/\s+/g, '-').toLowerCase()}`} className="text-lg font-bold text-white sm:text-xl">
            {title}
          </h2>
          {subtitle ? <p className="mt-0.5 text-xs text-slate-400 sm:text-sm">{subtitle}</p> : null}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-white/10 bg-ink-800/60 p-4 text-sm text-slate-400">
          Nothing here yet — check back soon.
        </p>
      ) : layout === 'scroll' ? (
        <ul className="no-scrollbar -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
          {items.map((game) => (
            <li key={game.id} className="w-36 shrink-0 snap-start sm:w-44 lg:w-48">
              <GameCard
                game={game}
                favorite={favorites?.has(game.id) ?? false}
                onToggleFavorite={onToggleFavorite}
              />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {items.map((game) => (
            <li key={game.id} className="min-w-0">
              <GameCard
                game={game}
                favorite={favorites?.has(game.id) ?? false}
                onToggleFavorite={onToggleFavorite}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
'use client';

import { GameSection } from './GameSection';
import { useFavorites } from '@/hooks/use-favorites';
import { games } from '@/lib/data/games';

/** Client-side favorites view — reuses GameSection, no duplicated card JSX. */
export function FavoritesContent() {
  const { favorites, toggleFavorite, ready } = useFavorites();

  const favoriteGames = games.filter((game) => favorites.has(game.id));

  if (!ready) return null;

  return (
    <GameSection
      title="Saved games"
      subtitle={`${favoriteGames.length} games`}
      games={favoriteGames}
      favorites={favorites}
      onToggleFavorite={toggleFavorite}
      limit={games.length}
    />
  );
}
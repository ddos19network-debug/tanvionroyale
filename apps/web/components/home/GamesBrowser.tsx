'use client';

import { useSearchParams } from 'next/navigation';
import { GameSection } from './GameSection';
import { useFavorites } from '@/hooks/use-favorites';
import { CasinoCatalogSection } from '@/components/casino/casino-catalog-section';
import { freeplayGames } from '@/lib/data/games';

/**
 * Games page catalog (the parameterless `/games` route).
 *
 * The partner/provider catalog is the REAL public catalog
 * (`GET /api/v1/casino/catalog?product=casino`), read through
 * `CasinoCatalogSection`, so every active provider's games are listed here.
 *
 * QUERY PARAMS (legacy links keep working):
 *   (none)       → ALL active/visible providers
 *   ?provider=X  → that provider only (X is a provider row id; an unknown value
 *                  yields an honest empty result instead of breaking the page)
 *   ?category=X  → that category slug
 *   `?provider=` (blank) is normalised to null = ALL providers, so an empty
 *   filter can never mean `WHERE provider_id = ''`.
 */
export function GamesBrowser() {
  const searchParams = useSearchParams();
  const { favorites, toggleFavorite } = useFavorites();

  const providerParam = searchParams.get('provider');
  const initialProvider = providerParam?.trim() ? providerParam.trim() : null;
  const categoryParam = searchParams.get('category');
  const initialCategory = categoryParam?.trim() ? categoryParam.trim() : null;

  const visibleInternal = freeplayGames();

  return (
    <div className="flex flex-col gap-8">
      <CasinoCatalogSection
        product="casino"
        heading={initialProvider ? 'Provider games' : 'All provider games'}
        description="Every game from every active provider, served by the TANVIONROYALE backend."
        initialProvider={initialProvider}
        initialCategory={initialCategory}
        showProviders
      />

      {visibleInternal.length > 0 && (
        <GameSection
          title="Royale Play"
          subtitle="Free-play games built and hosted by TANVIONROYALE"
          games={visibleInternal}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          layout="scroll"
        />
      )}
    </div>
  );
}
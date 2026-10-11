// ---------------------------------------------------------------------------
// Sports / Games catalog (Phase 4)
// ---------------------------------------------------------------------------

export type CatalogStatus = 'ACTIVE' | 'INACTIVE';
export type ProviderMappingStatus = 'ACTIVE' | 'INACTIVE';

/** Public sport representation — safe to expose to any user. */
export interface PublicSport {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  status: CatalogStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Gambling availability as seen by normal users. */
export interface PublicGameAvailability {
  gamblingEnabled: boolean;
  /** True only when game ACTIVE + gamblingEnabled + active provider mapping. */
  gamblingAvailable: boolean;
}

/** Public game representation — never exposes provider identifiers/secrets. */
export interface PublicGame {
  id: string;
  sportId: string;
  name: string;
  slug: string;
  description: string | null;
  status: CatalogStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  availability: PublicGameAvailability | null;
  /** Present only when a provider mapping is active; name only, no secrets. */
  providerName: string | null;
}

/** Sport detail with its active games. */
export interface SportWithGames extends PublicSport {
  games: PublicGame[];
}

/** Admin-facing sport (includes internal id/status manipulation). */
export type AdminSport = PublicSport;

/** Admin-facing game — includes provider mapping details. */
export interface AdminGame extends PublicGame {
  providerMapping: {
    id: string;
    providerName: string;
    externalGameId: string;
    status: ProviderMappingStatus;
  } | null;
}

/**
 * Generic API envelope so every response has a stable, inspectable shape.
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  requestId?: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Standard health status payload.
 */
export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  service: string;
  checks: Record<string, 'up' | 'down' | 'unknown'>;
  timestamp: string;
}
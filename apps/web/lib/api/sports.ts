/**
 * Frontend sports/games API (Phase 4 — sports catalog).
 * All calls go through the TANVIONROYALE backend — never to a provider.
 */
import { apiFetch } from './client';
import type { PublicCompetition, PublicGame, PublicSport, SportWithGames } from '@tanvion-royale/types';

export async function listSports(): Promise<PublicSport[]> {
  return apiFetch<PublicSport[]>('/sports');
}

export async function getSport(slug: string): Promise<SportWithGames> {
  return apiFetch<SportWithGames>(`/sports/${encodeURIComponent(slug)}`);
}

export async function getSportGames(slug: string): Promise<PublicGame[]> {
  return apiFetch<PublicGame[]>(`/sports/${encodeURIComponent(slug)}/games`);
}

export async function getSportCompetitions(slug: string): Promise<PublicCompetition[]> {
  return apiFetch<PublicCompetition[]>(`/sports/${encodeURIComponent(slug)}/competitions`);
}

export async function getGame(slug: string): Promise<PublicGame> {
  return apiFetch<PublicGame>(`/games/${encodeURIComponent(slug)}`);
}

/**
 * Client API for Royale Play slot games (Games #4 to #13).
 *
 * GET  /games/play/:slug/slot/config (public)
 * POST /games/play/:slug/slot/spin   (auth required)
 * GET  /games/play/:slug/slot/rounds (auth required)
 */

import { apiFetch, authFetch } from './client';
import type {
  SlotConfigView,
  SlotSpinRequest,
  SlotSpinResponse,
  SlotRoundHistoryEntry,
} from '@tanvion-royale/types';

export async function getSlotConfig(slug: string): Promise<SlotConfigView> {
  return apiFetch<SlotConfigView>(`/games/play/${slug}/slot/config`);
}

export async function postSlotSpin(
  slug: string,
  req: SlotSpinRequest,
): Promise<SlotSpinResponse> {
  return authFetch<SlotSpinResponse>(`/games/play/${slug}/slot/spin`, {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function getSlotRounds(
  slug: string,
): Promise<SlotRoundHistoryEntry[]> {
  return authFetch<SlotRoundHistoryEntry[]>(`/games/play/${slug}/slot/rounds`);
}

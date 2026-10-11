/**
 * Profile-center API client (account summary + activity + history).
 * All calls go through the TANVIONROYALE backend with the stored JWT;
 * userId always comes from the token server-side.
 */
import { authFetch } from './client';

export interface ProfileSummary {
  wallet: { availableBalance: number; lockedBalance: number; currency: string } | null;
  totalDeposited: number;
  totalWithdrawn: number;
  pendingWithdrawals: number;
  totalBets: number;
  settledBets: number;
  totalWins: number;
  totalLosses: number;
  totalStaked: number;
  totalPayout: number;
  totalGames: number;
  totalCrashBets: number;
  currency: string;
}

export interface ActivityItem {
  id: string;
  kind: 'SPORTS' | 'GAMES' | 'CRASH' | 'DEPOSIT' | 'WITHDRAWAL' | 'WALLET' | 'PROFILE';
  title: string;
  subtitle: string | null;
  amount: number | null;
  currency: string | null;
  status: string;
  createdAt: string;
  refId: string | null;
}

export interface Paged<T> {
  items: T[];
  page: number;
  limit: number;
}

export interface ActivityFilters {
  type?: string;
  status?: string;
  range?: string;
  limit?: number;
  page?: number;
  search?: string;
}

function qsOf(obj: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    if (v === 'ALL') continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function getProfileSummary(): Promise<ProfileSummary> {
  return authFetch<ProfileSummary>('/users/me/summary');
}

export async function listActivity(filters: ActivityFilters = {}): Promise<Paged<ActivityItem>> {
  return authFetch<Paged<ActivityItem>>(`/users/me/activity${qsOf(filters as Record<string, unknown>)}`);
}

export interface GameResultItem {
  id: string;
  gameSlug: string;
  score: number;
  outcome: string;
  message: string | null;
  createdAt: string;
}

export async function listMyGameResults(filters: { limit?: number; page?: number; search?: string } = {}) {
  return authFetch<Paged<GameResultItem>>(`/users/me/games${qsOf(filters as Record<string, unknown>)}`);
}

export interface CrashHistoryItem {
  id: string;
  roundId: string;
  roundNumber: number;
  crashMultiplier: number | null;
  stake: number;
  currency: string;
  status: string;
  cashoutMultiplier: number | null;
  payout: number | null;
  result: string | null;
  placedAt: string;
  cashoutAt: string | null;
  settledAt: string | null;
}

export async function listMyCrash(filters: { limit?: number; page?: number } = {}) {
  return authFetch<Paged<CrashHistoryItem>>(`/users/me/crash${qsOf(filters as Record<string, unknown>)}`);
}

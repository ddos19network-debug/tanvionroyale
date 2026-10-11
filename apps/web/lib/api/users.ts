/**
 * Frontend users API (Phase 3 — account & dashboard).
 */
import { apiFetch, authFetch } from './client';
import type { PublicUser, SessionInfo } from '@tanvion-royale/types';

export async function getMe(): Promise<PublicUser> {
  return authFetch<PublicUser>('/users/me');
}

export interface UpdateProfilePayload {
  username?: string;
  firstName?: string;
  lastName?: string;
  country?: string;
  timezone?: string;
  phone?: string;
}

export async function updateProfile(payload: UpdateProfilePayload): Promise<PublicUser> {
  return authFetch<PublicUser>('/users/me', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/** Username rules mirror the backend RegisterDto/UpdateProfileDto. */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

export function validateUsername(value: string): string | null {
  const v = value.trim();
  if (v.length < 3) return 'Username must be at least 3 characters';
  if (v.length > 32) return 'Username must be at most 32 characters';
  if (!USERNAME_PATTERN.test(v)) return 'Username may only contain letters, numbers and underscores';
  return null;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await authFetch<unknown>('/users/me/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function listSessions(): Promise<SessionInfo[]> {
  return authFetch<SessionInfo[]>('/users/me/sessions');
}

export async function revokeSession(sessionId: string): Promise<void> {
  await authFetch<unknown>(`/users/me/sessions/${sessionId}`, { method: 'DELETE' });
}

export async function logoutCurrentSession(): Promise<void> {
  await authFetch<unknown>('/auth/logout', { method: 'POST' });
}

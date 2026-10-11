/**
 * Admin route authorization (Phase 3).
 *
 * The authoritative logged-in user comes from GET /api/v1/auth/me (server
 * truth), and the authoritative ROLE check is GET /api/v1/admin/access —
 * the backend 403s any non-admin. This module never decides authorization
 * by itself; it only interprets the backend's answers.
 *
 * Expired access tokens are handled by the EXISTING refresh mechanism inside
 * authFetch (single rotation + retry, then redirect to /login on failure).
 */
import type { PublicUser } from '@tanvion-royale/types';
import { authFetch, ApiClientError } from '@/lib/api/client';
import { checkAdminAccess } from '@/lib/api/admin';
import { getAccessToken } from './session';

export type AdminAccessState =
  | { status: 'loading' }
  | { status: 'ok'; user: PublicUser; roles: string[]; permissions: string[]; isMasterAdmin: boolean }
  | { status: 'unauthenticated' }
  | { status: 'forbidden' }
  | { status: 'error'; message: string };

export async function resolveAdminAccess(): Promise<AdminAccessState> {
  if (typeof window === 'undefined') return { status: 'loading' };

  // No stored session at all → straight to login, zero admin API calls.
  if (!getAccessToken()) return { status: 'unauthenticated' };

  try {
    // /api/v1/auth/me — the authoritative logged-in user (session validated,
    // revoked/expired sessions rejected by the backend boundary).
    const user = await authFetch<PublicUser>('/auth/me');

    try {
      const access = await checkAdminAccess();
      return {
        status: 'ok',
        user,
        roles: access.roles,
        permissions: access.permissions,
        isMasterAdmin: access.isMasterAdmin,
      };
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 403) {
        return { status: 'forbidden' };
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof ApiClientError) {
      // authFetch already exhausted the existing refresh flow for 401s.
      if (error.status === 401) return { status: 'unauthenticated' };
      if (error.status === 403) return { status: 'forbidden' };
    }
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Failed to verify your session.',
    };
  }
}

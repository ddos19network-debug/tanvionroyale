/**
 * Minimal session store (Phase 2, hardened for Google + phone logins).
 *
 * Behavior guarantees:
 *  - accessToken / refreshToken / user persist in localStorage under stable keys.
 *  - ROUTE-SCOPED callbacks (/oauth/callback) never clear the stored session —
 *    clearing is reserved for definitive backend auth verdicts (see the API
 *    client: only 401/403 on /auth/refresh or /auth/me).
 *  - saveSession()/clearSession() dispatch a same-tab window event so in-app
 *    consumers (AuthProvider, route guards) re-sync IMMEDIATELY. This closes the
 *    race where a freshly saved session was invisible to the already-mounted
 *    AuthProvider until the next full page load — the exact cause of
 *    "logged in, then bounced back to /login immediately".
 *
 * A temporary network/Render cold-start failure must NEVER clear the session:
 * clearSession() is only called with a definitive auth reason (invalid,
 * expired or revoked token; disabled / suspended / closed / locked account).
 */
import type { PublicUser } from '@tanvion-royale/types';

const ACCESS_KEY = 'ng.access';
const REFRESH_KEY = 'ng.refresh';
const USER_KEY = 'ng.user';

/** Custom window event fired after every session store mutation. */
export const SESSION_CHANGED_EVENT = 'ng:session-changed';

/** Why the local session was cleared — informational only, never persisted. */
export type SessionClearReason =
  | 'logout'
  | 'invalid-refresh-token'
  | 'session-revoked'
  | 'session-expired'
  | 'account-disabled';

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

function notifySessionChanged(action: 'saved' | 'cleared', reason?: SessionClearReason): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(SESSION_CHANGED_EVENT, { detail: { action, reason: reason ?? null } }),
  );
}

/**
 * Narrow runtime guard for the cached PublicUser. The stored user is JSON we
 * wrote ourselves, but defensive validation is what keeps a bad write (e.g. a
 * refresh response without `user`) from corrupting the session store.
 */
function isPublicUserShape(value: unknown): value is PublicUser {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PublicUser).id === 'string' &&
    typeof (value as PublicUser).username === 'string'
  );
}

/** Reads and validates the cached user WITHOUT touching the token keys. */
function readStoredUser(): PublicUser | null {
  const userJson = localStorage.getItem(USER_KEY);
  if (!userJson) return null;
  try {
    const parsed: unknown = JSON.parse(userJson);
    return isPublicUserShape(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession): void {
  localStorage.setItem(ACCESS_KEY, session.accessToken);
  localStorage.setItem(REFRESH_KEY, session.refreshToken);
  /*
   * NEVER overwrite a good cached user with nothing. A refresh response that
   * carries no `user` once made this write JSON.stringify(undefined) — the
   * literal string "undefined" — into USER_KEY, so every later JSON.parse
   * threw, getSession() returned null, and the whole browser looked logged out
   * on the next reload/new tab. Merge instead: the newest VALID user wins, and
   * a userless payload simply keeps the previously cached one.
   */
  const user = isPublicUserShape(session.user) ? session.user : readStoredUser();
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
  notifySessionChanged('saved');
}

export function getSession(): StoredSession | null {
  const accessToken = localStorage.getItem(ACCESS_KEY);
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!accessToken || !refreshToken) return null;
  const user = readStoredUser();
  if (!user) {
    /*
     * Self-heal a corrupted/missing user cache: drop ONLY the bad user key and
     * KEEP the authoritative tokens. The auth provider restores the full
     * session from the still-valid refresh token instead of logging the user
     * out (UNKNOWN → RESTORING_SESSION → AUTHENTICATED).
     */
    localStorage.removeItem(USER_KEY);
    return null;
  }
  return { accessToken, refreshToken, user };
}

/**
 * Clears the stored session. Callers MUST pass a definitive reason — transient
 * failures (502/503/504, network errors) must never reach this function.
 */
export function clearSession(reason: SessionClearReason = 'logout'): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
  notifySessionChanged('cleared', reason);
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}
/**
 * Updates ONLY the cached user inside the stored session (e.g. right after a
 * phone/email verification changed phoneVerified/emailVerified) and returns
 * the refreshed stored session. Returns null when no session exists.
 */
export function updateStoredUser(user: PublicUser): StoredSession | null {
  const current = getSession();
  if (!current) return null;
  const next: StoredSession = { ...current, user };
  saveSession(next);
  return next;
}


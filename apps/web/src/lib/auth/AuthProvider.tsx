'use client';

/**
 * Canonical AuthProvider - the ONLY React auth context for the web app.
 *
 * Session data lives in localStorage via `@/lib/auth/session`. This provider
 * hydrates from localStorage on mount, validates via GET /auth/me through the
 * shared authFetch client (single refresh rotation, retry exactly once), and
 * re-syncs instantly on the `ng:session-changed` event so saveSession() +
 * router.replace() never leaves stale state behind (the post-Google-login
 * bounce bug). Transient failures (502/503/504, network) NEVER clear the
 * session; only definitive 401/403 verdicts or explicit logout() do.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import type { PublicUser } from '@tanvion-royale/types';
import { authFetch, ApiClientError, refreshAuthSession } from '@/lib/api/client';
import {
  clearSession,
  getRefreshToken,
  getSession,
  SESSION_CHANGED_EVENT,
  type StoredSession,
} from '@/lib/auth/session';

export type { StoredSession };

export interface AuthState {
  ready: boolean;
  isAuthenticated: boolean;
  user: PublicUser | null;
  transientError: boolean;
}

export interface AuthActions {
  fetchUser: () => Promise<PublicUser | null>;
  refresh: () => Promise<PublicUser | null>;
  logout: () => Promise<void>;
}

export type AuthContextValue = AuthState & AuthActions;

const AuthContext = createContext<AuthContextValue | null>(null);

function readLocalSession(): StoredSession | null {
  try {
    return getSession();
  } catch {
    return null;
  }
}

/**
 * Raw refresh-token lookup for the restore path: unlike getSession(), this
 * survives a missing/corrupt cached user so the session can be REBUILT from
 * the still-valid refresh token instead of declaring the browser logged out.
 */
function readStoredRefreshToken(): string | null {
  try {
    return getRefreshToken();
  } catch {
    return null;
  }
}

async function loadMe(): Promise<PublicUser> {
  return authFetch<PublicUser>('/auth/me');
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const seedRef = useRef<StoredSession | null | undefined>(undefined);
  if (seedRef.current === undefined) {
    seedRef.current = readLocalSession();
  }
  const seed = seedRef.current;

  const [user, setUser] = useState<PublicUser | null>(seed?.user ?? null);
  const [ready, setReady] = useState(false);
  const [transientError, setTransientError] = useState(false);
  const validatingRef = useRef(false);
  const userRef = useRef<PublicUser | null>(seed?.user ?? null);
  userRef.current = user;

  const fetchUser = useCallback(async (): Promise<PublicUser | null> => {
    if (validatingRef.current) return userRef.current;
    validatingRef.current = true;
    try {
      const me = await loadMe();
      setUser(me);
      setTransientError(false);
      setReady(true);
      return me;
    } catch (error) {
      if (error instanceof ApiClientError && error.transient) {
        setTransientError(true);
        setReady(true);
        return userRef.current;
      }
      if (error instanceof ApiClientError && (error.status === 401 || error.status === 403)) {
        setUser(null);
        setTransientError(false);
        setReady(true);
        return null;
      }
      const local = readLocalSession();
      setUser(local?.user ?? userRef.current);
      setTransientError(true);
      setReady(true);
      return local?.user ?? userRef.current;
    } finally {
      validatingRef.current = false;
    }
  }, []);

  const refresh = useCallback(async (): Promise<PublicUser | null> => {
    const ok = await refreshAuthSession();
    if (!ok) {
      const local = readLocalSession();
      if (local) {
        setTransientError(true);
        return local.user;
      }
      setUser(null);
      setReady(true);
      return null;
    }
    return fetchUser();
  }, [fetchUser]);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await authFetch<unknown>('/auth/logout', { method: 'POST' });
    } catch {
      // Best effort - local state is authoritative for the UI.
    }
    clearSession('logout');
    setUser(null);
    setTransientError(false);
    setReady(true);
    router.replace('/login');
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = readLocalSession();
      if (!local) {
        /*
         * UNKNOWN → RESTORING_SESSION. Tokens may still be present even when
         * the cached user is missing or corrupt (interrupted write, legacy
         * cache). A stored refresh token is authoritative: rebuild the full
         * session from it BEFORE declaring the browser unauthenticated, so a
         * reload never bounces a valid user to /login. `ready` stays false
         * during the restore, which keeps protected routes from redirecting.
         */
        const storedRefreshToken = readStoredRefreshToken();
        if (storedRefreshToken) {
          const restored = await refreshAuthSession();
          const next = restored ? readLocalSession() : null;
          if (cancelled) return;
          if (next) {
            setUser(next.user);
            setTransientError(false);
            setReady(true);
            return;
          }
          // Definitive refresh failure already cleared storage — fall through
          // to the unauthenticated verdict below.
        }
        if (!cancelled) {
          setUser(null);
          setReady(true);
        }
        return;
      }
      if (!cancelled) setUser(local.user);
      try {
        const me = await loadMe();
        if (!cancelled) {
          setUser(me);
          setTransientError(false);
          setReady(true);
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiClientError && error.transient) {
          setTransientError(true);
          setReady(true);
          return;
        }
        if (error instanceof ApiClientError && (error.status === 401 || error.status === 403)) {
          setUser(null);
          setTransientError(false);
          setReady(true);
          return;
        }
        setTransientError(true);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ action: string }>).detail;
      if (detail?.action === 'saved') {
        const next = readLocalSession();
        setUser(next?.user ?? null);
        setTransientError(false);
        setReady(true);
      } else if (detail?.action === 'cleared') {
        setUser(null);
        setTransientError(false);
        setReady(true);
      }
    };
    window.addEventListener(SESSION_CHANGED_EVENT, onChange);
    const onStorage = () => {
      const next = readLocalSession();
      setUser(next?.user ?? null);
      setReady(true);
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(SESSION_CHANGED_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      isAuthenticated: user !== null,
      user,
      transientError,
      fetchUser,
      refresh,
      logout,
    }),
    [ready, user, transientError, fetchUser, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}


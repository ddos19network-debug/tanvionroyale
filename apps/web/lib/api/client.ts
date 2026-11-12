import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  saveSession,
} from '@/lib/auth/session';
import type { PublicUser } from '@tanvion-royale/types';

/**
 * Shared API client settings for the frontend.
 *
 * Backend routes are exposed under:
 *   /api/v1/...
 *
 * NEXT_PUBLIC_API_URL may be configured either as:
 *
 *   https://example.com
 *
 * or:
 *
 *   https://example.com/api/v1
 *
 * The client normalizes both forms to the actual API base URL so an
 * incorrectly omitted /api/v1 suffix does not make every Admin/Trading
 * request hit a non-existing route.
 */

function normalizeApiBaseUrl(value: string): string {
  let url = value.trim().replace(/\/+$/, '');

  if (!url) {
    return url;
  }

  /*
   * The NestJS backend uses:
   *
   * app.setGlobalPrefix("api")
   * app.enableVersioning({
   *   type: VersioningType.URI,
   *   defaultVersion: "1",
   * })
   *
   * Therefore the production API root is /api/v1.
   *
   * Keep an explicitly supplied versioned URL unchanged.
   */
  if (/\/api\/v\d+$/i.test(url)) {
    return url;
  }

  /*
   * Also tolerate an API URL ending in /api.
   */
  if (/\/api$/i.test(url)) {
    return `${url}/v1`;
  }

  /*
   * If only the Render/Vercel backend origin was supplied, append the
   * actual NestJS API prefix.
   */
  return `${url}/api/v1`;
}

export function getApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;

  if (configured?.trim()) {
    return normalizeApiBaseUrl(configured);
  }

  /*
   * Never silently point a production deployment at localhost.
   */
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'NEXT_PUBLIC_API_URL must be set in production (Vercel)',
    );
  }

  return 'http://localhost:3000/api/v1';
}

// ---------------------------------------------------------------------------
// Backend Offline Circuit Breaker (prevents console spam when backend is down)
// ---------------------------------------------------------------------------
let backendOfflineUntil = 0;
if (typeof window !== 'undefined') {
  try {
    const saved = sessionStorage.getItem('tr_backend_offline_until');
    if (saved) {
      backendOfflineUntil = parseInt(saved, 10) || 0;
    }
  } catch {}
}

export function isBackendOffline(): boolean {
  if (typeof window === 'undefined') return false;
  return Date.now() < backendOfflineUntil;
}

export function markBackendOffline(cooldownMs = 60_000): void {
  backendOfflineUntil = Date.now() + cooldownMs;
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.setItem('tr_backend_offline_until', String(backendOfflineUntil));
    } catch {}
  }
}

export function resetBackendOffline(): void {
  backendOfflineUntil = 0;
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.removeItem('tr_backend_offline_until');
    } catch {}
  }
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: unknown,
    /**
     * Set by authFetch when a 401 was caused by an EXPIRED ACCESS TOKEN whose
     * follow-up refresh was inconclusive (transient backend failure).
     *
     * The session is deliberately NOT cleared in that case. Callers should
     * show a retry instead of redirecting to /login.
     */
    public transient = false,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

/**
 * Maps an API/network failure to a safe, user-facing message.
 *
 * Specific backend messages are preserved where they are actionable.
 * Generic server/network failures receive friendly fixed copy.
 *
 * HONESTY RULE: each HTTP status is answered with ITS OWN meaning. A 401 is
 * only ever reported as an expired session when the token really was
 * rejected; the two 401s that mean something else the API can actually emit
 * (a request that arrived with no token at all, and a CUSTOMER session
 * refused at a staff-only route) are reported as themselves. 403/404/408/409/
 * 429/5xx each keep a distinct message, so no non-authentication failure is
 * ever relabelled as "Your session has expired".
 *
 * Errors are never swallowed and never converted into fake success data.
 */
export function describeApiError(error: unknown): string {
  if (error instanceof ApiClientError) {
    switch (error.status) {
      case 400:
      case 422:
        return (
          error.message ||
          'The request was invalid. Please check the input and try again.'
        );

      case 401:
        // A staff-only route reached with a customer session: the session is
        // perfectly valid, it is simply the wrong kind of sign-in. Saying
        // "expired" here would send a signed-in admin to the login page.
        if (/staff sign-in session is required/i.test(error.message)) {
          return 'This page needs a staff sign-in. Please use the admin login.';
        }
        // No token reached the API at all, so nothing expired. Reported as a
        // missing sign-in instead of a false "session has expired".
        if (/^missing access token$/i.test(error.message)) {
          return 'You are not signed in. Please sign in and try again.';
        }
        return 'Your session has expired. Please sign in again.';

      case 403:
        return 'You do not have permission to perform this action.';

      case 404:
        return 'Requested resource was not found.';

      case 408:
        return 'The request took too long to complete. Please try again.';

      case 409:
        return (
          error.message ||
          'This item already exists or conflicts with another record.'
        );

      case 429:
        return 'Too many requests. Please wait a moment and try again.';

      case 502:
      case 504:
        return 'The upstream service is not responding. Please try again shortly.';

      case 503:
        return (
          error.message ||
          'Service temporarily unavailable. Please try again.'
        );

      default:
        if (error.status >= 500) {
          return 'Something went wrong on the server. Please try again.';
        }

        return error.message || 'Request failed. Please try again.';
    }
  }

  return 'Network error — please check your connection and try again.';
}

/**
 * Read an API error response safely.
 *
 * The backend normally returns:
 *
 * {
 *   success: true,
 *   data: ...
 * }
 *
 * and errors may be returned either directly or through an `error` object.
 */
type ApiErrorEnvelope = {
  success?: boolean;
  data?: unknown;
  error?: {
    message?: string;
    code?: string;
    details?: unknown;
  };
  code?: string;
  message?: string;
  details?: unknown;
};

/**
 * Unwrap the standard backend ApiResponse envelope.
 *
 * This also tolerates endpoints that return a raw payload so existing
 * endpoints are not broken while the API is being migrated.
 */
function unwrapApiResponse<T>(body: ApiErrorEnvelope): T {
  if (body.success === true) {
    return body.data as T;
  }

  return body as T;
}

/**
 * Generic unauthenticated API request.
 */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  if (isBackendOffline()) {
    throw new ApiClientError('Backend service is currently offline', 503, 'BACKEND_OFFLINE', undefined, true);
  }

  const url = buildApiUrl(path);

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      cache: 'no-store',
    });
  } catch (err) {
    // Connection refused / Network failure -> mark backend offline for 60s
    markBackendOffline(60_000);
    throw err;
  }

  // Succeeded network request -> clear offline status
  resetBackendOffline();

  const body = (await res.json().catch(() => ({}))) as ApiErrorEnvelope;

  if (!res.ok) {
    const code = body.code ?? body.error?.code;

    const message =
      body.message ??
      body.error?.message ??
      `Request failed with status ${res.status}`;

    const details = body.details ?? body.error?.details;

    throw new ApiClientError(message, res.status, code, details);
  }

  return unwrapApiResponse<T>(body);
}

/**
 * Build the final API URL.
 *
 * API functions should pass paths such as:
 *
 *   /admin/access
 *   /admin/payment-methods
 *   /admin/wallets
 *   /trading/markets
 *
 * The API base already contains /api/v1.
 */
function buildApiUrl(path: string): string {
  const base = getApiBaseUrl();

  if (!path) {
    return base;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  return `${base}${normalizedPath}`;
}

/**
 * Authenticated fetch.
 *
 * Attaches the stored bearer access token.
 *
 * When the access token expires with HTTP 401:
 *
 * 1. refresh the session exactly once
 * 2. persist the rotated token pair
 * 3. retry the original request exactly once
 *
 * A temporary backend outage must NOT log the user out.
 */
export async function authFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = getAccessToken() ?? undefined;

  if (!token) {
    throw new ApiClientError('Missing access token', 401);
  }

  try {
    return await apiFetch<T>(path, withAuth(init, token));
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401 && token) {
      const renewed = await refreshAuthSession();

      if (renewed) {
        /*
         * Retry the original request exactly once using the newly rotated
         * access token.
         */
        return apiFetch<T>(
          path,
          withAuth(init, getAccessToken() ?? undefined),
        );
      }

      /*
       * If a refresh failure was transient, preserve the session and flag
       * the error so callers can provide a retry action.
       */
      if (getAccessToken()) {
        error.transient = true;
      }
    }

    throw error;
  }
}

/**
 * Add Authorization without destroying caller-supplied headers.
 */
function withAuth(
  init: RequestInit | undefined,
  token?: string,
): RequestInit {
  return {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Refresh-token rotation - single-flight, rotation-safe, multi-tab safe
// ---------------------------------------------------------------------------

/**
 * True ONLY when the backend conclusively rejected the auth material:
 *
 * 401 = invalid/revoked/expired refresh token
 * 403 = account suspended/locked/closed
 *
 * 500/502/503/504/network errors are transient and must not automatically
 * destroy a valid local session.
 */
export function isDefinitiveAuthError(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    (error.status === 401 || error.status === 403)
  );
}

let refreshInFlight: Promise<boolean> | null = null;

/** Bound every refresh POST so a hanging backend can never deadlock tabs. */
const REFRESH_TIMEOUT_MS = 15_000;

/**
 * Cross-tab mutex (Web Locks API, best effort).
 *
 * While one tab rotates the refresh token, sibling tabs WAIT instead of
 * firing their own concurrent /auth/refresh with the (soon stale) token. The
 * lock callback re-reads the freshest token from storage, so a tab that queued
 * behind a sibling simply uses the pair the sibling just saved. Browsers
 * without the API fall through: the backend additionally accepts the previous
 * refresh-token hash for one rotation, so concurrent refreshes still converge.
 */
function withCrossTabRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const lockManager =
    typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!lockManager?.request) {
    return fn();
  }
  /*
   * lib.dom types LockGrantedCallback<T> as (lock) => T, so the async body is
   * expressed as request<Promise<T>> and flattened with Promise.resolve — the
   * runtime promise the lock request resolves with is the refresh outcome.
   */
  return Promise.resolve(
    lockManager.request<Promise<T>>('tanvion-royale:auth-refresh', () => fn()),
  );
}

/**
 * Rotate the refresh token exactly once.
 *
 * Concurrent 401 responses share this same Promise so the backend's
 * one-time refresh-token rotation is not raced by multiple requests.
 *
 * Returns:
 *   true  -> new session successfully saved
 *   false -> refresh failed (session cleared ONLY on a definitive verdict)
 */
export function refreshAuthSession(): Promise<boolean> {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = withCrossTabRefreshLock(async () => {
    /*
     * Read the token INSIDE the cross-tab lock: a sibling tab may have just
     * rotated the pair, and this tab must adopt the newest one.
     */
    const refreshToken = getRefreshToken();

    if (!refreshToken) {
      return false;
    }

    try {
      /*
       * Deliberately use apiFetch rather than authFetch.
       *
       * The refresh endpoint must not recursively trigger another refresh.
       * The request is bounded by an AbortController so a hung backend
       * surfaces as a transient failure instead of blocking forever.
       */
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
      let session: AuthResponseShape;
      try {
        session = await apiFetch<AuthResponseShape>('/auth/refresh', {
          method: 'POST',
          body: JSON.stringify({ refreshToken }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      /*
       * Persist the NEW refresh token every time.
       *
       * This is required when the backend rotates refresh tokens. saveSession
       * also keeps the cached user intact for any response that omits it.
       */
      saveSession(session);

      return true;
    } catch (error) {
      /*
       * Definitive authentication failures clear the session.
       *
       * Temporary backend/network failures preserve the current session.
       */
      if (isDefinitiveAuthError(error)) {
        /*
         * Cross-tab convergence: if another tab rotated the token pair while
         * this refresh was in flight, the 401 verdict applies to a token this
         * tab no longer stores. Adopting the newer stored session (by NOT
         * clearing) lets the next API request ride the fresh tokens instead of
         * logging the whole browser out over an intra-device race.
         */
        const adoptedToken = getRefreshToken();
        if (adoptedToken && adoptedToken !== refreshToken) {
          return false;
        }
        clearSession('invalid-refresh-token');
      }

      return false;
    } finally {
      refreshInFlight = null;
    }
  });

  return refreshInFlight;
}

interface AuthResponseShape {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  user: PublicUser;
}

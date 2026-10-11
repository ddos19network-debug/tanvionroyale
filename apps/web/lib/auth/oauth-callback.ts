/**
 * OAuth exchange - single-flight + completion tracking.
 *
 * The OAuth exchange code is ONE-TIME. This module guarantees that:
 *  - a code is POSTed at most once at a time (module-level in-flight map
 *    keyed by the EXACT code) - StrictMode double-effects, component
 *    remounts, searchParams identity changes and concurrent duplicate
 *    requests all share the SAME Promise/result;
 *  - a completed exchange is remembered for the current tab so an
 *    accidental refresh (or a browser Back to the callback URL) NEVER
 *    re-POSTs the already-consumed code;
 *  - retries are exclusively handled inside exchangeOAuthCode (transient
 *    infra failures only); this module never re-submits the code on a real
 *    400/401 rejection.
 */
import { exchangeOAuthCode, type AuthResponse } from '@/lib/api/auth';

const inFlight = new Map<string, Promise<AuthResponse>>();

const COMPLETED_KEY = 'ng.oauth.completed';

/**
 * Returns the in-flight exchange for `code`, or starts exactly one. Two or
 * more callers passing the same code get the identical Promise - no second
 * POST /auth/oauth/exchange request is ever issued while one is running.
 */
export function getOrStartExchange(code: string): Promise<AuthResponse> {
  const existing = inFlight.get(code);
  if (existing) return existing;

  const request = exchangeOAuthCode(code);
  inFlight.set(
    code,
    request.finally(() => {
      inFlight.delete(code);
    }),
  );
  return inFlight.get(code) as Promise<AuthResponse>;
}

/** Records that `code` was successfully exchanged THIS tab visit. */
export function markExchangeCompleted(code: string): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(COMPLETED_KEY, code);
  } catch {
    /* storage unavailable - the stored-session fallback still protects us */
  }
}

/** True when `code` was successfully exchanged during this tab visit. */
export function hasExchangeCompleted(code: string): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  try {
    return sessionStorage.getItem(COMPLETED_KEY) === code;
  } catch {
    return false;
  }
}
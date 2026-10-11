/**
 * Frontend auth API. All calls go through the TANVIONROYALE backend — never to a
 * licensed operator directly.
 */
import { ApiClientError, apiFetch, authFetch } from './client';
import type { PublicUser } from '@tanvion-royale/types';

export interface AuthResponse {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  user: PublicUser;
}

export async function register(input: {
  email: string;
  username: string;
  password: string;
}): Promise<PublicUser> {
  return apiFetch<PublicUser>('/auth/register', { method: 'POST', body: JSON.stringify(input) });
}

/**
 * Unified customer sign-in: ONE endpoint (POST /auth/login) for both customer
 * identifier kinds — an email/Gmail address OR a phone number — plus password.
 * The backend detects the shape (canonical E.164 phone rule, otherwise email)
 * and runs a single shared authentication path; STAFF accounts are refused
 * here (they must use adminLogin → /admin/login).
 */
export async function loginWithIdentifier(
  identifier: string,
  password: string,
): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  });
}

/**
 * Staff-only sign in (POST /auth/admin-login). Same token shape as the normal
 * login, but the backend 403s any account without ADMIN/SUPER_ADMIN. Used by
 * the dedicated /admin/login page — never by the customer login page.
 *
 * `identifier` is the staff USERNAME or the Gmail address (one combined
 * field on the staff login screen). Unknown identifier and wrong password
 * both surface as the same generic 401.
 */
export async function adminLogin(identifier: string, password: string): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/admin-login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  });
}

// ---------------------------------------------------------------------------
// Phase 11 — multi-method authentication
// ---------------------------------------------------------------------------

/**
 * Step 1 of phone signup.
 *
 * `phone` accepts a Bangladesh local number (01712345678) or any international
 * E.164 number; the API canonicalizes it and ECHOES the canonical value back as
 * `phone`. Callers MUST use that returned value for `phoneSignupVerify` — the
 * OTP is issued against the canonical identifier, so verifying with the raw
 * local format would never match.
 */
export async function phoneSignupSendOtp(input: {
  phone: string;
  password: string;
  username?: string;
  /** Referral code captured from `?ref=`; recorded once, at account creation. */
  ref?: string;
}): Promise<{ message: string; phone: string }> {
  return apiFetch<{ message: string; phone: string }>('/auth/phone/send-otp', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Step 2 of phone signup: verifies the OTP and signs the user in. */
export async function phoneSignupVerify(phone: string, code: string): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/phone/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ phone, code }),
  });
}

/**
 * Returns the provider consent URL (server-side OAuth code flow — the client
 * never sees provider tokens). Navigate the browser to the returned URL.
 *
 * A backend cold start (Render) fails this with 502/503/504 or a network
 * error; retrying is safe here because NOTHING one-time has been issued yet —
 * this is exactly what makes the "Continue with Google" button work on the
 * first click even during a cold start.
 */
export async function getOAuthRedirectUrl(
  provider: 'google' | 'facebook',
  ref?: string | null,
): Promise<string> {
  // The referral code is forwarded to the API, which puts it in a SIGNED state
  // token and resolves the owner server-side after the callback. The browser
  // never sends a referrer id, and the code is simply omitted when there is
  // none — so the common (no-referral) URL is byte-for-byte unchanged.
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const res = await runWithTransientRetry(() =>
    apiFetch<{ redirectUrl: string }>(`/auth/${provider}${query}`),
  );
  return res.redirectUrl;
}

/** Returns the provider consent URL in account-linking mode (authenticated). */
export async function getOAuthLinkUrl(provider: 'google' | 'facebook'): Promise<string> {
  const res = await authFetch<{ redirectUrl: string }>(`/auth/${provider}/link`);
  return res.redirectUrl;
}

/**
 * Gateway statuses that mean "the backend is asleep or restarting" (e.g. a
 * Render cold start) rather than the API actually rejecting the code.
 */
const TRANSIENT_GATEWAY_STATUSES = new Set([502, 503, 504]);

/** Delay (ms) before retry N; two entries => up to 2 retries. */
const TRANSIENT_RETRY_DELAYS_MS = [1500, 3000];

function isTransientFailure(error: unknown): boolean {
  // apiFetch throws ApiClientError only for HTTP error responses; anything
  // else escaped from fetch() itself (network failure, DNS, connection reset
  // while the backend cold-starts) and counts as transient.
  if (!(error instanceof ApiClientError)) return true;
  return TRANSIENT_GATEWAY_STATUSES.has(error.status);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs a request, retrying ONLY genuine transient infrastructure failures
 * (network errors, 502/503/504 gateway responses) up to two more times. Real
 * API rejections (400/401/403/409/422 ...) throw immediately.
 */
async function runWithTransientRetry<T>(request: () => Promise<T>): Promise<T> {
  const maxRetries = TRANSIENT_RETRY_DELAYS_MS.length;
  for (let attempt = 0; ; attempt++) {
    try {
      return await request();
    } catch (error) {
      if (!isTransientFailure(error) || attempt >= maxRetries) {
        throw error;
      }
      await sleep(TRANSIENT_RETRY_DELAYS_MS[attempt]);
    }
  }
}

/**
 * Exchanges the one-time OAuth code for the application token pair.
 *
 * The code is one-time use, so the exchange is retried ONLY on transient
 * infrastructure failures — network errors or 502/503/504 gateway responses
 * from a cold-starting backend (up to 2 more attempts after 1.5s and 3s).
 * Real API rejections (e.g. 400 invalid/expired code, 401) are thrown
 * immediately so the callback page keeps its existing error handling.
 */
export async function exchangeOAuthCode(code: string): Promise<AuthResponse> {
  return runWithTransientRetry(() =>
    apiFetch<AuthResponse>('/auth/oauth/exchange', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  );
}


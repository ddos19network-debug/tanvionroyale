/**
 * CORS allow-list resolution for the API.
 *
 * Production requirements (Phase 11 security):
 * - The web app origin is allow-listed explicitly via the CORS_ORIGIN env
 *   variable (comma-separated list supported, e.g. the Vercel production
 *   origin plus any preview origins).
 * - A wildcard "*" is NEVER honoured — the API is authenticated and every
 *   response is sent with credentials, and "Access-Control-Allow-Origin: *"
 *   together with credentials=true is forbidden by the CORS specification.
 * - If CORS_ORIGIN is missing/blank in production we FAIL SAFE to the
 *   built-in production origin allow-list instead of reflecting every origin.
 * - Local development (non-production) keeps the previous permissive
 *   behaviour (reflect any origin) so `pnpm dev` keeps working unchanged.
 */

/** Built-in production origin allow-list (public values, not secrets). */
export const DEFAULT_PRODUCTION_CORS_ORIGINS: readonly string[] = [
  'https://tanvionroyale.vercel.app',
];

/**
 * Resolves the CORS `origin` option: an explicit allow-list (string[]) or
 * `true` to reflect the request origin (development only, see above).
 */
export function resolveCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] | boolean {
  const configured = (env.CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    // A wildcard is never honoured: the API always answers with credentials.
    .filter((o) => o.length > 0 && o.toLowerCase() !== '*');

  if (configured.length > 0) return configured;

  if ((env.NODE_ENV ?? '') === 'production') {
    // Fail SAFE: never expose the authenticated API to every origin.
    return [...DEFAULT_PRODUCTION_CORS_ORIGINS];
  }

  // Development convenience only — production never reaches this branch.
  return true;
}
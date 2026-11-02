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
 * - In non-production, the built-in local-development origins
 *   (DEFAULT_LOCAL_CORS_ORIGINS, incl. http://localhost:3100) are UNIONED
 *   with any explicitly configured CORS_ORIGIN entries, so a workstation that
 *   still carries production values in a local env file keeps permitting the
 *   local frontend. Production never includes local origins automatically.
 */

/**
 * Built-in production origin allow-list (public values, not secrets).
 *
 * The canonical production origin is https://royale.tanvion.com. The previous
 * Vercel origin is kept in the list during the migration so existing sessions,
 * bookmarks and the OAuth post-login redirect keep working until the owner
 * confirms every login path succeeds on the custom domain and removes it.
 * These are only the FAIL-SAFE defaults used when CORS_ORIGIN is unset; the
 * deployment sets CORS_ORIGIN explicitly (see render.yaml).
 */
export const DEFAULT_PRODUCTION_CORS_ORIGINS: readonly string[] = [
  'https://royale.tanvion.com',
  'https://tanvionroyale.vercel.app',
];

/**
 * Built-in local-development origin allow-list (public values, not secrets).
 *
 * The local web app runs on http://localhost:3100 (see WEB_PORT/APP_URL in
 * .env.example). These are unioned into the CORS allow-list in NON-production
 * environments only, so a developer workstation that still carries production
 * values in a local env file keeps permitting the local frontend. Production
 * never includes these automatically.
 */
export const DEFAULT_LOCAL_CORS_ORIGINS: readonly string[] = [
  'http://localhost:3100',
  'http://127.0.0.1:3100',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
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

  const isProduction = (env.NODE_ENV ?? '') === 'production';

  if (configured.length > 0) {
    if (isProduction) return configured;
    // Non-production: union explicit entries with the built-in local origins
    // so http://localhost:3100 is permitted even when a local env file still
    // carries production values. Deduplicated, order-preserving.
    const merged = [...configured];
    for (const local of DEFAULT_LOCAL_CORS_ORIGINS) {
      if (!merged.includes(local)) merged.push(local);
    }
    return merged;
  }

  if (isProduction) {
    // Fail SAFE: never expose the authenticated API to every origin.
    return [...DEFAULT_PRODUCTION_CORS_ORIGINS];
  }

  // Development convenience only — production never reaches this branch.
  return true;
}
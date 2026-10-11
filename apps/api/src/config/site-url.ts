/**
 * PUBLIC SITE URL — the single resolver for the canonical public origin of the
 * web app, used by every server-generated absolute link (currently the referral
 * and affiliate share links).
 *
 * WHY THIS FILE EXISTS
 *   The resolution order used to be duplicated inline in two controllers. A
 *   duplicated chain drifts: the copies had grown an `APP_PUBLIC_URL` key that
 *   this project has never used, and therefore did NOT read `APP_URL` — the
 *   variable the rest of the API (AuthService, OAuthService,
 *   VerificationService, BigBangWebhookConfigService) and `render.yaml` all
 *   treat as the canonical public frontend URL. On a deployment that only sets
 *   `APP_URL`, the old chain resolved to `''` and produced a RELATIVE
 *   `/signup?ref=CODE` link instead of an absolute one.
 *
 *   One resolver, one documented order, one place to change.
 *
 * RESOLUTION ORDER (first non-blank wins)
 *   1. PUBLIC_SITE_URL     — explicit, set only for this purpose
 *   2. NEXT_PUBLIC_SITE_URL— the same variable the web app uses (config/site.ts)
 *   3. APP_URL             — the canonical public frontend URL used everywhere
 *                            else in this API and declared in render.yaml
 *
 *   An explicit deployment-specific variable always wins over the shared
 *   fallback, so a staging Render service can point at a staging origin without
 *   touching code.
 *
 * NEVER a hard-coded production domain here. The web app owns that default
 * (`apps/web/config/site.ts`); the API only echoes back whatever the deployment
 * is configured with, so the two can never disagree about a built-in host.
 *
 * NORMALISATION
 *   The value is trimmed and any trailing slashes are removed, so the result is
 *   always a safe string to concatenate a `/path` onto. That is what prevents a
 *   doubled separator (`https://host//signup`) from ever being generated.
 *
 * BLANK VALUES ARE SKIPPED, NOT ACCEPTED
 *   A declared-but-empty env var (very common on Render) resolves to `''`. The
 *   old `??` chain stopped at the first empty string and returned a relative
 *   link; here a blank value is skipped and the next candidate is tried.
 *
 * Returns `''` only when nothing at all is configured, which is the honest
 * signal that the deployment has no public origin — the caller decides what to
 * do with that, and never invents a host.
 */

/** The documented resolution order. Exported so tests can pin it. */
export const PUBLIC_SITE_URL_ENV_KEYS = [
  'PUBLIC_SITE_URL',
  'NEXT_PUBLIC_SITE_URL',
  'APP_URL',
] as const;

/** Anything that can read a string by key (a Nest `ConfigService`, or env). */
export type SiteUrlLookup = (key: string) => string | undefined;

const fromProcessEnv: SiteUrlLookup = (key) => process.env[key];

/**
 * Resolves the canonical public site URL, without a trailing slash.
 *
 * @param lookup Key lookup. Defaults to `process.env`; a Nest `ConfigService`
 *               can be passed directly, since its `get` is compatible.
 */
export function resolvePublicSiteUrl(
  lookup: SiteUrlLookup = fromProcessEnv,
): string {
  for (const key of PUBLIC_SITE_URL_ENV_KEYS) {
    const value = lookup(key)?.trim();
    if (value) return value.replace(/\/+$/, '');
  }
  return '';
}
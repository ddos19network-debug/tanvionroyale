import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * TANVION ROYALE — SERVER-SIDE trusted geo (country) context.
 *
 * The player's country for the REAL_MONEY jurisdiction gate is NEVER taken
 * from the request body, a query parameter or anything else the browser can
 * choose. It comes from exactly two server-side sources:
 *
 *   1. the trusted edge geo header (`x-royale-geo-country`) written by the
 *      fronting proxy/edge — captured ONCE per request by TrustedGeoMiddleware
 *      and propagated through this AsyncLocalStorage context, and
 *   2. the KYC country stored on the user row (`User.country`).
 *
 * A mismatch between the two, or a completely unknown country, is BLOCKED by
 * RoyaleEligibilityService (fail closed).
 *
 * The header name is an implementation detail of OUR edge configuration: a
 * client that sends it directly to the API still cannot make the gate pass on
 * its own, because the KYC country must agree (and an unknown KYC country is
 * blocked regardless).
 */

/** Header the trusted edge/proxy sets with the caller's ISO-3166 alpha-2 country. */
export const TRUSTED_GEO_COUNTRY_HEADER = 'x-royale-geo-country';

/** ISO 3166-1 alpha-2 (two upper-case letters), nothing else. */
const ISO_ALPHA_2 = /^[A-Z]{2}$/;

/**
 * Normalize any value to a canonical ISO-3166 alpha-2 code, or `null` when it
 * is not one. Anything unparseable is treated as UNKNOWN (=> BLOCKED).
 */
export function normalizeCountryCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return ISO_ALPHA_2.test(code) ? code : null;
}

const storage = new AsyncLocalStorage<string | null>();

/** Country captured from the trusted edge header for the current request. */
export function currentTrustedGeoCountry(): string | null {
  return storage.getStore() ?? null;
}

/**
 * Run `fn` with `country` as the trusted geo country for the current async
 * context. Used by TrustedGeoMiddleware (per request) and by tests.
 */
export function runWithTrustedGeoCountry<T>(country: unknown, fn: () => T): T {
  return storage.run(normalizeCountryCode(country), fn);
}

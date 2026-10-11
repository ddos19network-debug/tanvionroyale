/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  resolvePublicSiteUrl,
  PUBLIC_SITE_URL_ENV_KEYS,
} from '../src/config/site-url';

/**
 * The canonical public origin is what every server-generated absolute link
 * (referral share link, affiliate share link) is built from. If this resolver
 * returns the wrong thing, EVERY shared link is wrong — so the order, the
 * normalisation and the blank-value handling are all pinned here.
 */
const PROD_SITE = 'https://tanvionroyale.vercel.app';

function lookupOf(overrides: Record<string, string | undefined>) {
  return (key: string): string | undefined => overrides[key];
}

describe('public site URL resolution', () => {
  it('prefers the explicit PUBLIC_SITE_URL over every fallback', () => {
    expect(
      resolvePublicSiteUrl(
        lookupOf({
          PUBLIC_SITE_URL: 'https://explicit.example',
          NEXT_PUBLIC_SITE_URL: 'https://next.example',
          APP_URL: 'https://app.example',
        }),
      ),
    ).toBe('https://explicit.example');
  });

  it('falls back to NEXT_PUBLIC_SITE_URL (the web app variable) when PUBLIC is unset', () => {
    expect(
      resolvePublicSiteUrl(
        lookupOf({ NEXT_PUBLIC_SITE_URL: 'https://next.example', APP_URL: 'https://app.example' }),
      ),
    ).toBe('https://next.example');
  });

  it('falls back to APP_URL, the variable render.yaml actually sets', () => {
    // Regression guard: the old inline chain read a key that this project never
    // set (APP_PUBLIC_URL), so an APP_URL-only deployment produced a RELATIVE
    // '/signup?ref=CODE' link instead of an absolute one.
    expect(resolvePublicSiteUrl(lookupOf({ APP_URL: PROD_SITE }))).toBe(PROD_SITE);
  });

  it('pins the documented resolution order', () => {
    expect([...PUBLIC_SITE_URL_ENV_KEYS]).toEqual([
      'PUBLIC_SITE_URL',
      'NEXT_PUBLIC_SITE_URL',
      'APP_URL',
    ]);
  });

  it('skips a declared-but-BLANK variable instead of stopping on it', () => {
    // A blank Render env var resolves to ''. The old `??` chain halted there
    // and returned ''; the next candidate must be used instead.
    expect(resolvePublicSiteUrl(lookupOf({ PUBLIC_SITE_URL: '', APP_URL: PROD_SITE }))).toBe(
      PROD_SITE,
    );
    expect(resolvePublicSiteUrl(lookupOf({ PUBLIC_SITE_URL: '   ', APP_URL: PROD_SITE }))).toBe(
      PROD_SITE,
    );
  });

  it('strips trailing slashes so a doubled separator can never be generated', () => {
    expect(resolvePublicSiteUrl(lookupOf({ PUBLIC_SITE_URL: `${PROD_SITE}/` }))).toBe(PROD_SITE);
    expect(resolvePublicSiteUrl(lookupOf({ PUBLIC_SITE_URL: `${PROD_SITE}///` }))).toBe(PROD_SITE);
  });

  it('trims surrounding whitespace from a hand-edited dashboard value', () => {
    expect(resolvePublicSiteUrl(lookupOf({ APP_URL: `  ${PROD_SITE}  ` }))).toBe(PROD_SITE);
  });

  it('returns empty only when nothing at all is configured (never invents a host)', () => {
    expect(resolvePublicSiteUrl(lookupOf({}))).toBe('');
    expect(resolvePublicSiteUrl(lookupOf({ PUBLIC_SITE_URL: '', APP_URL: '  ' }))).toBe('');
  });

  it('is stable for the real production value', () => {
    expect(resolvePublicSiteUrl(lookupOf({ APP_URL: PROD_SITE }))).toBe(PROD_SITE);
  });
});

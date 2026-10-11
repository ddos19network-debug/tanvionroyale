/**
 * Central site & brand configuration — the single source of truth for the
 * public identity of TANVIONROYALE across page metadata, canonical URLs, Open
 * Graph tags, robots.txt and sitemap.xml.
 *
 * NEXT_PUBLIC_SITE_URL (optional, NEXT_PUBLIC_* — safe to expose to the
 * browser, never a secret):
 *   Public base URL of the deployed web app, no trailing slash.
 *   Production default: https://tanvionroyale.vercel.app
 *   When a custom production domain is configured later, set the variable in
 *   the Vercel dashboard (or .env.local) and every canonical/OG/sitemap URL
 *   updates — no host is hardcoded in any component.
 */
const DEFAULT_SITE_URL = 'https://tanvionroyale.vercel.app';

function normalizeBaseUrl(raw: string | undefined, fallback: string): string {
  const value = raw?.trim();
  if (!value) return fallback;
  return value.replace(/\/+$/, '');
}

export const siteConfig = {
  /** Application / brand name shown on the OAuth consent screen. */
  name: 'TANVIONROYALE',
  /** Default <title> and Open Graph title for the public homepage. */
  title: 'TANVIONROYALE — Online Gaming & Entertainment Platform',
  /** Default meta description (mirrored on /home and in Open Graph tags). */
  description:
    'TANVIONROYALE is an online gaming and entertainment platform where users can explore games, sports, events, and available platform services.',
  /** Public base URL (no trailing slash), driven by NEXT_PUBLIC_SITE_URL. */
  url: normalizeBaseUrl(process.env.NEXT_PUBLIC_SITE_URL, DEFAULT_SITE_URL),
  /** Path of the platform home alias (canonical home is `/`). */
  homePath: '/home',
  /** File-convention Open Graph image served from the app router root. */
  ogImagePath: '/opengraph-image.png',
} as const;

export type SiteConfig = typeof siteConfig;

/** Build an absolute public URL from a site-relative path. */
export function siteUrl(path = ''): string {
  if (!path || path === '/') return `${siteConfig.url}/`;
  return `${siteConfig.url}${path.startsWith('/') ? path : `/${path}`}`;
}

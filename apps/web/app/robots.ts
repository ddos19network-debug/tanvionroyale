import type { MetadataRoute } from 'next';
import { siteConfig, siteUrl } from '@/config/site';

/**
 * robots.txt for the public web app.
 *
 * The public site (/, /home, /privacy, /terms, catalog pages) is fully
 * crawlable — required for Google OAuth brand verification. Only the admin
 * panel is disallowed (it also sets `robots: noindex` in its layout).
 * The base URL comes from NEXT_PUBLIC_SITE_URL via the shared site config.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin'],
      },
    ],
    sitemap: siteUrl('/sitemap.xml'),
    host: siteConfig.url,
  };
}

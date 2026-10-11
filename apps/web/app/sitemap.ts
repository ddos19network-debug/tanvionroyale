import type { MetadataRoute } from 'next';
import { siteUrl } from '@/config/site';

/**
 * sitemap.xml for the public web app.
 *
 * Lists only publicly accessible, crawlable pages (no account-only routes
 * such as /wallet, /profile, /my-bets, and no /admin). URLs are built from
 * the shared site config so a custom production domain updates everything.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  const entries: Array<{
    path: string;
    priority: number;
    changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
  }> = [
    { path: '/', priority: 1, changeFrequency: 'daily' },
    { path: '/home', priority: 1, changeFrequency: 'weekly' },
    { path: '/games', priority: 0.8, changeFrequency: 'daily' },
    { path: '/sports', priority: 0.8, changeFrequency: 'hourly' },
    { path: '/events', priority: 0.6, changeFrequency: 'hourly' },
    { path: '/live', priority: 0.6, changeFrequency: 'hourly' },
    { path: '/promotions', priority: 0.6, changeFrequency: 'weekly' },
    { path: '/support', priority: 0.5, changeFrequency: 'monthly' },
    { path: '/privacy', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/terms', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/account-deletion', priority: 0.3, changeFrequency: 'yearly' },
  ];

  return entries.map(({ path, priority, changeFrequency }) => ({
    url: siteUrl(path),
    lastModified,
    changeFrequency,
    priority,
  }));
}

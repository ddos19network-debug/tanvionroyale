/** @type {import('next').NextConfig} */
import path from 'path';

const __dirname = path.dirname(import.meta.url);

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@tanvion-royale/types', '@tanvion-royale/validation', '@tanvion-royale/config', '@tanvion-royale/ui'],
  webpack: (config) => {
    config.resolve.alias['@ui'] = path.resolve(__dirname, '../packages/ui/dist');
    return config;
  },
  // NOTE: this app never proxies /api through Next.js -- every API call goes
  // directly to the absolute NEXT_PUBLIC_API_URL resolved lazily by the API
  // client (apps/web/lib/api/client.ts). There is deliberately NO localhost
  // fallback in this config: in production a missing NEXT_PUBLIC_API_URL
  // fails clearly at request time instead of silently talking to the wrong host.

  /**
   * CONTENT SECURITY POLICY — scoped, never global.
   *
   * The BIG SPORT section embeds the external sportsbook provider with the
   * provider's own loader, so the browser needs `frame-src` to allow that ONE
   * origin. The directive is sent ONLY for the sports routes that can render the
   * book — no other page's security posture changes and no wildcard is used:
   *   frame-src 'self' https://iframe.winhouse.bet;
   *
   * `frame-src` on its own constrains frame loads only: it deliberately does NOT
   * add default-src/script-src/connect-src, so the rest of the app (Firebase,
   * socket.io, API calls) keeps working exactly as before.
   */
  async headers() {
    const winHouseOrigin = 'https://iframe.winhouse.bet';
    const framePolicy = `frame-src 'self' ${winHouseOrigin};`;
    return [
      { source: '/sports', headers: [{ key: 'Content-Security-Policy', value: framePolicy }] },
      {
        source: '/sports/:path*',
        headers: [{ key: 'Content-Security-Policy', value: framePolicy }],
      },
    ];
  },
};

export default nextConfig;
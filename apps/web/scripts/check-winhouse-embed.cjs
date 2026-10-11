/**
 * BIG SPORT → embedded WinHouse sportsbook — static integration guard.
 *
 * The book is a THIRD-PARTY origin inside our own header/sidebar/bottom-nav.
 * Three things can silently break that, and none of them is visible in a unit
 * test of the API:
 *
 *   1. the CSP — the browser refuses to load `https://iframe.winhouse.bet` at
 *      all unless `frame-src` allows that ONE origin, and a wildcard (or a
 *      global `frame-src *`) would weaken every other route;
 *   2. the frame sizing — a fixed height / min-height on the mount point is the
 *      classic "no tab bar, no betslip, unreachable cash-out" bug on phones, and
 *      the provider loader needs our own bottom-nav height (`data-bottom-gap`);
 *   3. the credential boundary — the browser may only ever receive the PUBLIC
 *      embed key (`ifr_…`) and a short-lived launch token. The wallet API key
 *      and the callback token are server-side secrets.
 *
 * This script asserts all three against the real source files, so a future
 * refactor cannot quietly reintroduce any of them.
 *
 * Run: `node scripts/check-winhouse-embed.cjs` (exit 0 = pass).
 */
const fs = require('fs');
const path = require('path');

const webRoot = path.join(__dirname, '..');
const repoRoot = path.join(webRoot, '..', '..');

let failures = 0;

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  failures += 1;
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

const partnerProvidersPath = 'apps/web/app/admin/partner-providers/page.tsx';
const partnerProviders = read(partnerProvidersPath);
{
  const publicFields = ['Domain (exact frontend origin)', 'Seamless wallet base URL', 'Server IP (optional)', 'Public configuration'];
  const secretFields = ['Secret configuration', 'Wallet API key', 'Callback token'];
  for (const field of [...publicFields, ...secretFields]) {
    if (!partnerProviders.includes(field)) fail(`${partnerProvidersPath}: missing ${field}`);
  }
  if (!partnerProviders.includes("form.walletApiKey || undefined") || !partnerProviders.includes("form.callbackToken || undefined")) {
    fail(`${partnerProvidersPath}: blank secret input must be omitted so stored ciphertext is preserved.`);
  } else {
    pass('partner provider blank secret input preserves the stored value');
  }
  if (!partnerProviders.includes("form.environment === 'production'")) {
    fail(`${partnerProvidersPath}: production must enforce the exact verified domain/wallet base.`);
  } else {
    pass('partner provider production form enforces the exact verified domain and wallet base');
  }
  if (!partnerProviders.includes('runWinHouseSelfTest(true)')) {
    fail(`${partnerProvidersPath}: the self-test button must exercise the provider SSO contract.`);
  } else {
    pass('partner provider self-test uses the official network-safe probe');
  }
  if (!partnerProviders.includes("'https://tanvionroyale.vercel.app'") || !partnerProviders.includes("'https://tanvionroyale.onrender.com/api/v1/winhouse'")) {
    fail(`${partnerProvidersPath}: verified production domain/wallet base defaults are missing.`);
  } else {
    pass('partner provider exposes the verified production origin and wallet base');
  }
}

const componentPath = 'apps/web/components/sports/winhouse-book.tsx';
const pagePath = 'apps/web/app/(user)/sports/page.tsx';
const clientPath = 'apps/web/lib/api/winhouse.ts';
const configPath = 'apps/web/next.config.mjs';

const component = read(componentPath);
const page = read(pagePath);
const client = read(clientPath);
const nextConfig = read(configPath);

// ---------------------------------------------------------------------------
// 1) iframe rendering — the PROVIDER'S loader is used, with its documented
//    data attributes. A hand-written iframe loses the book's fixed tab bar.
// ---------------------------------------------------------------------------
{
  const required = [
    ['loader origin', /config\.embedBaseUrl\}\/embed\.js/],
    ['data-key', /script\.dataset\['key'\]/],
    ['data-target', /script\.dataset\['target'\]/],
    ['data-height', /script\.dataset\['height'\]/],
    ['data-bottom-gap', /script\.dataset\['bottomGap'\]/],
    ['data-embed', /script\.dataset\['embed'\]/],
    ['data-launch', /script\.dataset\['launch'\]/],
  ];
  const missing = required.filter(([, pattern]) => !pattern.test(component)).map(([name]) => name);
  if (missing.length > 0) {
    fail(`${componentPath}: missing loader attribute(s): ${missing.join(', ')}`);
  } else {
    pass('embed loader carries data-key/data-target/data-height/data-bottom-gap/data-embed/data-launch');
  }

  if (/<iframe/.test(component)) {
    fail(`${componentPath}: a hand-written <iframe> bypasses the provider loader (book chrome breaks on phones).`);
  } else {
    pass('no hand-written <iframe> — the provider loader owns the frame');
  }

  if (!/id=\{WINHOUSE_BOOK_ELEMENT_ID\}/.test(component)) {
    fail(`${componentPath}: the mount container must carry the id the loader targets (#winhouse-book).`);
  } else {
    pass('mount point id matches the loader target');
  }

  if (!/if \(failed \|\| !config\) return null;/.test(component)) {
    fail(`${componentPath}: an unconfigured/unreachable provider must render NOTHING (never a fake book).`);
  } else {
    pass('renders nothing when the provider is unconfigured (no invented matches/odds)');
  }

  if (!/ready \|\| !isAuthenticated/.test(component)) {
    fail(`${componentPath}: the launch token must be requested only for a signed-in player.`);
  } else {
    pass('the book is requested only for a signed-in TANVION user');
  }

  if (!/WinHouseBook/.test(page)) {
    fail(`${pagePath}: the embedded book must be rendered inside the existing BIG SPORT page.`);
  } else {
    pass('the embedded book is mounted inside the existing BIG SPORT page');
  }
}

// ---------------------------------------------------------------------------
// 2) Mobile sizing — no fixed/min height on the mount point, and a refit on
//    viewport changes so the book's own tab bar and betslip stay reachable.
// ---------------------------------------------------------------------------
{
  const mountPoint = component.match(/id=\{WINHOUSE_BOOK_ELEMENT_ID\}[^>]*className="([^"]*)"/);
  const mountClasses = mountPoint ? mountPoint[1] : null;
  if (mountClasses === null) {
    fail(`${componentPath}: could not locate the mount point's class list.`);
  } else if (/\b(min-h-|h-\[|h-\d|max-h-)/.test(mountClasses)) {
    fail(
      `${componentPath}: the mount point must not impose a height (found "${mountClasses}") — the loader sizes the frame.`,
    );
  } else {
    pass('mount point leaves sizing to the provider loader (no fixed/min height)');
  }

  if (
    !/refit\?\.\(\)/.test(component) ||
    !/addEventListener\('resize', refit\)/.test(component) ||
    !/addEventListener\('orientationchange', refit\)/.test(component)
  ) {
    fail(`${componentPath}: the frame must be refitted on resize/orientation change (keyboard, rotation).`);
  } else {
    pass('frame is refitted on resize and orientation change');
  }

  if (!/bottomGapPx/.test(component)) {
    fail(`${componentPath}: the fixed mobile bottom nav height must be passed to the loader.`);
  } else {
    pass('our own mobile bottom-nav height is handed to the loader');
  }
}

// ---------------------------------------------------------------------------
// 3) Credential boundary — the browser gets the PUBLIC embed key only.
// ---------------------------------------------------------------------------
{
  const webFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', '.next', 'dist', 'out', 'scripts'].includes(entry.name)) continue;
        walk(full);
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
        webFiles.push(full);
      }
    }
  };
  for (const dir of ['app', 'components', 'lib', 'src']) {
    const absolute = path.join(webRoot, dir);
    if (fs.existsSync(absolute)) walk(absolute);
  }

  const leaks = [];
  for (const file of webFiles) {
    const source = fs.readFileSync(file, 'utf8');
    const relative = path.relative(webRoot, file);
    // The admin panel is where an operator TYPES the public embed key, so it
    // legitimately contains a format EXAMPLE in a placeholder (never a real
    // key). Every player-facing file must take the key from the backend.
    const isAdminFile = relative.includes(`admin${path.sep}`);
    if (/WINHOUSE_WALLET_API_KEY|WINHOUSE_CALLBACK_TOKEN/.test(source)) {
      leaks.push(`${relative} references a server-only WinHouse secret name`);
    }
    if (/NEXT_PUBLIC_[A-Z_]*WINHOUSE[A-Z_]*(WALLET|SECRET|TOKEN)/.test(source)) {
      leaks.push(`${relative} exposes a WinHouse secret via NEXT_PUBLIC_*`);
    }
    if (!isAdminFile && /ifr_[0-9a-f]{40}/i.test(source)) {
      leaks.push(`${relative} hard-codes an embed key (ifr_…) outside the admin panel`);
    }
  }
  if (leaks.length > 0) {
    for (const leak of leaks) fail(leak);
  } else {
    pass('no WinHouse secret and no hard-coded embed key anywhere in the web app');
  }

  if (!/authFetch<WinHouseLaunchView>\('\/winhouse\/launch'\)/.test(client)) {
    fail(`${clientPath}: the launch token must come from our authenticated API (GET /winhouse/launch).`);
  } else {
    pass('the launch token is minted by the TANVION API, not in the browser');
  }
}

// ---------------------------------------------------------------------------
// 4) CSP — `frame-src` for the ONE provider origin, scoped to the sports
//    routes, never a wildcard and never global.
// ---------------------------------------------------------------------------
{
  if (!/frame-src 'self' \$\{winHouseOrigin\}/.test(nextConfig)) {
    fail(`${configPath}: frame-src must allow 'self' plus the ONE WinHouse origin.`);
  } else {
    pass("CSP allows frame-src 'self' + the WinHouse origin only");
  }

  if (!/const winHouseOrigin = 'https:\/\/iframe\.winhouse\.bet'/.test(nextConfig)) {
    fail(`${configPath}: the allowed frame origin must be the provider's documented origin.`);
  }

  if (/frame-src[^`'"]*\*/.test(nextConfig)) {
    fail(`${configPath}: frame-src must never use a wildcard.`);
  } else {
    pass('no wildcard frame-src');
  }

  const sources = [...nextConfig.matchAll(/source:\s*'([^']+)'/g)].map((match) => match[1]);
  if (sources.length === 0) {
    fail(`${configPath}: the CSP header must be scoped to specific routes.`);
  } else if (sources.some((source) => source === '/' || source === '/:path*' || source === '/(.*)')) {
    fail(`${configPath}: the CSP must not be applied globally (found "${sources.join(', ')}").`);
  } else if (!sources.every((source) => source === '/sports' || source.startsWith('/sports/'))) {
    fail(`${configPath}: the CSP must be limited to the sports routes (found "${sources.join(', ')}").`);
  } else {
    pass(`CSP is scoped to the sports routes only (${sources.join(', ')})`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} WinHouse embed check(s) failed.`);
  process.exit(1);
}
console.log('\nAll WinHouse embed checks passed.');

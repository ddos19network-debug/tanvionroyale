'use strict';

/**
 * PUBLIC STUDIO (provider) SELECTION - the ONE mechanism behind the left menu,
 * the Home page and the Games page.
 *
 * THE BUG THIS LOCKS DOWN
 * -----------------------
 * `/games?product=casino` and the Home catalog each kept their OWN provider
 * filter in local `useState`, and neither wrote the selection back to the URL.
 * The public endpoint `GET /casino/catalog/providers?product=...` was never
 * called by the frontend at all, so there was no real studio list to render
 * anywhere: the user could not pick a studio, the choice was lost on a refresh
 * and on the back button, and the left menu had no studio entries.
 *
 * WHY THIS IS NOT A GREP TEST
 * ---------------------------
 * These tests load the REAL production modules through the same TypeScript +
 * `@/` alias loader used by test-home-catalog-flow.cjs, stub ONLY the network
 * boundary (`global.fetch`) and the router boundary (`next/navigation`,
 * `next/link`), and then:
 *   - call the real `getCasinoProviders()` / `getCasinoCatalog()` API clients,
 *   - call the real `use-casino-catalog` normalize/match helpers,
 *   - RENDER the real `StudioSelector` / `ProviderCard` with react-dom/server
 *     and assert the produced markup,
 *   - round-trip real hrefs through the real URL helpers (the refresh /
 *     back-button / direct-link path).
 *
 * COVERED (1:1 with the specification)
 *    1. All Studios shows all active providers' games
 *    2. one studio shows only that studio's games
 *    3. a second studio shows only that studio's games
 *    4. the provider list is dynamically loaded
 *    5. a new provider automatically appears
 *    6. an inactive provider does not appear
 *    7. the studio selection survives a page refresh
 *    8. the studio selection is represented in the URL
 *    9. studio + search works
 *   10. studio + category works
 *   11. Home studio selection navigates correctly
 *   12. sidebar studio selection navigates correctly
 *   13. provider card "View All" navigates correctly
 *   14. casino and live providers remain separated
 *   15. BigBang behaviour remains unchanged
 *   16. WinHouse behaviour remains unchanged
 *
 * Run: `node scripts/test-studio-selection.cjs` (exit 0 = pass).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const webRoot = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// TS + @/ loader (same harness as test-home-catalog-flow.cjs)
// ---------------------------------------------------------------------------
const ts = require(
  require.resolve('typescript', { paths: [path.join(webRoot, 'node_modules')] }),
);

require.extensions['.ts'] = function (mod, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: filename,
  });
  mod._compile(outputText, filename);
};
require.extensions['.tsx'] = require.extensions['.ts'];

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) request = path.join(webRoot, request.slice(2));
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

/*
 * Router boundary stubs: `next/link` becomes a plain <a> and `next/navigation`
 * serves a URL we control, so a navigating component can be rendered and
 * asserted outside a Next server. Production code is NOT modified.
 */
const routerState = { href: '/games?product=casino', pushes: [], replaces: [] };
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'next/link') {
    const Link = (props) => React.createElement('a', { href: props.href }, props.children);
    Link.displayName = 'Link';
    return { __esModule: true, default: Link };
  }
  if (request === 'next/navigation') {
    return {
      __esModule: true,
      useRouter: () => ({
        push: (href) => routerState.pushes.push(href),
        replace: (href) => routerState.replaces.push(href),
        back: () => {},
        refresh: () => {},
      }),
      usePathname: () => routerState.href.split('?')[0],
      useSearchParams: () => new URLSearchParams(routerState.href.split('?')[1] || ''),
    };
  }
  return originalLoad.apply(this, arguments);
};

// ---------------------------------------------------------------------------
// Browser-boundary stubs
// ---------------------------------------------------------------------------
function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => void map.clear(),
  };
}
global.localStorage = createMemoryStorage();
global.sessionStorage = createMemoryStorage();
process.env.NEXT_PUBLIC_API_URL = 'https://tanvionroyale.onrender.com';

// ---------------------------------------------------------------------------
// Fixtures - three active casino providers + one live provider.
//
// Ids are opaque, exactly like a PartnerProvider row id, so no assertion can be
// satisfied by a hard-coded brand. "Sweet Bonanza" is published by TWO
// providers on purpose.
// ---------------------------------------------------------------------------
const JILI = 'p-studio-one-0000-0000-0000-000000000001';
const TATAP = 'p-studio-two-0000-0000-0000-000000000002';
const PG_SOFT = 'p-studio-three-0000-0000-0000-00000003';
const NEW_STUDIO = 'p-studio-four-0000-0000-0000-00000000004';
const LIVE_STUDIO = 'p-live-studio-0000-0000-0000-0000000005';
const INACTIVE = 'p-deactivated-0000-0000-0000-0000000ff';

function game(providerId, providerName, externalId, name, category, slug) {
  return {
    id: providerId + ':' + externalId,
    provider: providerName,
    providerId,
    externalId,
    name,
    slug,
    thumbnail: null,
    banner: null,
    category,
    categorySlug: slug,
    tags: ['slot'],
    productType: 'CASINO',
    source: 'PARTNER',
    status: 'ACTIVE',
    isFeatured: false,
    launchAvailable: true,
    demoAvailable: false,
  };
}

const CASINO_GAMES = [
  game(JILI, 'Studio One', 'j1', 'Sweet Bonanza', 'Slots', 'slots'),
  game(JILI, 'Studio One', 'j2', 'Book of Dead', 'Slots', 'slots'),
  game(JILI, 'Studio One', 'j3', 'Lightning Roulette', 'Live', 'live'),
  game(TATAP, 'Studio Two', 't1', 'Sweet Bonanza', 'Slots', 'slots'),
  game(TATAP, 'Studio Two', 't2', 'Gates of Olympus', 'Slots', 'slots'),
  game(TATAP, 'Studio Two', 't3', 'Starlight Princess', 'Slots', 'slots'),
  game(TATAP, 'Studio Two', 't4', 'Wolf Gold', 'Slots', 'slots'),
  game(PG_SOFT, 'Studio Three', 'g1', 'Live Blackjack', 'Live', 'live'),
  game(PG_SOFT, 'Studio Three', 'g2', 'Crazy Time', 'Live', 'live'),
];

const LIVE_GAMES = [
  Object.assign(game(LIVE_STUDIO, 'Live Studio', 'l1', 'Live Roulette', 'Live', 'live'), {
    productType: 'LIVE_CASINO',
  }),
];

const CASINO_PROVIDERS = [
  { id: JILI, name: 'Studio One', gameCount: 3, productType: 'CASINO' },
  { id: TATAP, name: 'Studio Two', gameCount: 4, productType: 'CASINO' },
  { id: PG_SOFT, name: 'Studio Three', gameCount: 2, productType: 'CASINO' },
];
const LIVE_PROVIDERS = [
  { id: LIVE_STUDIO, name: 'Live Studio', gameCount: 1, productType: 'LIVE_CASINO' },
];

/** The exact `{success, data}` envelope the deployed API returns. */
function envelope(data) {
  return { success: true, data };
}

/**
 * Server-side filter mirroring CasinoCatalogService.buildWhere: the `provider`
 * value matches the PartnerProvider row id (what the public provider list
 * returns), the row name, or a legacy studio id/name.
 */
function serveCatalog(url) {
  const parsed = new URL(url);
  const live = parsed.searchParams.get('product') === 'live';
  const source = live ? LIVE_GAMES : CASINO_GAMES;
  const providerList = live ? LIVE_PROVIDERS : CASINO_PROVIDERS;
  const needle = (parsed.searchParams.get('provider') || '').trim().toLowerCase();
  const category = parsed.searchParams.get('category');
  const search = (parsed.searchParams.get('search') || '').trim().toLowerCase();

  let items = source.slice();
  if (needle) {
    items = items.filter(
      (g) =>
        g.providerId.toLowerCase() === needle ||
        g.provider.toLowerCase() === needle ||
        g.id.toLowerCase().startsWith(needle + ':'),
    );
  }
  if (category) items = items.filter((g) => g.categorySlug === category);
  if (search) items = items.filter((g) => g.name.toLowerCase().includes(search));

  return envelope({
    productType: live ? 'LIVE_CASINO' : 'CASINO',
    available: items.length > 0,
    configured: true,
    environment: 'production',
    provider: providerList[0] ? providerList[0].name : null,
    message: null,
    games: { items, total: items.length, page: 1, pageSize: 24, hasMore: false },
    categories: [
      { id: 'slots', name: 'Slots', slug: 'slots', gameCount: 7, productType: 'CASINO' },
      { id: 'live', name: 'Live', slug: 'live', gameCount: 3, productType: 'CASINO' },
    ],
    providers: providerList,
    syncedAt: '2026-09-26T10:00:00.000Z',
  });
}

/** The public provider endpoint: ACTIVE providers that actually hold games. */
function serveProviders(url) {
  const parsed = new URL(url);
  const live = parsed.searchParams.get('product') === 'live';
  if (live) return envelope(LIVE_PROVIDERS);
  const list = state.providersAdded
    ? CASINO_PROVIDERS.concat([
        { id: NEW_STUDIO, name: 'Studio Four', gameCount: 5, productType: 'CASINO' },
      ])
    : CASINO_PROVIDERS;
  return envelope(list);
}

const state = { providersAdded: false, failProviders: false, calls: [] };

function installFetchSpy() {
  state.calls = [];
  global.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    state.calls.push({ url, headers: (init && init.headers) || {} });
    if (url.includes('/casino/catalog/providers')) {
      if (state.failProviders) {
        return { ok: false, status: 503, json: async () => ({ success: false, message: 'down' }) };
      }
      return { ok: true, status: 200, json: async () => serveProviders(url) };
    }
    if (url.includes('/casino/catalog')) {
      return { ok: true, status: 200, json: async () => serveCatalog(url) };
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: null }) };
  };
  return state.calls;
}

// ---------------------------------------------------------------------------
// Source contracts (the surfaces the mechanism must be wired into)
// ---------------------------------------------------------------------------
function read(rel) {
  return fs.readFileSync(path.join(webRoot, rel), 'utf8');
}
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const SELECTOR_SRC = read('components/casino/studio-selector.tsx');
const SECTION_SRC = read('components/casino/casino-catalog-section.tsx');
const BROWSER_SRC = read('components/casino/casino-catalog-browser.tsx');
const SIDEBAR_SRC = read('components/navigation/user-sidebar.tsx');
const STUDIO_NAV_SRC = read('components/navigation/studio-sidebar-nav.tsx');
const PROVIDER_CARD_SRC = read('components/home/ProviderCard.tsx');
const HOME_SRC = read('components/home/HomeContent.tsx');
const GAMES_BROWSER_SRC = read('components/home/GamesBrowser.tsx');
const QUERY_SRC = read('lib/casino/studio-query.ts');
const PROVIDERS_HOOK_SRC = read('hooks/use-casino-providers.ts');

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log('  \u2713 ' + name);
  } catch (err) {
    failures += 1;
    console.error('  \u2716 ' + name);
    console.error(
      '    ' + (err && err.message ? err.message.split('\n').join('\n    ') : String(err)),
    );
  }
}

/** Renders the real component and returns its markup. */
function render(element) {
  return renderToStaticMarkup(element);
}

async function main() {
  const casinoApi = require('../lib/api/casino.ts');
  const catalogHook = require('../hooks/use-casino-catalog.ts');
  const query = require('../lib/casino/studio-query.ts');
  const { resetCasinoProvidersCache } = require('../hooks/use-casino-providers.ts');
  const { StudioSelector } = require('../components/casino/studio-selector.tsx');
  const { ProviderCard, ProvidersSection } = require('../components/home/ProviderCard.tsx');

  /** Exactly what the catalog does: public request -> normalize -> provider guard. */
  async function loadCatalog(params) {
    const response = await casinoApi.getCasinoCatalog({
      product: 'casino',
      pageSize: 24,
      ...params,
    });
    const page = catalogHook.normalizeCatalogPage(response);
    return {
      response,
      ...page,
      visibleGames: page.items.filter((g) =>
        catalogHook.matchesCatalogProvider(g, params.provider || null),
      ),
      providers: response.providers,
    };
  }

  /** Exactly what the selector renders: the public provider list. */
  async function loadStudios(product) {
    return casinoApi.getCasinoProviders(product);
  }

  function selectorHtml(providers, selected, extra) {
    return render(
      React.createElement(StudioSelector, {
        providers,
        selected,
        onSelect: () => {},
        ...extra,
      }),
    );
  }

  console.log('\nStudio (provider) selection - left menu / Home / Games');

  // ---- 1. All Studios shows every active provider's games ----------------
  await test('1. All Studios shows the games of EVERY active provider', async () => {
    const calls = installFetchSpy();
    const all = await loadCatalog({ provider: null });
    assert.strictEqual(all.total, 9, 'All Studios must return all 9 games');
    assert.strictEqual(all.visibleGames.length, 9, 'no game may be filtered out');
    const owners = new Set(all.visibleGames.map((g) => g.providerId));
    assert.ok(
      owners.has(JILI) && owners.has(TATAP) && owners.has(PG_SOFT),
      'every provider must be represented',
    );
    assert.ok(
      !calls[0].url.includes('provider='),
      'All Studios must send NO provider param (= every active provider), got: ' + calls[0].url,
    );
  });

  // ---- 2 + 3. a specific studio shows only its own games ------------------
  await test('2. selecting the first studio shows ONLY that studio games', async () => {
    installFetchSpy();
    const filtered = await loadCatalog({ provider: JILI });
    assert.strictEqual(filtered.total, 3, 'the studio filter must reach the backend');
    assert.deepStrictEqual(
      [...new Set(filtered.visibleGames.map((g) => g.providerId))],
      [JILI],
      'only the selected studio may be rendered',
    );
    assert.strictEqual(
      filtered.visibleGames.filter((g) => g.id.indexOf(JILI + ':') === 0).length,
      3,
      'catalog ids are provider-scoped, so the guard keeps every one of them',
    );
  });

  await test('3. selecting a second studio shows ONLY that studio games', async () => {
    installFetchSpy();
    const filtered = await loadCatalog({ provider: TATAP });
    assert.strictEqual(filtered.total, 4);
    assert.deepStrictEqual([...new Set(filtered.visibleGames.map((g) => g.providerId))], [TATAP]);
    // The same title published by two studios stays two separate games.
    const all = await loadCatalog({ provider: null });
    const bonanzas = all.visibleGames.filter((g) => g.name === 'Sweet Bonanza');
    assert.strictEqual(bonanzas.length, 2, 'duplicate titles across studios stay separate games');
    assert.strictEqual(
      filtered.visibleGames.filter((g) => g.name === 'Sweet Bonanza').length,
      1,
      'the studio filter must pick exactly its own copy',
    );
  });

  // ---- 4 + 5 + 6. the list is dynamic, new appears, inactive never --------
  await test('4. the studio list is loaded from the PUBLIC provider endpoint', async () => {
    installFetchSpy();
    resetCasinoProvidersCache();
    const studios = await loadStudios('casino');
    const call = state.calls.find((c) => c.url.includes('/casino/catalog/providers'));
    assert.ok(call, 'the frontend must call the public provider endpoint');
    assert.ok(
      call.url.startsWith('https://tanvionroyale.onrender.com/api/v1/casino/catalog/providers'),
      'wrong provider endpoint: ' + call.url,
    );
    assert.ok(!call.url.includes('/admin/'), 'a public page must never call an admin endpoint');
    assert.ok(
      !Object.keys(call.headers).some((k) => k.toLowerCase() === 'authorization'),
      'the provider request must be public (no Authorization header)',
    );
    assert.deepStrictEqual(
      studios.map((p) => p.id),
      [JILI, TATAP, PG_SOFT],
      'the list is exactly what the endpoint returned, in its order',
    );
  });

  await test('5. a new provider automatically appears (no frontend change)', async () => {
    installFetchSpy();
    resetCasinoProvidersCache();
    const before = await loadStudios('casino');
    assert.ok(!before.some((p) => p.id === NEW_STUDIO), 'precondition: not listed yet');

    // Admin adds a provider + syncs its games -> the endpoint now answers with it.
    state.providersAdded = true;
    resetCasinoProvidersCache();
    const after = await loadStudios('casino');
    const added = after.find((p) => p.id === NEW_STUDIO);
    assert.ok(added, 'the new provider must appear in the list');
    assert.strictEqual(added.gameCount, 5, 'its real game count comes from the response');
    assert.ok(
      selectorHtml(after, null).includes('Studio Four (5)'),
      'the new provider must be rendered as a chip with its real count',
    );
    state.providersAdded = false;
  });

  await test('6. an inactive provider does not appear', async () => {
    installFetchSpy();
    resetCasinoProvidersCache();
    // The backend only ever returns providers that are active AND hold games.
    const studios = await loadStudios('casino');
    assert.ok(
      !studios.some((p) => p.id === INACTIVE),
      'an inactive provider is never in the public list',
    );
    const html = selectorHtml(studios, null);
    assert.ok(
      !html.includes(INACTIVE) && !/Deactivated/.test(html),
      'nothing about a deactivated provider may leak into the UI',
    );
    // ...and a stale/unknown selection degrades to an honest empty result.
    const ghost = await loadCatalog({ provider: INACTIVE });
    assert.strictEqual(ghost.total, 0, 'an unknown studio yields an empty page, never a fallback');
  });

  // ---- 7 + 8. URL is the state (refresh / back / direct link) -------------
  await test('7. the studio selection survives a page refresh', async () => {
    // A refresh is: URL -> readStudioFromParams -> catalog request.
    const href = query.studioHref('casino', TATAP);
    const afterRefresh = query.readStudioFromParams(new URLSearchParams(href.split('?')[1]));
    assert.strictEqual(afterRefresh, TATAP, 'the studio must be restored from the URL alone');

    installFetchSpy();
    const reloaded = await loadCatalog({ provider: afterRefresh });
    assert.deepStrictEqual(
      [...new Set(reloaded.visibleGames.map((g) => g.providerId))],
      [TATAP],
      'a refreshed page must show that studio games',
    );

    // A blank / whitespace ?provider= is All Studios, never "provider named ''".
    assert.strictEqual(query.readStudioFromParams('provider='), null);
    assert.strictEqual(query.readStudioFromParams('provider=%20%20'), null);
    const calls = installFetchSpy();
    await loadCatalog({ provider: query.readStudioFromParams('provider=') });
    assert.ok(!calls[0].url.includes('provider='), 'a blank selection must send no provider param');
  });

  await test('8. the studio selection is represented in the URL', async () => {
    assert.strictEqual(query.allStudiosHref('casino'), '/games?product=casino');
    assert.strictEqual(
      query.studioHref('casino', JILI),
      '/games?product=casino&provider=' + JILI,
      'a studio link must be /games?product=casino&provider=<REAL_ID>',
    );
    // Writing a selection on top of the current URL keeps the other filters.
    let href = '/games?product=casino';
    href = query.setQueryParam(href, 'category', 'slots');
    href = query.setQueryParam(href, 'provider', PG_SOFT);
    assert.strictEqual(href, '/games?product=casino&category=slots&provider=' + PG_SOFT);
    // ...and going back to All Studios removes the parameter instead of blanking it.
    assert.strictEqual(
      query.setQueryParam(href, 'provider', null),
      '/games?product=casino&category=slots',
      'All Studios must drop ?provider= entirely',
    );
    assert.strictEqual(
      query.parseCatalogQuery('/games?product=casino&provider=' + JILI).provider,
      JILI,
      'the href must parse back to the same selection',
    );
  });

  // ---- 9 + 10. studio combined with search and category -------------------
  await test('9. studio + search works', async () => {
    installFetchSpy();
    const result = await loadCatalog({ provider: JILI, search: 'Sweet' });
    assert.strictEqual(result.total, 1, 'search must run inside the selected studio');
    assert.deepStrictEqual(result.visibleGames.map((g) => g.name), ['Sweet Bonanza']);
    assert.strictEqual(
      result.visibleGames[0].providerId,
      JILI,
      'the match must belong to the selected studio',
    );
    assert.ok(
      state.calls[0].url.includes('provider=' + JILI) &&
        state.calls[0].url.includes('search=Sweet'),
      'both filters must reach the backend: ' + state.calls[0].url,
    );
  });

  await test('10. studio + category works and neither filter resets the other', async () => {
    installFetchSpy();
    const slots = await loadCatalog({ provider: JILI, category: 'slots' });
    assert.deepStrictEqual(
      slots.visibleGames.map((g) => g.name),
      ['Sweet Bonanza', 'Book of Dead'],
      'only that studio slot games',
    );
    const live = await loadCatalog({ provider: JILI, category: 'live' });
    assert.deepStrictEqual(live.visibleGames.map((g) => g.name), ['Lightning Roulette']);

    // Changing the category must NOT clear the studio in the URL...
    let href = query.setQueryParam('/games?product=casino', 'provider', JILI);
    href = query.setQueryParam(href, 'category', 'slots');
    assert.strictEqual(
      query.parseCatalogQuery(href).provider,
      JILI,
      'a category change keeps the studio',
    );
    // ...and changing the studio must NOT clear the category.
    href = query.setQueryParam(href, 'provider', TATAP);
    assert.strictEqual(
      query.parseCatalogQuery(href).category,
      'slots',
      'a studio change keeps the category',
    );
  });

  // ---- 11. Home ----------------------------------------------------------
  await test('11. the Home studio selection navigates correctly', async () => {
    assert.ok(
      HOME_SRC.includes('<CasinoCatalogSection'),
      'Home must keep rendering the real catalog section',
    );
    assert.ok(
      SECTION_SRC.includes('<StudioSelector'),
      'the catalog section (rendered by Home) must render the shared studio selector',
    );
    assert.ok(
      SECTION_SRC.includes('href={buildGamesHref({ product, provider, category: categorySlug })}'),
      'the Home "View all" link must hand the selected studio over to /games',
    );
    assert.strictEqual(
      query.buildGamesHref({ product: 'casino', provider: PG_SOFT, category: 'slots' }),
      '/games?product=casino&provider=' + PG_SOFT + '&category=slots',
      'Home hands over to the real games route, keeping the studio',
    );
  });

  // ---- 12. sidebar -------------------------------------------------------
  await test('12. the sidebar studio selection navigates correctly', async () => {
    assert.ok(SIDEBAR_SRC.includes('<StudioSidebarNav'), 'the left menu must render the studios block');
    assert.ok(
      /ownsGames/.test(SIDEBAR_SRC),
      'the studios block must be attached to the existing Games section',
    );
    assert.ok(
      STUDIO_NAV_SRC.includes('useCasinoProviders'),
      'the sidebar studios must come from the public provider endpoint',
    );
    assert.ok(
      STUDIO_NAV_SRC.includes('allStudiosHref(product)') &&
        STUDIO_NAV_SRC.includes('studioHref(product, entry.id)'),
      'every sidebar row must be a real /games?product=... link',
    );
    assert.strictEqual(query.allStudiosHref('casino'), '/games?product=casino', 'All Studios row');
    assert.strictEqual(
      query.studioHref('casino', TATAP),
      '/games?product=casino&provider=' + TATAP,
      'a studio sidebar row',
    );
    // Active-row highlighting follows the real route.
    assert.ok(
      query.isStudioRouteActive({
        pathname: '/games',
        product: 'casino',
        selected: TATAP,
        studioId: TATAP,
      }),
      'the current studio row must be highlighted',
    );
    assert.ok(
      !query.isStudioRouteActive({
        pathname: '/games',
        product: 'casino',
        selected: TATAP,
        studioId: JILI,
      }),
      'a different studio row must not be highlighted',
    );
    assert.ok(
      query.isStudioRouteActive({
        pathname: '/games',
        product: 'casino',
        selected: null,
        studioId: null,
      }),
      'All Studios is active on a plain /games?product=casino',
    );
    assert.ok(
      !query.isStudioRouteActive({
        pathname: '/wallet',
        product: 'casino',
        selected: TATAP,
        studioId: TATAP,
      }),
      'nothing is highlighted away from the games page',
    );
  });

  // ---- 13. provider card ------------------------------------------------
  await test('13. the provider card "View All" navigates correctly', async () => {
    assert.ok(
      PROVIDER_CARD_SRC.includes('href={studioHref(product, provider.id)}'),
      'the card must use the shared studio href contract',
    );
    // React escapes "&" in an href attribute; compare the decoded value.
    const unescapeHref = (markup) => markup.replace(/&amp;/g, '&');
    const html = unescapeHref(
      render(
        React.createElement(ProviderCard, {
          provider: { id: JILI, name: 'Studio One', gameCount: 3 },
          product: 'casino',
        }),
      ),
    );
    assert.ok(
      html.includes('href="/games?product=casino&provider=' + JILI + '"'),
      'the rendered card must link to the real provider id: ' + html,
    );
    assert.ok(html.includes('3 games'), 'the card shows the real count from the response');
    const liveHtml = unescapeHref(
      render(
        React.createElement(ProviderCard, {
          provider: { id: LIVE_STUDIO, name: 'Live Studio', gameCount: 1 },
          product: 'live',
        }),
      ),
    );
    assert.ok(
      liveHtml.includes('href="/games?product=live&provider=' + LIVE_STUDIO + '"'),
      'a live card must stay in the live product',
    );
    assert.strictEqual(
      render(React.createElement(ProvidersSection, { items: [], product: 'casino' })),
      '',
      'no active provider => no studio row at all',
    );
  });

  // ---- 14. casino vs live ------------------------------------------------
  await test('14. casino and live providers remain separated', async () => {
    installFetchSpy();
    resetCasinoProvidersCache();
    const casino = await loadStudios('casino');
    const live = await loadStudios('live');
    assert.ok(
      state.calls.some((c) => c.url.includes('product=casino')) &&
        state.calls.some((c) => c.url.includes('product=live')),
      'each product must be requested with its own product param',
    );
    assert.ok(
      casino.every((p) => p.productType === 'CASINO') &&
        live.every((p) => p.productType === 'LIVE_CASINO'),
      'each list must only contain providers of its own product',
    );
    assert.ok(
      !casino.some((p) => live.some((q) => q.id === p.id)),
      'the two product lists must not overlap',
    );
    assert.strictEqual(
      query.studioHref('live', LIVE_STUDIO),
      '/games?product=live&provider=' + LIVE_STUDIO,
      'a live studio link must stay in the live product',
    );
    // The sidebar picks the product from the URL it renders.
    assert.strictEqual(query.studioProductFromQuery('live'), 'live');
    assert.strictEqual(query.studioProductFromQuery('casino'), 'casino');
    assert.strictEqual(query.studioProductFromQuery(null), 'casino');
  });

  // ---- 15 + 16. BigBang / WinHouse untouched -----------------------------
  const STUDIO_SOURCES = [
    SELECTOR_SRC,
    SECTION_SRC,
    BROWSER_SRC,
    QUERY_SRC,
    PROVIDERS_HOOK_SRC,
    STUDIO_NAV_SRC,
    PROVIDER_CARD_SRC,
  ];

  await test('15. BigBang behaviour remains unchanged', async () => {
    for (const src of STUDIO_SOURCES) {
      assert.ok(!/BigBang/i.test(src), 'no frontend studio source may special-case BigBang');
    }
    // BigBang games are ordinary catalog rows: they arrive from the endpoint and
    // are filtered by their real provider id like every other studio.
    installFetchSpy();
    const bigbang = { id: 'row-bigbang', name: 'BigBang', gameCount: 2, productType: 'CASINO' };
    const html = selectorHtml([bigbang], bigbang.id);
    assert.ok(html.includes('BigBang (2)'), 'a BigBang row renders like any other studio');
    assert.ok(html.includes('aria-pressed="true"'), 'and is selected when it is the active one');
  });

  await test('16. WinHouse behaviour remains unchanged', async () => {
    for (const src of STUDIO_SOURCES) {
      assert.ok(!/WinHouse/i.test(src), 'no frontend studio source may special-case WinHouse');
    }
    assert.ok(
      fs.existsSync(path.join(webRoot, 'components/sports/winhouse-book.tsx')),
      'the existing WinHouse sportsbook surface is untouched',
    );
  });

  // ---- cross-cutting contracts ------------------------------------------
  await test('no studio list, name or id is hard-coded in the frontend', async () => {
    const pairs = [
      ['studio-query', stripComments(QUERY_SRC)],
      ['studio-selector', stripComments(SELECTOR_SRC)],
      ['studio-sidebar-nav', stripComments(STUDIO_NAV_SRC)],
      ['use-casino-providers', stripComments(PROVIDERS_HOOK_SRC)],
      ['casino-catalog-section', stripComments(SECTION_SRC)],
      ['casino-catalog-browser', stripComments(BROWSER_SRC)],
    ];
    for (const pair of pairs) {
      const label = pair[0];
      const src = pair[1];
      assert.ok(!/providers\s*\[\s*0\s*\]/.test(src), label + ' must never default to providers[0]');
      const brands = ['JILI', 'TATAP', 'PG SOFT', 'PRAGMATIC', 'EVOLUTION', 'BigBang', 'WinHouse'];
      for (const brand of brands) {
        assert.ok(!src.includes(brand), label + ' must not hard-code ' + brand);
      }
    }
    assert.ok(
      /All Studios/.test(SELECTOR_SRC) && /All Studios/.test(STUDIO_NAV_SRC),
      'the UI wording is "All Studios"',
    );
  });

  await test('All Studios is the default state of the rendered selector', async () => {
    installFetchSpy();
    const studios = await loadStudios('casino');
    const html = selectorHtml(studios, null);
    assert.ok(html.includes('All Studios (9)'), 'All Studios shows the real total from the response');
    assert.ok(
      /aria-pressed="true"[^>]*>All Studios/.test(html),
      'All Studios must be the selected (default) chip',
    );
    const selected = selectorHtml(studios, TATAP);
    assert.ok(selected.includes('aria-pressed="true"'), 'the selected studio stays visibly selected');
    assert.ok(
      selected.includes('<option value="' + TATAP + '" selected=""'),
      'the mobile dropdown must reflect the same selection',
    );
    assert.ok(
      html.includes('<option value="' + JILI + '">Studio One (3)</option>'),
      'the dropdown lists the real providers with their real counts',
    );
  });

  await test('loading, error and empty states are honest', async () => {
    installFetchSpy();
    const studios = await loadStudios('casino');
    const loading = selectorHtml([], null, { loading: true });
    assert.ok(!/Studio One|Studio Two/.test(loading), 'no studio name may be rendered while loading');
    assert.ok(/animate-pulse/.test(loading), 'a skeleton is shown instead');

    const failed = selectorHtml([], null, { error: 'Studio list unavailable', onRetry: () => {} });
    assert.ok(failed.includes('Studio list unavailable'), 'the failure must be surfaced');
    assert.ok(/Retry/.test(failed), 'with a retry action');
    assert.ok(!/Studio One|Studio Two/.test(failed), 'and never a hard-coded fallback list');

    const empty = selectorHtml([], null);
    assert.ok(/No studios are available/.test(empty), 'zero providers => the honest empty state');

    // A failed provider request falls back to the catalog response own list.
    const picked = query.pickStudioList({ primary: [], fallback: studios, error: 'boom' });
    assert.deepStrictEqual(picked.list.map((p) => p.id), [JILI, TATAP, PG_SOFT]);
    assert.strictEqual(picked.error, null, 'a working list suppresses the error');
    const nothing = query.pickStudioList({ primary: [], fallback: [], error: 'boom' });
    assert.strictEqual(nothing.error, 'boom', 'with no list at all the error is shown');
  });

  await test('one selection mechanism is shared by all three surfaces', async () => {
    const pairs = [
      ['section', SECTION_SRC],
      ['browser', BROWSER_SRC],
    ];
    for (const pair of pairs) {
      const label = pair[0];
      const src = pair[1];
      assert.ok(
        src.includes('useCatalogFilters'),
        label + ' must read/write the studio through the shared URL contract',
      );
      assert.ok(
        src.includes('useCasinoProviders'),
        label + ' must read the studio list from the shared public provider hook',
      );
      assert.ok(src.includes('<StudioSelector'), label + ' must render the shared selector');
      assert.ok(
        !/All providers<\/option>/.test(src) && !/All studios<\/option>/.test(src),
        label + ' must not keep a private provider filter',
      );
    }
    assert.ok(
      !/useState<string \| null>\(initialProvider/.test(SECTION_SRC),
      'the section must not keep a private provider state',
    );
    assert.ok(
      GAMES_BROWSER_SRC.includes('initialProvider={initialProvider}'),
      'the /games route keeps passing its ?provider= seed through',
    );
  });

  await test('game launch is unaffected by the studio filter', async () => {
    assert.ok(
      /launchCasinoGame/.test(BROWSER_SRC),
      'the games page must still launch through the backend',
    );
    assert.ok(
      BROWSER_SRC.includes('game: gameId'),
      'the launch payload must still carry the real game id',
    );
    const href = query.buildGamesHref({ product: 'casino', provider: TATAP, game: TATAP + ':t1' });
    assert.ok(
      href.indexOf('game=' + encodeURIComponent(TATAP + ':t1')) > -1,
      'opening a game keeps the provider-scoped catalog id: ' + href,
    );
  });

  // -------------------------------------------------------------------------
  // Completeness: the selector must render EVERY entry the API returned, on
  // BOTH the desktop chip row and the mobile <select>, and never invent one.
  // -------------------------------------------------------------------------

  await test('every returned studio appears on desktop AND on mobile', async () => {
    installFetchSpy();
    const studios = await loadStudios('casino');
    assert.strictEqual(studios.length, 3, 'fixture must expose three studios');

    const html = selectorHtml(studios, null);

    // Desktop chips and the mobile dropdown are the SAME list.
    for (const studio of studios) {
      const chip = studio.name + ' (' + studio.gameCount + ')';
      assert.ok(html.includes(chip), 'the chip for ' + studio.id + ' must render: ' + chip);
      assert.ok(
        html.includes('<option value="' + studio.id + '">' + chip + '</option>'),
        'the mobile <option> for ' + studio.id + ' must exist',
      );
    }
    // And "All Studios" is offered on both, as the empty provider filter.
    assert.ok(html.includes('All Studios'), 'the desktop All Studios chip must render');
    // React marks the active option, so match the tag, not the attribute order.
    const allStudiosOption = /<option value=""[^>]*>All Studios/.test(html);
    assert.ok(allStudiosOption, 'the mobile All Studios option must render');
  });

  await test('the studio selector is capped by the API, never by the UI', async () => {
    // 25 studios is far more than any UI affordance: if the component ever
    // grew a hard-coded slice, this fails.
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: 'p-studio-' + String(i).padStart(3, '0'),
      name: 'Studio ' + (i + 1),
      gameCount: i + 1,
      productType: 'CASINO',
    }));
    const html = selectorHtml(many, null);

    for (const studio of many) {
      assert.ok(
        html.includes('<option value="' + studio.id + '">'),
        'studio ' + studio.id + ' must be offered',
      );
    }
    assert.strictEqual(
      (html.match(/<option value="p-studio-/g) || []).length,
      25,
      'all 25 studios must be offered',
    );
  });

  await test('an empty provider response renders no studio at all (no fabrication)', async () => {
    const html = selectorHtml([], null);
    const options = (html.match(/<option /g) || []).length;

    // Only the "All Studios" option may exist.
    assert.strictEqual(options, 1, 'only the All Studios option may be rendered');
    assert.ok(/No studios are available/.test(html), 'the honest empty state must render');
  });

  await test('a provider API failure never yields a placeholder studio', async () => {
    installFetchSpy();
    state.failProviders = true;
    try {
      // A failed provider request must REJECT, never resolve to a fake list.
      let rejected = false;
      try {
        await loadStudios('casino');
      } catch {
        rejected = true;
      }
      assert.ok(rejected, 'a failed provider request must not resolve with studios');

      const html = selectorHtml([], null, {
        error: 'Provider list unavailable',
        onRetry: () => {},
      });
      assert.ok(/Provider list unavailable/.test(html), 'the failure must be surfaced');
      assert.ok(/Retry/.test(html), 'with a retry action');
      assert.ok(!/Studio One|Studio Two|Studio Three/.test(html), 'no invented studio name');
    } finally {
      state.failProviders = false;
    }
  });

  await test('no provider or category is ever hard-coded in the frontend', async () => {
    // BIGBANG is a real PartnerProvider ROW, not a studio the frontend may
    // assume. No selector surface may mention it (or any brand) as a literal.
    for (const [label, src] of [
      ['studio selector', SELECTOR_SRC],
      ['studio query', QUERY_SRC],
      ['provider hook', read('hooks/use-casino-providers.ts')],
      ['casino browser', BROWSER_SRC],
    ]) {
      assert.ok(
        !/BIGBANG|BigBang|bigbang/.test(src),
        label + ' must not hard-code a provider name',
      );
    }
    // Categories are equally data-driven: no genre is written into the UI.
    assert.ok(
      !/'Slots'|"Slots"|'Table Games'|"Table Games"/.test(SELECTOR_SRC + QUERY_SRC),
      'no category name may be hard-coded in the selector data flow',
    );
  });

  await test('every category the catalog returns reaches the category filter', async () => {
    // 32 categories, mirroring the reported catalog size. Nothing may cap it.
    const categories = Array.from({ length: 32 }, (_, i) => ({
      id: 'cat-' + i,
      externalId: 'ext-' + i,
      name: 'Category ' + (i + 1),
      slug: 'category-' + (i + 1),
      productType: 'CASINO',
      gameCount: 1,
    }));

    for (const category of categories) {
      const href = query.buildGamesHref({
        product: 'casino',
        provider: JILI,
        category: category.slug,
      });
      const parsed = query.parseCatalogQuery(href);
      assert.strictEqual(
        parsed.category,
        category.slug,
        'the selected category must survive the URL round-trip: ' + category.name,
      );
      assert.strictEqual(parsed.product, 'casino', 'a category must never change the product');
      // The slug is what reaches the backend.
      const qs = casinoApi.buildCatalogQuery({
        product: 'casino',
        category: category.slug,
      });
      assert.ok(qs.includes('category=' + category.slug), qs);
    }
  });

  await test('"All Categories" removes the category filter entirely', async () => {
    assert.strictEqual(
      query.setQueryParam('/games?product=casino&category=slots', 'category', null),
      '/games?product=casino',
      'All Categories must REMOVE the parameter, not send an empty one',
    );
    // An empty/blank value is normalised to "no filter" as well.
    assert.strictEqual(query.normalizeCategory('   '), null);
    assert.strictEqual(query.normalizeCategory(undefined), null);
  });

  await test('"All Studios" removes the provider filter and never sends "all"', async () => {
    assert.strictEqual(
      query.setQueryParam('/games?product=casino&provider=' + JILI, 'provider', null),
      '/games?product=casino',
      'All Studios must REMOVE the provider parameter',
    );
    // The real request builder must omit it rather than send a fake id.
    const qs = casinoApi.buildCatalogQuery({ product: 'casino', provider: null });
    assert.ok(!qs.includes('provider='), 'no provider parameter may be sent: ' + qs);
    assert.ok(qs.includes('product=casino'), 'the product is always sent: ' + qs);

    // A real selection IS sent verbatim.
    const selected = casinoApi.buildCatalogQuery({ product: 'casino', provider: JILI });
    assert.ok(selected.includes('provider=' + encodeURIComponent(JILI)), selected);
  });

  await test('provider and category filters are sent together', async () => {
    const qs = casinoApi.buildCatalogQuery({
      product: 'casino',
      provider: JILI,
      category: 'slots',
    });
    assert.ok(qs.includes('provider=' + encodeURIComponent(JILI)), qs);
    assert.ok(qs.includes('category=slots'), qs);
    assert.ok(qs.includes('product=casino'), qs);
  });

  // -------------------------------------------------------------------------
  if (failures > 0) {
    console.error('\n' + failures + ' studio-selection test(s) FAILED.');
    process.exitCode = 1;
    return;
  }
  console.log('\nAll studio-selection tests passed.');
}

main().catch((err) => {
  console.error(err);
  console.error('\n' + failures + ' studio-selection test(s) FAILED.');
  process.exit(1);
});

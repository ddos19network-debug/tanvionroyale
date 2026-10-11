'use strict';

/**
 * PUBLIC Home / Games page → provider-catalog data-flow regression tests.
 *
 * THE BUG THIS LOCKS DOWN
 * -----------------------
 * The real Home page (`/` and `/home` → `app/(user)/page.tsx` →
 * `components/home/HomeContent.tsx`) and the parameterless Games page
 * (`app/(user)/games/page.tsx` → `components/home/GamesBrowser.tsx`) rendered a
 * HARD-CODED array from `lib/data/games.ts` ("Teal Fortune", "Provider One"…).
 * Neither file ever imported `lib/api/casino`, so the public catalog endpoint
 * was never called from Home at all. The backend could sync and serve 1797 real
 * provider games and every backend test still passed, while production Home
 * displayed zero provider games.
 *
 * WHY THIS IS NOT A GREP TEST
 * ---------------------------
 * These tests load the REAL production modules through the same TypeScript +
 * `@/` alias loader used by test-auth-flow.cjs, stub ONLY the network boundary
 * (`global.fetch`) and the browser boundary (storage), and drive the real
 * `getCasinoCatalog()` API client and the real `use-casino-catalog` data flow.
 * The stubbed response is byte-for-byte the shape the deployed API returns
 * (`{success, data:{productType, available, configured, games:{items,total,
 * page,pageSize,hasMore}, providers, categories, syncedAt}}`), so a drift in
 * the endpoint, the query string, the envelope or the provider filter fails
 * here exactly as it would fail in a browser.
 *
 * COVERED
 *   1. default = ALL active providers (no `provider` param is ever sent)
 *   2. Provider A → 3, Provider B → 4, Provider C → 2 ⇒ 9 games on the page
 *   3. an EMPTY provider filter means all providers, never "none"
 *   4. per-provider filtering by row id AND by display name
 *   5. duplicate game names across providers stay SEPARATE games
 *   6. the request is public (no Authorization header, no admin endpoint)
 *   7. Home and /games are wired to the real catalog, not to placeholder data
 *
 * Run: `node scripts/test-home-catalog-flow.cjs` (exit 0 = pass).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const webRoot = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// TS + @/ loader (same harness as test-auth-flow.cjs)
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

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    // '@/*' -> './*' relative to the web app root.
    request = path.join(webRoot, request.slice(2));
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
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

// The deployed API base. `lib/api/client.ts` normalises it to `…/api/v1`.
process.env.NEXT_PUBLIC_API_URL = 'https://tanvionroyale.onrender.com';

// ---------------------------------------------------------------------------
// Fixture — three active providers: A(3) + B(4) + C(2) = 9 games.
// "Sweet Bonanza" is deliberately published by BOTH Provider A and Provider B.
// ---------------------------------------------------------------------------
const PROVIDER_A = 'aaaaaaaa-0000-0000-0000-00000000000a';
const PROVIDER_B = 'bbbbbbbb-0000-0000-0000-00000000000b';
const PROVIDER_C = 'cccccccc-0000-0000-0000-00000000000c';

function game(providerId, providerName, externalId, name, category, slug) {
  return {
    id: `${providerId}:${externalId}`,
    provider: providerName,
    providerId,
    externalId,
    name,
    slug,
    thumbnail: null,
    banner: null,
    category,
    categorySlug: category.toLowerCase(),
    tags: ['slot', 'standard'],
    productType: 'CASINO',
    source: 'PARTNER',
    status: 'ACTIVE',
    isFeatured: false,
    launchAvailable: true,
    demoAvailable: false,
  };
}

const GAMES = [
  game(PROVIDER_A, 'Provider A', 'a1', 'Sweet Bonanza', 'Slots', 'sweet-bonanza-a'),
  game(PROVIDER_A, 'Provider A', 'a2', 'Book of Dead', 'Slots', 'book-of-dead'),
  game(PROVIDER_A, 'Provider A', 'a3', 'Legacy of Dead', 'Slots', 'legacy-of-dead'),

  game(PROVIDER_B, 'Provider B', 'b1', 'Sweet Bonanza', 'Slots', 'sweet-bonanza-b'),
  game(PROVIDER_B, 'Provider B', 'b2', 'Gates of Olympus', 'Slots', 'gates-of-olympus'),
  game(PROVIDER_B, 'Provider B', 'b3', 'Starlight Princess', 'Slots', 'starlight'),
  game(PROVIDER_B, 'Provider B', 'b4', 'Wolf Gold', 'Slots', 'wolf-gold'),

  game(PROVIDER_C, 'Provider C', 'c1', 'Live Roulette', 'Live', 'live-roulette'),
  game(PROVIDER_C, 'Provider C', 'c2', 'Live Blackjack', 'Live', 'live-blackjack'),
];

const PROVIDERS = [
  { id: PROVIDER_A, name: 'Provider A', gameCount: 3, productType: 'CASINO' },
  { id: PROVIDER_B, name: 'Provider B', gameCount: 4, productType: 'CASINO' },
  { id: PROVIDER_C, name: 'Provider C', gameCount: 2, productType: 'CASINO' },
];

/** The exact envelope the deployed API returns. */
function catalogEnvelope(items, providers) {
  return {
    success: true,
    data: {
      productType: 'CASINO',
      available: true,
      configured: true,
      environment: 'production',
      provider: providers[0] ? providers[0].name : null,
      message: null,
      games: {
        items,
        total: items.length,
        page: 1,
        pageSize: 24,
        hasMore: false,
      },
      categories: [
        { id: 'slots', name: 'Slots', slug: 'slots', gameCount: 7, productType: 'CASINO' },
        { id: 'live', name: 'Live', slug: 'live', gameCount: 2, productType: 'CASINO' },
      ],
      providers,
      syncedAt: '2026-09-25T15:42:23.573Z',
    },
  };
}

/**
 * Minimal server-side filter, mirroring `CasinoCatalogService.buildWhere`:
 * a `provider` value matches the PartnerProvider row id, the row name
 * (case-insensitive) or a catalog-id prefix, and an UNKNOWN value narrows to
 * nothing (never to an unfiltered result). The backend already narrows to one
 * provider, so the client only has to survive the response.
 */
function serveCatalog(url) {
  const parsed = new URL(url);
  const provider = parsed.searchParams.get('provider');
  const category = parsed.searchParams.get('category');
  const search = (parsed.searchParams.get('search') || '').toLowerCase();

  let items = GAMES;
  let providers = PROVIDERS;
  if (provider) {
    const needle = provider.trim().toLowerCase();
    const matches = (g) =>
      g.providerId.toLowerCase() === needle ||
      g.provider.toLowerCase() === needle ||
      g.id.toLowerCase().startsWith(needle + ':');
    items = items.filter(matches);
    providers = providers.filter(
      (p) => p.id.toLowerCase() === needle || p.name.toLowerCase() === needle,
    );
  }
  if (category) {
    items = items.filter((g) => g.categorySlug === category);
  }
  if (search) {
    items = items.filter((g) => g.name.toLowerCase().includes(search));
  }
  return catalogEnvelope(items, providers);
}

/** Records every request the code under test makes. */
function installFetchSpy() {
  const calls = [];
  global.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const headers = (init && init.headers) || {};
    calls.push({ url, headers });
    return {
      ok: true,
      status: 200,
      json: async () => serveCatalog(url),
    };
  };
  return calls;
}


// ---------------------------------------------------------------------------
// Source contracts for the two public catalog surfaces
// ---------------------------------------------------------------------------
function read(rel) {
  return fs.readFileSync(path.join(webRoot, rel), 'utf8');
}

/** Drops comments so prose about `providers[0]` cannot satisfy a code check. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const HOME_SRC = read('components/home/HomeContent.tsx');
const GAMES_SRC = read('components/home/GamesBrowser.tsx');
const HOME_PAGE_SRC = read('app/(user)/page.tsx');
const GAMES_PAGE_SRC = read('app/(user)/games/page.tsx');

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

async function main() {
  const casinoApi = require('../lib/api/casino.ts');
  const { normalizeCatalogPage, matchesCatalogProvider } = require('../hooks/use-casino-catalog.ts');

  /** The exact thing Home renders: fetch → map → filter. */
  async function loadHomeCatalog(provider) {
    const response = await casinoApi.getCasinoCatalog({
      product: 'casino',
      provider: provider ?? undefined,
      page: 1,
      pageSize: 24,
    });
    const page = normalizeCatalogPage(response);
    return {
      response,
      ...page,
      visibleGames: page.items.filter((g) => matchesCatalogProvider(g, provider)),
      providers: response.providers,
    };
  }

  console.log('\nHome / Games page → provider catalog data flow');

  await test('the Home catalog request targets the PUBLIC endpoint under /api/v1', async () => {
    const calls = installFetchSpy();
    await loadHomeCatalog(null);

    assert.strictEqual(calls.length, 1, 'the Home page must issue exactly one catalog request');
    const { url } = calls[0];
    assert.ok(
      url.startsWith('https://tanvionroyale.onrender.com/api/v1/casino/catalog'),
      'the Home page must call the deployed public catalog, got: ' + url,
    );
    assert.ok(
      !url.includes('/admin/'),
      'the public Home page must never call an /admin/ endpoint, got: ' + url,
    );
    const headers = calls[0].headers || {};
    assert.ok(
      !Object.keys(headers).some((k) => k.toLowerCase() === 'authorization'),
      'the public catalog request must not carry an Authorization header',
    );
  });

  await test('DEFAULT = ALL providers: no `provider` parameter is sent', async () => {
    const calls = installFetchSpy();
    await loadHomeCatalog(null);

    const sent = new URL(calls[0].url);
    assert.strictEqual(
      sent.searchParams.get('provider'),
      null,
      'with no provider selected the request must carry NO provider param (= all providers)',
    );
    assert.strictEqual(sent.searchParams.get('product'), 'casino');
    assert.strictEqual(sent.searchParams.get('page'), '1', 'pagination must start at page 1');
  });

  await test('an EMPTY / whitespace provider filter still means ALL providers', async () => {
    const calls = installFetchSpy();
    const { visibleGames } = await loadHomeCatalog('');
    await loadHomeCatalog('   ');

    assert.strictEqual(visibleGames.length, 9, 'a blank provider must not narrow the catalog');
    for (const call of calls) {
      const sent = new URL(call.url);
      assert.strictEqual(
        sent.searchParams.get('provider'),
        null,
        'a blank provider must never be sent as `provider=` (WHERE provider_id = "")',
      );
    }
  });


  await test('Home receives and renders games from Provider A + B + C (9 games)', async () => {
    installFetchSpy();
    const result = await loadHomeCatalog(null);

    assert.strictEqual(result.visibleGames.length, 9, 'A(3) + B(4) + C(2) must all render');
    assert.strictEqual(result.total, 9);
    assert.strictEqual(result.providers.length, 3, 'all three active providers must be reported');

    const perProvider = {};
    for (const g of result.visibleGames) {
      perProvider[g.provider] = (perProvider[g.provider] || 0) + 1;
    }
    assert.deepStrictEqual(
      perProvider,
      { 'Provider A': 3, 'Provider B': 4, 'Provider C': 2 },
      'every provider must be represented on Home',
    );
    // A React key is the catalog id, so all nine cards must be distinct.
    assert.strictEqual(new Set(result.visibleGames.map((g) => g.id)).size, 9);
  });

  await test('Provider A filter → 3, Provider B → 4, Provider C → 2', async () => {
    installFetchSpy();
    assert.strictEqual((await loadHomeCatalog(PROVIDER_A)).visibleGames.length, 3);
    assert.strictEqual((await loadHomeCatalog(PROVIDER_B)).visibleGames.length, 4);
    assert.strictEqual((await loadHomeCatalog(PROVIDER_C)).visibleGames.length, 2);
  });

  await test('a selected provider narrows BOTH the request and the rendered list', async () => {
    const calls = installFetchSpy();
    const result = await loadHomeCatalog(PROVIDER_B);

    assert.strictEqual(new URL(calls[0].url).searchParams.get('provider'), PROVIDER_B);
    assert.ok(
      result.visibleGames.every((g) => g.providerId === PROVIDER_B),
      "a filtered view must never leak another provider's games",
    );
  });

  await test('a provider can be selected by display name as well as by row id', async () => {
    installFetchSpy();
    const byName = await loadHomeCatalog('Provider A');
    assert.strictEqual(byName.visibleGames.length, 3, 'the display name must keep filtering');

    // Even against an unfiltered 9-game list the guard holds.
    assert.strictEqual(
      GAMES.filter((g) => matchesCatalogProvider(g, 'Provider C')).length,
      2,
      'name matching must be applied client-side too',
    );
  });

  await test('an UNKNOWN provider yields an honest empty result, not a broken page', async () => {
    installFetchSpy();
    const result = await loadHomeCatalog('does-not-exist');
    assert.strictEqual(result.visibleGames.length, 0);
    assert.strictEqual(result.total, 0);
    assert.ok(Array.isArray(result.response.providers), 'the response shape stays valid');
  });

  await test('duplicate game names from different providers stay SEPARATE games', async () => {
    installFetchSpy();
    const result = await loadHomeCatalog(null);
    const sweet = result.visibleGames.filter((g) => g.name === 'Sweet Bonanza');

    assert.strictEqual(sweet.length, 2, 'both "Sweet Bonanza" entries must survive');
    assert.deepStrictEqual(
      sweet.map((g) => g.provider).sort(),
      ['Provider A', 'Provider B'],
    );
    assert.notStrictEqual(sweet[0].id, sweet[1].id, 'they are distinct catalog games');
  });

  await test('the response envelope is unwrapped exactly once', async () => {
    installFetchSpy();
    const { response } = await loadHomeCatalog(null);
    assert.strictEqual(response.success, undefined, 'the {success,data} envelope must be unwrapped');
    assert.ok(response.games && Array.isArray(response.games.items));
  });

  await test('an unexpected payload degrades to an empty page, never to fake games', () => {
    assert.strictEqual(normalizeCatalogPage(null).items.length, 0);
    assert.strictEqual(normalizeCatalogPage({}).items.length, 0);
    assert.strictEqual(normalizeCatalogPage({ games: null }).items.length, 0);
    // A bare page is still accepted.
    assert.strictEqual(normalizeCatalogPage({ items: GAMES }).items.length, 9);
  });


  // ------------------------------------------------------------------
  // The pages themselves must be WIRED to the real catalog. Without these
  // the data flow above would be perfect while Home still rendered nothing.
  // ------------------------------------------------------------------
  await test('the Home page renders HomeContent, which renders the real catalog', () => {
    assert.ok(
      HOME_PAGE_SRC.includes('<HomeContent />'),
      'the production route `/` must render HomeContent',
    );
    assert.ok(
      HOME_SRC.includes('<CasinoCatalogSection'),
      'HomeContent must render CasinoCatalogSection (the real public catalog)',
    );
    assert.ok(
      HOME_SRC.includes("from '@/components/casino/casino-catalog-section'"),
      'HomeContent must import CasinoCatalogSection',
    );
    assert.ok(
      !/gamesByCategory|gameSections|gameCategories/.test(HOME_SRC),
      'HomeContent must no longer build its grid from the hard-coded lib/data/games catalog',
    );
    assert.ok(
      !/from '@\/lib\/data\/providers'/.test(HOME_SRC),
      'HomeContent must no longer list the hard-coded placeholder providers',
    );
  });

  await test('the /games page renders the real catalog too', () => {
    assert.ok(
      GAMES_PAGE_SRC.includes('<GamesBrowser />'),
      'the parameterless /games route must render GamesBrowser',
    );
    assert.ok(
      GAMES_SRC.includes('<CasinoCatalogSection'),
      'GamesBrowser must render CasinoCatalogSection (the real public catalog)',
    );
    assert.ok(
      !/gamesByCategory/.test(GAMES_SRC),
      'GamesBrowser must no longer filter the hard-coded lib/data/games catalog',
    );
  });

  await test('no public page defaults to the first provider or an empty provider id', () => {
    const hookSrc = stripComments(read('hooks/use-casino-catalog.ts'));
    const sectionSrc = stripComments(read('components/casino/casino-catalog-section.tsx'));
    const selectorSrc = stripComments(read('components/casino/studio-selector.tsx'));
    const filtersSrc = stripComments(read('hooks/use-catalog-filters.ts'));

    for (const [label, src] of [
      ['hook', hookSrc],
      ['section', sectionSrc],
      ['studio-selector', selectorSrc],
      ['catalog-filters', filtersSrc],
    ]) {
      assert.ok(
        !/providers\s*\[\s*0\s*\]/.test(src),
        label + ' must never default to providers[0]',
      );
      assert.ok(
        !/defaultProvider\s*=|BIGBANG|WinHouse/.test(src),
        label + ' must not hard-code a single provider',
      );
    }

    // The shared studio selector starts on "All Studios" and only narrows on
    // user choice; clearing it resolves to null (= every active provider),
    // never "".
    assert.ok(
      selectorSrc.includes('<option value="">{ALL_STUDIOS_LABEL}</option>'),
      'the studio filter must offer an explicit "All Studios" default',
    );
    assert.ok(
      selectorSrc.includes('onClick={() => onSelect(null)}'),
      'the "All Studios" chip must select null (= every active provider), never ""',
    );
    assert.ok(
      selectorSrc.includes('onSelect(normalizeStudio(event.target.value))'),
      'clearing the studio dropdown must normalise to null (= all providers), never ""',
    );
    // …and the section that Home renders now delegates to it (one mechanism).
    assert.ok(
      sectionSrc.includes('<StudioSelector'),
      'the catalog section must use the shared studio selector',
    );
    assert.ok(
      sectionSrc.includes('useCatalogFilters'),
      'the studio selection must be URL-canonical, not local state',
    );
  });

  await test('the Games page normalises a blank ?provider= to "all providers"', () => {
    assert.ok(
      /initialProvider\s*=\s*providerParam\?\.trim\(\)\s*\?/.test(GAMES_SRC),
      'an empty ?provider= must be normalised to null (= all providers)',
    );
  });

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  if (failures > 0) {
    console.error('\n' + failures + ' home-catalog data-flow test(s) FAILED.');
    process.exitCode = 1;
    return;
  }
  console.log('\nAll home-catalog data-flow tests passed.');
}

main().catch((err) => {
  console.error(err);
  console.error('\n' + failures + ' home-catalog data-flow test(s) FAILED.');
  process.exit(1);
});


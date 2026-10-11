/* eslint-disable @typescript-eslint/no-explicit-any */
import { BigBangCasinoProvider } from '../src/modules/bigbang/bigbang.provider';
import { BIGBANG_DEFAULT_BASE_URL, loadBigBangEnvConfig } from '../src/modules/bigbang/bigbang.config';

/**
 * BigBang catalog adapter tests.
 *
 * The provider is read with the DOCUMENTED contract only: `limit`/`offset`
 * pagination terminated by `pagination.total`, the documented catalog fields
 * normalized first, `/categories` as the category source, and a launch payload
 * built from `user_token` (never the obsolete `POST /users/create`).
 */
const API_KEY = 'sandbox-key';
const PLAYER_ID = 'tr0123456789abcdef0123456789abcd';
const GAME_URL =
  'https://bigbangcasino.bet/api/game/Habanero/SGHotHotFruit/4821/player_42/1699999999/ab12cd';

type Handler = (url: URL) => { body: unknown; status?: number } | undefined;

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as any;
}

function installFetch(handlers: Handler[]) {
  const calls: string[] = [];
  const fetchMock = jest.fn(async (input: any, init?: any) => {
    const url = String(input);
    calls.push(url);
    const parsed = new URL(url);
    for (const handler of handlers) {
      const result = handler(parsed);
      if (result) return jsonResponse(result.body, result.status ?? 200);
    }
    return jsonResponse({ success: false, error: { code: 404, message: 'unhandled' } }, 404);
  });
  (globalThis as any).fetch = fetchMock;
  return { fetchMock, calls };
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as any).fetch = originalFetch;
});

function makeProvider(baseUrl = BIGBANG_DEFAULT_BASE_URL) {
  return new BigBangCasinoProvider({
    name: 'BIGBANG',
    environment: 'sandbox',
    baseUrl,
    apiKey: API_KEY,
    timeoutMs: 5000,
  });
}

const game = (overrides: Record<string, unknown> = {}) => ({
  id: 4821,
  name: 'SGHotHotFruit',
  title: 'Hot Hot Fruit',
  provider: 'Habanero',
  category: 'Habanero',
  category_title: 'Habanero',
  thumbnail: 'https://bigbangcasino.bet/frontend/Vegas/ico/Habanero/SGHotHotFruit.webp?v=1',
  mode: 'standard',
  is_premium: false,
  game_type: 'slot',
  is_demo: true,
  ...overrides,
});

/** A `/games` endpoint that pages `pageSize` rows at a time with real totals. */
function gamesHandler(rows: unknown[], pageSize = 5000): Handler {
  return (url) => {
    if (!url.pathname.endsWith('/games')) return undefined;
    const offset = Number(url.searchParams.get('offset') ?? '0');
    const limit = Number(url.searchParams.get('limit') ?? '0');
    return {
      body: {
        success: true,
        data: rows.slice(offset, offset + pageSize),
        pagination: { total: rows.length, limit: Math.min(limit, pageSize), offset },
      },
    };
  };
}

function categoriesHandler(rows: unknown[]): Handler {
  return (url) =>
    url.pathname.endsWith('/categories') ? { body: { success: true, data: rows } } : undefined;
}

describe('bigbang catalog pagination', () => {
  it('uses the documented limit/offset paging and stops at pagination.total', async () => {
    const rows = [1, 2, 3, 4, 5].map((id) => game({ id }));
    const { calls } = installFetch([gamesHandler(rows, 2)]);

    const page = await makeProvider().listGames({ page: 1, pageSize: 10 });

    expect(page.total).toBe(5);
    expect(page.items).toHaveLength(5);
    expect(calls).toHaveLength(3);
    // Bounded page size, NOT the documented maximum: asking for the whole
    // catalog in one response is what made every production sync abort with
    // "timed out after 10000ms" against a host that answers in under a second.
    expect(calls[0]).toContain('limit=500');
    expect(calls[0]).not.toContain('limit=5000');
    expect(calls[0]).toContain('offset=0');
    expect(calls[1]).toContain('offset=2');
    expect(calls[2]).toContain('offset=4');
    for (const call of calls) {
      expect(call).not.toContain('per_page');
      expect(call).not.toContain('last_page');
      expect(call).not.toContain('page=');
    }
  });

  it('walks a large catalog in bounded pages without ever asking for the maximum', async () => {
    // 1,200 rows at the default page size of 500 => 3 page calls, not one
    // 5000-row request. This is the regression guard for the production
    // "BigBang request timed out after 10000ms" sync failure.
    const rows = Array.from({ length: 1200 }, (_, i) => game({ id: i + 1 }));
    const { calls } = installFetch([gamesHandler(rows, 500)]);

    const page = await makeProvider().listGames({ page: 1, pageSize: 10 });

    expect(page.total).toBe(1200);
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call).toContain('limit=500');
      expect(call).not.toContain('limit=5000');
    }
    expect(calls.map((c) => new URL(c).searchParams.get('offset'))).toEqual([
      '0',
      '500',
      '1000',
    ]);
  });

  it('clamps a misconfigured page size to the provider maximum', async () => {
    const rows = [game({ id: 1 })];
    const { calls } = installFetch([gamesHandler(rows, 5000)]);
    const provider = new BigBangCasinoProvider({
      name: 'BIGBANG',
      environment: 'sandbox',
      baseUrl: BIGBANG_DEFAULT_BASE_URL,
      apiKey: API_KEY,
      timeoutMs: 5000,
      catalogPageSize: 999_999,
    });

    await provider.listGames({ page: 1, pageSize: 10 });

    expect(calls[0]).toContain('limit=5000');
  });

  it('reads the catalog ONCE per sync cycle, not once per caller', async () => {
    // capabilities(), listCategories() and listGames() each need the whole
    // inventory. Without memoization a single sync re-downloaded it 3+ times.
    const rows = Array.from({ length: 1200 }, (_, i) => game({ id: i + 1 }));
    const { calls } = installFetch([
      gamesHandler(rows, 500),
      categoriesHandler([{ id: 1, name: 'Slots' }]),
    ]);
    const provider = makeProvider();

    await provider.capabilities();
    await provider.listCategories('CASINO');
    await provider.listCategories('LIVE_CASINO');
    await provider.listGames({ page: 1, pageSize: 10 });

    // Exactly one walk: 3 page calls total, not 4x3.
    const gameCalls = calls.filter((c) => c.includes('/games'));
    expect(gameCalls).toHaveLength(3);
  });

  it('re-reads the catalog once the reuse window has expired', async () => {
    const rows = [game({ id: 1 }), game({ id: 2 })];
    const { calls } = installFetch([gamesHandler(rows, 500)]);
    const provider = new BigBangCasinoProvider({
      name: 'BIGBANG',
      environment: 'sandbox',
      baseUrl: BIGBANG_DEFAULT_BASE_URL,
      apiKey: API_KEY,
      timeoutMs: 5000,
      // A zero-length window disables reuse entirely.
      catalogCacheTtlMs: 0,
    });

    await provider.listGames({ page: 1, pageSize: 10 });
    await provider.listGames({ page: 1, pageSize: 10 });

    expect(calls.filter((c) => c.includes('/games'))).toHaveLength(2);
  });

  it('clears the memo after a failure so a retry is not poisoned', async () => {
    const failing = installFetch([
      () => ({
        body: { success: false, error: { code: 401, message: 'Invalid API key' } },
        status: 401,
      }),
    ]);
    const provider = makeProvider();

    await expect(provider.listGames({ page: 1, pageSize: 10 })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });

    // The next attempt must actually call the provider again.
    const healthy = installFetch([gamesHandler([game({ id: 1 })], 500)]);
    const page = await provider.listGames({ page: 1, pageSize: 10 });
    expect(page.total).toBe(1);
    expect(failing.fetchMock).not.toBe(healthy.fetchMock);
  });

  it('terminates on pagination.total even when the provider keeps returning rows', async () => {
    // A provider that answers every offset with the same two rows but declares
    // a total of 2 must be read ONCE — never looped forever.
    const repeated: Handler = (url) =>
      url.pathname.endsWith('/games')
        ? {
            body: {
              success: true,
              data: [game({ id: 1 }), game({ id: 2 })],
              pagination: {
                total: 2,
                limit: 2,
                offset: Number(url.searchParams.get('offset') ?? '0'),
              },
            },
          }
        : undefined;
    const { calls } = installFetch([repeated]);

    const page = await makeProvider().listGames({ page: 1, pageSize: 10 });

    expect(calls).toHaveLength(1);
    expect(page.total).toBe(2);
  });

  it('fails safely instead of guessing obsolete pagination fields', async () => {
    installFetch([
      () => ({
        body: { success: true, data: [game()], page: 1, per_page: 100, last_page: 1, total: 1 },
      }),
    ]);

    await expect(makeProvider().listGames({ page: 1, pageSize: 10 })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('reports health with limit/offset (never page/per_page)', async () => {
    const { calls } = installFetch([gamesHandler([game()])]);

    const health = await makeProvider().health();

    expect(health.reachable).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('limit=1');
    expect(calls[0]).toContain('offset=0');
    expect(calls[0]).not.toContain('per_page');
  });

  it('reports an honest unreachable health verdict when the contract breaks', async () => {
    installFetch([() => ({ body: { success: true, data: [] } })]);

    const health = await makeProvider().health();

    expect(health.reachable).toBe(false);
    expect(health.message).toContain('pagination');
  });

  it('refuses every call when the provider is not configured', async () => {
    installFetch([gamesHandler([game()])]);
    const unconfigured = makeProvider('https://evil.example/api/v1');

    expect(unconfigured.isConfigured()).toBe(false);
    await expect(unconfigured.listGames({ page: 1, pageSize: 10 })).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
    const health = await unconfigured.health();
    expect(health.reachable).toBe(false);
  });
});

describe('bigbang failure classification', () => {
  /**
   * The admin UI can only tell an operator what to DO next if the four
   * failure modes stay distinguishable. Collapsing them into one generic
   * "request failed" message is what made a rejected API key look like an
   * outage, so each is pinned here.
   */
  it('reports a rejected credential as an authentication failure', async () => {
    installFetch([
      (url) =>
        url.pathname.endsWith('/games')
          ? {
              body: { success: false, error: { code: 401, message: 'Invalid API key' } },
              status: 401,
            }
          : undefined,
    ]);

    await expect(makeProvider().listGames({ page: 1, pageSize: 10 })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
    });
  });

  it("keeps the provider's own refusal text so the cause is actionable", async () => {
    installFetch([
      () => ({
        body: { success: false, error: { code: 401, message: 'Invalid API key' } },
        status: 401,
      }),
    ]);

    await expect(makeProvider().listGames({ page: 1, pageSize: 10 })).rejects.toThrow(
      /Invalid API key/,
    );
  });

  it('reports a 403 as an authentication failure too', async () => {
    installFetch([
      () => ({ body: { success: false, error: { message: 'Forbidden' } }, status: 403 }),
    ]);

    await expect(makeProvider().listGames({ page: 1, pageSize: 10 })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('reports a missing path as an invalid endpoint', async () => {
    installFetch([
      () => ({ body: { success: false, error: { message: 'Not found' } }, status: 404 }),
    ]);

    await expect(makeProvider().listGames({ page: 1, pageSize: 10 })).rejects.toMatchObject({
      code: 'INVALID_ENDPOINT',
      status: 404,
    });
  });

  it('keeps a genuine 5xx as a provider error with its status', async () => {
    installFetch([
      () => ({ body: { success: false, error: { message: 'boom' } }, status: 500 }),
    ]);

    await expect(makeProvider().listGames({ page: 1, pageSize: 10 })).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      status: 500,
    });
  });

  it('reports an aborted request as a timeout naming the real budget', async () => {
    (globalThis as any).fetch = jest.fn(async (_url: unknown, init?: any) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
    );
    const provider = new BigBangCasinoProvider({
      name: 'BIGBANG',
      environment: 'sandbox',
      baseUrl: BIGBANG_DEFAULT_BASE_URL,
      apiKey: API_KEY,
      timeoutMs: 5000,
      // A small budget keeps the test fast while proving the CATALOG budget
      // (not the interactive one) is what a catalog read is measured against.
      catalogTimeoutMs: 25,
    });

    // The catalog budget is the one that applies to a catalog read.
    await expect(provider.listGames({ page: 1, pageSize: 10 })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    await expect(provider.listGames({ page: 1, pageSize: 10 })).rejects.toThrow(/timed out after 25ms/);
  });

  it('surfaces the transport cause so DNS is distinguishable from a dead host', async () => {
    (globalThis as any).fetch = jest.fn(async () => {
      const error = new TypeError('fetch failed');
      (error as any).cause = { code: 'ENOTFOUND' };
      throw error;
    });

    await expect(makeProvider().listGames({ page: 1, pageSize: 10 })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    await expect(makeProvider().listGames({ page: 1, pageSize: 10 })).rejects.toThrow(/ENOTFOUND/);
  });

  it('never leaks the API key into a failure message', async () => {
    installFetch([
      () => ({
        body: { success: false, error: { message: 'Invalid API key' } },
        status: 401,
      }),
    ]);

    let captured: Error | null = null;
    try {
      await makeProvider().listGames({ page: 1, pageSize: 10 });
    } catch (error) {
      captured = error as Error;
    }

    expect(captured).not.toBeNull();
    expect(captured!.message).not.toContain(API_KEY);
  });
});

describe('bigbang catalog normalization', () => {
  it('normalizes the documented fields first', async () => {
    installFetch([gamesHandler([game()])]);

    const page = await makeProvider().listGames({ page: 1, pageSize: 10 });
    const normalized = page.items[0];

    expect(normalized).toMatchObject({
      externalId: '4821',
      // `title` is the human-readable game title; `name` is the launch slug.
      name: 'Hot Hot Fruit',
      providerExternalId: 'Habanero',
      providerName: 'Habanero',
      categoryExternalId: 'Habanero',
      categoryName: 'Habanero',
      productType: 'CASINO',
      demoAvailable: true,
      launchAvailable: true,
      active: true,
      banner: null,
    });
    expect(normalized.slug).toBe('sghothotfruit');
    expect(normalized.thumbnail).toContain('SGHotHotFruit.webp');
    expect(normalized.tags).toEqual(expect.arrayContaining(['slot', 'standard', 'demo']));
  });

  it('maps the provider game_type live to LIVE_CASINO only', async () => {
    installFetch([
      gamesHandler([
        game({ id: 1, name: 'LiveRoulette', title: 'Live Roulette', game_type: 'live' }),
        game({ id: 2, name: 'CrashRocket', title: 'Crash Rocket', game_type: 'crash' }),
      ]),
    ]);

    const page = await makeProvider().listGames({ page: 1, pageSize: 10 });

    expect(page.items[0].productType).toBe('LIVE_CASINO');
    // There is no CRASH product type: a crash game is a CASINO game whose
    // provider game_type is preserved as a tag.
    expect(page.items[1].productType).toBe('CASINO');
    expect(page.items[1].tags).toContain('crash');
  });

  it('preserves premium/mode metadata as tags', async () => {
    installFetch([
      gamesHandler([
        game({
          id: 7,
          name: 'PremiumSlot',
          title: 'Premium Slot',
          mode: 'premium',
          is_premium: true,
          is_demo: false,
        }),
      ]),
    ]);

    const page = await makeProvider().listGames({ page: 1, pageSize: 10 });

    expect(page.items[0].tags).toEqual(expect.arrayContaining(['premium', 'slot']));
    expect(page.items[0].tags).not.toContain('demo');
    expect(page.items[0].demoAvailable).toBe(false);
  });

  it('still accepts the legacy aliases when the documented fields are absent', async () => {
    installFetch([
      gamesHandler([
        {
          game_id: 99,
          game_name: 'LegacyGame',
          provider_id: 'StudioOne',
          game_type: 'live',
          standard_available: true,
          premium_available: false,
        },
      ]),
    ]);

    const page = await makeProvider().listGames({ page: 1, pageSize: 10 });

    expect(page.items[0]).toMatchObject({
      externalId: '99',
      name: 'LegacyGame',
      providerExternalId: 'StudioOne',
      productType: 'LIVE_CASINO',
    });
  });
});

describe('bigbang categories', () => {
  it('reads the documented /categories endpoint and counts matching games', async () => {
    installFetch([
      categoriesHandler([
        { id: 1, name: 'Habanero', slug: 'Habanero', premium: false },
        { id: 2, name: 'Pragmatic', slug: 'Pragmatic', premium: true },
        { id: 3, name: 'NoGamesHere', slug: 'NoGamesHere', premium: false },
      ]),
      gamesHandler([
        game({ id: 1, game_type: 'slot', category: 'Habanero', category_title: 'Habanero' }),
        game({ id: 2, game_type: 'live', category: 'Habanero', category_title: 'Habanero' }),
        game({ id: 3, game_type: 'live', category: 'Pragmatic', category_title: 'Pragmatic' }),
      ]),
    ]);

    const categories = await makeProvider().listCategories('LIVE_CASINO');

    expect(categories.map((category) => category.externalId)).toEqual([
      'Habanero',
      'Pragmatic',
      'NoGamesHere',
    ]);
    expect(categories[0]).toMatchObject({
      externalId: 'Habanero',
      name: 'Habanero',
      slug: 'habanero',
      productType: 'LIVE_CASINO',
      gameCount: 1,
      premium: false,
    });
    expect(categories[1]).toMatchObject({ gameCount: 1, premium: true });
    // The provider's own list is never silently dropped: a category without a
    // visible game of the requested product keeps its zero count.
    expect(categories[2]).toMatchObject({ gameCount: 0 });
  });

  it('keeps the safe product-type fallback when no product is requested', async () => {
    installFetch([
      categoriesHandler([{ id: 1, name: 'Habanero', slug: 'Habanero' }]),
      gamesHandler([game()]),
    ]);

    const categories = await makeProvider().listCategories();

    expect(categories[0]).toMatchObject({ productType: 'CASINO', gameCount: 1 });
  });

  it('lists the studios BigBang actually supplies', async () => {
    installFetch([
      gamesHandler([
        game({ id: 1, provider: 'Habanero' }),
        game({ id: 2, provider: 'Habanero', game_type: 'live' }),
        game({ id: 3, provider: 'Pragmatic' }),
      ]),
    ]);

    const providers = await makeProvider().listProviders();

    expect(providers).toEqual([
      { externalId: 'Habanero', name: 'Habanero', gameCount: 2, liveCapable: true },
      { externalId: 'Pragmatic', name: 'Pragmatic', gameCount: 1, liveCapable: false },
    ]);
  });
});

describe('bigbang launch', () => {
  function launchHandler(response: Record<string, unknown> = {}): Handler {
    return (url) =>
      url.pathname.endsWith('/games/launch')
        ? { body: { success: true, game_url: GAME_URL, ...response } }
        : undefined;
  }

  it('sends the documented real-money launch payload (no player creation)', async () => {
    const { fetchMock, calls } = installFetch([launchHandler({ session_id: 'sess-1', game_id: 4821 })]);

    const result = await makeProvider().launch({
      playerId: PLAYER_ID,
      externalGameId: '4821',
      currency: 'BDT',
      mode: 'REAL',
      locale: 'en-US',
    });

    const [url, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse((init as any).body);
    expect(sent).toEqual({ game_id: 4821, user_token: PLAYER_ID, language: 'en' });
    // The create-player contract has no currency, and the seamless user_data
    // endpoint provisions the player — so no player is ever fabricated here.
    expect(sent).not.toHaveProperty('currency');
    expect(sent).not.toHaveProperty('username');
    expect(url).toContain('/games/launch');
    expect(calls.every((call) => !call.includes('/users/create'))).toBe(true);
    // The key travels as the documented header, never in the URL.
    expect((init as any).headers['X-API-Key']).toBe(API_KEY);
    expect(url).not.toContain(API_KEY);
    expect(result).toEqual({ url: GAME_URL, providerSessionId: 'sess-1', providerRoundId: null });
  });

  it('launches a demo game without any player identity', async () => {
    const { fetchMock } = installFetch([launchHandler()]);

    const result = await makeProvider().launchDemo({
      externalGameId: '4821',
      currency: 'BDT',
      mode: 'DEMO',
    });

    const sent = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(sent).toEqual({ game_id: 4821, demo: true });
    expect(sent).not.toHaveProperty('user_token');
    expect(result.url).toBe(GAME_URL);
    expect(result.providerSessionId).toBeNull();
  });

  it('refuses a non-numeric game id before calling the provider', async () => {
    const { calls } = installFetch([launchHandler()]);

    await expect(
      makeProvider().launch({
        playerId: PLAYER_ID,
        externalGameId: 'SGHotHotFruit',
        currency: 'BDT',
        mode: 'REAL',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(calls).toHaveLength(0);
  });

  it('fails safely when the provider answers without a game_url', async () => {
    installFetch([(url) => (url.pathname.endsWith('/games/launch') ? { body: { success: true } } : undefined)]);

    await expect(
      makeProvider().launch({
        playerId: PLAYER_ID,
        externalGameId: '4821',
        currency: 'BDT',
        mode: 'REAL',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('bigbang capabilities', () => {
  it('derives both products from the provider inventory', async () => {
    installFetch([
      gamesHandler([
        game({ id: 1, game_type: 'slot', is_demo: true }),
        game({ id: 2, game_type: 'live', is_demo: false }),
      ]),
    ]);

    const capabilities = await makeProvider().capabilities();

    expect(capabilities).toEqual({
      casino: true,
      liveCasino: true,
      demoSupported: true,
      source: 'catalog',
    });
  });

  it('reports nothing available when the provider is not configured', async () => {
    installFetch([gamesHandler([game()])]);

    const capabilities = await makeProvider('https://other.example/api/v1').capabilities();

    expect(capabilities).toEqual({
      casino: false,
      liveCasino: false,
      demoSupported: false,
      source: 'unavailable',
    });
  });

  it('never claims a product the provider does not supply', async () => {
    installFetch([gamesHandler([game({ id: 1, game_type: 'slot', is_demo: false })])]);

    const capabilities = await makeProvider().capabilities();

    expect(capabilities).toEqual({
      casino: true,
      liveCasino: false,
      demoSupported: false,
      source: 'catalog',
    });
  });
});

/**
 * The production sync failure: `TIMEOUT: BigBang request timed out after
 * 10000ms` while the very same host answered a `limit=1` probe instantly.
 *
 * `GET /categories` is a CATALOG read, but it used to be issued with no
 * timeout override, so it silently inherited the 10s INTERACTIVE budget and
 * aborted the whole sync even though the paged `/games` walk already had a
 * much larger `catalogTimeoutMs`.
 */
describe('bigbang per-purpose catalog budget', () => {
  it('gives GET /categories the CATALOG budget, not the interactive one', async () => {
    // A `/categories` endpoint that never answers: only the AbortController in
    // `request()` can end this call, so the budget in the error IS the budget
    // that was applied.
    (globalThis as any).fetch = jest.fn(async (input: any, init?: any) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/categories')) {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      }
      return jsonResponse({
        success: true,
        data: [game()],
        pagination: { total: 1, limit: 1, offset: 0 },
      });
    });

    const makeWithBudget = () =>
      new BigBangCasinoProvider({
        name: 'BIGBANG',
        environment: 'sandbox',
        baseUrl: BIGBANG_DEFAULT_BASE_URL,
        apiKey: API_KEY,
        // The interactive budget is far larger, so a TIMEOUT naming it would
        // prove `/categories` is still on the wrong budget.
        timeoutMs: 5_000,
        catalogTimeoutMs: 40,
      });

    // The reported budget must be the CATALOG one (40ms), not 5000ms.
    await expect(makeWithBudget().listCategories('CASINO')).rejects.toThrow(
      /timed out after 40ms/,
    );
    await expect(makeWithBudget().listCategories('LIVE_CASINO')).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('reads GET /categories ONCE per sync cycle, not once per product', async () => {
    // A sync calls listCategories('CASINO') and listCategories('LIVE_CASINO').
    // Without a shared snapshot that is two identical provider downloads.
    const rows = [game({ id: 1 }), game({ id: 2 })];
    const { calls } = installFetch([
      gamesHandler(rows, 500),
      categoriesHandler([{ id: 1, name: 'Habanero', slug: 'Habanero' }]),
    ]);
    const provider = makeProvider();

    await provider.listCategories('CASINO');
    await provider.listCategories('LIVE_CASINO');

    expect(calls.filter((c) => c.includes('/categories'))).toHaveLength(1);
    // The games walk is likewise read once.
    expect(calls.filter((c) => c.includes('/games'))).toHaveLength(1);
  });

  it('re-reads GET /categories once the reuse window has expired', async () => {
    const { calls } = installFetch([
      gamesHandler([game({ id: 1 })], 500),
      categoriesHandler([{ id: 1, name: 'Habanero', slug: 'Habanero' }]),
    ]);
    const provider = new BigBangCasinoProvider({
      name: 'BIGBANG',
      environment: 'sandbox',
      baseUrl: BIGBANG_DEFAULT_BASE_URL,
      apiKey: API_KEY,
      timeoutMs: 5000,
      catalogCacheTtlMs: 0,
    });

    await provider.listCategories('CASINO');
    await provider.listCategories('CASINO');

    expect(calls.filter((c) => c.includes('/categories'))).toHaveLength(2);
  });

  it('never caches a FAILED catalog read, so a retry really re-contacts the provider', async () => {
    let attempt = 0;
    const { calls } = installFetch([
      (url) => {
        if (!url.pathname.endsWith('/categories')) return undefined;
        attempt += 1;
        return attempt === 1
          ? { body: { success: false, error: { code: 500, message: 'boom' } }, status: 500 }
          : { body: { success: true, data: [{ id: 1, name: 'Habanero', slug: 'Habanero' }] } };
      },
      gamesHandler([game()]),
    ]);
    const provider = makeProvider();

    await expect(provider.listCategories('CASINO')).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
    await expect(provider.listCategories('CASINO')).resolves.toHaveLength(1);

    expect(calls.filter((c) => c.includes('/categories'))).toHaveLength(2);
  });

  it('keeps the health probe off the (possibly much larger) catalog budget', async () => {
    installFetch([gamesHandler([game()])]);
    const provider = new BigBangCasinoProvider({
      name: 'BIGBANG',
      environment: 'sandbox',
      baseUrl: BIGBANG_DEFAULT_BASE_URL,
      apiKey: API_KEY,
      timeoutMs: 5_000,
      // A generous catalog budget must NOT make the admin health check hang.
      catalogTimeoutMs: 60_000,
      healthTimeoutMs: 30,
    });

    expect((await provider.health()).reachable).toBe(true);
  });
});

describe('bigbang timeout configuration', () => {
  it('defaults to 10s interactive and a larger bounded catalog budget', () => {
    const config = loadBigBangEnvConfig({} as NodeJS.ProcessEnv);

    expect(config.timeoutMs).toBe(10_000);
    expect(config.catalogTimeoutMs).toBeGreaterThan(config.timeoutMs);
    expect(config.healthTimeoutMs).toBe(config.timeoutMs);
    expect(config.launchTimeoutMs).toBe(config.timeoutMs);
  });

  it('honours BIGBANG_HEALTH/CATALOG/LAUNCH_TIMEOUT_MS', () => {
    const config = loadBigBangEnvConfig({
      BIGBANG_HEALTH_TIMEOUT_MS: '3000',
      BIGBANG_CATALOG_TIMEOUT_MS: '45000',
      BIGBANG_LAUNCH_TIMEOUT_MS: '7000',
    } as unknown as NodeJS.ProcessEnv);

    expect(config.healthTimeoutMs).toBe(3_000);
    expect(config.catalogTimeoutMs).toBe(45_000);
    expect(config.launchTimeoutMs).toBe(7_000);
  });

  it('never lets the catalog budget fall BELOW the interactive one', () => {
    // A typo must not make a catalog walk abort faster than a launch.
    const config = loadBigBangEnvConfig({
      BIGBANG_TIMEOUT_MS: '20000',
      BIGBANG_CATALOG_TIMEOUT_MS: '1',
    } as unknown as NodeJS.ProcessEnv);

    expect(config.catalogTimeoutMs).toBe(20_000);
  });
});

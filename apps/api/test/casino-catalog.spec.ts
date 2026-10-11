/* eslint-disable @typescript-eslint/no-explicit-any */
import { CasinoCatalogService } from '../src/modules/casino/casino-catalog.service';
import type { PrismaService } from '../src/database/prisma.service';
import type { CasinoProviderFactory } from '../src/modules/casino/casino-provider.factory';

/**
 * BIG CASINO / BIG LIVE CASINO catalog tests.
 *
 * The product split is a hard contract: a `casino` query may only ever return
 * CASINO rows and a `live` query only LIVE_CASINO rows — search, category and
 * featured filters must never widen that scope. When no provider is configured
 * the response is honestly `available: false` (never a fabricated list).
 */
const PROVIDER_ROW_ID = 'provider-row-1';

function makeRows() {
  return [
    {
      id: 'g1',
      providerId: PROVIDER_ROW_ID,
      externalId: 'slot-1',
      name: 'Golden Reels',
      slug: 'golden-reels',
      thumbnail: 'https://cdn.example/slot-1.png',
      banner: null,
      categoryId: 'cat-slots',
      categoryName: 'Slots',
      tags: ['slots', 'hot'],
      productType: 'CASINO',
      status: 'ACTIVE',
      isFeatured: true,
      launchAvailable: true,
      demoAvailable: true,
      raw: { providerName: 'Studio One', providerExternalId: 'studio-one' },
    },
    {
      id: 'g2',
      providerId: PROVIDER_ROW_ID,
      externalId: 'table-1',
      name: 'Classic Blackjack',
      slug: 'classic-blackjack',
      thumbnail: null,
      banner: null,
      categoryId: 'cat-table',
      categoryName: 'Table Games',
      tags: [],
      productType: 'CASINO',
      status: 'ACTIVE',
      isFeatured: false,
      launchAvailable: true,
      demoAvailable: false,
      raw: { providerName: 'Studio Two', providerExternalId: 'studio-two' },
    },
    {
      id: 'g3',
      providerId: PROVIDER_ROW_ID,
      externalId: 'live-1',
      name: 'Live Roulette A',
      slug: 'live-roulette-a',
      thumbnail: null,
      banner: null,
      categoryId: 'cat-live-roulette',
      categoryName: 'Live Roulette',
      tags: ['live'],
      productType: 'LIVE_CASINO',
      status: 'ACTIVE',
      isFeatured: false,
      launchAvailable: true,
      demoAvailable: false,
      raw: { providerName: 'Live Studio', providerExternalId: 'live-studio' },
    },
    {
      id: 'g4',
      providerId: PROVIDER_ROW_ID,
      externalId: 'live-2',
      name: 'Live Blackjack B',
      slug: 'live-blackjack-b',
      thumbnail: null,
      banner: null,
      categoryId: 'cat-live-blackjack',
      categoryName: 'Live Blackjack',
      tags: ['live'],
      productType: 'LIVE_CASINO',
      status: 'INACTIVE',
      isFeatured: false,
      launchAvailable: false,
      demoAvailable: false,
      raw: { providerName: 'Live Studio', providerExternalId: 'live-studio' },
    },
  ];
}

interface MockProviderRow {
  id: string;
  name: string;
  status: string;
}

function matchesWhere(row: any, where: any, providers: MockProviderRow[] = []): boolean {
  if (!where) return true;
  if (where.AND) {
    return where.AND.every((clause: any) => matchesWhere(row, clause, providers));
  }
  if (where.OR) {
    return where.OR.some((clause: any) => matchesWhere(row, clause, providers));
  }
  return Object.entries(where).every(([key, value]) => {
    // Relation filter: `provider: { status }` / `provider: { name: { equals } }`
    // — the PUBLIC visibility rule (an INACTIVE provider hides its games).
    if (key === 'provider' && value && typeof value === 'object') {
      const provider = providers.find((candidate) => candidate.id === row.providerId);
      if (!provider) return false;
      return Object.entries(value as Record<string, any>).every(([field, expected]) => {
        const actual = (provider as unknown as Record<string, unknown>)[field];
        if (expected && typeof expected === 'object') {
          const equals = (expected as any).equals;
          if (typeof equals !== 'string') return true;
          return (expected as any).mode === 'insensitive'
            ? String(actual).toLowerCase() === equals.toLowerCase()
            : actual === equals;
        }
        return actual === expected;
      });
    }
    if (key === 'name' && value && typeof value === 'object') {
      const contains = (value as any).contains;
      if (typeof contains !== 'string') return true;
      return String(row.name).toLowerCase().includes(contains.toLowerCase());
    }
    // `raw: { path: ['providerName'], equals: '…' }` — the studio dimension.
    if (key === 'raw' && value && typeof value === 'object') {
      const path = (value as any).path as string[] | undefined;
      const equals = (value as any).equals;
      if (!path || path.length !== 1) return true;
      const raw = (row.raw ?? {}) as Record<string, unknown>;
      return raw[path[0] as string] === equals;
    }
    if (key === 'externalId' && value && typeof value === 'object') {
      const notIn = (value as any).notIn as string[] | undefined;
      return notIn ? !notIn.includes(row.externalId) : true;
    }
    if (key === 'id' && value && typeof value === 'object') {
      const inList = (value as any).in as string[] | undefined;
      return inList ? inList.includes(row.id) : true;
    }
    return row[key] === value;
  });
}

function makeHarness(options: { configured?: boolean; withRows?: boolean } = {}) {
  const configured = options.configured ?? true;
  const games = options.withRows === false ? [] : makeRows();
  const providerRows: MockProviderRow[] = [
    { id: PROVIDER_ROW_ID, name: 'Script Casino Partner', status: 'ACTIVE' },
  ];
  const categories = [
    { id: 'cat-slots', externalId: 'slots', name: 'Slots', slug: 'slots', productType: 'CASINO', gameCount: 1, sortOrder: 0, status: 'ACTIVE' },
    { id: 'cat-table', externalId: 'table', name: 'Table Games', slug: 'table-games', productType: 'CASINO', gameCount: 1, sortOrder: 1, status: 'ACTIVE' },
    { id: 'cat-live-roulette', externalId: 'live-roulette', name: 'Live Roulette', slug: 'live-roulette', productType: 'LIVE_CASINO', gameCount: 1, sortOrder: 0, status: 'ACTIVE' },
  ];

  const prisma: any = {
    casinoGame: {
      findMany: jest.fn(async ({ where, select, orderBy, skip, take }: any) => {
        let rows = games.filter((row) => matchesWhere(row, where, providerRows));
        if (orderBy) {
          const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
          rows = [...rows].sort((a, b) => {
            for (const clause of clauses) {
              const [key, direction] = Object.entries(clause)[0] as [string, string];
              const left = (a as Record<string, unknown>)[key];
              const right = (b as Record<string, unknown>)[key];
              if (left === right) continue;
              const comparison =
                typeof left === 'boolean' ? Number(left) - Number(right) : String(left).localeCompare(String(right));
              return direction === 'desc' ? -comparison : comparison;
            }
            return 0;
          });
        }
        if (typeof skip === 'number') rows = rows.slice(skip);
        if (typeof take === 'number') rows = rows.slice(0, take);
        return rows.map((row) => (select ? { providerId: row.providerId, raw: row.raw } : row));
      }),
      findUnique: jest.fn(async ({ where }: any) => games.find((row) => row.id === where.id) ?? null),
      count: jest.fn(
        async (args?: any) =>
          games.filter((row) => matchesWhere(row, args?.where, providerRows)).length,
      ),
      groupBy: jest.fn(async ({ by, where }: any) => {
        const filtered: any[] = games.filter((row) => matchesWhere(row, where, providerRows));
        const keys: string[] = Array.isArray(by) ? by : [by];
        const buckets = new Map<string, { key: Record<string, unknown>; count: number }>();
        filtered.forEach((row) => {
          const composite = keys.map((key) => String(row[key])).join('\u0000');
          const bucket = buckets.get(composite);
          if (bucket) {
            bucket.count += 1;
            return;
          }
          const key: Record<string, unknown> = {};
          keys.forEach((field) => {
            key[field] = row[field];
          });
          buckets.set(composite, { key, count: 1 });
        });
        return [...buckets.values()].map((bucket) => ({
          ...bucket.key,
          _count: { _all: bucket.count },
        }));
      }),
      upsert: jest.fn(async () => ({ id: 'upserted' })),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    casinoCategory: {
      findMany: jest.fn(async ({ where }: any) =>
        categories.filter((row) => matchesWhere(row, where)),
      ),
      findFirst: jest.fn(
        async ({ where }: any) => categories.find((row) => matchesWhere(row, where)) ?? null,
      ),
      count: jest.fn(async () => categories.length),
    },
    casinoSession: { count: jest.fn(async () => 0) },
    casinoTransaction: { count: jest.fn(async () => 0) },
    partnerProvider: {
      findUnique: jest.fn(async ({ where }: any) =>
        where?.id
          ? { ...providerRows.find((row) => row.id === where.id), lastSyncAt: new Date('2026-01-01T00:00:00.000Z'), lastSyncError: null }
          : { lastSyncAt: new Date('2026-01-01T00:00:00.000Z'), lastSyncError: null },
      ),
      findMany: jest.fn(async ({ where, select }: any) => {
        let rows = providerRows.map((row) => ({
          ...row,
          providerCode: null,
          environment: 'sandbox',
          lastSyncAt: new Date('2026-01-01T00:00:00.000Z'),
          lastSyncError: null,
        }));
        if (where?.id?.in) {
          rows = rows.filter((row) => where.id.in.includes(row.id));
        }
        if (select) {
          return rows.map((row) => {
            const projected: Record<string, unknown> = {};
            Object.entries(select).forEach(([key, wanted]) => {
              if (wanted) projected[key] = (row as Record<string, unknown>)[key];
            });
            return projected;
          });
        }
        return rows;
      }),
      update: jest.fn(async () => ({ id: PROVIDER_ROW_ID })),
    },
  };

  const envConfig = {
    environment: 'sandbox',
    apiVersion: 'v1',
    pageSizeDefault: 48,
    pageSizeMax: 60,
    syncPageSize: 500,
    maxSyncPages: 40,
    merchantId: 'merchant',
    secret: 'secret',
  };

  const providers = {
    config: jest.fn(() => envConfig),
    resolve: jest.fn(async () => ({
      provider: {
        health: jest.fn(async () => ({ reachable: configured, latencyMs: 5 })),
        capabilities: jest.fn(async () =>
          configured
            ? { casino: true, liveCasino: true, demoSupported: true, source: 'provider' }
            : { casino: false, liveCasino: false, demoSupported: false, source: 'unavailable' },
        ),
      },
      config: envConfig,
      row: configured
        ? {
            id: PROVIDER_ROW_ID,
            name: 'Script Casino Partner',
            baseUrl: 'https://api.partner.example',
            status: 'ACTIVE',
            environment: 'sandbox',
            apiVersion: 'v1',
          }
        : null,
      configured,
      credentialsSource: configured ? 'environment' : 'none',
      unavailableReason: configured ? null : 'Partner casino is not configured.',
    })),
  };

  const service = new CasinoCatalogService(
    prisma as unknown as PrismaService,
    providers as unknown as CasinoProviderFactory,
  );

  return { service, prisma, providers, games };
}

describe('casino catalog — product scoping', () => {
  // The catalog id is stable and provider-scoped: `${providerRowId}:${externalId}`.
  const id = (externalId: string) => `${PROVIDER_ROW_ID}:${externalId}`;

  it('returns ONLY casino games for the casino product', async () => {
    const h = makeHarness();
    const response = await h.service.getCatalog({ productType: 'CASINO' });

    expect(response.productType).toBe('CASINO');
    expect(response.available).toBe(true);
    expect(response.games.items.map((game) => game.externalId)).toEqual(['slot-1', 'table-1']);
    expect(response.games.items.every((game) => game.productType === 'CASINO')).toBe(true);
  });

  it('returns ONLY active live-casino games for the live product', async () => {
    const h = makeHarness();
    const response = await h.service.getCatalog({ productType: 'LIVE_CASINO' });

    expect(response.productType).toBe('LIVE_CASINO');
    expect(response.games.items.map((game) => game.externalId)).toEqual(['live-1']);
    expect(response.games.items.every((game) => game.productType === 'LIVE_CASINO')).toBe(true);
  });

  it('never leaks a live game into a casino search', async () => {
    const h = makeHarness();
    const response = await h.service.getCatalog({ productType: 'CASINO', search: 'Live' });

    expect(response.games.items).toHaveLength(0);
  });

  it('scopes search to the requested product', async () => {
    const h = makeHarness();
    const casino = await h.service.getCatalog({ productType: 'CASINO', search: 'blackjack' });
    const live = await h.service.getCatalog({ productType: 'LIVE_CASINO', search: 'blackjack' });

    expect(casino.games.items.map((game) => game.externalId)).toEqual(['table-1']);
    expect(live.games.items).toHaveLength(0);
  });

  it('scopes the featured filter to the requested product', async () => {
    const h = makeHarness();
    const casino = await h.service.getCatalog({ productType: 'CASINO', featured: true });
    const live = await h.service.getCatalog({ productType: 'LIVE_CASINO', featured: true });

    expect(casino.games.items.map((game) => game.externalId)).toEqual(['slot-1']);
    expect(live.games.items).toHaveLength(0);
  });

  it('filters by category within the product', async () => {
    const h = makeHarness();
    const response = await h.service.getCatalog({
      productType: 'CASINO',
      categorySlug: 'slots',
    });

    expect(response.games.items.map((game) => game.externalId)).toEqual(['slot-1']);
  });

  it('yields an empty page for an unknown category instead of an unfiltered fallback', async () => {
    const h = makeHarness();
    const response = await h.service.getCatalog({
      productType: 'CASINO',
      categorySlug: 'does-not-exist',
    });

    expect(response.games.items).toHaveLength(0);
  });

  it('hides inactive games from the user catalog but shows them to admin', async () => {
    const h = makeHarness();
    const userView = await h.service.getCatalog({ productType: 'LIVE_CASINO' });
    const adminView = await h.service.getAdminCatalog({ productType: 'LIVE_CASINO' });

    expect(userView.games.items.map((game) => game.externalId)).toEqual(['live-1']);
    expect(adminView.games.items.map((game) => game.externalId).sort()).toEqual([
      'live-1',
      'live-2',
    ]);
  });
  it('exposes only the requested product categories and the DB-derived provider filter', async () => {
    const h = makeHarness();
    const casino = await h.service.getCatalog({ productType: 'CASINO' });
    const live = await h.service.getCatalog({ productType: 'LIVE_CASINO' });

    expect(casino.categories.map((category) => category.name)).toEqual(['Slots', 'Table Games']);
    expect(live.categories.map((category) => category.name)).toEqual(['Live Roulette']);

    // The public provider filter is the STUDIO dimension reported by the partner
    // (built from the database, never hard-coded) with the REAL active game
    // count — this is what a player picks in the UI.
    expect(casino.providers).toEqual([
      {
        id: 'studio-one',
        name: 'Studio One',
        gameCount: 1,
        productType: 'CASINO',
      },
      {
        id: 'studio-two',
        name: 'Studio Two',
        gameCount: 1,
        productType: 'CASINO',
      },
    ]);
    expect(live.providers).toEqual([
      {
        id: 'live-studio',
        name: 'Live Studio',
        gameCount: 1,
        productType: 'LIVE_CASINO',
      },
    ]);
  });

  it('offers the partner studio list, not the single operator feed row', async () => {
    // THE REGRESSION: the public endpoint used to return one entry per
    // PartnerProvider row (a single "Script Casino Partner"), which made picking
    // an individual studio impossible even though the games were all there.
    const h = makeHarness();
    const providers = await h.service.listProviders('CASINO');

    expect(providers.map((provider) => provider.id)).toEqual(['studio-one', 'studio-two']);
    expect(providers.map((provider) => provider.name)).toEqual(['Studio One', 'Studio Two']);
    expect(providers.map((provider) => provider.id)).not.toContain(PROVIDER_ROW_ID);
  });

  it('keeps the legacy studio filter working (?provider=<studio id|name>)', async () => {
    const h = makeHarness();
    const byStudioId = await h.service.getCatalog({
      productType: 'CASINO',
      providerExternalId: 'studio-two',
    });
    const byStudioName = await h.service.getCatalog({
      productType: 'CASINO',
      providerExternalId: 'Studio Two',
    });

    expect(byStudioId.games.items.map((game) => game.externalId)).toEqual(['table-1']);
    expect(byStudioName.games.items.map((game) => game.externalId)).toEqual(['table-1']);
  });

  it('filters by the PartnerProvider row id or name', async () => {
    const h = makeHarness();
    const byId = await h.service.getCatalog({
      productType: 'CASINO',
      providerExternalId: PROVIDER_ROW_ID,
    });
    const byName = await h.service.getCatalog({
      productType: 'CASINO',
      providerExternalId: 'Script Casino Partner',
    });
    const unknown = await h.service.getCatalog({
      productType: 'CASINO',
      providerExternalId: 'does-not-exist',
    });

    expect(byId.games.items.map((game) => game.externalId)).toEqual(['slot-1', 'table-1']);
    expect(byName.games.total).toBe(2);
    // An unknown provider yields an empty page — never an unfiltered fallback.
    expect(unknown.games.items).toHaveLength(0);
  });

  it('normalizes the shared CatalogGame shape', async () => {
    const h = makeHarness();
    const response = await h.service.getCatalog({ productType: 'CASINO', search: 'Golden' });
    const game = response.games.items[0];

    expect(game).toMatchObject({
      id: id('slot-1'),
      provider: 'Studio One',
      providerId: PROVIDER_ROW_ID,
      externalId: 'slot-1',
      name: 'Golden Reels',
      slug: 'golden-reels',
      thumbnail: 'https://cdn.example/slot-1.png',
      category: 'Slots',
      productType: 'CASINO',
      source: 'PARTNER',
      status: 'ACTIVE',
      isFeatured: true,
      launchAvailable: true,
      demoAvailable: true,
    });
    expect(game.tags).toEqual(['slots', 'hot']);
  });

  it('reports the environment and sync timestamp without leaking credentials', async () => {
    const h = makeHarness();
    const response = await h.service.getCatalog({ productType: 'CASINO' });
    const serialized = JSON.stringify(response);

    expect(response.environment).toBe('sandbox');
    expect(response.provider).toBe('Script Casino Partner');
    expect(response.syncedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(serialized).not.toContain('"secret"');
    expect(serialized).not.toContain('"merchant"');
  });

  it('paginates server-side', async () => {
    const h = makeHarness();
    const response = await h.service.getCatalog({ productType: 'CASINO', page: 1, pageSize: 1 });

    expect(response.games.items).toHaveLength(1);
    expect(response.games.total).toBe(2);
    expect(response.games.hasMore).toBe(true);
  });
});

describe('casino catalog — provider not configured', () => {
  it('reports an honest unavailable state instead of fake games', async () => {
    const h = makeHarness({ configured: false, withRows: false });
    const response = await h.service.getCatalog({ productType: 'CASINO' });

    expect(response.configured).toBe(false);
    expect(response.available).toBe(false);
    expect(response.games.items).toHaveLength(0);
    expect(response.message).toBeTruthy();
  });

  it('keeps serving the last synced catalog when the provider is unreachable', async () => {
    const h = makeHarness({ configured: false });
    const response = await h.service.getCatalog({ productType: 'CASINO' });

    // Cached rows are still real provider rows — never invented, never hidden.
    expect(response.configured).toBe(false);
    expect(response.games.items.map((game) => game.externalId)).toEqual(['slot-1', 'table-1']);
  });

  it('reports capabilities as unavailable in the capability report', async () => {
    const h = makeHarness({ configured: false, withRows: false });
    const report = await h.service.getCapabilityReport();

    expect(report.configured).toBe(false);
    expect(report.casino).toBe(false);
    expect(report.liveCasino).toBe(false);
    expect(report.message).toBeTruthy();
  });

  it('never returns credentials in the admin status', async () => {
    const h = makeHarness();
    const status = await h.service.getAdminStatus();
    const serialized = JSON.stringify(status);

    expect(status.credentials.merchantConfigured).toBe(true);
    expect(status.credentials.secretConfigured).toBe(true);
    expect(status.credentials.source).toBe('environment');
    expect(serialized).not.toContain('"secret"');
  });

  it('does NOT download the provider catalog to build the status page', async () => {
    // THE REGRESSION: `capabilities()` walks the ENTIRE provider inventory
    // (~1,800+ rows for an aggregator) just to answer "does this product have
    // any games". It ran on EVERY admin page load AND on the public
    // `GET /casino/status`, and its verdict was then discarded in favour of
    // the database counts the service had already computed.
    const h = makeHarness();

    await h.service.getAdminStatus();
    await h.service.getCapabilityReport();

    const resolved = await h.providers.resolve.mock.results[0].value;
    expect(resolved.provider.capabilities).not.toHaveBeenCalled();
  });

  it('still reports reachability from the live health probe, not a stale sync', async () => {
    const h = makeHarness();
    const report = await h.service.getCapabilityReport();

    // The health probe ran, so "Reachable" reflects the provider right now.
    expect(report.reachable).toBe(true);
    // Availability comes from the stored catalog counts.
    expect(report.casino).toBe(true);
    expect(report.liveCasino).toBe(true);
  });
});

/**
 * Provider/studio + category lists must be COMPLETE and derived from data.
 *
 * The production symptom was a selector showing only `BIGBANG (1797)` next to
 * "1 studio" while the admin reported 32 categories. That combination is only
 * reachable when the synced rows carry no per-game studio identity, so the
 * facets collapse onto the single `PartnerProvider` feed row.
 */
describe('casino catalog — complete, data-derived provider and category lists', () => {
  it('returns EVERY category of the product, with no page limit', async () => {
    const h = makeHarness();
    const many = Array.from({ length: 32 }, (_, i) => ({
      id: `cat-${i}`,
      externalId: `ext-${i}`,
      name: `Category ${i + 1}`,
      slug: `category-${i + 1}`,
      productType: 'CASINO',
      gameCount: 1,
      sortOrder: i,
      status: 'ACTIVE',
    }));
    (h.prisma.casinoCategory.findMany as jest.Mock).mockImplementation(async ({ where }: any) =>
      many.filter((row) => matchesWhere(row, where)),
    );

    const categories = await h.service.listCategories('CASINO');

    expect(categories).toHaveLength(32);
    expect(categories[0].name).toBe('Category 1');
    expect(categories[31].name).toBe('Category 32');
    // The selector must never be served a first page only.
    const call = (h.prisma.casinoCategory.findMany as jest.Mock).mock.calls[0][0];
    expect(call.take).toBeUndefined();
    expect(call.skip).toBeUndefined();
  });

  it('scopes categories to the requested product (casino never lists live)', async () => {
    const h = makeHarness();

    const casino = await h.service.listCategories('CASINO');
    const live = await h.service.listCategories('LIVE_CASINO');

    expect(casino.map((c) => c.name)).toEqual(['Slots', 'Table Games']);
    expect(live.map((c) => c.name)).toEqual(['Live Roulette']);
  });

  it('lists one studio per DISTINCT studio in the synced rows', async () => {
    const h = makeHarness();
    const providers = await h.service.listProviders('CASINO');

    // Two games from two different studios => two selectable studios, and the
    // operator feed row is never offered as a studio.
    expect(providers.map((p) => p.id)).toEqual(['studio-one', 'studio-two']);
    expect(providers.map((p) => p.gameCount)).toEqual([1, 1]);
    expect(providers.some((p) => p.id === PROVIDER_ROW_ID)).toBe(false);
  });

  it('keeps studios of the two products separate', async () => {
    const h = makeHarness();

    const casino = await h.service.listProviders('CASINO');
    const live = await h.service.listProviders('LIVE_CASINO');

    expect(casino.map((p) => p.id)).toEqual(['studio-one', 'studio-two']);
    expect(live.map((p) => p.id)).toEqual(['live-studio']);
  });

  it('falls back to the feed row ONLY for rows that carry no studio identity', async () => {
    // Legacy rows synced before the studio identity was persisted in `raw` have
    // nothing to group by, so they collapse onto the feed row. This is honest
    // (one real row) but is exactly why the studio list looked empty of studios
    // until a re-sync wrote `raw.providerExternalId`.
    const h = makeHarness();
    h.games.forEach((row: any) => {
      row.raw = {};
    });

    const providers = await h.service.listProviders('CASINO');

    expect(providers).toHaveLength(1);
    expect(providers[0].id).toBe(PROVIDER_ROW_ID);
    expect(providers[0].name).toBe('Script Casino Partner');
    expect(providers[0].gameCount).toBe(2);
  });

  it('combines the provider filter with the category filter', async () => {
    const h = makeHarness();

    const both = await h.service.getCatalog({
      productType: 'CASINO',
      providerExternalId: 'studio-two',
      categorySlug: 'table-games',
    });

    expect(both.games.items.map((g) => g.externalId)).toEqual(['table-1']);
  });

  it('combines provider + category and still refuses a cross-product match', async () => {
    const h = makeHarness();

    // A live studio cannot satisfy a casino category.
    const none = await h.service.getCatalog({
      productType: 'CASINO',
      providerExternalId: 'live-studio',
      categorySlug: 'live-roulette',
    });

    expect(none.games.items).toHaveLength(0);
  });
});

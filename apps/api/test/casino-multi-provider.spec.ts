/* eslint-disable @typescript-eslint/no-explicit-any */
import { CasinoCatalogService } from '../src/modules/casino/casino-catalog.service';
import { CasinoLaunchService } from '../src/modules/casino/casino-launch.service';
import type { PrismaService } from '../src/database/prisma.service';
import type { CasinoProviderFactory } from '../src/modules/casino/casino-provider.factory';
import type { WalletService } from '../src/modules/wallet/wallet.service';
import type { CasinoRemoteGame } from '../src/modules/casino/casino-provider.interface';

/**
 * MULTI-PROVIDER catalog tests (the "only Provider A shows" regression).
 *
 * Real dataset:
 *   Provider A → 3 games      (ACTIVE)
 *   Provider B → 4 games      (ACTIVE, one name shared with A and C)
 *   Provider C → 2 games      (ACTIVE, one name shared with A and B)
 *   Provider D → 2 games      (provider INACTIVE → never public)
 *   Hidden     → 1 game in B  (game status INACTIVE → never public)
 *
 *   All active providers   = 9 games
 *   Provider A / B / C     = 3 / 4 / 2
 *   Duplicate name "Sweet Bonanza" (A + B + C) → 3 separate rows
 *   Same external id in two providers → 2 separate rows (provider + external id)
 *
 * Every provider is a PartnerProvider row with its OWN adapter, so these tests
 * also cover per-provider launch and the all-provider sync (including one
 * provider failing without discarding the others).
 */

const HOST = 'https://game.example';

interface MockProviderRow {
  id: string;
  name: string;
  providerCode: string | null;
  integrationType: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  environment: string | null;
  productTypes: string[];
  baseUrl: string;
  apiVersion: string | null;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
  createdAt: Date;
}

interface MockGameRow {
  id: string;
  providerId: string;
  externalId: string;
  name: string;
  slug: string;
  thumbnail: string | null;
  banner: string | null;
  categoryId: string | null;
  categoryName: string | null;
  tags: string[];
  sortOrder: number;
  productType: 'CASINO' | 'LIVE_CASINO';
  status: 'ACTIVE' | 'INACTIVE';
  isFeatured: boolean;
  launchAvailable: boolean;
  demoAvailable: boolean;
  raw: Record<string, unknown>;
}

function mkProvider(
  id: string,
  name: string,
  overrides: Partial<MockProviderRow> = {},
): MockProviderRow {
  return {
    id,
    name,
    providerCode: null,
    integrationType: null,
    status: 'ACTIVE',
    environment: 'sandbox',
    productTypes: ['CASINO', 'LIVE_CASINO'],
    baseUrl: 'https://api.partner.example',
    apiVersion: 'v1',
    lastSyncAt: null,
    lastSyncError: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function mkRemoteGame(
  externalId: string,
  name: string,
  providerExternalId: string,
  overrides: Partial<CasinoRemoteGame> = {},
): CasinoRemoteGame {
  return {
    externalId,
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    providerExternalId,
    providerName: providerExternalId,
    categoryExternalId: 'slots',
    categoryName: 'Slots',
    thumbnail: null,
    banner: null,
    tags: [],
    productType: 'CASINO',
    isFeatured: false,
    launchAvailable: true,
    demoAvailable: true,
    active: true,
    ...overrides,
  };
}

/** A DB row exactly as the sync would have written it. */
function mkDbGame(
  providerId: string,
  externalId: string,
  name: string,
  overrides: Partial<MockGameRow> = {},
): MockGameRow {
  return {
    id: `${providerId}:${externalId}`,
    providerId,
    externalId,
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    thumbnail: null,
    banner: null,
    categoryId: `cat-${providerId}`,
    categoryName: 'Slots',
    tags: [],
    sortOrder: 0,
    productType: 'CASINO',
    status: 'ACTIVE',
    isFeatured: false,
    launchAvailable: true,
    demoAvailable: true,
    raw: { providerName: 'Studio One', providerExternalId: 'studio-one' },
    ...overrides,
  };
}
function matchesWhere(row: any, where: any, providers: MockProviderRow[] = []): boolean {
  if (!where) return true;
  if (where.AND) return where.AND.every((clause: any) => matchesWhere(row, clause, providers));
  if (where.OR) return where.OR.some((clause: any) => matchesWhere(row, clause, providers));
  return Object.entries(where).every(([key, value]) => {
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
    if (key === 'categoryName' && value && typeof value === 'object') {
      const equals = (value as any).equals;
      return typeof equals === 'string' ? row.categoryName === equals : true;
    }
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

function sortRows(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const clause of clauses) {
      const [key, direction] = Object.entries(clause)[0] as [string, string];
      const left = (a as Record<string, unknown>)[key];
      const right = (b as Record<string, unknown>)[key];
      let comparison: number;
      if (left instanceof Date && right instanceof Date) {
        // Dates MUST be compared chronologically, never lexicographically.
        comparison = left.getTime() - right.getTime();
      } else if (typeof left === 'boolean' || typeof right === 'boolean') {
        comparison = Number(left) - Number(right);
      } else if (left === right || left === undefined || right === undefined) {
        comparison = 0;
      } else {
        comparison = String(left).localeCompare(String(right));
      }
      if (comparison === 0) continue;
      return direction === 'desc' ? -comparison : comparison;
    }
    return 0;
  });
}

const envConfig = {
  environment: 'sandbox',
  environmentExplicit: true,
  providerRowName: null,
  merchantId: 'merchant-id',
  secret: 'merchant-secret',
  apiVersion: 'v1',
  timeoutMs: 1000,
  cacheTtlMs: 1000,
  pageSizeDefault: 48,
  pageSizeMax: 60,
  maxSyncPages: 40,
  syncPageSize: 500,
  supportedCurrencies: ['BDT', 'USD'],
  minBetMinor: 1,
  maxBetMinor: 100000,
  launchHostAllowlist: [],
};
interface HarnessOptions {
  providers?: MockProviderRow[];
  games?: MockGameRow[];
  /** Remote catalogs per provider row id (what that provider's API returns). */
  remote?: Record<string, CasinoRemoteGame[]>;
  /** Provider row ids whose provider API throws (sync failure isolation). */
  failing?: string[];
}

function makeHarness(options: HarnessOptions = {}) {
  const providerRows = options.providers ?? defaultProviders();
  const games: MockGameRow[] = options.games ? options.games.map((row) => ({ ...row })) : [];
  const remote = options.remote ?? {};
  const failing = new Set(options.failing ?? []);
  const categories: Array<Record<string, unknown>> = [
    // Every provider owns its own "Slots" category row (as a real sync writes).
    ...providerRows.map((row) => ({
      id: `cat-${row.id}`,
      providerId: row.id,
      externalId: 'slots',
      name: 'Slots',
      slug: 'slots',
      productType: 'CASINO',
      gameCount: 0,
      status: 'ACTIVE',
      sortOrder: 0,
    })),
  ];
  const launchCalls: Array<{ providerId: string; externalGameId: string; mode: string }> = [];
  const destructiveCalls: string[] = [];

  const rowOf = (id: string) => providerRows.find((row) => row.id === id);

  const providerAdapter = (providerId: string) => ({
    health: async () => ({ reachable: true, latencyMs: 3, providersUp: 1, message: null }),
    capabilities: async () => ({
      casino: true,
      liveCasino: true,
      demoSupported: true,
      source: 'catalog' as const,
    }),
    listCategories: async (productType?: string) => [
      {
        externalId: 'slots',
        name: 'Slots',
        slug: 'slots',
        productType: productType ?? 'CASINO',
        gameCount: (remote[providerId] ?? []).length,
      },
    ],
    listProviders: async () => [
      {
        externalId: 'studio-one',
        name: 'Studio One',
        gameCount: (remote[providerId] ?? []).length,
        liveCapable: false,
      },
    ],
    listGames: async (query: any = {}) => {
      if (failing.has(providerId)) {
        throw new Error(`provider ${providerId} unreachable`);
      }
      const page = Math.max(query.page ?? 1, 1);
      const pageSize = Math.max(query.pageSize ?? 48, 1);
      const filtered = (remote[providerId] ?? []).filter(
        (game) =>
          (!query.productType || game.productType === query.productType) &&
          (!query.providerExternalId || game.providerExternalId === query.providerExternalId) &&
          (!query.search ||
            `${game.name} ${game.providerName}`
              .toLowerCase()
              .includes(String(query.search).toLowerCase())),
      );
      const start = (page - 1) * pageSize;
      return {
        items: filtered.slice(start, start + pageSize),
        total: filtered.length,
        page,
        pageSize,
        hasMore: start + pageSize < filtered.length,
      };
    },
    getGame: async (externalId: string) =>
      (remote[providerId] ?? []).find((game) => game.externalId === externalId) ?? null,
    launch: async (input: any) => {
      launchCalls.push({ providerId, externalGameId: input.externalGameId, mode: 'REAL' });
      return {
        url: `${HOST}/${providerId}/${input.externalGameId}`,
        providerSessionId: 'partner-session-1',
        providerRoundId: null,
      };
    },
    launchDemo: async (input: any) => {
      launchCalls.push({ providerId, externalGameId: input.externalGameId, mode: 'DEMO' });
      return {
        url: `${HOST}/${providerId}/${input.externalGameId}?demo=1`,
        providerSessionId: null,
        providerRoundId: null,
      };
    },
    closeSession: async () => undefined,
  });

  const resolvedFor = (providerId: string) => {
    const row = rowOf(providerId);
    const active = Boolean(row && row.status === 'ACTIVE');
    return {
      provider: providerAdapter(providerId),
      config: envConfig,
      row: row
        ? {
            id: row.id,
            name: row.name,
            providerCode: row.providerCode,
            baseUrl: row.baseUrl,
            status: row.status,
            environment: 'sandbox',
            apiVersion: row.apiVersion,
          }
        : null,
      configured: active,
      credentialsSource: 'environment' as const,
      unavailableReason: active ? null : `Provider "${providerId}" is disabled.`,
    };
  };
  const prisma: any = {
    casinoGame: {
      findMany: jest.fn(async ({ where, select, orderBy, skip, take }: any) => {
        let rows = games.filter((row) => matchesWhere(row, where, providerRows));
        rows = sortRows(rows, orderBy);
        if (typeof skip === 'number') rows = rows.slice(skip);
        if (typeof take === 'number') rows = rows.slice(0, take);
        if (!select) return rows;
        return rows.map((row) => {
          const projected: Record<string, unknown> = {};
          Object.entries(select).forEach(([key, wanted]) => {
            if (wanted) projected[key] = (row as unknown as Record<string, unknown>)[key];
          });
          return projected;
        });
      }),
      findUnique: jest.fn(async ({ where, include, select }: any) => {
        const row =
          where?.providerId_externalId !== undefined
            ? games.find(
                (candidate) =>
                  candidate.providerId === where.providerId_externalId.providerId &&
                  candidate.externalId === where.providerId_externalId.externalId,
              )
            : games.find((candidate) => candidate.id === where.id);
        if (!row) return null;
        const base: Record<string, unknown> = { ...row };
        if (include?.provider) {
          const providerRow = rowOf(row.providerId);
          base.provider = { status: providerRow?.status ?? 'ACTIVE' };
        }
        if (!select) return base;
        const projected: Record<string, unknown> = {};
        Object.entries(select).forEach(([key, wanted]) => {
          if (wanted) projected[key] = (row as unknown as Record<string, unknown>)[key];
        });
        if (include?.provider) projected.provider = base.provider;
        return projected;
      }),
      count: jest.fn(
        async (args?: any) =>
          games.filter((row) => matchesWhere(row, args?.where, providerRows)).length,
      ),
      groupBy: jest.fn(async ({ by, where }: any) => {
        const filtered = games.filter((row) => matchesWhere(row, where, providerRows));
        const keys: string[] = Array.isArray(by) ? by : [by];
        const buckets = new Map<string, { key: Record<string, unknown>; count: number }>();
        filtered.forEach((row) => {
          const composite = keys.map((key) => String((row as any)[key])).join('|');
          const bucket = buckets.get(composite);
          if (bucket) {
            bucket.count += 1;
            return;
          }
          const key: Record<string, unknown> = {};
          keys.forEach((field) => {
            key[field] = (row as any)[field];
          });
          buckets.set(composite, { key, count: 1 });
        });
        return [...buckets.values()].map((bucket) => ({
          ...bucket.key,
          _count: { _all: bucket.count },
        }));
      }),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const key = where.providerId_externalId;
        const existing = games.find(
          (row) => row.providerId === key.providerId && row.externalId === key.externalId,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const created = {
          id: `${key.providerId}:${key.externalId}`,
          ...create,
        } as MockGameRow;
        games.push(created);
        return created;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const rows = games.filter((row) => matchesWhere(row, where, providerRows));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      }),
    },
    casinoCategory: {
      findMany: jest.fn(async ({ where, orderBy }: any) =>
        sortRows(
          categories.filter((row) => matchesWhere(row, where, providerRows)),
          orderBy,
        ),
      ),
      findFirst: jest.fn(
        async ({ where }: any) =>
          categories.find((row) => matchesWhere(row, where, providerRows)) ?? null,
      ),
      count: jest.fn(async () => categories.length),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const key = where.providerId_externalId;
        const existing = categories.find(
          (row) => row.providerId === key.providerId && row.externalId === key.externalId,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const created = { id: `cat-${categories.length + 1}`, ...create };
        categories.push(created);
        return created;
      }),
    },
    casinoSession: {
      count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }: any) => ({ id: 'session-1', ...data })),
      updateMany: jest.fn(async () => ({ count: 0 })),
      findUnique: jest.fn(async () => null),
    },
    casinoTransaction: { count: jest.fn(async () => 0) },
    auditLog: { create: jest.fn(async () => ({ id: 'audit-1' })) },
  };
  prisma.partnerProvider = {
    findUnique: jest.fn(async ({ where }: any) => {
      if (where?.name) {
        return providerRows.find((row) => row.name === where.name) ?? null;
      }
      return rowOf(where.id) ?? null;
    }),
    findMany: jest.fn(async ({ where, select, orderBy }: any) => {
      const filtered = providerRows.filter((row) => {
        if (where?.status && row.status !== where.status) return false;
        if (where?.id?.in && !where.id.in.includes(row.id)) return false;
        if (where?.productTypes?.hasSome) {
          const wanted: string[] = where.productTypes.hasSome;
          if (!wanted.some((product) => row.productTypes.includes(product))) return false;
        }
        return true;
      });
      const rows = sortRows(filtered, orderBy);
      if (!select) return rows;
      return rows.map((row) => {
        const projected: Record<string, unknown> = {};
        Object.entries(select).forEach(([key, wanted]) => {
          if (wanted) projected[key] = (row as unknown as Record<string, unknown>)[key];
        });
        return projected;
      });
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rowOf(where.id);
      if (row) Object.assign(row, data);
      return row ?? null;
    }),
    // Destructive provider operations must NEVER be reached by the catalog.
    delete: jest.fn(async () => {
      destructiveCalls.push('partnerProvider.delete');
      throw new Error('destructive provider delete attempted');
    }),
    deleteMany: jest.fn(async () => {
      destructiveCalls.push('partnerProvider.deleteMany');
      throw new Error('destructive provider deleteMany attempted');
    }),
  };

  prisma.$transaction = jest.fn(async (fn: any) =>
    fn({
      casinoSession: {
        updateMany: jest.fn(async () => ({ count: 0 })),
        create: jest.fn(async ({ data }: any) => ({ id: 'session-1', ...data })),
      },
    }),
  );

  const providers = {
    config: jest.fn(() => envConfig),
    resolve: jest.fn(async () => resolvedFor(providerRows[0]?.id ?? '')),
    resolveById: jest.fn(async (providerId: string) =>
      rowOf(providerId) ? resolvedFor(providerId) : null,
    ),
    listResolvableProviders: jest.fn(async () =>
      providerRows.filter((row) => row.status === 'ACTIVE').map((row) => resolvedFor(row.id)),
    ),
  };

  const wallet = {
    getOrCreateWalletForUser: jest.fn(async (_userId: string, currency: string) => ({ currency })),
  };

  const service = new CasinoCatalogService(
    prisma as unknown as PrismaService,
    providers as unknown as CasinoProviderFactory,
  );
  const launchService = new CasinoLaunchService(
    prisma as unknown as PrismaService,
    providers as unknown as CasinoProviderFactory,
    wallet as unknown as WalletService,
  );

  return {
    service,
    launchService,
    prisma,
    providers,
    games,
    launchCalls,
    destructiveCalls,
    providerRows,
  };
}
const PROVIDER_A = 'provider-a-id';
const PROVIDER_B = 'provider-b-id';
const PROVIDER_C = 'provider-c-id';
const PROVIDER_D = 'provider-d-id';
const PROVIDER_BIGBANG = 'provider-bigbang-id';

function defaultProviders(): MockProviderRow[] {
  return [
    mkProvider(PROVIDER_A, 'Provider A', { createdAt: new Date('2026-01-01T00:00:00.000Z') }),
    mkProvider(PROVIDER_B, 'Provider B', { createdAt: new Date('2026-01-02T00:00:00.000Z') }),
    mkProvider(PROVIDER_C, 'Provider C', { createdAt: new Date('2026-01-03T00:00:00.000Z') }),
    // Disabled provider: its games exist but must NEVER be public.
    mkProvider(PROVIDER_D, 'Provider D', {
      status: 'INACTIVE',
      createdAt: new Date('2026-01-04T00:00:00.000Z'),
    }),
  ];
}

function defaultGames(): MockGameRow[] {
  return [
    // Provider A → 3
    mkDbGame(PROVIDER_A, 'a-book-of-ra', 'Book of Ra'),
    mkDbGame(PROVIDER_A, 'sweet-bonanza', 'Sweet Bonanza'),
    mkDbGame(PROVIDER_A, 'a-fruit-party', 'Fruit Party'),
    // Provider B → 4 public (+1 hidden); its "Sweet Bonanza" reuses A's id.
    mkDbGame(PROVIDER_B, 'b-gates', 'Gates of Olympus', {
      raw: { providerName: 'Studio Two', providerExternalId: 'studio-two' },
    }),
    mkDbGame(PROVIDER_B, 'sweet-bonanza', 'Sweet Bonanza', {
      raw: { providerName: 'Studio Two', providerExternalId: 'studio-two' },
    }),
    mkDbGame(PROVIDER_B, 'b-book-of-books', 'Book of Books', {
      raw: { providerName: 'Studio Two', providerExternalId: 'studio-two' },
    }),
    mkDbGame(PROVIDER_B, 'b-new', 'Bright Nova', {
      raw: { providerName: 'Studio Two', providerExternalId: 'studio-two' },
    }),
    // Hidden by the existing game-status rule (never public).
    mkDbGame(PROVIDER_B, 'b-hidden', 'Hidden Game', {
      status: 'INACTIVE',
      raw: { providerName: 'Studio Two', providerExternalId: 'studio-two' },
    }),
    // Provider C → 2 (name shared with A and B)
    mkDbGame(PROVIDER_C, 'c-sweet-bonanza', 'Sweet Bonanza', {
      raw: { providerName: 'Studio Three', providerExternalId: 'studio-three' },
    }),
    mkDbGame(PROVIDER_C, 'c-book-of-shadows', 'Book of Shadows', {
      raw: { providerName: 'Studio Three', providerExternalId: 'studio-three' },
    }),
    // Provider D (INACTIVE provider) → 2
    mkDbGame(PROVIDER_D, 'd-slot', 'Provider D Slots'),
    mkDbGame(PROVIDER_D, 'd-live', 'Provider D Live'),
  ];
}

/** What each provider's own API returns (used by the sync tests). */
function defaultRemote(): Record<string, CasinoRemoteGame[]> {
  return {
    [PROVIDER_A]: [
      mkRemoteGame('a-book-of-ra', 'Book of Ra', 'studio-one'),
      mkRemoteGame('sweet-bonanza', 'Sweet Bonanza', 'studio-one'),
      mkRemoteGame('a-fruit-party', 'Fruit Party', 'studio-one'),
    ],
    [PROVIDER_B]: [
      mkRemoteGame('b-gates', 'Gates of Olympus', 'studio-two'),
      mkRemoteGame('sweet-bonanza', 'Sweet Bonanza', 'studio-two'),
      mkRemoteGame('b-book-of-books', 'Book of Books', 'studio-two'),
      mkRemoteGame('b-new', 'Bright Nova', 'studio-two'),
    ],
    [PROVIDER_C]: [
      mkRemoteGame('c-sweet-bonanza', 'Sweet Bonanza', 'studio-three'),
      mkRemoteGame('c-book-of-shadows', 'Book of Shadows', 'studio-three'),
    ],
  };
}

/** Catalog ids are provider-scoped (`providerId:externalId`), so a Set is safe. */
const pagedIds = (response: { games: { items: Array<{ id: string }> } }) =>
  response.games.items.map((game) => game.id).sort();
describe('multi-provider catalog', () => {
  it('returns games from EVERY active provider (all = 9)', async () => {
    const h = makeHarness({ games: defaultGames() });
    const response = await h.service.getCatalog({ productType: 'CASINO' });

    expect(response.games.total).toBe(9);
    expect(response.games.items).toHaveLength(9);
    const providers = new Set(response.games.items.map((game) => game.providerId));
    expect([...providers].sort()).toEqual([PROVIDER_A, PROVIDER_B, PROVIDER_C]);
  });

  it('builds the provider filter from the database (one entry per active studio)', async () => {
    const h = makeHarness({ games: defaultGames() });
    const response = await h.service.getCatalog({ productType: 'CASINO' });

    expect(response.providers).toEqual([
      { id: 'studio-two', name: 'Studio Two', gameCount: 4, productType: 'CASINO' },
      { id: 'studio-one', name: 'Studio One', gameCount: 3, productType: 'CASINO' },
      { id: 'studio-three', name: 'Studio Three', gameCount: 2, productType: 'CASINO' },
    ]);
    // The disabled provider's games (and therefore its studio) are NOT public.
    expect(response.providers.map((provider) => provider.id)).not.toContain(PROVIDER_D);
    expect(response.providers.map((provider) => provider.id)).not.toContain(PROVIDER_A);
  });

  it('one provider filter returns exactly that provider’s games', async () => {
    const h = makeHarness({ games: defaultGames() });

    const a = await h.service.getCatalog({ productType: 'CASINO', providerExternalId: PROVIDER_A });
    const b = await h.service.getCatalog({ productType: 'CASINO', providerExternalId: PROVIDER_B });
    const c = await h.service.getCatalog({ productType: 'CASINO', providerExternalId: PROVIDER_C });

    expect(a.games.total).toBe(3);
    expect(b.games.total).toBe(4);
    expect(c.games.total).toBe(2);
    expect(a.games.items.every((game) => game.providerId === PROVIDER_A)).toBe(true);
    expect(b.games.items.every((game) => game.providerId === PROVIDER_B)).toBe(true);
  });

  it('excludes an INACTIVE provider publicly but keeps it for admin', async () => {
    const h = makeHarness({ games: defaultGames() });
    const publicView = await h.service.getCatalog({ productType: 'CASINO' });
    const adminView = await h.service.getAdminCatalog({ productType: 'CASINO' });

    expect(publicView.games.items.some((game) => game.providerId === PROVIDER_D)).toBe(false);
    expect(publicView.games.total).toBe(9);
    expect(adminView.games.total).toBe(12);
    expect(adminView.games.items.some((game) => game.providerId === PROVIDER_D)).toBe(true);
  });

  it('excludes a disabled game publicly but keeps it for admin', async () => {
    const h = makeHarness({ games: defaultGames() });
    const publicView = await h.service.getCatalog({ productType: 'CASINO' });
    const adminView = await h.service.getAdminCatalog({ productType: 'CASINO' });

    expect(publicView.games.items.some((game) => game.externalId === 'b-hidden')).toBe(false);
    expect(adminView.games.items.some((game) => game.externalId === 'b-hidden')).toBe(true);
  });

  it('keeps duplicate game names from different providers', async () => {
    const h = makeHarness({ games: defaultGames() });
    const response = await h.service.getCatalog({ productType: 'CASINO', search: 'Sweet Bonanza' });

    expect(response.games.total).toBe(3);
    expect(response.games.items.map((game) => game.id).sort()).toEqual([
      `${PROVIDER_A}:sweet-bonanza`,
      `${PROVIDER_B}:sweet-bonanza`,
      `${PROVIDER_C}:c-sweet-bonanza`,
    ]);
    // The same external id in A and B stays two provider-specific rows.
    expect(new Set(response.games.items.map((game) => game.providerId)).size).toBe(3);
  });

  it('paginates across providers without dropping any game', async () => {
    const h = makeHarness({ games: defaultGames() });
    const first = await h.service.getCatalog({ productType: 'CASINO', page: 1, pageSize: 4 });
    const second = await h.service.getCatalog({ productType: 'CASINO', page: 2, pageSize: 4 });
    const third = await h.service.getCatalog({ productType: 'CASINO', page: 3, pageSize: 4 });

    expect(first.games.items).toHaveLength(4);
    expect(second.games.items).toHaveLength(4);
    expect(third.games.items).toHaveLength(1);
    expect(first.games.hasMore).toBe(true);
    expect(second.games.hasMore).toBe(true);
    expect(third.games.hasMore).toBe(false);
    expect(first.games.total).toBe(9);

    const seen = new Set([...pagedIds(first), ...pagedIds(second), ...pagedIds(third)]);
    expect(seen.size).toBe(9);
  });

  it('searches across every provider', async () => {
    const h = makeHarness({ games: defaultGames() });
    const response = await h.service.getCatalog({ productType: 'CASINO', search: 'Book' });

    expect(response.games.total).toBe(3);
    expect(new Set(response.games.items.map((game) => game.providerId)).size).toBe(3);
  });

  it('combines provider + search + category', async () => {
    const h = makeHarness({ games: defaultGames() });
    const response = await h.service.getCatalog({
      productType: 'CASINO',
      providerExternalId: PROVIDER_C,
      search: 'Sweet',
      categorySlug: 'slots',
    });
    const miss = await h.service.getCatalog({
      productType: 'CASINO',
      providerExternalId: PROVIDER_A,
      search: 'Shadows',
    });

    expect(response.games.items.map((game) => game.externalId)).toEqual(['c-sweet-bonanza']);
    expect(miss.games.items).toHaveLength(0);
  });

  it('scopes each product independently across providers', async () => {
    const games = [
      ...defaultGames(),
      mkDbGame(PROVIDER_B, 'b-live', 'Live Roulette B', { productType: 'LIVE_CASINO' }),
    ];
    const h = makeHarness({ games });

    const casino = await h.service.getCatalog({ productType: 'CASINO' });
    const live = await h.service.getCatalog({ productType: 'LIVE_CASINO' });

    expect(casino.games.total).toBe(9);
    expect(live.games.total).toBe(1);
    expect(live.games.items[0].providerId).toBe(PROVIDER_B);
    // The public provider list is the STUDIO dimension (what a player picks),
    // NOT the operator feed rows. Provider D is INACTIVE, so it is absent.
    expect(casino.providers.map((provider) => provider.id)).toEqual([
      'studio-two',
      'studio-one',
      'studio-three',
    ]);
    expect(casino.providers.map((provider) => provider.gameCount)).toEqual([4, 3, 2]);
    // Live is scoped independently: only Provider B has a live title, and that
    // title is still reported under its own studio.
    expect(live.providers.map((provider) => provider.id)).toEqual(['studio-one']);
  });

  it('reports the studio dimension only for active providers', async () => {
    const h = makeHarness({ games: defaultGames() });
    const studios = await h.service.listStudios('CASINO');

    expect(studios.map((studio) => studio.name).sort()).toEqual([
      'Studio One',
      'Studio Three',
      'Studio Two',
    ]);
  });

  it('keeps the legacy studio link working (?provider=studio-two)', async () => {
    const h = makeHarness({ games: defaultGames() });
    const byStudio = await h.service.getCatalog({
      productType: 'CASINO',
      providerExternalId: 'studio-two',
    });
    const byRowId = await h.service.getCatalog({
      productType: 'CASINO',
      providerExternalId: PROVIDER_B,
    });

    expect(byStudio.games.total).toBe(4);
    expect(byRowId.games.items.map((game) => game.id)).toEqual(
      byStudio.games.items.map((game) => game.id),
    );
  });

  it('an unknown provider filter yields an empty page (never a fallback)', async () => {
    const h = makeHarness({ games: defaultGames() });
    const response = await h.service.getCatalog({
      productType: 'CASINO',
      providerExternalId: 'provider-that-does-not-exist',
    });

    expect(response.games.total).toBe(0);
    expect(response.games.items).toEqual([]);
  });

  it('resolves a single game by its provider-scoped catalog id', async () => {
    const h = makeHarness({ games: defaultGames() });

    const publicGame = await h.service.getGameById(`${PROVIDER_C}:c-book-of-shadows`);
    const hiddenGame = await h.service.getGameById(`${PROVIDER_D}:d-slot`);
    const adminHidden = await h.service.getGameById(`${PROVIDER_D}:d-slot`, true);
    const wrongProvider = await h.service.getGameById(`${PROVIDER_A}:c-book-of-shadows`);

    expect(publicGame?.providerId).toBe(PROVIDER_C);
    expect(hiddenGame).toBeNull();
    expect(adminHidden?.providerId).toBe(PROVIDER_D);
    expect(wrongProvider).toBeNull();
  });
});
describe('multi-provider sync', () => {
  it('syncs EVERY active provider in one run', async () => {
    const h = makeHarness({ games: [], remote: defaultRemote() });

    const summary = await h.service.sync();

    // The INACTIVE provider D is never discovered.
    expect(summary.providersDiscovered).toBe(3);
    expect(summary.providersSynced).toBe(3);
    expect(summary.providersFailed).toBe(0);
    expect(summary.errors).toEqual([]);
    expect(summary.providerResults.map((row) => row.providerId)).toEqual([
      PROVIDER_A,
      PROVIDER_B,
      PROVIDER_C,
    ]);
    expect(summary.providerResults.map((row) => row.status)).toEqual([
      'SYNCED',
      'SYNCED',
      'SYNCED',
    ]);
    expect(summary.fetched).toBe(9);
    expect(summary.created).toBe(9);
    expect(summary.provider).toBe('3 providers');

    // Each game is stored under ITS OWN provider identity.
    expect(h.games.map((row) => row.id).sort()).toEqual([
      `${PROVIDER_A}:a-book-of-ra`,
      `${PROVIDER_A}:a-fruit-party`,
      `${PROVIDER_A}:sweet-bonanza`,
      `${PROVIDER_B}:b-book-of-books`,
      `${PROVIDER_B}:b-gates`,
      `${PROVIDER_B}:b-new`,
      `${PROVIDER_B}:sweet-bonanza`,
      `${PROVIDER_C}:c-book-of-shadows`,
      `${PROVIDER_C}:c-sweet-bonanza`,
    ]);
    expect(h.destructiveCalls).toEqual([]);
  });

  it('the synced catalog is immediately public for every provider', async () => {
    const h = makeHarness({ games: [], remote: defaultRemote() });
    await h.service.sync();

    const response = await h.service.getCatalog({ productType: 'CASINO' });
    expect(response.games.total).toBe(9);
    // After a sync the public list is the STUDIO dimension the partner reported.
    expect(response.providers.map((provider) => provider.id)).toEqual([
      'studio-two',
      'studio-one',
      'studio-three',
    ]);
    expect(response.provider).toBe('Provider A');
    expect(response.available).toBe(true);
  });

  it('one failing provider never discards the others', async () => {
    const h = makeHarness({
      games: [],
      remote: defaultRemote(),
      failing: [PROVIDER_B],
    });

    const summary = await h.service.sync();

    expect(summary.providersDiscovered).toBe(3);
    expect(summary.providersSynced).toBe(2);
    expect(summary.providersFailed).toBe(1);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]).toContain('Provider B');

    const byProvider = new Map(summary.providerResults.map((row) => [row.providerId, row]));
    expect(byProvider.get(PROVIDER_A)?.status).toBe('SYNCED');
    expect(byProvider.get(PROVIDER_C)?.status).toBe('SYNCED');
    expect(byProvider.get(PROVIDER_B)?.status).toBe('FAILED');

    // A and C are still in the public catalog, B contributed nothing.
    const response = await h.service.getCatalog({ productType: 'CASINO' });
    expect(response.games.total).toBe(5);
    expect(new Set(response.games.items.map((game) => game.providerId))).toEqual(
      new Set([PROVIDER_A, PROVIDER_C]),
    );
  });

  it('deactivates only the games of the provider that stopped listing them', async () => {
    const remote = defaultRemote();
    remote[PROVIDER_A] = remote[PROVIDER_A]!.filter((game) => game.externalId !== 'a-fruit-party');
    const h = makeHarness({
      games: defaultGames(),
      remote,
      failing: [PROVIDER_B],
    });

    await h.service.sync();

    const row = (id: string) => h.games.find((game) => game.id === id);
    expect(row(`${PROVIDER_A}:a-fruit-party`)?.status).toBe('INACTIVE');
    // B failed, so ITS snapshot is untouched (no mass deactivation).
    expect(row(`${PROVIDER_B}:b-gates`)?.status).toBe('ACTIVE');
    expect(row(`${PROVIDER_B}:b-hidden`)?.status).toBe('INACTIVE');
    expect(row(`${PROVIDER_C}:c-sweet-bonanza`)?.status).toBe('ACTIVE');
  });

  it('a re-sync updates instead of duplicating the same titles', async () => {
    const h = makeHarness({ games: [], remote: defaultRemote() });

    const first = await h.service.sync();
    const second = await h.service.sync();

    expect(first.created).toBe(9);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(9);
    expect(h.games).toHaveLength(9);
  });
});
describe('multi-provider launch', () => {
  it('launches each game through ITS OWN provider adapter', async () => {
    const h = makeHarness({ games: defaultGames() });

    const fromA = await h.launchService.launch('user-1', {
      gameId: `${PROVIDER_A}:a-book-of-ra`,
      mode: 'REAL',
    });
    const fromB = await h.launchService.launch('user-1', {
      gameId: `${PROVIDER_B}:sweet-bonanza`,
      mode: 'REAL',
    });
    const fromC = await h.launchService.launch('user-1', {
      gameId: `${PROVIDER_C}:c-sweet-bonanza`,
      mode: 'DEMO',
    });

    expect(h.providers.resolveById).toHaveBeenCalledWith(PROVIDER_A);
    expect(h.providers.resolveById).toHaveBeenCalledWith(PROVIDER_B);
    expect(h.providers.resolveById).toHaveBeenCalledWith(PROVIDER_C);
    expect(h.launchCalls).toEqual([
      { providerId: PROVIDER_A, externalGameId: 'a-book-of-ra', mode: 'REAL' },
      { providerId: PROVIDER_B, externalGameId: 'sweet-bonanza', mode: 'REAL' },
      { providerId: PROVIDER_C, externalGameId: 'c-sweet-bonanza', mode: 'DEMO' },
    ]);
    expect(fromA.gameId).toBe(`${PROVIDER_A}:a-book-of-ra`);
    expect(fromB.provider).toBe('Provider B');
    expect(fromC.mode).toBe('DEMO');
  });

  it('refuses to launch a game of a disabled provider', async () => {
    const h = makeHarness({ games: defaultGames() });

    await expect(
      h.launchService.launch('user-1', { gameId: `${PROVIDER_D}:d-slot`, mode: 'REAL' }),
    ).rejects.toThrow();
    expect(h.launchCalls).toEqual([]);
  });

  it('refuses to launch an inactive game', async () => {
    const h = makeHarness({ games: defaultGames() });

    await expect(
      h.launchService.launch('user-1', { gameId: `${PROVIDER_B}:b-hidden`, mode: 'REAL' }),
    ).rejects.toThrow();
    expect(h.launchCalls).toEqual([]);
  });
});

describe('admin status across providers', () => {
  it('reports EVERY configured provider row with its real game counts', async () => {
    const h = makeHarness({ games: defaultGames() });
    const status = await h.service.getAdminStatus();

    const providerRows = status.providerRows ?? [];
    expect(providerRows.map((row) => row.id)).toEqual([
      PROVIDER_A,
      PROVIDER_B,
      PROVIDER_C,
      PROVIDER_D,
    ]);
    const byId = new Map(providerRows.map((row) => [row.id, row]));
    expect(byId.get(PROVIDER_A)?.gameCount).toBe(3);
    expect(byId.get(PROVIDER_A)?.activeGameCount).toBe(3);
    expect(byId.get(PROVIDER_B)?.gameCount).toBe(5);
    expect(byId.get(PROVIDER_B)?.activeGameCount).toBe(4);
    expect(byId.get(PROVIDER_D)?.status).toBe('INACTIVE');
    expect(byId.get(PROVIDER_D)?.activeGameCount).toBe(2);
    // Admin counts are DB truth: 12 rows in total, 11 ACTIVE casino games —
    // including the 2 of the disabled provider, whose games stay stored but are
    // never public (asserted by the public-catalog tests above).
    expect(status.counts.games).toBe(12);
    expect(status.counts.casinoGames).toBe(11);
    expect(status.counts.inactive).toBe(1);
  });
});

describe('single-provider backwards compatibility (BigBang / WinHouse)', () => {
  const single = () => ({
    providers: [mkProvider(PROVIDER_BIGBANG, 'BigBang')],
    games: [
      mkDbGame(PROVIDER_BIGBANG, 'bb-sweet-bonanza', 'Sweet Bonanza'),
      mkDbGame(PROVIDER_BIGBANG, 'bb-gates', 'Gates of Olympus'),
    ],
    remote: {
      [PROVIDER_BIGBANG]: [
        mkRemoteGame('bb-sweet-bonanza', 'Sweet Bonanza', 'studio-one'),
        mkRemoteGame('bb-gates', 'Gates of Olympus', 'studio-one'),
      ],
    },
  });

  it('syncs and exposes a single legacy provider unchanged', async () => {
    const h = makeHarness(single());
    const summary = await h.service.sync();

    expect(summary.providersDiscovered).toBe(1);
    expect(summary.providersSynced).toBe(1);
    expect(summary.fetched).toBe(2);
    // Both rows already exist under this provider, so the sync updates them.
    expect(summary.created).toBe(0);
    expect(summary.updated).toBe(2);
    // A single provider is still reported by name (not "1 providers").
    expect(summary.provider).toBe('BigBang');

    const response = await h.service.getCatalog({ productType: 'CASINO' });
    expect(response.games.total).toBe(2);
    expect(response.provider).toBe('BigBang');
    // A single partner feed still yields the STUDIOS it publishes, so the studio
    // picker stays usable with one operator integration. The name is the studio
    // name the partner reported during the sync.
    expect(response.providers).toEqual([
      {
        id: 'studio-one',
        name: 'studio-one',
        gameCount: 2,
        productType: 'CASINO',
      },
    ]);
  });

  it('reports an honest failure when no provider is configured', async () => {
    const h = makeHarness({ ...single(), providers: [] });
    const summary = await h.service.sync();

    expect(summary.providersDiscovered).toBe(0);
    expect(summary.providersSynced).toBe(0);
    expect(summary.errors).toHaveLength(1);
  });
});

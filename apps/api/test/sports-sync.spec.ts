/* eslint-disable @typescript-eslint/no-explicit-any */
import { UnconfiguredOperatorAdapter } from '@tanvion-royale/integrations';
import { SportsSyncService } from '../src/modules/sportsbook/sports-sync.service';

/**
 * Phase 9 — Sports partner sync fail-safety + normalization tests.
 *
 * Covers:
 *  1. Missing partner credentials (UnconfiguredOperatorAdapter) → provider row
 *     goes ERROR with a structured lastSyncError; NO sports/games/events are
 *     ever fabricated.
 *  2. Provider failure mid-sync → syncStatus ERROR + lastSyncError recorded;
 *     no partial/fake events are written.
 *  3. Successful sync normalizes real provider data into internal rows,
 *     preserves the external event id (upsert key + externalEventId + PARTNER
 *     betting mode + partnerProviderId) and skips inactive provider sports.
 *  4. No ACTIVE provider configured → sync is an explicit no-op.
 */

const providerRow: any = {
  id: 'provider-1',
  name: 'real-partner',
  baseUrl: 'https://partner.example.com',
  deepLinkTemplate: '/sport/{sportSlug}/event/{externalEventId}',
  status: 'ACTIVE',
  apiKeyEnc: 'v1:encrypted',
  apiSecretEnc: null,
  authMode: 'api-key',
  apiVersion: null,
  syncStatus: null,
  lastSyncAt: null,
  lastSyncError: null,
  createdAt: new Date(),
};

const cricketSport = {
  externalProvider: 'real-partner',
  externalId: 'spr-1',
  name: 'Cricket',
  active: true,
};

const iplCompetition = {
  externalProvider: 'real-partner',
  externalId: 'comp-ipl',
  sport: cricketSport,
  name: 'IPL',
  country: 'India',
};

const iplEvent = {
  externalProvider: 'real-partner',
  externalId: 'evt-9001',
  competition: iplCompetition,
  kicksOffAt: '2026-04-10T14:30:00.000Z',
  homeName: 'Mumbai Indians',
  awayName: 'Chennai Super Kings',
  status: 'LIVE',
  live: true,
};

function makePrismaSyncFake(rows: any[] = []) {
  const calls: Record<string, unknown[]> = {};
  const record = (key: string, arg: unknown) => {
    calls[key] = calls[key] ?? [];
    calls[key].push(arg);
  };

  const prisma: any = {
    partnerProvider: {
      findMany: jest.fn(async () => rows),
      update: jest.fn(async ({ where, data }: any) => {
        const target = rows.find((r) => r.id === where.id);
        return { ...(target ?? providerRow), ...data };
      }),
    },
    sport: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => {
        record('sport.create', data);
        return { id: `sport-${data.slug}` };
      }),
    },
    game: {
      upsert: jest.fn(async ({ create }: any) => {
        record('game.upsert', create);
        return { id: `game-${create.slug}` };
      }),
    },
    gameAvailability: {
      upsert: jest.fn(async ({ create }: any) => {
        record('gameAvailability.upsert', create);
        return { id: 'av-1', gamblingEnabled: true };
      }),
    },
    providerMapping: {
      upsert: jest.fn(async ({ create }: any) => {
        record('providerMapping.upsert', create);
        return { id: 'pm-1', ...create };
      }),
    },
    competition: {
      upsert: jest.fn(async ({ create }: any) => {
        record('competition.upsert', create);
        return { id: `competition-${create.slug}` };
      }),
    },
    event: {
      upsert: jest.fn(async ({ create, update }: any) => {
        record('event.upsert', { create, update });
        return { id: 'event-1', ...create };
      }),
      findFirst: jest.fn(async () => null),
    },
    market: { upsert: jest.fn(async () => ({ id: 'market-1' })) },
    selection: { upsert: jest.fn(async () => ({ id: 'selection-1' })) },
    odds: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
    },
  };
  return { prisma, calls };
}

function makeProvider(overrides: Record<string, unknown> = {}) {
  return {
    name: 'real-partner',
    authenticate: jest.fn(async () => undefined),
    getSports: jest.fn(async () => [cricketSport]),
    getCompetitions: jest.fn(async () => [iplCompetition]),
    getEvents: jest.fn(async () => [iplEvent]),
    getMarkets: jest.fn(async () => []),
    getSelections: jest.fn(async () => []),
    getOdds: jest.fn(async () => []),
    ...overrides,
  };
}

describe('Sports sync — missing partner credentials', () => {
  it('marks the provider ERROR and fabricates nothing when no provider is configured', async () => {
    const { prisma, calls } = makePrismaSyncFake([providerRow]);
    const provider = new UnconfiguredOperatorAdapter();
    const service = new SportsSyncService(prisma as any, provider as any);

    const summary = await service.syncAll();

    expect(summary.events).toBe(0);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]).toContain('Betting provider is not configured');

    // No sports/games/competitions/events were invented.
    expect(calls['sport.create']).toBeUndefined();
    expect(calls['game.upsert']).toBeUndefined();
    expect(calls['competition.upsert']).toBeUndefined();
    expect(calls['event.upsert']).toBeUndefined();

    // The provider row records the structured failure (no fake success).
    const updates = (prisma.partnerProvider.update as jest.Mock).mock.calls.map(
      (c: any) => c[0].data,
    );
    const finalUpdate = updates[updates.length - 1];
    expect(finalUpdate.syncStatus).toBe('ERROR');
    expect(finalUpdate.lastSyncError).toContain('Betting provider is not configured');
    expect(finalUpdate.lastSyncAt).toBeUndefined();
  });
});

describe('Sports sync — provider failure', () => {
  it('records the sync failure and never writes partial/fake events', async () => {
    const { prisma, calls } = makePrismaSyncFake([providerRow]);
    const provider = makeProvider({
      getEvents: jest.fn(async () => {
        throw new Error('upstream 500: provider exploded');
      }),
    });
    const service = new SportsSyncService(prisma as any, provider as any);

    const summary = await service.syncAll();

    expect(summary.events).toBe(0);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]).toContain('upstream 500');
    expect(calls['event.upsert']).toBeUndefined();

    const updates = (prisma.partnerProvider.update as jest.Mock).mock.calls.map(
      (c: any) => c[0].data,
    );
    expect(updates[updates.length - 1].syncStatus).toBe('ERROR');
    expect(updates[updates.length - 1].lastSyncError).toContain('upstream 500');
    expect(updates[updates.length - 1].lastSyncAt).toBeUndefined();
  });
});

describe('Sports sync — event normalization', () => {
  it('maps real provider data into internal rows preserving the external event id', async () => {
    const { prisma, calls } = makePrismaSyncFake([providerRow]);
    const inactiveSport = { ...cricketSport, externalId: 'spr-2', name: 'Polo', active: false };
    const provider = makeProvider({
      getSports: jest.fn(async () => [cricketSport, inactiveSport]),
    });
    const service = new SportsSyncService(prisma as any, provider as any);

    const summary = await service.syncAll();

    expect(summary).toMatchObject({
      sports: 1,
      competitions: 1,
      events: 1,
      markets: 0,
      selections: 0,
      odds: 0,
      errors: [],
    });

    // Inactive provider sports are skipped, not fabricated.
    const sportCreates = calls['sport.create'] as any[];
    expect(sportCreates).toHaveLength(1);
    expect(sportCreates[0].slug).toBe('cricket');

    const gameUpserts = calls['game.upsert'] as any[];
    expect(gameUpserts).toHaveLength(1);
    expect(gameUpserts[0].slug).toBe('cricket-partner');

    // The event upsert is keyed by the provider event id and keeps the
    // external id + partner routing intact.
    const eventUpserts = calls['event.upsert'] as any[];
    expect(eventUpserts).toHaveLength(1);
    const { create } = eventUpserts[0];
    expect(create.providerEventId).toBe('evt-9001');
    expect(create.externalEventId).toBe('evt-9001');
    expect(create.bettingMode).toBe('PARTNER');
    expect(create.partnerProviderId).toBe('provider-1');
    expect(create.status).toBe('LIVE');
    expect(create.live).toBe(true);
    expect(create.homeName).toBe('Mumbai Indians');
    expect(create.awayName).toBe('Chennai Super Kings');
    expect(create.startTime).toEqual(new Date('2026-04-10T14:30:00.000Z'));

    // Competition + provider mapping come from provider data. The competition
    // is ensured twice by design (from the provider competition list and from
    // the event's embedded competition) — both are idempotent upserts.
    const compUpserts = calls['competition.upsert'] as any[];
    expect(compUpserts).toHaveLength(2);
    expect(compUpserts[0].name).toBe('IPL');
    expect(compUpserts[0].slug).toBe('ipl');
    expect(compUpserts[1].name).toBe('IPL');
    expect(compUpserts[1].slug).toBe('ipl');

    const mappings = calls['providerMapping.upsert'] as any[];
    expect(mappings[0].providerName).toBe('real-partner');
    expect(mappings[0].externalGameId).toBe('spr-1');
    expect(mappings[0].status).toBe('ACTIVE');

    // Successful sync recorded with real data — never fake.
    const updates = (prisma.partnerProvider.update as jest.Mock).mock.calls.map(
      (c: any) => c[0].data,
    );
    const finalUpdate = updates[updates.length - 1];
    expect(finalUpdate.syncStatus).toBe('OK');
    expect(finalUpdate.lastSyncError).toBeNull();
    expect(finalUpdate.lastSyncAt).toBeInstanceOf(Date);
  });
});

describe('Sports sync — no providers configured', () => {
  it('is an explicit no-op with zero counts (no fabricated feed)', async () => {
    const { prisma } = makePrismaSyncFake([]);
    const provider = makeProvider();
    const service = new SportsSyncService(prisma as any, provider as any);

    const summary = await service.syncAll();

    expect(summary).toMatchObject({
      sports: 0,
      competitions: 0,
      events: 0,
      markets: 0,
      selections: 0,
      odds: 0,
      errors: [],
    });
    expect(provider.getSports).not.toHaveBeenCalled();
    expect(prisma.partnerProvider.update).not.toHaveBeenCalled();
  });
});
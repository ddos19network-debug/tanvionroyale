/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { AdminSportsController, SportsController } from '../src/modules/sports/sports.controller';
import { SportsService } from '../src/modules/sports/sports.service';
import { PrismaService } from '../src/database/prisma.service';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';

/** In-memory fake of the Prisma surface used by SportsService. */
function makePrismaFake() {
  const sports = new Map<string, any>();
  const games = new Map<string, any>();
  const competitions = new Map<string, any>();
  const availabilities = new Map<string, any>();
  const mappings = new Map<string, any>();
  const auditLogs: any[] = [];

  function withRelations(game: any, include?: any): any {
    if (!include) return game;
    return {
      ...game,
      availability: availabilities.get(game.id) ?? null,
      providerMapping: mappings.get(game.id) ?? null,
    };
  }

  const prisma = {
    sport: {
      findUnique: jest.fn(async ({ where, include }: any) => {
        const base = where.slug
          ? [...sports.values()].find((s) => s.slug === where.slug) ?? null
          : sports.get(where.id) ?? null;
        if (!base) return null;
        if (include?.games) {
          return {
            ...base,
            games: [...games.values()].filter((g) => g.sportId === base.id && g.status === 'ACTIVE'),
          };
        }
        if (include?.competitions) {
          return {
            ...base,
            competitions: [...competitions.values()]
              .filter((c) => c.sportId === base.id && c.status === 'ACTIVE')
              .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
          };
        }
        return base;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        [...sports.values()]
          .filter((s) => !where || !where.status || s.status === where.status)
          .sort((a, b) => a.sortOrder - b.sortOrder),
      ),
      create: jest.fn(async ({ data }: any) => {
        const sport = { ...data, id: `sport-${sports.size + 1}`, createdAt: new Date(), updatedAt: new Date() };
        sports.set(sport.id, sport);
        return sport;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const sport = { ...sports.get(where.id), ...data, updatedAt: new Date() };
        sports.set(where.id, sport);
        return sport;
      }),
      delete: jest.fn(async ({ where }: any) => {
        const sport = sports.get(where.id);
        sports.delete(where.id);
        return sport;
      }),
    },
    game: {
      findUnique: jest.fn(async ({ where, include }: any) => {
        const base = where.slug
          ? [...games.values()].find((g) => g.slug === where.slug) ?? null
          : games.get(where.id) ?? null;
        return base ? withRelations(base, include) : null;
      }),
      findMany: jest.fn(async () => [...games.values()]),
      create: jest.fn(async ({ data, include }: any) => {
        const game = { ...data, id: `game-${games.size + 1}`, createdAt: new Date(), updatedAt: new Date() };
        games.set(game.id, game);
        return withRelations(game, include);
      }),
      update: jest.fn(async ({ where, data, include }: any) => {
        const existing = games.get(where.id);
        const next = { ...existing, ...data, updatedAt: new Date() };
        if (data.sport) next.sportId = data.sport.connect.id;
        games.set(where.id, next);
        return withRelations(next, include);
      }),
      delete: jest.fn(async ({ where }: any) => {
        const game = games.get(where.id);
        games.delete(where.id);
        return game;
      }),
    },
    gameAvailability: {
      upsert: jest.fn(async ({ where, update, create }: any) => {
        const existing = availabilities.get(where.gameId);
        if (existing) {
          const next = { ...existing, ...update };
          availabilities.set(where.gameId, next);
          return next;
        }
        const created = { ...create, id: `avail-${availabilities.size + 1}` };
        availabilities.set(where.gameId, created);
        return created;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const existing = availabilities.get(where.gameId);
        if (existing && existing.gamblingEnabled === where.gamblingEnabled) {
          availabilities.set(where.gameId, { ...existing, ...data });
          return { count: 1 };
        }
        return { count: 0 };
      }),
    },
    providerMapping: {
      upsert: jest.fn(async ({ where, update, create }: any) => {
        const existing = mappings.get(where.gameId);
        if (existing) {
          const next = { ...existing, ...update };
          mappings.set(where.gameId, next);
          return next;
        }
        const created = { ...create, id: `map-${mappings.size + 1}` };
        mappings.set(where.gameId, created);
        return created;
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        auditLogs.push(data);
        return data;
      }),
    },
  };

  return {
    prisma: prisma as unknown as PrismaService,
    sports,
    games,
    competitions,
    availabilities,
    mappings,
    auditLogs,
  };
}

const admin = { id: 'admin-1', sessionId: 's1', roles: ['ADMIN'] };

function seedSport(fake: ReturnType<typeof makePrismaFake>, overrides: Partial<any> = {}): any {
  const sport = {
    id: `sport-${fake.sports.size + 1}`,
    name: 'Football',
    slug: 'football',
    description: null,
    icon: null,
    status: 'ACTIVE',
    sortOrder: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  fake.sports.set(sport.id, sport);
  return sport;
}

function seedGame(fake: ReturnType<typeof makePrismaFake>, sportId: string, overrides: Partial<any> = {}): any {
  const game = {
    id: `game-${fake.games.size + 1}`,
    sportId,
    name: 'Match Winner',
    slug: `match-winner-${fake.games.size + 1}`,
    description: null,
    status: 'ACTIVE',
    sortOrder: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  fake.games.set(game.id, game);
  return game;
}

function seedCompetition(fake: ReturnType<typeof makePrismaFake>, overrides: Partial<any> = {}): any {
  const competition = {
    id: `comp-${fake.competitions.size + 1}`,
    sportId: 's1',
    name: 'Premier League',
    slug: 'premier-league',
    country: null,
    status: 'ACTIVE',
    sortOrder: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  fake.competitions.set(competition.id, competition);
  return competition;
}

describe('SportsService — public catalog', () => {
  it('lists only active sports', async () => {
    const fake = makePrismaFake();
    seedSport(fake, { id: 's1', slug: 'football', status: 'ACTIVE' });
    seedSport(fake, { id: 's2', slug: 'archery', status: 'INACTIVE' });
    const service = new SportsService(fake.prisma);

    const result = await service.listSports();

    expect(result.map((s) => s.slug)).toEqual(['football']);
  });

  it('returns an active sport with its active games', async () => {
    const fake = makePrismaFake();
    seedSport(fake, { id: 's1', slug: 'football' });
    seedGame(fake, 's1', { slug: 'winner' });
    seedGame(fake, 's1', { slug: 'retired', status: 'INACTIVE' });
    const service = new SportsService(fake.prisma);

    const sport = await service.getSportBySlug('football');

    expect(sport.slug).toBe('football');
    expect(sport.games.map((g) => g.slug)).toEqual(['winner']);
  });

  it('hides an inactive sport from the public API', async () => {
    const fake = makePrismaFake();
    seedSport(fake, { id: 's1', slug: 'football', status: 'INACTIVE' });
    const service = new SportsService(fake.prisma);

    await expect(service.getSportBySlug('football')).rejects.toThrow(NotFoundException);
  });

  it('hides an inactive game from the public API', async () => {
    const fake = makePrismaFake();
    seedGame(fake, 's1', { id: 'g1', slug: 'hidden', status: 'INACTIVE' });
    const service = new SportsService(fake.prisma);

    await expect(service.getGameBySlug('hidden')).rejects.toThrow(NotFoundException);
  });
});

describe('SportsService — competitions', () => {
  it('lists active competitions for football (Premier League, Champions League)', async () => {
    const fake = makePrismaFake();
    seedSport(fake, { id: 's1', slug: 'football' });
    seedCompetition(fake, { id: 'c1', sportId: 's1', slug: 'premier-league', sortOrder: 1 });
    seedCompetition(fake, { id: 'c2', sportId: 's1', slug: 'champions-league', sortOrder: 2 });
    seedCompetition(fake, {
      id: 'c3', sportId: 's1', slug: 'retired-cup', status: 'INACTIVE', sortOrder: 3,
    });
    const service = new SportsService(fake.prisma);

    const result = await service.listCompetitions('football');

    expect(result.map((c) => c.slug)).toEqual(['premier-league', 'champions-league']);
  });

  it('lists active competitions for cricket (IPL, BPL, PSL)', async () => {
    const fake = makePrismaFake();
    seedSport(fake, { id: 's2', slug: 'cricket' });
    (['ipl', 'bpl', 'psl'] as const).forEach((slug, i) => {
      seedCompetition(fake, { id: `c-cricket-${i}`, sportId: 's2', slug, sortOrder: i + 1 });
    });
    const service = new SportsService(fake.prisma);

    const result = await service.listCompetitions('cricket');

    expect(result.map((c) => c.slug)).toEqual(['ipl', 'bpl', 'psl']);
  });

  it('hides competitions for an inactive sport', async () => {
    const fake = makePrismaFake();
    seedSport(fake, { id: 's1', slug: 'football', status: 'INACTIVE' });
    const service = new SportsService(fake.prisma);

    await expect(service.listCompetitions('football')).rejects.toThrow(NotFoundException);
  });
});

describe('SportsService — admin games validation', () => {
  const dto = { sportId: 's1', name: 'Winner', slug: 'winner' };

  it('rejects a game with an invalid sportId', async () => {
    const fake = makePrismaFake();
    const service = new SportsService(fake.prisma);

    await expect(
      service.adminCreateGame(admin, { ...dto, sportId: 'nope' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a duplicate game slug', async () => {
    const fake = makePrismaFake();
    seedSport(fake, { id: 's1' });
    seedGame(fake, 's1', { slug: 'winner' });
    const service = new SportsService(fake.prisma);

    await expect(
      service.adminCreateGame(admin, { ...dto, sportId: 's1', slug: 'winner' }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects a duplicate sport slug', async () => {
    const fake = makePrismaFake();
    seedSport(fake, { id: 's1', slug: 'football' });
    const service = new SportsService(fake.prisma);

    await expect(
      service.adminCreateSport(admin, { name: 'Other', slug: 'football' }),
    ).rejects.toThrow(ConflictException);
  });
});

describe('SportsService — gambling availability', () => {
  function seedActiveMappingGame(fake: ReturnType<typeof makePrismaFake>, mappingStatus = 'ACTIVE') {
    seedSport(fake, { id: 's1' });
    seedGame(fake, 's1', { id: 'g1', slug: 'winner' });
    fake.mappings.set('g1', {
      id: 'm1', gameId: 'g1', providerName: 'mock-operator', externalGameId: 'ext-1', status: mappingStatus,
    });
  }

  it('keeps a non-gambling game non-gambling by default', async () => {
    const fake = makePrismaFake();
    seedSport(fake, { id: 's1' });
    const game = seedGame(fake, 's1', { id: 'g1', slug: 'casual' });
    const service = new SportsService(fake.prisma);

    const result = await service.getGameBySlug(game.slug);

    expect(result.availability).toEqual({ gamblingEnabled: false, gamblingAvailable: false });
  });

  it('accepts enabling gambling with an active mapping on an active game', async () => {
    const fake = makePrismaFake();
    seedActiveMappingGame(fake, 'ACTIVE');
    const service = new SportsService(fake.prisma);

    const result = await service.adminUpdateAvailability(admin, 'g1', { gamblingEnabled: true });

    expect(result.availability?.gamblingAvailable).toBe(true);
    expect(result.providerName).toBe('mock-operator');
  });

  it('rejects enabling gambling without a provider mapping', async () => {
    const fake = makePrismaFake();
    seedSport(fake, { id: 's1' });
    seedGame(fake, 's1', { id: 'g1', slug: 'winner' });
    const service = new SportsService(fake.prisma);

    await expect(
      service.adminUpdateAvailability(admin, 'g1', { gamblingEnabled: true }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects enabling gambling when the provider mapping is inactive', async () => {
    const fake = makePrismaFake();
    seedActiveMappingGame(fake, 'INACTIVE');
    const service = new SportsService(fake.prisma);

    await expect(
      service.adminUpdateAvailability(admin, 'g1', { gamblingEnabled: true }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects enabling gambling on an inactive game', async () => {
    const fake = makePrismaFake();
    seedActiveMappingGame(fake, 'ACTIVE');
    fake.games.get('g1').status = 'INACTIVE';
    const service = new SportsService(fake.prisma);

    await expect(
      service.adminUpdateAvailability(admin, 'g1', { gamblingEnabled: true }),
    ).rejects.toThrow(BadRequestException);
  });

  it('an inactive mapping does not make a gambling-enabled game available', async () => {
    const fake = makePrismaFake();
    seedActiveMappingGame(fake, 'INACTIVE');
    fake.availabilities.set('g1', { id: 'a1', gameId: 'g1', gamblingEnabled: true });
    const service = new SportsService(fake.prisma);

    const result = await service.getGameBySlug('winner');

    expect(result.availability?.gamblingEnabled).toBe(true);
    expect(result.availability?.gamblingAvailable).toBe(false);
    expect(result.providerName).toBeNull();
  });
});

describe('Authorization — admin catalog routes', () => {
  const guard = new RolesGuard(new Reflector());

  function canActivate(
    handler: string,
    controller: any,
    roles: string[],
    permissions: string[] = [],
  ): boolean {
    return guard.canActivate({
      getHandler: () => Object.getOwnPropertyDescriptor(controller.prototype, handler)!.value,
      getClass: () => controller,
      switchToHttp: () => ({
        getRequest: () => ({ user: { roles, sessionKind: 'STAFF', permissions } }),
      }),
    } as any);
  }

  it('normal users cannot modify sports, games or gambling availability', () => {
    const controller = AdminSportsController;
    for (const handler of ['createSport', 'updateSport', 'deleteSport', 'createGame', 'updateGame', 'deleteGame', 'updateAvailability', 'upsertProviderMapping']) {
      expect(() => canActivate(handler, controller, ['USER'])).toThrow(ForbiddenException);
    }
  });

  it('admins can modify the catalog', () => {
    const controller = AdminSportsController;
    expect(
      canActivate(
        'updateAvailability',
        controller,
        ['ADMIN'],
        [ADMIN_PERMISSIONS.SPORTS_READ, ADMIN_PERMISSIONS.SPORTS_MANAGE],
      ),
    ).toBe(true);
    expect(
      canActivate(
        'createSport',
        controller,
        ['SUPER_ADMIN'],
        [ADMIN_PERMISSIONS.SPORTS_READ, ADMIN_PERMISSIONS.SPORTS_MANAGE],
      ),
    ).toBe(true);
  });

  it('public sports routes require no role', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SportsController.prototype.listSports)).toBeUndefined();
  });
});

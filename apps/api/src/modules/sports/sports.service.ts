import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import type {
  AdminGame,
  PublicCompetition,
  PublicGame,
  PublicSport,
  SportWithGames,
} from '@tanvion-royale/types';
import type {
  CreateGameDto,
  CreateSportDto,
  UpdateGameAvailabilityDto,
  UpdateGameDto,
  UpdateSportDto,
  UpsertProviderMappingDto,
} from './dto/sports.dto';

/** Internal shape of a game row with relations as loaded by Prisma. */
interface GameRow {
  id: string;
  sportId: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  availability: { gamblingEnabled: boolean } | null;
  providerMapping: {
    id: string;
    providerName: string;
    externalGameId: string;
    status: string;
  } | null;
}

interface SportRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  status: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

interface CompetitionRow {
  id: string;
  sportId: string;
  name: string;
  slug: string;
  country: string | null;
  status: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const gameInclude = { include: { availability: true, providerMapping: true } } as const;

/**
 * Gambling is exposed to users ONLY when ALL of the following hold:
 *  - the game itself is ACTIVE (checked by the caller/query), AND
 *  - an admin explicitly enabled gambling on the game, AND
 *  - an ACTIVE provider mapping exists.
 * The frontend never decides this â€” the API computes `gamblingAvailable`.
 */
function isGamblingAvailable(game: GameRow): boolean {
  return (
    game.status === 'ACTIVE' &&
    game.availability?.gamblingEnabled === true &&
    game.providerMapping?.status === 'ACTIVE'
  );
}

function toPublicGame(game: GameRow): PublicGame {
  const gamblingAvailable = isGamblingAvailable(game);
  return {
    id: game.id,
    sportId: game.sportId,
    name: game.name,
    slug: game.slug,
    description: game.description,
    status: game.status as PublicGame['status'],
    sortOrder: game.sortOrder,
    createdAt: game.createdAt.toISOString(),
    updatedAt: game.updatedAt.toISOString(),
    availability: {
      gamblingEnabled: game.availability?.gamblingEnabled ?? false,
      gamblingAvailable,
    },
    providerName: gamblingAvailable ? game.providerMapping?.providerName ?? null : null,
  };
}

function toAdminGame(game: GameRow): AdminGame {
  return {
    ...toPublicGame(game),
    providerMapping: game.providerMapping
      ? {
          id: game.providerMapping.id,
          providerName: game.providerMapping.providerName,
          externalGameId: game.providerMapping.externalGameId,
          status: game.providerMapping.status as 'ACTIVE' | 'INACTIVE',
        }
      : null,
  };
}

function toPublicSport(sport: SportRow): PublicSport {
  return {
    id: sport.id,
    name: sport.name,
    slug: sport.slug,
    description: sport.description,
    icon: sport.icon,
    status: sport.status as PublicSport['status'],
    sortOrder: sport.sortOrder,
    createdAt: sport.createdAt.toISOString(),
    updatedAt: sport.updatedAt.toISOString(),
  };
}

function toPublicCompetition(competition: CompetitionRow): PublicCompetition {
  return {
    id: competition.id,
    sportId: competition.sportId,
    name: competition.name,
    slug: competition.slug,
    country: competition.country,
    status: competition.status as PublicCompetition['status'],
    sortOrder: competition.sortOrder,
  };
}

@Injectable()
export class SportsService {
  private readonly logger = new Logger(SportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // --------------------------------------------------------------------------
  // Public catalog (active content only)
  // --------------------------------------------------------------------------

  async listSports(): Promise<PublicSport[]> {
    const sports = await this.prisma.sport.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return sports.map(toPublicSport);
  }

  async getSportBySlug(slug: string): Promise<SportWithGames> {
    const sport = await this.prisma.sport.findUnique({
      where: { slug },
      include: {
        games: {
          where: { status: 'ACTIVE' },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: { availability: true, providerMapping: true },
        },
      },
    });
    // Inactive or missing sports look identical to the public: not found.
    if (!sport || sport.status !== 'ACTIVE') {
      throw new NotFoundException('Sport not found');
    }
    return {
      ...toPublicSport(sport),
      games: (sport.games as unknown as GameRow[]).map(toPublicGame),
    };
  }

  async getSportGames(slug: string): Promise<PublicGame[]> {
    return (await this.getSportBySlug(slug)).games;
  }

  async listCompetitions(slug: string): Promise<PublicCompetition[]> {
    const sport = await this.prisma.sport.findUnique({
      where: { slug },
      include: {
        competitions: {
          where: { status: 'ACTIVE' },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        },
      },
    });
    if (!sport || sport.status !== 'ACTIVE') {
      throw new NotFoundException('Sport not found');
    }
    return (sport.competitions as unknown as CompetitionRow[]).map(toPublicCompetition);
  }

  async getGameBySlug(slug: string): Promise<PublicGame> {
    const game = await this.prisma.game.findUnique({
      where: { slug },
      ...gameInclude,
    });
    if (!game || game.status !== 'ACTIVE') {
      throw new NotFoundException('Game not found');
    }
    return toPublicGame(game as unknown as GameRow);
  }

  // --------------------------------------------------------------------------
  // Admin: sports
  // --------------------------------------------------------------------------

  async adminCreateSport(
    actor: AuthenticatedUser,
    dto: CreateSportDto,
    ip?: string,
    userAgent?: string,
  ): Promise<PublicSport> {
    const existing = await this.prisma.sport.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException('A sport with this slug already exists');

    const sport = await this.prisma.sport.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        description: dto.description,
        icon: dto.icon,
        status: dto.status ?? 'ACTIVE',
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.audit(actor.id, 'ADMIN_SPORT_CREATED', 'Sport', sport.id, null, sport as unknown as Record<string, unknown>, ip, userAgent);
    return toPublicSport(sport);
  }

  async adminUpdateSport(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateSportDto,
    ip?: string,
    userAgent?: string,
  ): Promise<PublicSport> {
    const sport = await this.prisma.sport.findUnique({ where: { id } });
    if (!sport) throw new NotFoundException('Sport not found');

    if (dto.slug && dto.slug !== sport.slug) {
      const clash = await this.prisma.sport.findUnique({ where: { slug: dto.slug } });
      if (clash) throw new ConflictException('A sport with this slug already exists');
    }

    const data: Prisma.SportUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.slug !== undefined) data.slug = dto.slug;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.icon !== undefined) data.icon = dto.icon;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;

    const updated = await this.prisma.sport.update({ where: { id }, data });
    await this.audit(actor.id, 'ADMIN_SPORT_UPDATED', 'Sport', id, sport as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>, ip, userAgent);
    return toPublicSport(updated);
  }

  async adminDeleteSport(
    actor: AuthenticatedUser,
    id: string,
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
    const sport = await this.prisma.sport.findUnique({ where: { id } });
    if (!sport) throw new NotFoundException('Sport not found');
    await this.prisma.sport.delete({ where: { id } });
    await this.audit(actor.id, 'ADMIN_SPORT_DELETED', 'Sport', id, sport as unknown as Record<string, unknown>, null, ip, userAgent);
  }
  // --------------------------------------------------------------------------
  // Admin: games
  // --------------------------------------------------------------------------

  async adminCreateGame(
    actor: AuthenticatedUser,
    dto: CreateGameDto,
    ip?: string,
    userAgent?: string,
  ): Promise<AdminGame> {
    const sport = await this.prisma.sport.findUnique({ where: { id: dto.sportId } });
    if (!sport) throw new BadRequestException('sportId does not reference an existing sport');

    const existing = await this.prisma.game.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException('A game with this slug already exists');

    const game = await this.prisma.game.create({
      data: {
        sportId: dto.sportId,
        name: dto.name,
        slug: dto.slug,
        description: dto.description,
        status: dto.status ?? 'ACTIVE',
        sortOrder: dto.sortOrder ?? 0,
      },
      ...gameInclude,
    });
    await this.audit(actor.id, 'ADMIN_GAME_CREATED', 'Game', game.id, null, game as unknown as Record<string, unknown>, ip, userAgent);
    return toAdminGame(game as unknown as GameRow);
  }

  async adminUpdateGame(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateGameDto,
    ip?: string,
    userAgent?: string,
  ): Promise<AdminGame> {
    const game = await this.prisma.game.findUnique({ where: { id } });
    if (!game) throw new NotFoundException('Game not found');

    if (dto.sportId) {
      const sport = await this.prisma.sport.findUnique({ where: { id: dto.sportId } });
      if (!sport) throw new BadRequestException('sportId does not reference an existing sport');
    }

    if (dto.slug && dto.slug !== game.slug) {
      const clash = await this.prisma.game.findUnique({ where: { slug: dto.slug } });
      if (clash) throw new ConflictException('A game with this slug already exists');
    }

    const data: Prisma.GameUpdateInput = {};
    if (dto.sportId !== undefined) data.sport = { connect: { id: dto.sportId } };
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.slug !== undefined) data.slug = dto.slug;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;

    const updated = await this.prisma.game.update({ where: { id }, data, ...gameInclude });
    await this.audit(actor.id, 'ADMIN_GAME_UPDATED', 'Game', id, game as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>, ip, userAgent);
    return toAdminGame(updated as unknown as GameRow);
  }

  async adminDeleteGame(
    actor: AuthenticatedUser,
    id: string,
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
    const game = await this.prisma.game.findUnique({ where: { id } });
    if (!game) throw new NotFoundException('Game not found');
    await this.prisma.game.delete({ where: { id } });
    await this.audit(actor.id, 'ADMIN_GAME_DELETED', 'Game', id, game as unknown as Record<string, unknown>, null, ip, userAgent);
  }

  // --------------------------------------------------------------------------
  // Admin: gambling availability (server-side enforcement — never trust the UI)
  // --------------------------------------------------------------------------

  async adminUpdateAvailability(
    actor: AuthenticatedUser,
    gameId: string,
    dto: UpdateGameAvailabilityDto,
    ip?: string,
    userAgent?: string,
  ): Promise<AdminGame> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      ...gameInclude,
    });
    if (!game) throw new NotFoundException('Game not found');
    const row = game as unknown as GameRow;

    if (dto.gamblingEnabled) {
      if (row.status !== 'ACTIVE') {
        throw new BadRequestException('An inactive game cannot be enabled for gambling');
      }
      if (!row.providerMapping) {
        throw new BadRequestException('Gambling requires an active provider mapping for this game');
      }
      if (row.providerMapping.status !== 'ACTIVE') {
        throw new BadRequestException('The provider mapping for this game is not active');
      }
    }

    const availability = await this.prisma.gameAvailability.upsert({
      where: { gameId },
      update: { gamblingEnabled: dto.gamblingEnabled },
      create: { gameId, gamblingEnabled: dto.gamblingEnabled },
    });

    await this.audit(
      actor.id,
      'ADMIN_GAME_AVAILABILITY_UPDATED',
      'Game',
      gameId,
      { gamblingEnabled: row.availability?.gamblingEnabled ?? false },
      { gamblingEnabled: availability.gamblingEnabled },
      ip,
      userAgent,
    );

    const refreshed = (await this.prisma.game.findUnique({
      where: { id: gameId },
      ...gameInclude,
    })) as unknown as GameRow;
    return toAdminGame(refreshed);
  }

  async adminUpsertProviderMapping(
    actor: AuthenticatedUser,
    gameId: string,
    dto: UpsertProviderMappingDto,
    ip?: string,
    userAgent?: string,
  ): Promise<AdminGame> {
    const game = await this.prisma.game.findUnique({ where: { id: gameId } });
    if (!game) throw new NotFoundException('Game not found');

    const mapping = await this.prisma.providerMapping.upsert({
      where: { gameId },
      update: {
        providerName: dto.providerName,
        externalGameId: dto.externalGameId,
        status: dto.status ?? 'ACTIVE',
      },
      create: {
        gameId,
        providerName: dto.providerName,
        externalGameId: dto.externalGameId,
        status: dto.status ?? 'ACTIVE',
      },
    });

    // If the mapping became inactive, gambling is no longer available.
    if (mapping.status !== 'ACTIVE') {
      await this.prisma.gameAvailability.updateMany({
        where: { gameId, gamblingEnabled: true },
        data: { gamblingEnabled: false },
      });
    }

    await this.audit(actor.id, 'ADMIN_PROVIDER_MAPPING_UPSERTED', 'Game', gameId, null, mapping as unknown as Record<string, unknown>, ip, userAgent);

    const refreshed = (await this.prisma.game.findUnique({
      where: { id: gameId },
      ...gameInclude,
    })) as unknown as GameRow;
    return toAdminGame(refreshed);
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private async audit(
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    oldValue: Record<string, unknown> | null,
    newValue: Record<string, unknown> | null,
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId,
          actorType: 'ADMIN',
          action,
          entityType,
          entityId,
          oldValue: oldValue === null ? Prisma.JsonNull : (oldValue as Prisma.InputJsonValue),
          newValue: newValue === null ? Prisma.JsonNull : (newValue as Prisma.InputJsonValue),
          ip,
          userAgent,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to write audit log ${action}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
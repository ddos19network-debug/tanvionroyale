import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  OperatorProviderInterface,
  ProviderCompetition,
  ProviderEvent,
  ProviderOdd,
  ProviderSport,
} from '@tanvion-royale/integrations';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { SPORTS_PROVIDER } from './sports-provider.token';

export interface SyncSummary {
  sports: number;
  competitions: number;
  events: number;
  markets: number;
  selections: number;
  odds: number;
  errors: string[];
}

interface PartnerSyncRow {
  id: string;
  name: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function mapEventStatus(status: string): 'SCHEDULED' | 'LIVE' | 'SUSPENDED' | 'FINISHED' | 'CANCELLED' {
  switch (status) {
    case 'LIVE':
      return 'LIVE';
    case 'FINISHED':
      return 'FINISHED';
    case 'SUSPENDED':
      return 'SUSPENDED';
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      return 'SCHEDULED';
  }
}

function mapMarketStatus(odds: ProviderOdd[]): 'OPEN' | 'SUSPENDED' | 'CLOSED' {
  if (odds.some((o) => o.status === 'OPEN')) return 'OPEN';
  if (odds.some((o) => o.status === 'SUSPENDED')) return 'SUSPENDED';
  return 'CLOSED';
}

/**
 * Phase 16 - sports/competitions/events sync from the configured operator/partner
 * provider into the TANVIONROYALE database. In production without a real provider,
 * the injected adapter fails safely so sync marks the provider row ERROR and
 * never fabricates sports/events/odds.
 */
@Injectable()
export class SportsSyncService {
  private readonly logger = new Logger(SportsSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SPORTS_PROVIDER) private readonly provider: OperatorProviderInterface,
  ) {}

  async syncAll(
    providerId?: string,
    _actor?: AuthenticatedUser,
    _ip?: string,
    _userAgent?: string,
  ): Promise<SyncSummary> {
    /**
     * Only rows that actually expose a SERVER-SIDE sports API are synced:
     * a NULL integrationType (every pre-existing row) and SPORTS_API. An
     * EMBEDDED sportsbook (SPORTS_IFRAME, e.g. WinHouse) hosts its own book and
     * has no sports/odds API of ours to import, so it is never asked for data
     * and never ends up with a fabricated catalog or a spurious sync ERROR.
     */
    const syncable: Prisma.PartnerProviderWhereInput = {
      OR: [{ integrationType: null }, { integrationType: 'SPORTS_API' }],
    };
    const where: Prisma.PartnerProviderWhereInput = providerId
      ? { id: providerId, ...syncable }
      : { status: 'ACTIVE', ...syncable };
    const providers = await this.prisma.partnerProvider.findMany({ where });
    const summary: SyncSummary = {
      sports: 0,
      competitions: 0,
      events: 0,
      markets: 0,
      selections: 0,
      odds: 0,
      errors: [],
    };
    for (const row of providers) {
      await this.syncOne(row as unknown as PartnerSyncRow, summary);
    }
    // An explicitly requested embedded provider reports honestly instead of
    // silently doing nothing.
    if (providerId && providers.length === 0) {
      const requested = await this.prisma.partnerProvider.findUnique({
        where: { id: providerId },
        select: { name: true, integrationType: true },
      });
      if (requested && requested.integrationType === 'SPORTS_IFRAME') {
        summary.errors.push(
          `Provider "${requested.name}" is an embedded (iframe) sportsbook: it serves its own book and has no sports API to sync.`,
        );
      }
    }
    return summary;
  }

  private async syncOne(row: PartnerSyncRow, summary: SyncSummary): Promise<void> {
    try {
      await this.prisma.partnerProvider.update({
        where: { id: row.id },
        data: { syncStatus: 'SYNCING' },
      });
      await this.provider.authenticate();
      const [providerSports, providerCompetitions, providerEvents] = await Promise.all([
        this.provider.getSports(),
        this.provider.getCompetitions(),
        this.provider.getEvents(),
      ]);

      for (const ps of providerSports) {
        if (!ps.active) continue;
        const sport = await this.ensureSport(ps, row.name);
        summary.sports += 1;
        const game = await this.ensurePartnerGame(sport, ps, row.name);

        const comps = providerCompetitions.filter((c) => c.sport.externalId === ps.externalId);
        for (const comp of comps) {
          await this.ensureCompetition(comp, sport);
          summary.competitions += 1;
        }

        const events = providerEvents.filter((e) => e.competition.sport.externalId === ps.externalId);
        for (const pe of events) {
          await this.ensureEvent(pe, game, sport, row);
          summary.events += 1;
          await this.syncEventDetail(pe, row, summary);
        }
      }

      await this.prisma.partnerProvider.update({
        where: { id: row.id },
        data: { syncStatus: 'OK', lastSyncAt: new Date(), lastSyncError: null },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const trimmed = message.length > 500 ? `${message.slice(0, 500)}...` : message;
      this.logger.warn(`Sports sync failed (provider=${row.name}): ${trimmed}`);
      await this.prisma.partnerProvider
        .update({
          where: { id: row.id },
          data: { syncStatus: 'ERROR', lastSyncError: trimmed },
        })
        .catch(() => undefined);
      summary.errors.push(trimmed);
    }
  }

  private async ensureSport(ps: ProviderSport, providerName: string) {
    const slug = slugify(ps.name);
    const existing = await this.prisma.sport.findUnique({ where: { slug } });
    if (existing) return existing;
    return this.prisma.sport.create({
      data: {
        name: ps.name,
        slug,
        description: `Provider sport (${providerName})`,
        status: 'ACTIVE',
        sortOrder: 0,
      },
    });
  }

  private async ensurePartnerGame(sport: { id: string }, ps: ProviderSport, providerName: string) {
    const slug = `${slugify(ps.name)}-partner`;
    const game = await this.prisma.game.upsert({
      where: { slug },
      update: {
        sportId: sport.id,
        name: `${ps.name} Partner`,
        description: `Official partner sports feed (${providerName})`,
        status: 'ACTIVE',
      },
      create: {
        sportId: sport.id,
        name: `${ps.name} Partner`,
        slug,
        description: `Official partner sports feed (${providerName})`,
        status: 'ACTIVE',
        sortOrder: 100,
      },
    });
    await this.prisma.gameAvailability.upsert({
      where: { gameId: game.id },
      update: { gamblingEnabled: true },
      create: { gameId: game.id, gamblingEnabled: true },
    });
    await this.prisma.providerMapping.upsert({
      where: { gameId: game.id },
      update: { providerName, externalGameId: ps.externalId, status: 'ACTIVE' },
      create: { gameId: game.id, providerName, externalGameId: ps.externalId, status: 'ACTIVE' },
    });
    return game;
  }

  private async ensureCompetition(comp: ProviderCompetition, sport: { id: string }) {
    const slug = slugify(comp.name);
    return this.prisma.competition.upsert({
      where: { sportId_slug: { sportId: sport.id, slug } },
      update: { name: comp.name, country: comp.country ?? null, status: 'ACTIVE' },
      create: {
        sportId: sport.id,
        name: comp.name,
        slug,
        country: comp.country ?? null,
        status: 'ACTIVE',
        sortOrder: 0,
      },
    });
  }

  private async ensureEvent(
    pe: ProviderEvent,
    game: { id: string },
    sport: { id: string },
    providerRow: { id: string },
  ) {
    let competition: { id: string } | null = null;
    if (pe.competition) {
      competition = await this.ensureCompetition(pe.competition, sport);
    }
    const name = pe.homeName && pe.awayName ? `${pe.homeName} v ${pe.awayName}` : `Match ${pe.externalId}`;
    const eventStatus = mapEventStatus(pe.status);
    const live = pe.status === 'LIVE' || pe.live;
    return this.prisma.event.upsert({
      where: { gameId_providerEventId: { gameId: game.id, providerEventId: pe.externalId } },
      update: {
        name,
        competitionId: competition?.id ?? null,
        homeName: pe.homeName ?? null,
        awayName: pe.awayName ?? null,
        startTime: new Date(pe.kicksOffAt),
        status: eventStatus,
        live,
        bettingMode: 'PARTNER',
        externalEventId: pe.externalId,
        partnerProviderId: providerRow.id,
      },
      create: {
        gameId: game.id,
        providerEventId: pe.externalId,
        name,
        competitionId: competition?.id ?? null,
        homeName: pe.homeName ?? null,
        awayName: pe.awayName ?? null,
        startTime: new Date(pe.kicksOffAt),
        status: eventStatus,
        live,
        bettingMode: 'PARTNER',
        externalEventId: pe.externalId,
        partnerProviderId: providerRow.id,
      },
    });
  }

  private async syncEventDetail(
    pe: ProviderEvent,
    providerRow: { id: string; name: string },
    summary: SyncSummary,
  ): Promise<void> {
    const dbEvent = await this.prisma.event.findFirst({
      where: { partnerProviderId: providerRow.id, externalEventId: pe.externalId },
      select: { id: true },
    });
    if (!dbEvent) return;

    const providerMarkets = await this.provider.getMarkets(pe.externalId);
    const seenMarkets = new Set<string>();
    for (const pm of providerMarkets) {
      if (seenMarkets.has(pm.externalId)) continue;
      seenMarkets.add(pm.externalId);

      const oddsForMarket = await this.provider.getOdds(pm.externalId);
      const marketStatus = mapMarketStatus(oddsForMarket);
      const market = await this.prisma.market.upsert({
        where: { eventId_name: { eventId: dbEvent.id, name: pm.name } },
        update: { status: marketStatus },
        create: { eventId: dbEvent.id, name: pm.name, status: marketStatus },
      });
      summary.markets += 1;

      const providerSelections = await this.provider.getSelections(pm.externalId);
      const seenSelections = new Set<string>();
      for (const psSel of providerSelections) {
        if (seenSelections.has(psSel.externalId)) continue;
        seenSelections.add(psSel.externalId);

        const oddRow = oddsForMarket.find((o) => o.selection.externalId === psSel.externalId) ?? null;
        const selectionStatus = oddRow && oddRow.status === 'OPEN' ? 'ACTIVE' : 'INACTIVE';
        const selection = await this.prisma.selection.upsert({
          where: {
            marketId_providerSelectionId: { marketId: market.id, providerSelectionId: psSel.externalId },
          },
          update: { name: psSel.name, status: selectionStatus },
          create: {
            marketId: market.id,
            name: psSel.name,
            providerSelectionId: psSel.externalId,
            status: selectionStatus,
          },
        });
        summary.selections += 1;

        if (oddRow && oddRow.decimal) {
          const existingOdd = await this.prisma.odds.findUnique({ where: { selectionId: selection.id } });
          if (!existingOdd) {
            await this.prisma.odds.create({
              data: { selectionId: selection.id, price: oddRow.decimal, oddsVersion: 1 },
            });
            summary.odds += 1;
          } else if (existingOdd.price !== oddRow.decimal) {
            await this.prisma.odds.update({
              where: { selectionId: selection.id },
              data: { price: oddRow.decimal, oddsVersion: existingOdd.oddsVersion + 1 },
            });
            summary.odds += 1;
          }
        }
      }
    }
  }
}
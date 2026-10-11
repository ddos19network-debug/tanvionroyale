import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OperatorError, type OperatorProviderInterface } from '@tanvion-royale/integrations';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import type {
  BetSelectionView,
  BetView,
  PlaceBetResponse,
  PublicEvent,
  PublicEventDetail,
  PublicMarket,
  PublicSelection,
} from '@tanvion-royale/types';
import type { PlaceBetDto } from './dto/place-bet.dto';
import type { BetsStatusFilter } from './dto/list-bets-query.dto';
import { bettingError } from './betting-errors';
import { isWalletError } from '../wallet/wallet-errors';
import { loadBettingConfig, type BettingConfig } from './betting.config';
import { calculatePotentialReturn } from './odds.util';
import { BETTING_PROVIDER } from './provider.token';
import { WALLET_SERVICE, type WalletServiceInterface } from './wallet.service';

/** Statuses still visible on the public event board. */
const DISPLAYABLE_EVENT_STATUSES = ['SCHEDULED', 'LIVE', 'SUSPENDED'] as const;
/** Statuses an event must be in before a bet may be placed. */
const BETTABLE_EVENT_STATUSES = ['SCHEDULED', 'LIVE'] as const;

interface GameAvailabilityContext {
  id: string;
  status: string;
  availability: { gamblingEnabled: boolean } | null;
  providerMapping: { providerName: string; status: string } | null;
  sport: { status: string; slug: string } | null;
}
interface EventRow {
  id: string;
  gameId: string;
  providerEventId: string;
  name: string;
  startTime: Date;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  competitionId: string | null;
  competition: {
    id: string;
    sportId: string;
    name: string;
    slug: string;
    country: string | null;
    status: string;
    sortOrder: number;
    sport: { id: string; name: string; slug: string } | null;
  } | null;
  homeName: string | null;
  awayName: string | null;
  live: boolean;
  bettingMode: string;
  externalEventId: string | null;
  partnerProviderId: string | null;
  partnerProvider: { id: string; name: string; baseUrl: string; deepLinkTemplate: string; status: string } | null;
  game?: GameAvailabilityContext;
  markets?: MarketRow[];
}
interface MarketRow {
  id: string;
  eventId: string;
  name: string;
  status: string;
  selections?: SelectionRow[];
}
interface SelectionRow {
  id: string;
  marketId: string;
  name: string;
  providerSelectionId: string;
  status: string;
  odds: { price: string; oddsVersion: number; updatedAt: Date } | null;
}
interface BetRow {
  id: string;
  userId: string;
  type: string;
  status: string;
  stake: number;
  potentialPayout: number;
  currency: string;
  providerReference: string | null;
  idempotencyKey: string;
  result: string | null;
  settledAt: Date | null;
  payout: number | null;
  createdAt: Date;
  updatedAt: Date;
  selections: BetSelectionSnapshotRow[];
}
interface BetSelectionSnapshotRow {
  id: string;
  selectionId: string;
  eventName: string;
  marketName: string;
  selectionName: string;
  priceAtPlacement: string;
  oddsVersion: number;
  result: string | null;
  settledAt: Date | null;
}

/**
 * Betting may be offered ONLY when ALL relevant conditions hold (computed
 * server-side every time). Frontend visibility flags are never trusted.
 */
function isGamblingAvailable(game: GameAvailabilityContext | undefined): boolean {
  if (!game) return false;
  return (
    game.status === 'ACTIVE' &&
    game.availability?.gamblingEnabled === true &&
    game.providerMapping?.status === 'ACTIVE' &&
    game.sport?.status === 'ACTIVE'
  );
}

function isDisplayableEvent(event: EventRow): boolean {
  return (
    isGamblingAvailable(event.game) &&
    (DISPLAYABLE_EVENT_STATUSES as readonly string[]).includes(event.status)
  );
}

function isBettableEvent(event: EventRow): boolean {
  return (
    isGamblingAvailable(event.game) &&
    // PARTNER events are handled by the partner sportsbook — the TANVIONROYALE
    // bet slip must NEVER submit a bet for them.
    event.bettingMode !== 'PARTNER' &&
    (BETTABLE_EVENT_STATUSES as readonly string[]).includes(event.status)
  );
}

function toPublicEvent(event: EventRow): PublicEvent {
  const isPartner = event.bettingMode === 'PARTNER';
  const partnerActive = isPartner && event.partnerProvider?.status === 'ACTIVE';
  return {
    id: event.id,
    gameId: event.gameId,
    name: event.name,
    startTime: event.startTime.toISOString(),
    status: event.status as PublicEvent['status'],
    createdAt: event.createdAt.toISOString(),
    competition: event.competition
      ? {
          id: event.competition.id,
          sportId: event.competition.sportId,
          name: event.competition.name,
          slug: event.competition.slug,
          country: event.competition.country,
          status: event.competition.status as 'ACTIVE' | 'INACTIVE',
          sortOrder: event.competition.sortOrder,
        }
      : null,
    sport: event.competition?.sport
      ? {
          id: event.competition.sport.id,
          name: event.competition.sport.name,
          slug: event.competition.sport.slug,
        }
      : null,
    homeName: event.homeName ?? null,
    awayName: event.awayName ?? null,
    live: event.live,
    bettingMode: (event.bettingMode as PublicEvent['bettingMode']) ?? 'NATIVE',
    partner: partnerActive
      ? { id: event.partnerProvider!.id, name: event.partnerProvider!.name, available: true }
      : null,
  };
}

function selectionWithOdds(selection: SelectionRow): PublicSelection {
  return {
    id: selection.id,
    marketId: selection.marketId,
    name: selection.name,
    status: selection.status as PublicSelection['status'],
    odds:
      selection.odds && selection.status === 'ACTIVE'
        ? {
            price: selection.odds.price,
            oddsVersion: selection.odds.oddsVersion,
            updatedAt: selection.odds.updatedAt.toISOString(),
          }
        : null,
  };
}

function toPublicMarket(market: MarketRow): PublicMarket {
  return {
    id: market.id,
    eventId: market.eventId,
    name: market.name,
    status: market.status as PublicMarket['status'],
  };
}

function toPublicEventDetail(event: EventRow): PublicEventDetail {
  return {
    ...toPublicEvent(event),
    markets: (event.markets ?? []).map((market) => ({
      ...toPublicMarket(market),
      selections: (market.selections ?? []).map(selectionWithOdds),
    })),
  };
}

function toBetSelectionView(row: BetSelectionSnapshotRow): BetSelectionView {
  return {
    id: row.id,
    selectionId: row.selectionId,
    eventName: row.eventName,
    marketName: row.marketName,
    selectionName: row.selectionName,
    priceAtPlacement: row.priceAtPlacement,
    oddsVersion: row.oddsVersion,
    result: (row.result as BetSelectionView['result']) ?? null,
    settledAt: row.settledAt ? row.settledAt.toISOString() : null,
  };
}

function toBetView(bet: BetRow): BetView {
  return {
    id: bet.id,
    userId: bet.userId,
    type: bet.type as BetView['type'],
    status: bet.status as BetView['status'],
    stake: bet.stake,
    potentialPayout: bet.potentialPayout,
    currency: bet.currency,
    providerReference: bet.providerReference,
    result: (bet.result as BetView['result']) ?? null,
    settledAt: bet.settledAt ? bet.settledAt.toISOString() : null,
    payout: bet.payout ?? null,
    createdAt: bet.createdAt.toISOString(),
    updatedAt: bet.updatedAt.toISOString(),
    selections: bet.selections.map(toBetSelectionView),
  };
}

@Injectable()
export class BettingService {
  private readonly logger = new Logger(BettingService.name);
  private readonly config: BettingConfig = loadBettingConfig();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BETTING_PROVIDER) private readonly provider: OperatorProviderInterface,
    @Inject(WALLET_SERVICE) private readonly wallet: WalletServiceInterface,
  ) {}

  // --------------------------------------------------------------------------
  // Public: events / markets / selections / odds (gambling-available games only)
  // --------------------------------------------------------------------------

  async listEvents(status?: string, sport?: string, competition?: string): Promise<PublicEvent[]> {
    const where: Prisma.EventWhereInput = { status: { in: [...DISPLAYABLE_EVENT_STATUSES] } };
    if (status === 'LIVE') where.status = 'LIVE';
    if (status === 'UPCOMING') where.status = 'SCHEDULED';
    // Optional sport/competition scoping (used by the sports hub pages). Events
    // are always attached to a competition in the sportsbook model, so scoping
    // by sport/competition is a join on the competition row.
    if (sport || competition) {
      const competitionWhere: Prisma.CompetitionWhereInput = {};
      if (sport) competitionWhere.sport = { slug: sport };
      if (competition) competitionWhere.slug = competition;
      where.competition = { is: competitionWhere };
    }
    const events = await this.prisma.event.findMany({
      where,
      include: {
        game: { include: { availability: true, providerMapping: true, sport: true } },
        competition: { include: { sport: true } },
        partnerProvider: true,
      },
      orderBy: { startTime: 'asc' },
    });
    return (events as unknown as EventRow[]).filter(isDisplayableEvent).map(toPublicEvent);
  }

  async getEvent(id: string): Promise<PublicEventDetail> {
    await this.findViewableEvent(id);
    const detail = await this.prisma.event.findUnique({
      where: { id },
      include: {
        game: { include: { availability: true, providerMapping: true, sport: true } },
        competition: { include: { sport: true } },
        partnerProvider: true,
        markets: { include: { selections: { include: { odds: true } } } },
      },
    });
    if (!detail) throw new NotFoundException('Event not found');
    return toPublicEventDetail(detail as unknown as EventRow);
  }

  async listEventMarkets(id: string): Promise<PublicMarket[]> {
    await this.findViewableEvent(id);
    const markets = await this.prisma.market.findMany({
      where: { eventId: id },
      orderBy: { name: 'asc' },
    });
    return (markets as unknown as MarketRow[]).map(toPublicMarket);
  }

  async listMarketSelections(marketId: string): Promise<PublicSelection[]> {
    const market = await this.prisma.market.findUnique({
      where: { id: marketId },
      include: {
        event: { include: { game: { include: { availability: true, providerMapping: true, sport: true } } } },
      },
    });
    const row = market as unknown as (MarketRow & { event: EventRow }) | null;
    if (!row || !isDisplayableEvent(row.event)) throw new NotFoundException('Market not found');

    const selections = await this.prisma.selection.findMany({
      where: { marketId },
      include: { odds: true },
      orderBy: { name: 'asc' },
    });
    return (selections as unknown as SelectionRow[]).map(selectionWithOdds);
  }

  private async findViewableEvent(id: string): Promise<EventRow> {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        game: { include: { availability: true, providerMapping: true, sport: true } },
        competition: { include: { sport: true } },
        partnerProvider: true,
      },
    });
    const row = event as unknown as EventRow | null;
    if (!row || !isGamblingAvailable(row.game)) throw new NotFoundException('Event not found');
    return row;
  }

  // --------------------------------------------------------------------------
  // Partner event routing (server-side, allowlisted destination only)
  // --------------------------------------------------------------------------

  /**
   * Resolve the approved partner destination for a PARTNER event.
   *
   * Security: the destination is built ONLY from the allowlisted
   * PartnerProvider.baseUrl + deepLinkTemplate and the event's own
   * externalEventId. The client can never supply an arbitrary URL.
   */
  async getPartnerRedirect(
    eventId: string,
    auth?: AuthenticatedUser,
    ip?: string,
    userAgent?: string,
  ): Promise<{ url: string; provider: string; externalEventId: string }> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        game: { include: { availability: true, providerMapping: true, sport: true } },
        competition: { include: { sport: true } },
        partnerProvider: true,
      },
    });
    const row = event as unknown as EventRow | null;
    if (!row || !isGamblingAvailable(row.game)) {
      throw new NotFoundException('Event not found');
    }
    if (row.bettingMode !== 'PARTNER') {
      throw new NotFoundException('Event is not a partner event');
    }
    if (!row.partnerProvider || row.partnerProvider.status !== 'ACTIVE') {
      throw new NotFoundException('Partner provider is not active');
    }
    if (!row.externalEventId) {
      throw new NotFoundException('Partner event id is not configured');
    }

    // Build the deep link from the allowlisted template ONLY.
    const template = row.partnerProvider.deepLinkTemplate;
    const sportSlug = row.game?.sport?.slug ?? '';
    const url = template
      .replaceAll('{sportSlug}', encodeURIComponent(sportSlug))
      .replaceAll('{competitionSlug}', encodeURIComponent(row.competition?.slug ?? ''))
      .replaceAll('{externalEventId}', encodeURIComponent(row.externalEventId));

    // Validate the resolved URL stays on the allowlisted origin.
    const base = new URL(row.partnerProvider.baseUrl);
    const resolved = new URL(url, base);
    if (resolved.origin !== base.origin) {
      throw new NotFoundException('Partner destination is not allowlisted');
    }

    // Safe audit event (no secrets/credentials).
    await this.auditPartnerRedirect(eventId, row, auth, ip, userAgent);

    return {
      url: resolved.toString(),
      provider: row.partnerProvider.name,
      externalEventId: row.externalEventId,
    };
  }

  private async auditPartnerRedirect(
    eventId: string,
    event: EventRow,
    auth?: AuthenticatedUser,
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: auth?.id ?? null,
          actorType: auth ? 'USER' : 'SYSTEM',
          action: 'PARTNER_EVENT_REDIRECT',
          entityType: 'Event',
          entityId: eventId,
          oldValue: Prisma.JsonNull,
          newValue: {
            eventId,
            provider: event.partnerProvider?.name ?? null,
            externalEventId: event.externalEventId ?? null,
          } as Prisma.InputJsonValue,
          ip,
          userAgent,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to write partner redirect audit: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // --------------------------------------------------------------------------
  // Authenticated: my bets
  // --------------------------------------------------------------------------

  async listMyBets(
    auth: AuthenticatedUser,
    status?: BetsStatusFilter,
    options: { limit?: number; page?: number; search?: string; result?: string } = {},
  ): Promise<BetView[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const page = Math.max(options.page ?? 1, 1);
    const where: Prisma.BetWhereInput = { userId: auth.id };
    if (status && status !== 'ALL') where.status = status;
    if (options.result && options.result !== 'ALL') where.result = options.result as never;
    if (options.search && options.search.trim()) {
      const q = options.search.trim();
      const or: Prisma.BetWhereInput[] = [];
      if (q.length >= 8 && q.length <= 64) or.push({ id: q });
      or.push({ providerReference: { contains: q, mode: 'insensitive' } });
      or.push({ selections: { some: { eventName: { contains: q, mode: 'insensitive' } } } });
      or.push({ selections: { some: { selectionName: { contains: q, mode: 'insensitive' } } } });
      or.push({ selections: { some: { marketName: { contains: q, mode: 'insensitive' } } } });
      where.OR = or;
    }
    const bets = await this.prisma.bet.findMany({
      where,
      include: { selections: true },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return (bets as unknown as BetRow[]).map(toBetView);
  }

  async getMyBet(auth: AuthenticatedUser, betId: string): Promise<BetView> {
    const bet = await this.prisma.bet.findFirst({
      where: { id: betId, userId: auth.id },
      include: { selections: true },
    });
    if (!bet) throw new NotFoundException('Bet not found');
    return toBetView(bet as unknown as BetRow);
  }

  // --------------------------------------------------------------------------
  // Bet placement (all authoritative checks happen server-side)
  // --------------------------------------------------------------------------

  async placeBet(
    auth: AuthenticatedUser,
    dto: PlaceBetDto,
    ip?: string,
    userAgent?: string,
  ): Promise<PlaceBetResponse> {
    const currency = dto.currency ?? this.config.currency;
    if (currency !== this.config.currency) {
      bettingError('VALIDATION_ERROR', `Only ${this.config.currency} is supported at this time`, 400);
    }

    // 1. Idempotency: a retried request re-uses the existing bet.
    const existing = await this.prisma.bet.findUnique({
      where: {
        userId_idempotencyKey: { userId: auth.id, idempotencyKey: dto.idempotencyKey },
      },
      include: { selections: true },
    });
    if (existing) return { bet: toBetView(existing as unknown as BetRow), duplicate: true };

    // 2. User must exist and be active.
    const user = await this.prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) bettingError('UNAUTHORIZED', 'User not found', 401);
    if (user.status !== 'ACTIVE') bettingError('FORBIDDEN', 'Account is not active', 403);

    // 3. Stake limits (minor units).
    this.validateStake(dto.stake);

    // 4. Event availability (incl. gambling gating).
    const event = await this.findViewableEvent(dto.eventId);
    if (!isBettableEvent(event)) bettingError('EVENT_UNAVAILABLE', 'Event is not available for betting', 400);

    // 5. Market must be OPEN and belong to the event.
    const market = await this.prisma.market.findUnique({ where: { id: dto.marketId } });
    if (!market || market.eventId !== dto.eventId) bettingError('NOT_FOUND', 'Market not found', 404);
    if (market.status !== 'OPEN') bettingError('MARKET_SUSPENDED', 'This market is suspended', 400);

    // 6. Selection must be ACTIVE, in the market, with current odds.
    const selection = await this.prisma.selection.findUnique({
      where: { id: dto.selectionId },
      include: { odds: true },
    });
    if (!selection || selection.marketId !== dto.marketId) {
      bettingError('NOT_FOUND', 'Selection not found', 404);
    }
    if (selection.status !== 'ACTIVE') bettingError('SELECTION_UNAVAILABLE', 'Selection is not available', 400);
    const selectionRow = selection as unknown as SelectionRow;
    const currentOdds = selectionRow.odds;
    if (!currentOdds) bettingError('SELECTION_UNAVAILABLE', 'No odds are currently offered', 400);

    // 7. Odds-change guard: never silently accept odds the customer didn't see.
    if (currentOdds.price !== dto.requestedOdds) {
      bettingError('ODDS_CHANGED', 'Odds for this selection have changed', 409, {
        selectionId: dto.selectionId,
        previousOdds: dto.requestedOdds,
        currentOdds: currentOdds.price,
        oddsVersion: currentOdds.oddsVersion,
      });
    }

    // 8. Reserve the stake in the wallet (ledger-backed; locks the funds).
    // INSUFFICIENT_FUNDS from the wallet maps to the betting error surface.
    try {
      await this.wallet.reserveStake(auth.id, dto.stake, currency, dto.idempotencyKey);
    } catch (error) {
      if (isWalletError(error, 'INSUFFICIENT_FUNDS')) {
        bettingError('INSUFFICIENT_BALANCE', 'Insufficient balance for this stake', 400, {
          stake: dto.stake,
        });
      }
      throw error;
    }
    /** Best-effort release — a failed bet must never keep funds locked. */
    const releaseReservedStake = async (): Promise<void> => {
      try {
        await this.wallet.releaseStake(auth.id, dto.idempotencyKey);
      } catch (releaseError) {
        this.logger.warn(
          `Failed to release reserved stake ${dto.idempotencyKey}: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`,
        );
      }
    };

    // 9. Submit to the provider.
    let acceptedOdds: string;
    let providerReference: string;
    try {
      await this.provider.authenticate();
      const result = await this.provider.placeBet({
        accountRef: auth.id,
        type: 'SINGLE',
        stake: dto.stake,
        currency,
        selections: [
          {
            externalSelectionId: selectionRow.providerSelectionId,
            requestedDecimal: currentOdds.price,
          },
        ],
        idempotencyKey: dto.idempotencyKey,
      });

      if (result.status !== 'ACCEPTED') {
        await releaseReservedStake();
        bettingError('BET_REJECTED', `Provider did not accept the bet (${result.status})`, 400);
      }
      acceptedOdds = result.acceptedOdds ?? currentOdds.price;
      providerReference = result.externalBetId;
    } catch (error) {
      // Any provider failure releases the reserved stake — no money is lost.
      await releaseReservedStake();
      if (error instanceof OperatorError) {
        switch (error.code) {
          case 'ODDS_CHANGED':
            bettingError('ODDS_CHANGED', 'Odds changed during placement', 409, {
              selectionId: dto.selectionId,
              previousOdds: dto.requestedOdds,
              currentOdds: currentOdds.price,
            });
            break;
          case 'PROVIDER_UNAVAILABLE':
            bettingError('PROVIDER_UNAVAILABLE', 'Betting service is temporarily unavailable', 503);
            break;
          default:
            bettingError('BET_REJECTED', error.message, 400);
        }
      }
      throw error;
    }

    // Provider boundary: never accept a price different from what was requested.
    if (acceptedOdds !== dto.requestedOdds) {
      await releaseReservedStake();
      bettingError('ODDS_CHANGED', 'Odds changed during placement', 409, {
        selectionId: dto.selectionId,
        previousOdds: dto.requestedOdds,
        acceptedOdds,
      });
    }

    // 10. Deterministic payout from the accepted odds snapshot.
    const potentialPayout = calculatePotentialReturn(dto.stake, acceptedOdds);

    // 11. Persist Bet + immutable BetSelection snapshot (single nested create).
    let bet: BetRow;
    try {
      const created = await this.prisma.bet.create({
        data: {
          userId: auth.id,
          type: 'SINGLE',
          status: 'ACCEPTED',
          stake: dto.stake,
          potentialPayout,
          currency,
          providerReference,
          idempotencyKey: dto.idempotencyKey,
          selections: {
            create: [
              {
                selectionId: dto.selectionId,
                eventName: event.name,
                marketName: market.name,
                selectionName: selectionRow.name,
                priceAtPlacement: acceptedOdds,
                oddsVersion: currentOdds.oddsVersion,
              },
            ],
          },
        },
        include: { selections: true },
      });
      bet = created as unknown as BetRow;
    } catch (error) {
      // Concurrent duplicate idempotency submission (unique userId_idempotencyKey).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const dup = await this.prisma.bet.findUnique({
          where: {
            userId_idempotencyKey: { userId: auth.id, idempotencyKey: dto.idempotencyKey },
          },
          include: { selections: true },
        });
        if (dup) return { bet: toBetView(dup as unknown as BetRow), duplicate: true };
        await releaseReservedStake();
        throw new ConflictException('Could not resolve duplicate bet request');
      }
      await releaseReservedStake();
      throw error;
    }

    // 12. Capture the reserved stake: locked funds become a BET_STAKE debit.
    await this.wallet.captureStake(auth.id, dto.idempotencyKey);

    // 13. Audit the important lifecycle events (best-effort, never raises).
    await this.audit('BET_CREATED', auth.id, bet);
    await this.audit('BET_ACCEPTED', auth.id, bet, ip, userAgent);

    return { bet: toBetView(bet), duplicate: false };
  }

  private validateStake(stake: number): void {
    if (!Number.isInteger(stake)) {
      bettingError('INVALID_STAKE', 'Stake must be a whole number in minor units', 400);
    }
    if (stake < this.config.minStake) {
      bettingError('INVALID_STAKE', `Minimum stake is ${this.config.minStake} minor units`, 400, {
        min: this.config.minStake,
      });
    }
    if (stake > this.config.maxStake) {
      bettingError('INVALID_STAKE', `Maximum stake is ${this.config.maxStake} minor units`, 400, {
        max: this.config.maxStake,
      });
    }
  }

  private async audit(
    action: string,
    actorId: string,
    bet: BetRow,
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId,
          actorType: 'USER',
          action,
          entityType: 'Bet',
          entityId: bet.id,
          oldValue: Prisma.JsonNull,
          newValue: {
            betId: bet.id,
            status: bet.status,
            stake: bet.stake,
            potentialPayout: bet.potentialPayout,
            currency: bet.currency,
            reference: bet.providerReference,
            selectionId: bet.selections[0]?.selectionId ?? null,
          } as Prisma.InputJsonValue,
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
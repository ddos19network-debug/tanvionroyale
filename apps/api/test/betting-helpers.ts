/* eslint-disable @typescript-eslint/no-explicit-any */
import type { OperatorProviderInterface } from '@tanvion-royale/integrations';
import { PrismaService } from '../src/database/prisma.service';
import { BettingService } from '../src/modules/betting/betting.service';
import type { WalletServiceInterface } from '../src/modules/betting/wallet.service';

export const auth = { id: 'user-1', sessionId: 's1', roles: ['USER'] };

export interface BettingSeeds {
  prisma: PrismaService;
  users: Map<string, any>;
  events: Map<string, any>;
  markets: Map<string, any>;
  selections: Map<string, any>;
  bets: Map<string, any>;
  auditLogs: any[];
}

/** A gambling-available game context (ACTIVE sport + enabled + active mapping). */
export function gamblingGame(overrides: Partial<any> = {}): any {
  return {
    id: 'g1',
    status: 'ACTIVE',
    availability: { gamblingEnabled: true },
    providerMapping: { providerName: 'mock-operator', status: 'ACTIVE' },
    sport: { status: 'ACTIVE' },
    ...overrides,
  };
}

export function makePrismaFake(): BettingSeeds {
  const users = new Map<string, any>();
  const events = new Map<string, any>();
  const markets = new Map<string, any>();
  const selections = new Map<string, any>();
  const bets = new Map<string, any>();
  const auditLogs: any[] = [];

  const withOdds = (s: any): any => ({ ...s, odds: s.odds ?? null });

  const prisma = {
    user: {
      findUnique: jest.fn(async ({ where }: any) => users.get(where.id) ?? null),
    },
    event: {
      findUnique: jest.fn(async ({ where, include }: any) => {
        const e = events.get(where.id) ?? null;
        if (!e) return null;
        const out: any = { ...e, game: e.game ?? gamblingGame() };
        if (include?.markets) {
          out.markets = [...markets.values()]
            .filter((m) => m.eventId === e.id)
            .map((m) => {
              const sels = include?.markets?.include?.selections?.include?.odds
                ? [...selections.values()].filter((s) => s.marketId === m.id).map(withOdds)
                : [...selections.values()].filter((s) => s.marketId === m.id);
              return { ...m, selections: sels };
            });
        }
        return out;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        [...events.values()]
          .filter((e: any) => {
            if (!where) return true;
            if (where.status?.in && !where.status.in.includes(e.status)) return false;
            if (where.status && typeof where.status === 'string') return e.status === where.status;
            const compWhere = where.competition?.is;
            if (compWhere?.sport?.slug && e.competition?.sport?.slug !== compWhere.sport.slug) return false;
            if (compWhere?.slug && e.competition?.slug !== compWhere.slug) return false;
            return true;
          })
          .map((e) => ({ ...e, game: e.game ?? gamblingGame() })),
      ),
    },
    market: {
      findUnique: jest.fn(async ({ where, include }: any) => {
        const m = markets.get(where.id) ?? null;
        if (!m) return null;
        let out: any = m;
        if (include?.event) {
          const ev = events.get(m.eventId);
          out = { ...m, event: ev ? { ...ev, game: ev.game ?? gamblingGame() } : null };
        }
        if (include?.selections?.include?.odds) {
          out = { ...out, selections: [...selections.values()].filter((s) => s.marketId === m.id).map(withOdds) };
        }
        return out;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        [...markets.values()].filter((m) => !where || !where.eventId || m.eventId === where.eventId),
      ),
    },
    selection: {
      findUnique: jest.fn(async ({ where, include }: any) => {
        const s = selections.get(where.id) ?? null;
        return s ? withOdds(include ? { ...s } : s) : null;
      }),
      findMany: jest.fn(async ({ where, include }: any) =>
        [...selections.values()]
          .filter((s) => !where || !where.marketId || s.marketId === where.marketId)
          .map((s) => (include?.odds ? withOdds(s) : s)),
      ),
    },
bet: {
      findUnique: jest.fn(async ({ where, include }: any) => {
        const target =
          where.id !== undefined
            ? bets.get(where.id)
            : [...bets.values()].find(
                (b) =>
                  b.userId === where.userId_idempotencyKey.userId &&
                  b.idempotencyKey === where.userId_idempotencyKey.idempotencyKey,
              );
        if (!target) return null;
        return include?.selections ? { ...target, selections: target.selections ?? [] } : target;
      }),
      findFirst: jest.fn(async ({ where, include }: any) => {
        const found = [...bets.values()].find(
          (b) => (!where.id || b.id === where.id) && (!where.userId || b.userId === where.userId),
        );
        if (!found) return null;
        return include?.selections ? { ...found, selections: found.selections ?? [] } : found;
      }),
      findMany: jest.fn(async ({ where, include }: any) =>
        [...bets.values()]
          .filter((b) => (!where?.userId || b.userId === where.userId) && (!where?.status || b.status === where.status))
          .map((b) => (include?.selections ? { ...b, selections: b.selections ?? [] } : b)),
      ),
      create: jest.fn(async ({ data, include }: any) => {
        const id = `bet-${bets.size + 1}`;
        const now = new Date();
        const bet = {
          id,
          userId: data.userId,
          type: data.type,
          status: data.status,
          stake: data.stake,
          potentialPayout: data.potentialPayout,
          currency: data.currency,
          providerReference: data.providerReference ?? null,
          idempotencyKey: data.idempotencyKey,
          createdAt: now,
          updatedAt: now,
          selections: data.selections?.create?.map((s: any, i: number) => ({
            id: `bs-${id}-${i}`,
            selectionId: s.selectionId,
            eventName: s.eventName,
            marketName: s.marketName,
            selectionName: s.selectionName,
            priceAtPlacement: s.priceAtPlacement,
            oddsVersion: s.oddsVersion,
          })),
        };
        bets.set(id, include?.selections ? bet : { ...bet, selections: [] });
        return include?.selections ? bet : { ...bet, selections: [] };
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
    users,
    events,
    markets,
    selections,
    bets,
    auditLogs,
  };
}

export function seedUser(fake: BettingSeeds, overrides: Partial<any> = {}): any {
  const user = { id: 'user-1', email: 'a@b.c', status: 'ACTIVE', ...overrides };
  fake.users.set(user.id, user);
  return user;
}

export function seedEvent(fake: BettingSeeds, overrides: Partial<any> = {}): any {
  const event = {
    id: 'evt-1',
    gameId: 'g1',
    providerEventId: 'evt-1001',
    name: 'Alpha v Beta',
    startTime: new Date(Date.now() + 86_400_000),
    status: 'SCHEDULED',
    createdAt: new Date(),
    updatedAt: new Date(),
    competitionId: null,
    competition: null,
    homeName: 'Alpha',
    awayName: 'Beta',
    live: false,
    bettingMode: 'NATIVE',
    externalEventId: null,
    partnerProviderId: null,
    partnerProvider: null,
    game: gamblingGame(),
    ...overrides,
  };
  fake.events.set(event.id, event);
  return event;
}

/**
 * Convenience helper: attach a competition (with its sport) to an event so the
 * sports-hub fields (competition.sport.slug, sport summary) are populated.
 */
export function competitionWithSport(
  overrides: Partial<any> = {},
): { id: string; sportId: string; name: string; slug: string; country: string | null; status: string; sortOrder: number; sport: { id: string; name: string; slug: string } } {
  return {
    id: 'comp-1',
    sportId: 'sport-1',
    name: 'IPL',
    slug: 'ipl',
    country: 'India',
    status: 'ACTIVE',
    sortOrder: 1,
    sport: { id: 'sport-1', name: 'Cricket', slug: 'cricket' },
    ...overrides,
  };
}

export function seedMarket(fake: BettingSeeds, eventId: string, overrides: Partial<any> = {}): any {
  const market = {
    id: `market-${fake.markets.size + 1}`,
    eventId,
    name: 'Match Winner',
    status: 'OPEN',
    ...overrides,
  };
  fake.markets.set(market.id, market);
  return market;
}

export function seedSelection(
  fake: BettingSeeds,
  marketId: string,
  overrides: Partial<any> = {},
): any {
  const selection = {
    id: `sel-${fake.selections.size + 1}`,
    marketId,
    name: 'Home',
    providerSelectionId: 'evt-1001-sel-home',
    status: 'ACTIVE',
    odds: { price: '1.85', oddsVersion: 1, updatedAt: new Date() },
    ...overrides,
  };
  fake.selections.set(selection.id, selection);
  return selection;
}
export function makeProvider(
  behavior: Partial<{ placeBet: (req: any) => Promise<any> }> = {},
): OperatorProviderInterface {
  return {
    name: 'mock',
    authenticate: jest.fn(async () => undefined),
    getSports: jest.fn(),
    getCompetitions: jest.fn(),
    getEvents: jest.fn(),
    getEvent: jest.fn(),
    getMarkets: jest.fn(),
    getSelections: jest.fn(),
    getOdds: jest.fn(),
    placeBet:
      behavior.placeBet ??
      jest.fn().mockResolvedValue({
        externalBetId: 'mock-bet-1',
        status: 'ACCEPTED',
        acceptedOdds: '1.85',
        potentialReturn: 1850,
        message: null,
        raw: {},
      }),
    getBet: jest.fn(),
    getBalance: jest.fn(),
    createDeposit: jest.fn(),
    getTransaction: jest.fn(),
    requestWithdrawal: jest.fn(),
    handleWebhook: jest.fn(),
  } as unknown as OperatorProviderInterface;
}

export const wallet: WalletServiceInterface = {
  getAvailableBalance: jest.fn().mockResolvedValue(100_000),
  reserveStake: jest.fn().mockResolvedValue({ transactionId: 'tx-1', duplicate: false }),
  captureStake: jest.fn().mockResolvedValue(undefined),
  releaseStake: jest.fn().mockResolvedValue(undefined),
  settleBetCredit: jest
    .fn()
    .mockResolvedValue({ walletId: 'w-1', transactionId: 'tx-1', duplicate: false }),
};

export function makeService(
  fake: BettingSeeds,
  provider?: OperatorProviderInterface,
  testWallet: WalletServiceInterface = wallet,
): BettingService {
  return new BettingService(fake.prisma, provider ?? makeProvider(), testWallet);
}

export function placeDto(overrides: Partial<any> = {}): any {
  return {
    eventId: 'evt-1',
    marketId: 'market-1',
    selectionId: 'sel-1',
    stake: 1000,
    requestedOdds: '1.85',
    idempotencyKey: 'key-12345678',
    ...overrides,
  };
}
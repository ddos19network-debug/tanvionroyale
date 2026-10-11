/* eslint-disable @typescript-eslint/no-explicit-any */
import { UsersService } from '../src/modules/users/users.service';
import { ProfileActivityService } from '../src/modules/users/profile-activity.service';

function makeProfilePrismaFake() {
  const prisma = {
    wallet: { findMany: jest.fn(async () => [{ id: 'w1', userId: 'u1', currency: 'BDT', availableBalance: 5000, lockedBalance: 100, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() }]) },
    walletTransaction: { findMany: jest.fn(async () => []) },
    bet: { findMany: jest.fn(async () => []) },
    gameResult: { findMany: jest.fn(async () => []) },
    crashBet: { findMany: jest.fn(async () => []) },
    auditLog: { findMany: jest.fn(async () => []) },
  };
  return prisma as any;
}

const auth = { id: 'u1', sessionId: 's1', roles: ['USER'] } as any;

describe('ProfileActivityService', () => {
  it('builds a summary from owned rows only', async () => {
    const prisma = makeProfilePrismaFake();
    prisma.walletTransaction.findMany = jest.fn(async ({ where }: any) => {
      if (where.type === 'DEPOSIT') return [{ amount: 10000, currency: 'BDT' }];
      return [{ amount: -500, status: 'COMPLETED', currency: 'BDT' }];
    });
    const service = new ProfileActivityService(prisma);
    const summary = await service.getSummary(auth);
    expect(summary.totalDeposited).toBe(10000);
    expect(summary.totalWithdrawn).toBe(500);
    expect(summary.wallet?.availableBalance).toBe(5000);
  });

  it('aggregates win/loss/payout totals from settled bets', async () => {
    const prisma = makeProfilePrismaFake();
    prisma.bet.findMany = jest.fn(async () => [
      { id: 'b1', status: 'SETTLED', result: 'WIN', stake: 1000, payout: 2100, currency: 'BDT' },
      { id: 'b2', status: 'SETTLED', result: 'LOSS', stake: 500, payout: 0, currency: 'BDT' },
      { id: 'b3', status: 'PENDING', result: null, stake: 200, payout: null, currency: 'BDT' },
    ]);
    const service = new ProfileActivityService(prisma);
    const summary = await service.getSummary(auth);
    expect(summary.totalBets).toBe(3);
    expect(summary.settledBets).toBe(2);
    expect(summary.totalWins).toBe(1);
    expect(summary.totalLosses).toBe(1);
    expect(summary.totalStaked).toBe(1700);
    expect(summary.totalPayout).toBe(2100);
  });

  it('returns empty activity without leaking other users', async () => {
    const prisma = makeProfilePrismaFake();
    const service = new ProfileActivityService(prisma);
    const res = await service.listActivity(auth, { type: 'ALL' });
    expect(res.items).toEqual([]);
    expect(prisma.walletTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'u1' }) }),
    );
  });

  it('filters activity by type', async () => {
    const prisma = makeProfilePrismaFake();
    prisma.walletTransaction.findMany = jest.fn(async () => [
      { id: 't1', type: 'DEPOSIT', amount: 10000, currency: 'BDT', status: 'COMPLETED', createdAt: new Date('2026-01-01T03:04:05Z'), reference: null },
      { id: 't2', type: 'WITHDRAWAL', amount: -500, currency: 'BDT', status: 'COMPLETED', createdAt: new Date('2026-01-01T04:04:05Z'), reference: null },
    ]);
    const service = new ProfileActivityService(prisma);
    const res = await service.listActivity(auth, { type: 'DEPOSIT' });
    expect(res.items).toHaveLength(1);
    expect(res.items[0].kind).toBe('DEPOSIT');
  });

  it('normalizes win/status filters across kinds', async () => {
    const prisma = makeProfilePrismaFake();
    prisma.crashBet.findMany = jest.fn(async () => [
      {
        id: 'c1', roundId: 'r1', placedAt: new Date(), status: 'CASHED_OUT',
        cashoutMultiplier: 2.0, payout: 2000, stake: 1000, currency: 'BDT',
        cashoutAt: new Date(), settledAt: new Date(),
        round: { roundNumber: 7, crashMultiplier: 3.1 }, settlement: { result: 'CASHED_OUT' },
      },
    ]);
    const service = new ProfileActivityService(prisma);
    const res = await service.listActivity(auth, { type: 'CRASH', status: 'WON' });
    expect(res.items).toHaveLength(1);
    expect(res.items[0].status).toBe('CASHED_OUT');
  });

  it('sorts newest-first and paginates the combined feed', async () => {
    const prisma = makeProfilePrismaFake();
    const mk = (id: string, at: string) => ({
      id, createdAt: new Date(at), stake: 100, potentialPayout: 210, currency: 'BDT',
      status: 'ACCEPTED', result: null, selections: [{ eventName: `Match ${id}`, selectionName: 'Home' }],
    });
    prisma.bet.findMany = jest.fn(async () => [
      mk('b1', '2026-01-01T00:00:00Z'),
      mk('b2', '2026-01-02T00:00:00Z'),
      mk('b3', '2026-01-03T00:00:00Z'),
    ]);
    const service = new ProfileActivityService(prisma);
    const page1 = await service.listActivity(auth, { type: 'SPORTS', limit: 2, page: 1 });
    expect(page1.items.map((i) => i.id)).toEqual(['bet-b3', 'bet-b2']);
    const page2 = await service.listActivity(auth, { type: 'SPORTS', limit: 2, page: 2 });
    expect(page2.items.map((i) => i.id)).toEqual(['bet-b1']);
  });

  it('paginates game results by owner', async () => {
    const prisma = makeProfilePrismaFake();
    prisma.gameResult.findMany = jest.fn(async () => [
      { id: 'g1', gameSlug: 'coin-flip', score: 1, outcome: 'WIN', meta: null, createdAt: new Date() },
    ]);
    const service = new ProfileActivityService(prisma);
    const res = await service.listGames(auth, { limit: 20, page: 1 });
    expect(res.items).toHaveLength(1);
    expect(prisma.gameResult.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'u1' }) }),
    );
  });

  it('maps crash history from owned round data', async () => {
    const prisma = makeProfilePrismaFake();
    prisma.crashBet.findMany = jest.fn(async () => [
      {
        id: 'cb-1', roundId: 'r-1', stake: 500, currency: 'BDT', status: 'CASHED_OUT',
        cashoutMultiplier: 2.5, payout: 1250, placedAt: new Date('2026-01-01T00:00:00Z'),
        cashoutAt: new Date(), settledAt: new Date(),
        round: { roundNumber: 42, crashMultiplier: 4.2 }, settlement: { result: 'CASHED_OUT' },
      },
    ]);
    const service = new ProfileActivityService(prisma);
    const res = await service.listCrash(auth, { limit: 10, page: 1 });
    expect(res.items).toHaveLength(1);
    expect(res.items[0].roundNumber).toBe(42);
    expect(res.items[0].result).toBe('CASHED_OUT');
    expect(prisma.crashBet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'u1' }) }),
    );
  });
});

describe('UsersService username (existing suite guard)', () => {
  it('exposes updateProfile', () => {
    expect(typeof new UsersService(makeProfilePrismaFake()).updateProfile).toBe('function');
  });
});

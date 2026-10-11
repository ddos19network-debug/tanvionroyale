/* eslint-disable @typescript-eslint/no-explicit-any */
import { NotFoundException } from '@nestjs/common';
import { SettlementService } from '../src/modules/betting/settlement.service';

/**
 * Settlement engine unit tests (Phase 7).
 *
 * Exercises the deterministic SINGLE settlement rules, idempotency, invalid
 * transitions, and wallet integration against an in-memory fake of the Prisma
 * transaction surface and the WalletServiceInterface â€” no database required.
 */

interface BetSeed {
  id: string;
  userId?: string;
  status: string;
  type?: string;
  stake?: number;
  potentialPayout?: number;
  selectionId?: string;
  eventStatus?: string;
  result?: string | null;
  payout?: number | null;
}

function makeFake(seed: BetSeed) {
  const bet: any = {
    id: seed.id,
    userId: seed.userId ?? 'user-1',
    type: seed.type ?? 'SINGLE',
    status: seed.status,
    stake: seed.stake ?? 1000,
    potentialPayout: seed.potentialPayout ?? 1850,
    currency: 'BDT',
    providerReference: 'prov-ref-1',
    result: seed.result ?? null,
    payout: seed.payout ?? null,
    selections: [{ id: 'bs-1', selectionId: seed.selectionId ?? 'sel-1' }],
  };
  const auditLogs: any[] = [];
  const updates: any[] = [];
  const credits: any[] = [];

  const db: any = {
    $queryRaw: jest.fn(async () => []),
    bet: {
      findUnique: jest.fn(async () => ({ ...bet, selections: bet.selections })),
      update: jest.fn(async ({ data }: any) => {
        Object.assign(bet, data);
        updates.push(data);
        return bet;
      }),
    },
    betSelection: {
      updateMany: jest.fn(async ({ data }: any) => updates.push({ selection: data })),
    },
    selection: {
      findUnique: jest.fn(async () => ({
        market: { event: { id: 'event-1', status: seed.eventStatus ?? 'FINISHED' } },
      })),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        auditLogs.push(data);
        return data;
      }),
    },
  };

  const prisma: any = {
    $transaction: jest.fn(async (fn: any) => fn(db)),
  };

  const wallet = {
    settleBetCredit: jest.fn(
      async (
        _db: any,
        userId: string,
        amount: number,
        currency: string,
        type: 'BET_PAYOUT' | 'BET_REFUND',
        idempotencyKey: string,
      ) => {
        credits.push({ userId, amount, currency, type, idempotencyKey });
        return { walletId: 'w-1', transactionId: 'tx-1', duplicate: false };
      },
    ),
  };

  const service = new SettlementService(prisma, wallet as any);
  return { service, bet, db, auditLogs, updates, credits };
}

const WIN = [{ selectionId: 'sel-1', result: 'WIN' as const }];

describe('SettlementService', () => {
  it('settles WIN: bet â†’ SETTLED, wallet BET_PAYOUT of potentialPayout', async () => {
    const { service, credits, auditLogs, updates } = makeFake({ id: 'b-1', status: 'ACCEPTED' });
    const res = await service.settleBet('b-1', WIN, { actorId: 'admin-1' });
    expect(res).toEqual({
      betId: 'b-1',
      status: 'SETTLED',
      result: 'WIN',
      payout: 1850,
      alreadySettled: false,
    });
    expect(credits).toEqual([
      {
        userId: 'user-1',
        amount: 1850,
        currency: 'BDT',
        type: 'BET_PAYOUT',
        idempotencyKey: 'settle:b-1:BET_PAYOUT',
      },
    ]);
    expect(auditLogs.map((a) => a.action)).toEqual(['BET_WIN', 'BET_PAYOUT', 'BET_SETTLED']);
    expect(updates[0]).toMatchObject({ status: 'SETTLED', result: 'WIN', payout: 1850 });
  });

  it('settles LOSS: bet â†’ SETTLED, no wallet movement', async () => {
    const { service, credits } = makeFake({ id: 'b-1', status: 'ACCEPTED' });
    const res = await service.settleBet('b-1', [{ selectionId: 'sel-1', result: 'LOSS' }]);
    expect(res.result).toBe('LOSS');
    expect(res.payout).toBe(0);
    expect(credits).toHaveLength(0);
  });

  it('settles VOID: refund of the stake via BET_REFUND', async () => {
    const { service, credits } = makeFake({ id: 'b-1', status: 'ACCEPTED', stake: 1000 });
    const res = await service.settleBet('b-1', [{ selectionId: 'sel-1', result: 'VOID' }]);
    expect(res.result).toBe('VOID');
    expect(res.payout).toBe(1000);
    expect(credits[0]).toMatchObject({
      amount: 1000,
      type: 'BET_REFUND',
      idempotencyKey: 'settle:b-1:BET_REFUND',
    });
  });

  it('refunds (VOID) when the event is CANCELLED regardless of provided result', async () => {
    const { service, credits } = makeFake({ id: 'b-1', status: 'ACCEPTED', eventStatus: 'CANCELLED' });
    const res = await service.settleBet('b-1', WIN);
    expect(res.result).toBe('VOID');
    expect(res.payout).toBe(1000);
    expect(credits[0].type).toBe('BET_REFUND');
  });

  it('uses the payout snapshot saved at placement (not recalculated)', async () => {
    const { service, credits } = makeFake({ id: 'b-1', status: 'ACCEPTED', potentialPayout: 2345 });
    await service.settleBet('b-1', WIN);
    expect(credits[0].amount).toBe(2345);
  });

  it('is idempotent: already-SETTLED bet returns alreadySettled and never pays again', async () => {
    const { service, credits } = makeFake({ id: 'b-1', status: 'SETTLED', result: 'WIN', payout: 1850 });
    const res = await service.settleBet('b-1', WIN);
    expect(res.alreadySettled).toBe(true);
    expect(res.payout).toBe(1850);
    expect(credits).toHaveLength(0);
  });

  it('rejects invalid transitions (REJECTED/CANCELLED/PENDING cannot settle)', async () => {
    for (const status of ['REJECTED', 'CANCELLED', 'PENDING']) {
      const { service } = makeFake({ id: 'b-1', status });
      await expect(service.settleBet('b-1', WIN)).rejects.toThrow(
        `Cannot settle a bet in status ${status}`,
      );
    }
  });

  it('rejects settlement while the event has not finished', async () => {
    const { service } = makeFake({ id: 'b-1', status: 'ACCEPTED', eventStatus: 'LIVE' });
    await expect(service.settleBet('b-1', WIN)).rejects.toThrow('Event has not finished (LIVE)');
  });

  it('rejects non-SINGLE bets', async () => {
    const { service } = makeFake({ id: 'b-1', status: 'ACCEPTED', type: 'ACCUMULATOR' });
    await expect(service.settleBet('b-1', WIN)).rejects.toThrow('Only SINGLE bets');
  });

  it('returns NotFound for an unknown bet', async () => {
    const db: any = {
      $queryRaw: jest.fn(async () => []),
      bet: { findUnique: jest.fn(async () => null), update: jest.fn() },
      betSelection: { updateMany: jest.fn() },
      selection: { findUnique: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(db)) };
    const wallet = { settleBetCredit: jest.fn() };
    const service = new SettlementService(prisma, wallet as any);
    await expect(service.settleBet('missing', WIN)).rejects.toBeInstanceOf(NotFoundException);
  });
});


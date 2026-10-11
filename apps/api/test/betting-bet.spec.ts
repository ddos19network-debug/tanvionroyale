/* eslint-disable @typescript-eslint/no-explicit-any */
import { NotFoundException } from '@nestjs/common';
import { OperatorError } from '@tanvion-royale/integrations';
import {
  auth,
  makePrismaFake,
  makeProvider,
  makeService,
  placeDto,
  seedEvent,
  seedMarket,
  seedSelection,
  seedUser,
} from './betting-helpers';
import { calculatePotentialReturn, parseOdds } from '../src/modules/betting/odds.util';
import type { WalletServiceInterface } from '../src/modules/betting/wallet.service';
import { walletError } from '../src/modules/wallet/wallet-errors';

describe('Potential payout (deterministic, integer arithmetic)', () => {
  it('computes floor(stake * numerator / denominator) from decimal odds', () => {
    expect(parseOdds('1.85')).toEqual({ numerator: 185, denominator: 100 });
    expect(calculatePotentialReturn(1000, '1.85')).toBe(1850);
    expect(calculatePotentialReturn(100, '2.00')).toBe(200);
    expect(calculatePotentialReturn(1000, '4.20')).toBe(4200);
  });

  it('handles whole-number and 1-decimal odds', () => {
    expect(parseOdds('2')).toEqual({ numerator: 2, denominator: 1 });
    expect(parseOdds('3.4')).toEqual({ numerator: 34, denominator: 10 });
    expect(calculatePotentialReturn(500, '3.4')).toBe(1700);
  });

  it('never rounds up inconsistently', () => {
    expect(calculatePotentialReturn(1, '1.85')).toBe(1);
    expect(calculatePotentialReturn(50, '3.50')).toBe(175);
  });
});

describe('Bet lifecycle', () => {
  it('creates a valid accepted bet with an immutable odds snapshot and audit logs', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake);
    const market = seedMarket(fake, 'evt-1', { id: 'market-1' });
    seedSelection(fake, market.id, { id: 'sel-1' });
    const service = makeService(fake);

    const res = await service.placeBet(auth, placeDto());
    expect(res.bet.status).toBe('ACCEPTED');
    expect(res.bet.providerReference).toBe('mock-bet-1');
    expect(res.bet.selections).toHaveLength(1);
    expect(res.bet.selections[0].eventName).toBe('Alpha v Beta');
    expect(res.bet.selections[0].priceAtPlacement).toBe('1.85');
    expect(fake.auditLogs.map((a) => a.action)).toEqual(['BET_CREATED', 'BET_ACCEPTED']);
  });

  it('rejects an unknown event', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    const service = makeService(fake);
    await expect(service.placeBet(auth, placeDto())).rejects.toThrow(NotFoundException);
  });

  it('rejects an invalid selection', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake);
    seedMarket(fake, 'evt-1', { id: 'market-1' });
    const service = makeService(fake);
    await expect(service.placeBet(auth, placeDto())).rejects.toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'NOT_FOUND' }) }),
    );
  });
});

describe('Provider boundary', () => {
  it('maps provider rejection to BET_REJECTED', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake);
    const market = seedMarket(fake, 'evt-1', { id: 'market-1' });
    seedSelection(fake, market.id, { id: 'sel-1' });
    const provider = makeProvider({
      placeBet: jest.fn().mockRejectedValue(new OperatorError('BET_REJECTED', 'refused', 'mock')),
    });
    const service = makeService(fake, provider);

    await expect(service.placeBet(auth, placeDto())).rejects.toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'BET_REJECTED' }) }),
    );
  });

  it('maps provider unavailability to PROVIDER_UNAVAILABLE', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake);
    const market = seedMarket(fake, 'evt-1', { id: 'market-1' });
    seedSelection(fake, market.id, { id: 'sel-1' });
    const provider = makeProvider({
      placeBet: jest
        .fn()
        .mockRejectedValue(new OperatorError('PROVIDER_UNAVAILABLE', 'down', 'mock')),
    });
    const service = makeService(fake, provider);

    await expect(service.placeBet(auth, placeDto())).rejects.toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }) }),
    );
  });

  it('rejects a bet the provider did not accept', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake);
    const market = seedMarket(fake, 'evt-1', { id: 'market-1' });
    seedSelection(fake, market.id, { id: 'sel-1' });
    const provider = makeProvider({
      placeBet: jest.fn().mockResolvedValue({
        externalBetId: 'mock-bet-9',
        status: 'REJECTED',
        acceptedOdds: null,
        potentialReturn: null,
        message: 'no',
        raw: {},
      }),
    });
    const service = makeService(fake, provider);

    await expect(service.placeBet(auth, placeDto())).rejects.toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'BET_REJECTED' }) }),
    );
  });
});

describe('Idempotency', () => {
  it('re-uses the existing bet on a duplicate idempotency key', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake);
    const market = seedMarket(fake, 'evt-1', { id: 'market-1' });
    seedSelection(fake, market.id, { id: 'sel-1' });
    const provider = makeProvider();
    const service = makeService(fake, provider);

    const first = await service.placeBet(auth, placeDto());
    const second = await service.placeBet(auth, placeDto());
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.bet.id).toBe(first.bet.id);
    expect(provider.placeBet).toHaveBeenCalledTimes(1);
  });

  it('does not create multiple bets for the same key', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake);
    const market = seedMarket(fake, 'evt-1', { id: 'market-1' });
    seedSelection(fake, market.id, { id: 'sel-1' });
    const service = makeService(fake);

    await service.placeBet(auth, placeDto());
    await service.placeBet(auth, placeDto());
    expect(fake.bets.size).toBe(1);
  });
});

describe('User ownership', () => {
  it('lets a user list only their own bets', async () => {
    const fake = makePrismaFake();
    const created = {
      id: 'bet-A',
      userId: 'user-1',
      type: 'SINGLE',
      status: 'ACCEPTED',
      stake: 1000,
      potentialPayout: 1850,
      currency: 'BDT',
      providerReference: 'm',
      idempotencyKey: 'k-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      selections: [],
    };
    fake.bets.set('bet-A', created);
    fake.bets.set('bet-B', { ...created, id: 'bet-B', userId: 'user-2' });
    const service = makeService(fake);

    const mine = await service.listMyBets(auth);
    expect(mine.map((b) => b.id)).toEqual(['bet-A']);
    expect(mine.every((b) => b.userId === 'user-1')).toBe(true);
  });

  it("hides another user's bet from GET /bets/:id", async () => {
    const fake = makePrismaFake();
    fake.bets.set('bet-B', {
      id: 'bet-B',
      userId: 'user-2',
      type: 'SINGLE',
      status: 'ACCEPTED',
      stake: 1000,
      potentialPayout: 1000,
      currency: 'BDT',
      providerReference: 'm',
      idempotencyKey: 'k-2',
      createdAt: new Date(),
      updatedAt: new Date(),
      selections: [],
    });
    const service = makeService(fake);

    await expect(service.getMyBet(auth, 'bet-B')).rejects.toThrow(NotFoundException);
  });
});

describe('Authorization', () => {
  it('rejects an unauthenticated user (no user row)', async () => {
    const fake = makePrismaFake();
    seedEvent(fake);
    const market = seedMarket(fake, 'evt-1', { id: 'market-1' });
    seedSelection(fake, market.id, { id: 'sel-1' });
    const service = makeService(fake);

    await expect(
      service.placeBet({ id: 'ghost', sessionId: 's', roles: [] }, placeDto()),
    ).rejects.toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'UNAUTHORIZED' }) }),
    );
  });

  it('rejects an inactive account', async () => {
    const fake = makePrismaFake();
    seedUser(fake, { status: 'SUSPENDED' });
    seedEvent(fake);
    const market = seedMarket(fake, 'evt-1', { id: 'market-1' });
    seedSelection(fake, market.id, { id: 'sel-1' });
    const service = makeService(fake);

    await expect(service.placeBet(auth, placeDto())).rejects.toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'FORBIDDEN' }) }),
    );
  });

  it('rejects when the wallet balance is insufficient', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake);
    const market = seedMarket(fake, 'evt-1', { id: 'market-1' });
    seedSelection(fake, market.id, { id: 'sel-1' });
    const lowWallet: WalletServiceInterface = {
      getAvailableBalance: jest.fn().mockResolvedValue(50),
      // Simulate the real wallet: reserveStake throws the structured wallet error.
      reserveStake: jest.fn(async () => {
        walletError('INSUFFICIENT_FUNDS', 'Insufficient available balance', 400);
      }),
      captureStake: jest.fn(),
      releaseStake: jest.fn(),
      settleBetCredit: jest
        .fn()
        .mockResolvedValue({ walletId: 'w-1', transactionId: 'tx-1', duplicate: false }),
    };
    const service = makeService(fake, makeProvider(), lowWallet);

    await expect(service.placeBet(auth, placeDto())).rejects.toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'INSUFFICIENT_BALANCE' }) }),
    );
  });
});
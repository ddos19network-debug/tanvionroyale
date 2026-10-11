/* eslint-disable @typescript-eslint/no-explicit-any */
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

describe('Odds', () => {
  it('accepts a bet when reviewed odds match current odds', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake);
    const market = seedMarket(fake, 'evt-1', { id: 'market-1' });
    seedSelection(fake, market.id, {
      id: 'sel-1',
      odds: { price: '1.85', oddsVersion: 2, updatedAt: new Date() },
    });
    const service = makeService(fake);

    const res = await service.placeBet(auth, placeDto({ requestedOdds: '1.85' }));
    expect(res.bet.selections[0].oddsVersion).toBe(2);
    expect(res.bet.selections[0].priceAtPlacement).toBe('1.85');
  });

  it('rejects when odds changed (ODDS_CHANGED with current price)', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake);
    const market = seedMarket(fake, 'evt-1', { id: 'market-1' });
    seedSelection(fake, market.id, {
      id: 'sel-1',
      odds: { price: '2.10', oddsVersion: 3, updatedAt: new Date() },
    });
    const service = makeService(fake);

    await expect(service.placeBet(auth, placeDto({ requestedOdds: '1.85' }))).rejects.toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'ODDS_CHANGED' }) }),
    );
  });

  it('does not silently accept when the provider reports a different accepted price', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake);
    const market = seedMarket(fake, 'evt-1', { id: 'market-1' });
    seedSelection(fake, market.id, { id: 'sel-1' });
    const provider = makeProvider({
      placeBet: jest.fn().mockResolvedValue({
        externalBetId: 'mock-bet-7',
        status: 'ACCEPTED',
        acceptedOdds: '2.25',
        potentialReturn: 2250,
        message: null,
        raw: {},
      }),
    });
    const service = makeService(fake, provider);

    await expect(service.placeBet(auth, placeDto())).rejects.toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'ODDS_CHANGED' }) }),
    );
  });
});

describe('Stake validation', () => {
  function base() {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake);
    const market = seedMarket(fake, 'evt-1', { id: 'market-1' });
    seedSelection(fake, market.id, { id: 'sel-1' });
    return makeService(fake);
  }

  it('accepts the minimum stake (100 minor units)', async () => {
    const service = base();
    const res = await service.placeBet(auth, placeDto({ stake: 100, idempotencyKey: 'key-10000001' }));
    expect(res.bet.status).toBe('ACCEPTED');
  });

  it('accepts the maximum stake (100000 minor units)', async () => {
    const service = base();
    const res = await service.placeBet(auth, placeDto({ stake: 100000, idempotencyKey: 'key-10000002' }));
    expect(res.bet.status).toBe('ACCEPTED');
  });

  it('rejects a stake below the minimum', async () => {
    const service = base();
    await expect(service.placeBet(auth, placeDto({ stake: 50 }))).rejects.toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'INVALID_STAKE' }) }),
    );
  });

  it('rejects a stake above the maximum', async () => {
    const service = base();
    await expect(service.placeBet(auth, placeDto({ stake: 100001 }))).rejects.toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'INVALID_STAKE' }) }),
    );
  });

  it('rejects a fractional stake (invalid minor-unit precision)', async () => {
    const service = base();
    await expect(service.placeBet(auth, placeDto({ stake: 100.5 }))).rejects.toThrow();
  });
});
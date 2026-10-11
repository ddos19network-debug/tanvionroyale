/* eslint-disable @typescript-eslint/no-explicit-any */
import { NotFoundException } from '@nestjs/common';
import {
  auth,
  gamblingGame,
  makePrismaFake,
  makeService,
  placeDto,
  seedEvent,
  seedMarket,
  seedSelection,
  seedUser,
} from './betting-helpers';

describe('Event availability', () => {
  it('shows SCHEDULED and LIVE events for gambling-available games', async () => {
    const fake = makePrismaFake();
    seedEvent(fake, { status: 'SCHEDULED' });
    seedEvent(fake, { id: 'evt-2', status: 'LIVE', providerEventId: 'evt-1002' });
    const service = makeService(fake);

    const events = await service.listEvents();
    expect(events.map((e) => e.status)).toEqual(['SCHEDULED', 'LIVE']);
  });

  it('shows SUSPENDED on the board but hides FINISHED and CANCELLED events', async () => {
    const fake = makePrismaFake();
    seedEvent(fake, { status: 'SCHEDULED' });
    seedEvent(fake, { id: 'evt-2', status: 'FINISHED', providerEventId: 'evt-1003' });
    seedEvent(fake, { id: 'evt-3', status: 'CANCELLED', providerEventId: 'evt-1004' });
    seedEvent(fake, { id: 'evt-4', status: 'SUSPENDED', providerEventId: 'evt-1005' });
    const service = makeService(fake);

    const events = await service.listEvents();
    expect(events.map((e) => e.status)).toEqual(['SCHEDULED', 'SUSPENDED']);
  });

  it('hides events whose game is not gambling-available', async () => {
    const fake = makePrismaFake();
    seedEvent(fake, { game: gamblingGame({ availability: { gamblingEnabled: false } }) });
    const service = makeService(fake);

    const events = await service.listEvents();
    expect(events).toHaveLength(0);
  });

  it('rejects bet placement on a FINISHED event (EVENT_UNAVAILABLE)', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake, { status: 'FINISHED' });
    const market = seedMarket(fake, 'evt-1');
    seedSelection(fake, market.id, { id: 'sel-1' });
    const service = makeService(fake);

    await expect(service.placeBet(auth, placeDto())).rejects.toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'EVENT_UNAVAILABLE' }) }),
    );
  });
});

describe('Market availability', () => {
  it('rejects bet placement when the market is SUSPENDED', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake);
    seedMarket(fake, 'evt-1', { id: 'market-1', status: 'SUSPENDED' });
    seedSelection(fake, 'market-1', { id: 'sel-1' });
    const service = makeService(fake);

    await expect(service.placeBet(auth, placeDto())).rejects.toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'MARKET_SUSPENDED' }) }),
    );
  });

  it('rejects bet placement when the market is CLOSED', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake);
    seedMarket(fake, 'evt-1', { id: 'market-1', status: 'CLOSED' });
    seedSelection(fake, 'market-1', { id: 'sel-1' });
    const service = makeService(fake);

    await expect(service.placeBet(auth, placeDto())).rejects.toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'MARKET_SUSPENDED' }) }),
    );
  });

  it('rejects a market that does not belong to the event', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake);
    seedMarket(fake, 'other', { id: 'market-1' });
    seedSelection(fake, 'market-1', { id: 'sel-1' });
    const service = makeService(fake);

    await expect(service.placeBet(auth, placeDto())).rejects.toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'NOT_FOUND' }) }),
    );
  });
});
describe('Selection availability', () => {
  it('rejects bet placement when the selection is INACTIVE', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake);
    seedMarket(fake, 'evt-1', { id: 'market-1' });
    seedSelection(fake, 'market-1', { id: 'sel-1', status: 'INACTIVE' });
    const service = makeService(fake);

    await expect(service.placeBet(auth, placeDto())).rejects.toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'SELECTION_UNAVAILABLE' }) }),
    );
  });

  it('rejects a selection with no odds', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake);
    seedMarket(fake, 'evt-1', { id: 'market-1' });
    seedSelection(fake, 'market-1', { id: 'sel-1', odds: null });
    const service = makeService(fake);

    await expect(service.placeBet(auth, placeDto())).rejects.toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'SELECTION_UNAVAILABLE' }) }),
    );
  });

  it('rejects a selection not in the requested market', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake);
    seedMarket(fake, 'evt-1', { id: 'market-1' });
    seedSelection(fake, 'other', { id: 'sel-1' });
    const service = makeService(fake);

    await expect(service.placeBet(auth, placeDto())).rejects.toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'NOT_FOUND' }) }),
    );
  });
});

describe('Gambling availability (server-side enforcement)', () => {
  it('accepts a bet when gambling is fully enabled', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake);
    const market = seedMarket(fake, 'evt-1', { id: 'market-1' });
    seedSelection(fake, market.id, { id: 'sel-1' });
    const service = makeService(fake);

    const res = await service.placeBet(auth, placeDto());
    expect(res.bet.status).toBe('ACCEPTED');
    expect(res.bet.potentialPayout).toBe(1850);
    expect(res.bet.selections[0].priceAtPlacement).toBe('1.85');
  });

  it('rejects when gambling is disabled', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake, { game: gamblingGame({ availability: { gamblingEnabled: false } }) });
    const market = seedMarket(fake, 'evt-1', { id: 'market-1' });
    seedSelection(fake, market.id, { id: 'sel-1' });
    const service = makeService(fake);

    // The event is not gambling-available, so it is hidden entirely.
    await expect(service.placeBet(auth, placeDto())).rejects.toThrow(NotFoundException);
  });

  it('rejects when the game is inactive', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake, { game: gamblingGame({ status: 'INACTIVE' }) });
    const market = seedMarket(fake, 'evt-1', { id: 'market-1' });
    seedSelection(fake, market.id, { id: 'sel-1' });
    const service = makeService(fake);

    await expect(service.placeBet(auth, placeDto())).rejects.toThrow(NotFoundException);
  });

  it('rejects when the provider mapping is inactive', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake, {
      game: gamblingGame({ providerMapping: { providerName: 'mock', status: 'INACTIVE' } }),
    });
    const market = seedMarket(fake, 'evt-1', { id: 'market-1' });
    seedSelection(fake, market.id, { id: 'sel-1' });
    const service = makeService(fake);

    await expect(service.placeBet(auth, placeDto())).rejects.toThrow(NotFoundException);
  });

  it('rejects when the sport is inactive', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake, { game: gamblingGame({ sport: { status: 'INACTIVE' } }) });
    const market = seedMarket(fake, 'evt-1', { id: 'market-1' });
    seedSelection(fake, market.id, { id: 'sel-1' });
    const service = makeService(fake);

    await expect(service.placeBet(auth, placeDto())).rejects.toThrow(NotFoundException);
  });
});
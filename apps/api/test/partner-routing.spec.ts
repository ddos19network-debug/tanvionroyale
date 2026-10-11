/* eslint-disable @typescript-eslint/no-explicit-any */
import { NotFoundException } from '@nestjs/common';
import {
  auth,
  gamblingGame,
  makePrismaFake,
  makeService,
  seedEvent,
  seedUser,
} from './betting-helpers';

/**
 * Phase 16 — Partner event routing tests.
 *
 * Covers:
 *  1. Partner event detection (bettingMode = PARTNER)
 *  2. Native event detection (bettingMode = NATIVE)
 *  3. Partner event redirect resolves the allowlisted deep link
 *  4. Invalid partner event (missing externalEventId)
 *  5. Inactive provider mapping blocks partner redirect
 *  6. Arbitrary URL redirect attack is rejected (origin mismatch)
 *  7. Partner event cannot be placed through the native Bet Slip
 *  8. Native event can still use the native Bet Slip
 *  9. Event belongs to the correct sport
 * 10. User cannot manipulate provider/event routing
 */

function partnerEvent(overrides: Partial<any> = {}): any {
  return {
    id: 'evt-partner-1',
    gameId: 'g1',
    providerEventId: 'evt-2001',
    name: 'Mumbai Indians v Chennai Super Kings',
    startTime: new Date(Date.now() + 3_600_000),
    status: 'LIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
    competitionId: 'comp-1',
    competition: {
      id: 'comp-1',
      sportId: 'sport-1',
      name: 'IPL',
      slug: 'ipl',
      country: 'India',
      status: 'ACTIVE',
      sortOrder: 1,
      sport: { id: 'sport-1', name: 'Cricket', slug: 'cricket' },
    },
    homeName: 'Mumbai Indians',
    awayName: 'Chennai Super Kings',
    live: true,
    bettingMode: 'PARTNER',
    externalEventId: 'evt-2001',
    partnerProviderId: 'partner-1',
    partnerProvider: {
      id: 'partner-1',
      name: 'mock-partner',
      baseUrl: 'https://partner.example.com',
      deepLinkTemplate: '/sport/{sportSlug}/competition/{competitionSlug}/event/{externalEventId}',
      status: 'ACTIVE',
    },
    game: gamblingGame({ sport: { status: 'ACTIVE', slug: 'cricket' } }),
    ...overrides,
  };
}

describe('Partner event detection', () => {
  it('marks a PARTNER event with bettingMode = PARTNER and partner info', async () => {
    const fake = makePrismaFake();
    seedEvent(fake, partnerEvent());
    const service = makeService(fake);

    const events = await service.listEvents();
    expect(events).toHaveLength(1);
    expect(events[0].bettingMode).toBe('PARTNER');
    expect(events[0].partner).toEqual({
      id: 'partner-1',
      name: 'mock-partner',
      available: true,
    });
    expect(events[0].competition?.name).toBe('IPL');
    expect(events[0].homeName).toBe('Mumbai Indians');
    expect(events[0].awayName).toBe('Chennai Super Kings');
  });

  it('marks a NATIVE event with bettingMode = NATIVE and no partner', async () => {
    const fake = makePrismaFake();
    seedEvent(fake, { bettingMode: 'NATIVE', partnerProvider: null, partnerProviderId: null });
    const service = makeService(fake);

    const events = await service.listEvents();
    expect(events).toHaveLength(1);
    expect(events[0].bettingMode).toBe('NATIVE');
    expect(events[0].partner).toBeNull();
  });
});

describe('Partner event redirect', () => {
  it('resolves the allowlisted deep link for a valid PARTNER event', async () => {
    const fake = makePrismaFake();
    seedEvent(fake, partnerEvent());
    const service = makeService(fake);

    const result = await service.getPartnerRedirect('evt-partner-1', auth);

    expect(result.provider).toBe('mock-partner');
    expect(result.externalEventId).toBe('evt-2001');
    expect(result.url).toBe(
      'https://partner.example.com/sport/cricket/competition/ipl/event/evt-2001',
    );
  });

  it('rejects a NATIVE event from the partner redirect endpoint', async () => {
    const fake = makePrismaFake();
    seedEvent(fake, { bettingMode: 'NATIVE', partnerProvider: null });
    const service = makeService(fake);

    await expect(service.getPartnerRedirect('evt-1', auth)).rejects.toThrow(NotFoundException);
  });

  it('rejects a PARTNER event with no externalEventId', async () => {
    const fake = makePrismaFake();
    seedEvent(fake, partnerEvent({ externalEventId: null }));
    const service = makeService(fake);

    await expect(service.getPartnerRedirect('evt-partner-1', auth)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects a PARTNER event with an inactive partner provider', async () => {
    const fake = makePrismaFake();
    seedEvent(
      fake,
      partnerEvent({
        partnerProvider: {
          id: 'partner-1',
          name: 'mock-partner',
          baseUrl: 'https://partner.example.com',
          deepLinkTemplate: '/sport/{sportSlug}/event/{externalEventId}',
          status: 'INACTIVE',
        },
      }),
    );
    const service = makeService(fake);

    await expect(service.getPartnerRedirect('evt-partner-1', auth)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects a PARTNER event with an inactive provider mapping on the game', async () => {
    const fake = makePrismaFake();
    seedEvent(
      fake,
      partnerEvent({
        game: gamblingGame({ providerMapping: { providerName: 'mock', status: 'INACTIVE' } }),
      }),
    );
    const service = makeService(fake);

    await expect(service.getPartnerRedirect('evt-partner-1', auth)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects an arbitrary URL redirect attack (origin mismatch)', async () => {
    const fake = makePrismaFake();
    // Malicious deep-link template that would resolve to a different origin.
    seedEvent(
      fake,
      partnerEvent({
        partnerProvider: {
          id: 'partner-1',
          name: 'mock-partner',
          baseUrl: 'https://partner.example.com',
          deepLinkTemplate: 'https://evil.example.com/steal?event={externalEventId}',
          status: 'ACTIVE',
        },
      }),
    );
    const service = makeService(fake);

    await expect(service.getPartnerRedirect('evt-partner-1', auth)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects a javascript: deep-link template (scheme injection)', async () => {
    const fake = makePrismaFake();
    seedEvent(
      fake,
      partnerEvent({
        partnerProvider: {
          id: 'partner-1',
          name: 'mock-partner',
          baseUrl: 'https://partner.example.com',
          deepLinkTemplate: 'javascript:alert(String.fromCharCode(120))',
          status: 'ACTIVE',
        },
      }),
    );
    const service = makeService(fake);

    await expect(service.getPartnerRedirect('evt-partner-1', auth)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects a data: deep-link template (scheme injection)', async () => {
    const fake = makePrismaFake();
    seedEvent(
      fake,
      partnerEvent({
        partnerProvider: {
          id: 'partner-1',
          name: 'mock-partner',
          baseUrl: 'https://partner.example.com',
          deepLinkTemplate: 'data:text/html,<script>alert(1)</script>',
          status: 'ACTIVE',
        },
      }),
    );
    const service = makeService(fake);

    await expect(service.getPartnerRedirect('evt-partner-1', auth)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects a protocol-relative deep-link template (open redirect via //host)', async () => {
    const fake = makePrismaFake();
    seedEvent(
      fake,
      partnerEvent({
        partnerProvider: {
          id: 'partner-1',
          name: 'mock-partner',
          baseUrl: 'https://partner.example.com',
          deepLinkTemplate: '//evil.example.com/steal?event={externalEventId}',
          status: 'ACTIVE',
        },
      }),
    );
    const service = makeService(fake);

    await expect(service.getPartnerRedirect('evt-partner-1', auth)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('audits the partner redirect safely (no secrets stored)', async () => {
    const fake = makePrismaFake();
    seedEvent(fake, partnerEvent());
    const service = makeService(fake);

    await service.getPartnerRedirect('evt-partner-1', auth);

    const audit = fake.auditLogs.find((a) => a.action === 'PARTNER_EVENT_REDIRECT');
    expect(audit).toBeDefined();
    expect(audit.actorId).toBe('user-1');
    expect(audit.entityType).toBe('Event');
    expect(audit.entityId).toBe('evt-partner-1');
    expect(audit.newValue).toEqual({
      eventId: 'evt-partner-1',
      provider: 'mock-partner',
      externalEventId: 'evt-2001',
    });
    // No secrets/credentials in the audit payload.
    expect(JSON.stringify(audit.newValue)).not.toContain('secret');
    expect(JSON.stringify(audit.newValue)).not.toContain('token');
    expect(JSON.stringify(audit.newValue)).not.toContain('password');
  });
});

describe('Partner events blocked from native betting', () => {
  it('rejects bet placement on a PARTNER event (EVENT_UNAVAILABLE)', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake, partnerEvent());
    const market = { id: 'market-1', eventId: 'evt-partner-1', name: 'Match Winner', status: 'OPEN' };
    fake.markets.set(market.id, market);
    const selection = {
      id: 'sel-1',
      marketId: 'market-1',
      name: 'Mumbai Indians',
      providerSelectionId: 'evt-2001-sel-home',
      status: 'ACTIVE',
      odds: { price: '1.90', oddsVersion: 1, updatedAt: new Date() },
    };
    fake.selections.set(selection.id, selection);
    const service = makeService(fake);

    await expect(
      service.placeBet(auth, {
        eventId: 'evt-partner-1',
        marketId: 'market-1',
        selectionId: 'sel-1',
        stake: 1000,
        requestedOdds: '1.90',
        idempotencyKey: 'key-partner-blocked',
      }),
    ).rejects.toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'EVENT_UNAVAILABLE' }) }),
    );
  });

  it('allows bet placement on a NATIVE event (native bet slip works)', async () => {
    const fake = makePrismaFake();
    seedUser(fake);
    seedEvent(fake, { bettingMode: 'NATIVE', partnerProvider: null });
    const market = { id: 'market-1', eventId: 'evt-1', name: 'Match Winner', status: 'OPEN' };
    fake.markets.set(market.id, market);
    const selection = {
      id: 'sel-1',
      marketId: 'market-1',
      name: 'Home',
      providerSelectionId: 'evt-1001-sel-home',
      status: 'ACTIVE',
      odds: { price: '1.85', oddsVersion: 1, updatedAt: new Date() },
    };
    fake.selections.set(selection.id, selection);
    const service = makeService(fake);

    const res = await service.placeBet(auth, {
      eventId: 'evt-1',
      marketId: 'market-1',
      selectionId: 'sel-1',
      stake: 1000,
      requestedOdds: '1.85',
      idempotencyKey: 'key-native-ok',
    });

    expect(res.bet.status).toBe('ACCEPTED');
  });
});

describe('Event belongs to correct sport', () => {
  it('returns the sport summary on the event for partner deep-link building', async () => {
    const fake = makePrismaFake();
    seedEvent(fake, partnerEvent());
    const service = makeService(fake);

    const events = await service.listEvents();
    expect(events[0].competition?.sportId).toBe('sport-1');
    expect(events[0].sport?.slug).toBe('cricket');
    expect(events[0].sport?.name).toBe('Cricket');
  });

  it('scopes events by sport slug via the sports-hub filter', async () => {
    const fake = makePrismaFake();
    seedEvent(fake, partnerEvent());
    seedEvent(fake, { id: 'evt-football-1', bettingMode: 'NATIVE', partnerProvider: null, partnerProviderId: null, competition: null, competitionId: null });
    const service = makeService(fake);

    const cricket = await service.listEvents(undefined, 'cricket');
    expect(cricket).toHaveLength(1);
    expect(cricket[0].sport?.slug).toBe('cricket');

    // No events are attached to an unknown sport.
    const none = await service.listEvents(undefined, 'football');
    expect(none).toHaveLength(0);
  });
});

describe('User cannot manipulate provider/event routing', () => {
  it('rejects a partner redirect for a non-existent event', async () => {
    const fake = makePrismaFake();
    const service = makeService(fake);

    await expect(service.getPartnerRedirect('does-not-exist', auth)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects a partner redirect when the event game is not gambling-available', async () => {
    const fake = makePrismaFake();
    seedEvent(
      fake,
      partnerEvent({
        game: gamblingGame({ availability: { gamblingEnabled: false } }),
      }),
    );
    const service = makeService(fake);

    await expect(service.getPartnerRedirect('evt-partner-1', auth)).rejects.toThrow(
      NotFoundException,
    );
  });
});
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthController } from '../src/modules/health/health.controller';
import { HealthService } from '../src/modules/health/health.service';
import { PrismaService } from '../src/database/prisma.service';
import { AppService } from '../src/app.service';
import { AppController } from '../src/app.controller';
import { MockOperatorAdapter } from '@tanvion-royale/integrations';

describe('AppController (unit)', () => {
  it('returns API metadata', () => {
    const controller = new AppController(new AppService());
    expect(controller.getApiInfo().name).toBe('TANVIONROYALE API');
  });
});

describe('HealthService (unit)', () => {
  function makeHealthService(overrides: Record<string, jest.Mock> = {}) {
    const prismaMock = {
      isHealthy: jest.fn().mockResolvedValue(true),
      isSchemaUpToDate: jest.fn().mockResolvedValue(true),
      ...overrides,
    } as unknown as PrismaService;
    return new HealthService(prismaMock);
  }

  it('reports degraded when db is down but service is running', async () => {
    const service = makeHealthService({ isHealthy: jest.fn().mockResolvedValue(false) });

    const result = await service.getOverallStatus();

    expect(result.service).toBe('tanvion-royale-api');
    expect(result.checks.db).toBe('down');
    expect(result.status).toBe('degraded');
    expect(result.timestamp).toBeTruthy();
  });

  it('reports ok when db is healthy and the schema matches the generated client', async () => {
    const service = makeHealthService();

    const result = await service.getOverallStatus();

    expect(result.checks.db).toBe('up');
    expect(result.checks.schema).toBe('up');
    expect(result.status).toBe('ok');
  });

  it('reports degraded on SCHEMA DRIFT even when the db connection is up', async () => {
    // 2026-09-13 incident regression: /health reported db: up while
    // /auth/refresh and /auth/oauth/exchange 500ed on a missing
    // Session.previousRefreshTokenHash column (pending migration). A schema
    // probe makes drift loud in /health instead of hiding behind SELECT 1.
    const service = makeHealthService({ isSchemaUpToDate: jest.fn().mockResolvedValue(false) });

    const result = await service.getOverallStatus();

    expect(result.checks.db).toBe('up');
    expect(result.checks.schema).toBe('down');
    expect(result.status).toBe('degraded');
  });
});

describe('MockOperatorAdapter (unit)', () => {
  it('rejects calls before authentication', async () => {
    const adapter = new MockOperatorAdapter();
    await expect(adapter.getSports()).rejects.toThrow('not authenticated');
  });

  it('returns sports after authentication', async () => {
    const adapter = new MockOperatorAdapter();
    await adapter.authenticate();

    const sports = await adapter.getSports();

    expect(sports.length).toBeGreaterThan(0);
    expect(sports[0].externalProvider).toBe('mock-operator');
    expect(sports[0].externalId).toBeTruthy();
  });

  it('accepts a bet and returns an idempotency-backed reference', async () => {
    const adapter = new MockOperatorAdapter();
    await adapter.authenticate();

    const result = await adapter.placeBet({
      accountRef: 'user-1',
      type: 'SINGLE',
      stake: 1000, // minor units
      currency: 'BDT',
      selections: [{ externalSelectionId: 'evt-1001-sel-home', requestedDecimal: '1.85' }],
      idempotencyKey: 'test-key-1',
    });

    expect(result.status).toBe('ACCEPTED');
    expect(result.externalBetId).toBeTruthy();
    expect(result.potentialReturn).toBe(1850);
  });

  it('suspends getMarkets for unknown events gracefully (empty list)', async () => {
    const adapter = new MockOperatorAdapter();
    await adapter.authenticate();
    const markets = await adapter.getMarkets('evt-unknown');
    expect(markets).toEqual([]);
  });
});

describe('HealthController wiring (unit)', () => {
  it('exposes health through the controller', async () => {
    const prismaMock = {
      isHealthy: jest.fn().mockResolvedValue(true),
      isSchemaUpToDate: jest.fn().mockResolvedValue(true),
    } as unknown as PrismaService;
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: new HealthService(prismaMock) }],
    }).compile();

    const controller = moduleRef.get(HealthController);
    const result = await controller.getHealth();
    expect(result.status).toBe('ok');
  });
});

describe('ConfigService integration (unit)', () => {
  it('is provided by the Nest testing module', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ConfigService],
    }).compile();
    expect(moduleRef.get(ConfigService)).toBeInstanceOf(ConfigService);
  });
});
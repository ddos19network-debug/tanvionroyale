/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { decryptSecret } from '../src/common/utils/encryption';
import { PartnerProvidersService } from '../src/modules/sportsbook/partner-providers.service';
import {
  makeEmbeddedProviderPublicConfig,
  readEmbeddedProviderPublicConfig,
} from '../src/modules/sportsbook/partner-provider-config';

const TEST_ENCRYPTION_KEY = 'test-only-encryption-key-with-more-than-thirty-two-characters';
const DOMAIN = 'https://tanvionroyale.vercel.app';
const WALLET_BASE_URL = 'https://tanvionroyale.onrender.com/api/v1/winhouse';
const EMBED_KEY = 'ifr_0123456789abcdef0123456789abcdef01234567';
const WALLET_API_KEY = 'fake-wallet-api-key';
const CALLBACK_TOKEN = 'fake-callback-token';
const ADMIN = {
  id: 'admin-1',
  sessionId: 'admin-session-1',
  roles: ['ADMIN'],
  sessionKind: 'STAFF' as const,
};

function row(overrides: Record<string, unknown> = {}): any {
  const now = new Date('2026-09-24T00:00:00.000Z');
  return {
    id: 'provider-1',
    name: 'WinHouse',
    baseUrl: 'https://iframe.winhouse.bet',
    deepLinkTemplate: '',
    status: 'ACTIVE',
    apiKeyEnc: null,
    apiSecretEnc: null,
    authMode: null,
    apiVersion: null,
    syncStatus: null,
    lastSyncAt: null,
    lastSyncError: null,
    integrationType: 'SPORTS_IFRAME',
    environment: 'production',
    embedKey: EMBED_KEY,
    embedBaseUrl: 'https://iframe.winhouse.bet',
    walletApiKeyEnc: null,
    callbackTokenEnc: null,
    productTypes: ['SPORT'],
    config: makeEmbeddedProviderPublicConfig({
      domain: DOMAIN,
      walletBaseUrl: WALLET_BASE_URL,
    }),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeHarness(initial: any = row()) {
  let current = initial;
  const auditCalls: any[] = [];
  const prisma: any = {
    partnerProvider: {
      findMany: jest.fn(async () => [current]),
      findUnique: jest.fn(async ({ where }: any) => {
        if (!current) return null;
        if (where.id && where.id !== current.id) return null;
        if (where.name && where.name !== current.name) return null;
        return current;
      }),
      create: jest.fn(async ({ data }: any) => {
        current = row({ id: 'provider-new', name: data.name, ...data });
        return current;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        if (!current || current.id !== where.id) throw new Error('not found');
        current = { ...current, ...data, updatedAt: new Date() };
        return current;
      }),
      delete: jest.fn(async () => {
        current = null;
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        auditCalls.push(data);
        return data;
      }),
    },
  };
  const sync: any = {
    syncAll: jest.fn(async () => ({
      sports: 0,
      competitions: 0,
      events: 0,
      markets: 0,
      odds: 0,
      errors: [],
    })),
  };
  const service = new PartnerProvidersService(prisma, sync);
  return {
    service,
    prisma,
    auditCalls,
    get current() {
      return current;
    },
  };
}

const embeddedDto = (overrides: Record<string, unknown> = {}) => ({
  name: 'WinHouse',
  baseUrl: 'https://iframe.winhouse.bet',
  integrationType: 'SPORTS_IFRAME' as const,
  environment: 'production' as const,
  domain: DOMAIN,
  walletBaseUrl: WALLET_BASE_URL,
  embedKey: EMBED_KEY,
  embedBaseUrl: 'https://iframe.winhouse.bet',
  walletApiKey: WALLET_API_KEY,
  callbackToken: CALLBACK_TOKEN,
  ...overrides,
});

describe('PartnerProvidersService â€” WinHouse public and secret configuration', () => {
  const originalKey = process.env.ENCRYPTION_KEY;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalWalletKey = process.env.WINHOUSE_WALLET_API_KEY;
  const originalCallbackToken = process.env.WINHOUSE_CALLBACK_TOKEN;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
    process.env.NODE_ENV = 'test';
    delete process.env.WINHOUSE_WALLET_API_KEY;
    delete process.env.WINHOUSE_CALLBACK_TOKEN;
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalWalletKey === undefined) delete process.env.WINHOUSE_WALLET_API_KEY;
    else process.env.WINHOUSE_WALLET_API_KEY = originalWalletKey;
    if (originalCallbackToken === undefined) delete process.env.WINHOUSE_CALLBACK_TOKEN;
    else process.env.WINHOUSE_CALLBACK_TOKEN = originalCallbackToken;
  });

  it('encrypts both provider secrets and returns only set/unset state', async () => {
    const h = makeHarness(null);
    const view = await h.service.create(
      ADMIN,
      embeddedDto({ serverIp: '8.8.8.8' }),
    );

    expect(decryptSecret(h.current.walletApiKeyEnc)).toBe(WALLET_API_KEY);
    expect(decryptSecret(h.current.callbackTokenEnc)).toBe(CALLBACK_TOKEN);
    expect(h.current.walletApiKeyEnc).not.toContain(WALLET_API_KEY);
    expect(h.current.callbackTokenEnc).not.toContain(CALLBACK_TOKEN);
    expect(view).toMatchObject({
      domain: DOMAIN,
      walletBaseUrl: WALLET_BASE_URL,
      serverIp: '8.8.8.8',
      embedKey: EMBED_KEY,
      walletApiKeySet: true,
      callbackTokenSet: true,
    });

    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(WALLET_API_KEY);
    expect(serialized).not.toContain(CALLBACK_TOKEN);
    expect(serialized).not.toContain(h.current.walletApiKeyEnc);
    expect(serialized).not.toContain(h.current.callbackTokenEnc);
  });

  it('never copies encrypted credential columns into audit snapshots', async () => {
    const h = makeHarness(null);
    await h.service.create(ADMIN, embeddedDto());

    expect(h.auditCalls).toHaveLength(1);
    const serialized = JSON.stringify(h.auditCalls[0]);
    expect(serialized).not.toContain('walletApiKeyEnc');
    expect(serialized).not.toContain('callbackTokenEnc');
    expect(serialized).not.toContain('apiKeyEnc');
    expect(serialized).not.toContain('apiSecretEnc');
    expect(serialized).not.toContain(WALLET_API_KEY);
    expect(serialized).not.toContain(CALLBACK_TOKEN);
  });

  it('omitted secret fields preserve existing ciphertext during a public-field update', async () => {
    const h = makeHarness();
    h.current.walletApiKeyEnc = 'v1:existing-wallet';
    h.current.callbackTokenEnc = 'v1:existing-callback';
    const before = { ...h.current };

    await h.service.update(
      'provider-1',
      ADMIN,
      { domain: 'https://new-origin.example', environment: 'sandbox', status: 'ACTIVE' },
    );

    expect(h.current.walletApiKeyEnc).toBe(before.walletApiKeyEnc);
    expect(h.current.callbackTokenEnc).toBe(before.callbackTokenEnc);
  });

  it('allows a public-field edit when effective secrets are held in the environment', async () => {
    const previousWalletKey = process.env.WINHOUSE_WALLET_API_KEY;
    const previousCallbackToken = process.env.WINHOUSE_CALLBACK_TOKEN;
    process.env.WINHOUSE_WALLET_API_KEY = 'environment-only-wallet-key';
    process.env.WINHOUSE_CALLBACK_TOKEN = 'environment-only-callback-token';
    try {
      const h = makeHarness(row({ walletApiKeyEnc: null, callbackTokenEnc: null }));
      const view = await h.service.update(
        'provider-1',
        ADMIN,
        { domain: 'https://new-origin.example', environment: 'sandbox', status: 'ACTIVE' },
      );

      expect(view.domain).toBe('https://new-origin.example');
      expect(view.walletApiKeySet).toBe(false);
      expect(view.callbackTokenSet).toBe(false);
      expect(h.current.walletApiKeyEnc).toBeNull();
      expect(h.current.callbackTokenEnc).toBeNull();
      expect(JSON.stringify(view)).not.toContain('environment-only-wallet-key');
      expect(JSON.stringify(view)).not.toContain('environment-only-callback-token');
    } finally {
      if (previousWalletKey === undefined) delete process.env.WINHOUSE_WALLET_API_KEY;
      else process.env.WINHOUSE_WALLET_API_KEY = previousWalletKey;
      if (previousCallbackToken === undefined) delete process.env.WINHOUSE_CALLBACK_TOKEN;
      else process.env.WINHOUSE_CALLBACK_TOKEN = previousCallbackToken;
    }
  });

  it('rotates one secret atomically without returning it', async () => {
    const h = makeHarness();
    h.current.walletApiKeyEnc = 'v1:old-wallet';
    h.current.callbackTokenEnc = 'v1:old-callback';
    const rotated = 'rotated-wallet-api-key';

    const view = await h.service.update(
      'provider-1',
      ADMIN,
      { walletApiKey: rotated, status: 'ACTIVE' },
    );

    expect(decryptSecret(h.current.walletApiKeyEnc)).toBe(rotated);
    expect(h.current.callbackTokenEnc).toBe('v1:old-callback');
    expect(JSON.stringify(view)).not.toContain(rotated);
  });

  it('allows an explicit secret clear and leaves the integration unavailable', async () => {
    const h = makeHarness();
    h.current.walletApiKeyEnc = 'v1:old-wallet';
    h.current.callbackTokenEnc = 'v1:old-callback';

    const view = await h.service.update(
      'provider-1',
      ADMIN,
      { callbackToken: '', status: 'ACTIVE' },
    );

    expect(h.current.callbackTokenEnc).toBeNull();
    expect(view.callbackTokenSet).toBe(false);
    expect(view.walletApiKeySet).toBe(true);
    expect(view.status).toBe('INACTIVE');
  });

  it('disables the row when a secret is explicitly cleared even with environment fallback', async () => {
    const previousWalletKey = process.env.WINHOUSE_WALLET_API_KEY;
    const previousCallbackToken = process.env.WINHOUSE_CALLBACK_TOKEN;
    process.env.WINHOUSE_WALLET_API_KEY = 'environment-only-wallet-key';
    process.env.WINHOUSE_CALLBACK_TOKEN = 'environment-only-callback-token';
    try {
      const h = makeHarness();
      const view = await h.service.update('provider-1', ADMIN, { callbackToken: '' });

      expect(view.status).toBe('INACTIVE');
      expect(view.callbackTokenSet).toBe(false);
      expect(h.current.callbackTokenEnc).toBeNull();
    } finally {
      if (previousWalletKey === undefined) delete process.env.WINHOUSE_WALLET_API_KEY;
      else process.env.WINHOUSE_WALLET_API_KEY = previousWalletKey;
      if (previousCallbackToken === undefined) delete process.env.WINHOUSE_CALLBACK_TOKEN;
      else process.env.WINHOUSE_CALLBACK_TOKEN = previousCallbackToken;
    }
  });

  it('does not disable a legacy provider for unrelated embedded-only secret fields', async () => {
    const h = makeHarness(
      row({
        integrationType: 'SPORTS_API',
        deepLinkTemplate: '/sport/{sportSlug}/event/{externalEventId}',
      }),
    );

    const view = await h.service.update(
      'provider-1',
      ADMIN,
      { walletApiKey: '', status: 'ACTIVE' },
    );

    expect(view.status).toBe('ACTIVE');
  });

  it('always permits disabling an incomplete legacy row', async () => {
    const h = makeHarness(
      row({ embedKey: null, walletApiKeyEnc: null, callbackTokenEnc: null, config: null }),
    );

    const view = await h.service.update(
      'provider-1',
      ADMIN,
      { status: 'INACTIVE' },
    );

    expect(view.status).toBe('INACTIVE');
  });

  it.each([
    ['domain with a path', { domain: 'https://example.com/app' }],
    ['wildcard-style domain', { domain: 'https://*.example.com' }],
    ['wrong wallet path', { walletBaseUrl: 'https://api.example.com/api/v1' }],
    ['alternate production domain', { domain: 'https://alternate.example.com' }],
    ['alternate production wallet host', { walletBaseUrl: 'https://api.example.com/api/v1/winhouse' }],
    ['CIDR instead of an exact IP', { serverIp: '8.8.8.0/24' }],
    ['private IP', { serverIp: '10.0.0.1' }],
    ['reserved documentation IP', { serverIp: '203.0.113.10' }],
    ['reserved IPv6 documentation IP', { serverIp: '2001:db8::10' }],
    ['book origin with a path', { embedBaseUrl: 'https://iframe.winhouse.bet/book' }],
  ])('rejects %s', async (_label, overrides) => {
    const h = makeHarness(null);
    await expect(
      h.service.create(ADMIN, embeddedDto(overrides)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fails closed before storing a secret when production encryption is unsafe', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ENCRYPTION_KEY;
    const h = makeHarness(null);

    await expect(
      h.service.create(ADMIN, embeddedDto()),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(h.prisma.partnerProvider.create).not.toHaveBeenCalled();
  });
});

describe('Provider Separation — BigBang (Casino) vs WinHouse (Sportsbook)', () => {
  it('keeps BigBang/Casino configuration completely isolated from WinHouse', () => {
    // 1. Different product types and integration types
    const casinoProvider = {
      name: 'BigBang',
      integrationType: 'CASINO_API',
      productTypes: ['CASINO', 'LIVE_CASINO'],
      baseUrl: 'https://casino-api.example.com',
      apiKeyEnc: 'casino-merchant-id-enc',
      apiSecretEnc: 'casino-merchant-secret-enc',
    };

    const winhouseProvider = {
      name: 'WinHouse',
      integrationType: 'SPORTS_IFRAME',
      productTypes: ['SPORT'],
      baseUrl: 'https://iframe.winhouse.bet',
      embedKey: EMBED_KEY,
      embedBaseUrl: 'https://iframe.winhouse.bet',
      walletApiKeyEnc: 'winhouse-wallet-key-enc',
      callbackTokenEnc: 'winhouse-callback-token-enc',
    };

    // Assert disjoint schemas and distinct fields
    expect(casinoProvider.integrationType).not.toEqual(winhouseProvider.integrationType);
    expect(casinoProvider.productTypes).not.toEqual(winhouseProvider.productTypes);
    expect(casinoProvider.apiKeyEnc).not.toEqual(winhouseProvider.walletApiKeyEnc);
    expect(casinoProvider.apiSecretEnc).not.toEqual(winhouseProvider.callbackTokenEnc);
  });

  it('fails closed when WinHouse configuration is incomplete without touching Casino', () => {
    const incompleteWinHouse = row({
      walletApiKeyEnc: null,
      callbackTokenEnc: null,
    });
    const h = makeHarness(incompleteWinHouse);
    expect(h.current.name).toBe('WinHouse');
    expect(h.current.walletApiKeyEnc).toBeNull();
  });
});

describe('embedded provider public config allowlist', () => {
  it('normalizes exact values and ignores unknown or credential-like JSON keys', () => {
    const config = makeEmbeddedProviderPublicConfig({
      domain: 'https://example.com/',
      walletBaseUrl: 'https://api.example.com/api/v1/winhouse/',
      serverIp: '8.8.8.8',
    });
    expect(config).toEqual({
      domain: 'https://example.com',
      walletBaseUrl: 'https://api.example.com/api/v1/winhouse',
      serverIp: '8.8.8.8',
    });

    const read = readEmbeddedProviderPublicConfig({
      ...config,
      walletApiKey: 'must-not-be-exposed',
      callbackToken: 'must-not-be-exposed',
      arbitrary: 'must-not-be-exposed',
    });
    expect(read).toEqual({
      domain: 'https://example.com',
      walletBaseUrl: 'https://api.example.com/api/v1/winhouse',
      serverIp: '8.8.8.8',
    });
    expect(JSON.stringify(read)).not.toContain('must-not-be-exposed');
  });
});

describe('PartnerProvidersService — BigBang CASINO_AGGREGATOR admin configuration', () => {
  const originalKey = process.env.ENCRYPTION_KEY;
  const originalNodeEnv = process.env.NODE_ENV;

  const BIGBANG_BASE_URL = 'https://api.bigbangcasino.bet/api/v1';
  /** Fake placeholder credential — never a real sandbox or production key. */
  const API_KEY = 'ek_test_fake-bigbang-key-for-tests';

  const aggregatorDto = (overrides: Record<string, unknown> = {}) => ({
    name: 'BigBang',
    providerCode: 'BIGBANG',
    baseUrl: BIGBANG_BASE_URL,
    integrationType: 'CASINO_AGGREGATOR' as const,
    environment: 'sandbox' as const,
    apiKey: API_KEY,
    status: 'ACTIVE' as const,
    ...overrides,
  });

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
    process.env.NODE_ENV = 'test';
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('creates an ACTIVE sandbox BigBang row with the key encrypted and masked', async () => {
    const h = makeHarness(null);
    const view = await h.service.create(ADMIN, aggregatorDto());

    expect(h.current.providerCode).toBe('BIGBANG');
    expect(h.current.integrationType).toBe('CASINO_AGGREGATOR');
    expect(h.current.environment).toBe('sandbox');
    expect(h.current.baseUrl).toBe(BIGBANG_BASE_URL);
    expect(h.current.status).toBe('ACTIVE');
    // A casino aggregator serves the casino products and has NO sports
    // deep-link template — both set by the service itself.
    expect(h.current.productTypes).toEqual(['CASINO', 'LIVE_CASINO']);
    expect(h.current.deepLinkTemplate).toBe('');
    // Encrypted at rest; the ciphertext never contains the plaintext key.
    expect(decryptSecret(h.current.apiKeyEnc)).toBe(API_KEY);
    expect(h.current.apiKeyEnc).not.toContain(API_KEY);
    // The response only ever carries the set/unset flag.
    expect(view.apiKeySet).toBe(true);
    expect(JSON.stringify(view)).not.toContain(API_KEY);
  });

  it('supports production as an explicit, separate environment', async () => {
    const h = makeHarness(null);
    const view = await h.service.create(
      ADMIN,
      aggregatorDto({ name: 'BigBang Live', environment: 'production' }),
    );

    expect(h.current.environment).toBe('production');
    expect(view.environment).toBe('production');
  });

  it('rejects an ACTIVE aggregator create without an API key', async () => {
    const h = makeHarness(null);

    await expect(
      h.service.create(ADMIN, aggregatorDto({ apiKey: undefined })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.prisma.partnerProvider.create).not.toHaveBeenCalled();
  });

  it('rejects an aggregator row whose providerCode is not BIGBANG', async () => {
    const h = makeHarness(null);

    await expect(
      h.service.create(ADMIN, aggregatorDto({ providerCode: 'OTHER_AGGREGATOR' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.prisma.partnerProvider.create).not.toHaveBeenCalled();
  });

  it('rejects a baseUrl other than the verified BigBang API', async () => {
    const h = makeHarness(null);

    await expect(
      h.service.create(ADMIN, aggregatorDto({ baseUrl: 'https://evil.example/api/v1' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.prisma.partnerProvider.create).not.toHaveBeenCalled();
  });

  it('rejects a missing environment (sandbox and production are never implicit)', async () => {
    const h = makeHarness(null);

    await expect(
      h.service.create(ADMIN, aggregatorDto({ environment: undefined })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.prisma.partnerProvider.create).not.toHaveBeenCalled();
  });

  it('allows an INACTIVE aggregator row to be created without a key (configured later)', async () => {
    const h = makeHarness(null);
    const view = await h.service.create(
      ADMIN,
      aggregatorDto({ apiKey: undefined, status: 'INACTIVE' }),
    );

    expect(view.status).toBe('INACTIVE');
    expect(view.apiKeySet).toBe(false);
  });

  it('preserves the stored API key when an edit omits it', async () => {
    const h = makeHarness(null);
    await h.service.create(ADMIN, aggregatorDto());
    const stored = h.current.apiKeyEnc;

    const view = await h.service.update(h.current.id, ADMIN, { name: 'BigBang Sandbox' });

    expect(h.current.apiKeyEnc).toBe(stored);
    expect(view.apiKeySet).toBe(true);
    expect(JSON.stringify(view)).not.toContain(API_KEY);
  });

  it('replaces the ciphertext when a new API key is typed', async () => {
    const h = makeHarness(null);
    await h.service.create(ADMIN, aggregatorDto());
    const stored = h.current.apiKeyEnc;

    const view = await h.service.update(h.current.id, ADMIN, {
      apiKey: 'ek_test_rotated-fake-key',
    });

    expect(h.current.apiKeyEnc).not.toBe(stored);
    expect(decryptSecret(h.current.apiKeyEnc)).toBe('ek_test_rotated-fake-key');
    expect(view.apiKeySet).toBe(true);
    expect(JSON.stringify(view)).not.toContain('ek_test_rotated-fake-key');
  });

  it('clears the key and deactivates the row only on the explicit empty-string sentinel', async () => {
    const h = makeHarness(null);
    await h.service.create(ADMIN, aggregatorDto());

    const view = await h.service.update(h.current.id, ADMIN, { apiKey: '' });

    expect(h.current.apiKeyEnc).toBeNull();
    expect(view.apiKeySet).toBe(false);
    expect(view.status).toBe('INACTIVE');
  });

  it('refuses an ACTIVE edit that would leave the aggregator with no key at all', async () => {
    const h = makeHarness(
      row({
        name: 'BigBang',
        providerCode: 'BIGBANG',
        integrationType: 'CASINO_AGGREGATOR',
        baseUrl: BIGBANG_BASE_URL,
        environment: 'sandbox',
        apiKeyEnc: null,
        deepLinkTemplate: '',
      }),
    );

    await expect(
      h.service.update(h.current.id, ADMIN, { status: 'ACTIVE' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('never returns the plaintext key from list()', async () => {
    const h = makeHarness(null);
    await h.service.create(ADMIN, aggregatorDto());

    const views = await h.service.list();

    expect(views).toHaveLength(1);
    expect(views[0].apiKeySet).toBe(true);
    expect(JSON.stringify(views)).not.toContain(API_KEY);
  });

  it('keeps a BigBang edit away from the WinHouse-only fields (shape isolation)', async () => {
    const h = makeHarness(null);
    await h.service.create(ADMIN, aggregatorDto());

    await h.service.update(h.current.id, ADMIN, { environment: 'production' });

    expect(h.current.embedKey ?? null).toBeNull();
    expect(h.current.walletApiKeyEnc ?? null).toBeNull();
    expect(h.current.callbackTokenEnc ?? null).toBeNull();
    expect(h.current.environment).toBe('production');
  });
});

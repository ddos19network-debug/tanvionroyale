/* eslint-disable @typescript-eslint/no-explicit-any */
import { encryptSecret } from '../src/common/utils/encryption';
import { CasinoProviderFactory } from '../src/modules/casino/casino-provider.factory';
import { BIGBANG_DEFAULT_BASE_URL } from '../src/modules/bigbang/bigbang.config';
import type { PrismaService } from '../src/database/prisma.service';

/**
 * `CasinoProviderFactory.resolveBigBang()` — the ONLY place BigBang credentials
 * are resolved.
 *
 * The API key is decrypted from the environment-matched PartnerProvider row
 * (never an environment variable), the row is exposed exclusively through the
 * secret-free `toRowView` view, and every unusable configuration is refused
 * with a distinct, secret-free reason.
 */
const TEST_ENCRYPTION_KEY = 'test-only-encryption-key-with-more-than-thirty-two-characters';
const API_KEY = 'sandbox-key-never-logged';
const ROW_NAME = 'BIGBANG-SANDBOX';

function providerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-bigbang-1',
    name: ROW_NAME,
    providerCode: 'BIGBANG',
    baseUrl: BIGBANG_DEFAULT_BASE_URL,
    status: 'ACTIVE',
    environment: 'sandbox',
    apiVersion: 'v1',
    integrationType: 'CASINO_AGGREGATOR',
    productTypes: ['CASINO', 'LIVE_CASINO'],
    apiKeyEnc: encryptSecret(API_KEY),
    apiSecretEnc: null,
    walletApiKeyEnc: null,
    callbackTokenEnc: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeFactory(rows: any[]) {
  const prisma: any = {
    partnerProvider: {
      findMany: jest.fn(async () => rows),
      findUnique: jest.fn(async ({ where }: any) => rows.find((row) => row.name === where.name) ?? null),
    },
  };
  return {
    prisma,
    factory: new CasinoProviderFactory(prisma as unknown as PrismaService),
  };
}

describe('CasinoProviderFactory.resolveBigBang', () => {
  const envSnapshot = { ...process.env };

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
    process.env.PARTNER_CASINO_ENV = 'sandbox';
    process.env.PARTNER_CASINO_PROVIDER = ROW_NAME;
  });

  afterAll(() => {
    process.env = { ...envSnapshot } as NodeJS.ProcessEnv;
  });

  it('returns the row through toRowView (never an undefined view) and the decrypted key', async () => {
    const { factory } = makeFactory([providerRow()]);

    const resolved = await factory.resolveBigBang();

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    // The exact secret-free view produced by toRowView — not a raw row and not
    // an undefined `view` placeholder.
    expect(resolved.credentials.row).toEqual({
      id: 'row-bigbang-1',
      name: ROW_NAME,
      providerCode: 'BIGBANG',
      baseUrl: BIGBANG_DEFAULT_BASE_URL,
      status: 'ACTIVE',
      environment: 'sandbox',
      apiVersion: 'v1',
    });
    expect(resolved.credentials.apiKey).toBe(API_KEY);
    expect(resolved.credentials.environment).toBe('sandbox');
    // No encrypted column and no secret is ever part of the view.
    expect(Object.keys(resolved.credentials.row)).not.toContain('apiKeyEnc');
    expect(JSON.stringify(resolved.credentials.row)).not.toContain(API_KEY);
  });

  it('normalizes the row environment in the view', async () => {
    const { factory } = makeFactory([providerRow({ environment: ' PRODUCTION ' })]);

    const resolved = await factory.resolveBigBang();

    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.reason).toBe('environment_mismatch');
  });

  it('auto-selects the active CASINO_AGGREGATOR row for this environment', async () => {
    delete process.env.PARTNER_CASINO_PROVIDER;
    const { factory } = makeFactory([
      providerRow({ id: 'row-sandbox', environment: 'sandbox' }),
      providerRow({ id: 'row-production', name: 'BIGBANG-LIVE', environment: 'production' }),
    ]);

    const resolved = await factory.resolveBigBang();
    process.env.PARTNER_CASINO_PROVIDER = ROW_NAME;

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.credentials.row.id).toBe('row-sandbox');
    expect(resolved.credentials.environment).toBe('sandbox');
  });

  it('refuses when no BigBang row exists', async () => {
    const { factory } = makeFactory([]);

    const resolved = await factory.resolveBigBang();

    expect(resolved).toEqual({ ok: false, reason: 'not_configured', providerId: null });
  });

  it('refuses a disabled provider', async () => {
    const { factory } = makeFactory([providerRow({ status: 'INACTIVE' })]);

    const resolved = await factory.resolveBigBang();

    expect(resolved).toMatchObject({ ok: false, reason: 'provider_disabled' });
  });

  it('refuses an environment mismatch (sandbox and production are never mixed)', async () => {
    const { factory } = makeFactory([providerRow({ environment: 'production' })]);

    const resolved = await factory.resolveBigBang();

    expect(resolved).toMatchObject({ ok: false, reason: 'environment_mismatch' });
  });

  it('refuses an invalid BigBang base URL', async () => {
    const { factory } = makeFactory([providerRow({ baseUrl: 'https://evil.example/api/v1' })]);

    const resolved = await factory.resolveBigBang();

    expect(resolved).toMatchObject({ ok: false, reason: 'invalid_base_url' });
  });

  it('refuses a row without a stored API key', async () => {
    const { factory } = makeFactory([providerRow({ apiKeyEnc: null })]);

    const resolved = await factory.resolveBigBang();

    expect(resolved).toMatchObject({ ok: false, reason: 'credentials_missing' });
  });

  it('never exposes the decrypted key when the base URL is wrong', async () => {
    const { factory } = makeFactory([
      providerRow({ baseUrl: 'https://evil.example/api/v1', apiKeyEnc: encryptSecret(API_KEY) }),
    ]);

    const resolved = await factory.resolveBigBang();

    expect(JSON.stringify(resolved)).not.toContain(API_KEY);
  });
});
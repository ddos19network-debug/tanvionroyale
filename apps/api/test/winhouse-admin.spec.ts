/* eslint-disable @typescript-eslint/no-explicit-any */
import { WinHouseAdminController } from '../src/modules/winhouse/winhouse-admin.controller';
import type { WinHouseEnvConfig } from '../src/modules/winhouse/winhouse.config';
import { makeEmbeddedProviderPublicConfig } from '../src/modules/sportsbook/partner-provider-config';
import { WinHouseProviderFactory } from '../src/modules/winhouse/winhouse-provider.factory';


const WALLET_API_KEY = 'fake-wallet-key-for-self-test';
const CALLBACK_TOKEN = 'fake-callback-token-for-self-test';
const EMBED_KEY = 'ifr_0123456789abcdef0123456789abcdef01234567';
const DOMAIN = 'https://tanvionroyale.vercel.app';
const WALLET_BASE_URL = 'https://tanvionroyale.onrender.com/api/v1/winhouse';

const config: WinHouseEnvConfig = {
  environment: 'sandbox',
  environmentExplicit: true,
  providerRowName: null,
  embedKey: null,
  embedBaseUrl: 'https://iframe.winhouse.bet',
  walletApiKey: null,
  callbackToken: null,
  launchTtlMs: 300_000,
  maxLaunchTtlMs: 600_000,
  timeoutMs: 10_000,
  supportedCurrencies: ['BDT'],
  language: 'en',
  theme: 'dark',
  bottomGapPx: 56,
  frameHeight: '900px',
};

function makeHarness(configured = true) {
  const resolved: any = {
    config,
    row: {
      id: 'provider-1',
      name: 'WinHouse',
      status: 'ACTIVE',
      environment: 'sandbox',
      domain: DOMAIN,
      walletBaseUrl: WALLET_BASE_URL,
      serverIp: null,
      embedKey: EMBED_KEY,
      embedBaseUrl: 'https://iframe.winhouse.bet',
    },
    configured,
    credentialsSource: configured ? 'database' : 'none',
    unavailableReason: configured ? null : 'not configured',
    embedKey: configured ? EMBED_KEY : null,
    embedBaseUrl: configured ? 'https://iframe.winhouse.bet' : null,
    domain: configured ? DOMAIN : null,
    walletBaseUrl: configured ? WALLET_BASE_URL : null,
    serverIp: null,
    walletApiKey: configured ? WALLET_API_KEY : null,
    callbackToken: configured ? CALLBACK_TOKEN : null,
  };
  const prisma: any = {
    partnerProvider: {
      findUnique: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
    },
    winHouseSession: {
      count: jest.fn(async () => 0),
      findFirst: jest.fn(async () => null),
    },
    winHouseTransaction: {
      count: jest.fn(async () => 0),
      findFirst: jest.fn(async () => null),
    },
  };
  const providers: any = {
    resolve: jest.fn(async () => resolved),
    config: jest.fn(() => config),
    unavailableMessage: jest.fn(() => resolved.unavailableReason ?? 'unavailable'),
  };
  const wallet: any = {
    // The REAL service drives the wallet ledger inside a transaction that it
    // always rolls back; the unit harness substitutes it (its own behaviour is
    // covered by winhouse-wallet.spec.ts).
    probeWalletRoundTrip: jest.fn(async () => ({
      ok: true,
      detail: 'stake debit + capture + payout credit verified, then rolled back',
    })),
    diagnosticsSnapshot: jest.fn(() => ({
      lastCallback: null,
      lastBalanceChange: null,
      lastError: null,
    })),
  };
  const controller = new WinHouseAdminController(providers, prisma, wallet);
  return { controller, providers, prisma, wallet, resolved, factory: new WinHouseProviderFactory(prisma) };
}

describe('WinHouseAdminController — mutation-free self-test', () => {
  const originalEnvironment = process.env.WINHOUSE_ENV;
  const originalProvider = process.env.WINHOUSE_PROVIDER;
  const originalWalletApiKey = process.env.WINHOUSE_WALLET_API_KEY;
  const originalCallbackToken = process.env.WINHOUSE_CALLBACK_TOKEN;

  beforeEach(() => {
    process.env.WINHOUSE_ENV = 'sandbox';
    process.env.WINHOUSE_PROVIDER = '';
    delete process.env.WINHOUSE_WALLET_API_KEY;
    delete process.env.WINHOUSE_CALLBACK_TOKEN;
  });

  afterAll(() => {
    if (originalEnvironment === undefined) delete process.env.WINHOUSE_ENV;
    else process.env.WINHOUSE_ENV = originalEnvironment;
    if (originalProvider === undefined) delete process.env.WINHOUSE_PROVIDER;
    else process.env.WINHOUSE_PROVIDER = originalProvider;
    if (originalWalletApiKey === undefined) delete process.env.WINHOUSE_WALLET_API_KEY;
    else process.env.WINHOUSE_WALLET_API_KEY = originalWalletApiKey;
    if (originalCallbackToken === undefined) delete process.env.WINHOUSE_CALLBACK_TOKEN;
    else process.env.WINHOUSE_CALLBACK_TOKEN = originalCallbackToken;
  });

  it('validates the official local contract without a wallet mutation or secret response', async () => {
    const h = makeHarness();
    const result = await h.controller.selfTest();

    expect(result.ok).toBe(true);
    expect(result.checks.map((check) => check.check)).toEqual(
      expect.arrayContaining([
        'provider_resolved',
        'embed_key_format',
        'callback_token_configured',
        'wallet_api_key_configured',
        'portal_domain_configured',
        'portal_domain_expected',
        'wallet_base_url_configured',
        'server_ip_policy',
        'launch_token_mint_and_verify',
        'balance_change_signature_round_trip',
        'callback_token_compare',
        'wallet_base_url_expected',
        'required_credentials_resolved',
        'idempotency_fingerprint_stable',
        'idempotency_conflict_detected',
        'wallet_round_trip_rolled_back',
        'no_real_wager_guarantee',
      ]),
    );
    expect(JSON.stringify(result)).not.toContain(WALLET_API_KEY);
    expect(JSON.stringify(result)).not.toContain(CALLBACK_TOKEN);
    // The money-path dry run is delegated to the wallet service, which always
    // rolls its transaction back.
    expect(h.wallet.probeWalletRoundTrip).toHaveBeenCalledTimes(1);
    expect(h.prisma.winHouseSession.count).not.toHaveBeenCalled();
    expect(h.prisma.winHouseTransaction.count).not.toHaveBeenCalled();
  });

  it('fails closed with secret-free checks when the provider is incomplete', async () => {
    const h = makeHarness(false);
    const result = await h.controller.selfTest();

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.check === 'provider_resolved')).toMatchObject({
      ok: false,
      detail: 'not configured',
    });
    expect(JSON.stringify(result)).not.toContain(WALLET_API_KEY);
    expect(JSON.stringify(result)).not.toContain(CALLBACK_TOKEN);
  });

  it('fails closed when exact production portal metadata is missing or alternate', async () => {
    const completeRow = {
      id: 'provider-1',
      name: 'WinHouse',
      baseUrl: 'https://iframe.winhouse.bet',
      status: 'ACTIVE',
      environment: 'production',
      embedKey: EMBED_KEY,
      embedBaseUrl: 'https://iframe.winhouse.bet',
      walletApiKeyEnc: 'test-ciphertext-wallet',
      callbackTokenEnc: 'test-ciphertext-callback',
      config: makeEmbeddedProviderPublicConfig({
        domain: DOMAIN,
        walletBaseUrl: WALLET_BASE_URL,
      }),
    };

    for (const invalidConfig of [
      makeEmbeddedProviderPublicConfig({ domain: DOMAIN, walletBaseUrl: null }),
      makeEmbeddedProviderPublicConfig({ domain: null, walletBaseUrl: WALLET_BASE_URL }),
      makeEmbeddedProviderPublicConfig({
        domain: 'https://alternate.example.com',
        walletBaseUrl: WALLET_BASE_URL,
      }),
      makeEmbeddedProviderPublicConfig({
        domain: DOMAIN,
        walletBaseUrl: 'https://api.example.com/api/v1/winhouse',
      }),
    ]) {
      const h = makeHarness();
      process.env.WINHOUSE_ENV = 'production';
      h.prisma.partnerProvider.findMany.mockResolvedValueOnce([
        { ...completeRow, config: invalidConfig },
      ]);
      process.env.WINHOUSE_WALLET_API_KEY = WALLET_API_KEY;
      process.env.WINHOUSE_CALLBACK_TOKEN = CALLBACK_TOKEN;

      const resolved = await h.factory.resolve();

      expect(resolved.configured).toBe(false);
      expect(resolved.unavailableReason).toMatch(
        /missing its exact Domain|does not use TANVION's exact production/,
      );
      expect(resolved.walletApiKey).toBeNull();
      expect(resolved.callbackToken).toBeNull();
    }
  });

  it('network mode checks provider SSO without sending either wallet secret', async () => {
    const h = makeHarness();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      if (url.endsWith('/tenant/config?key=' + encodeURIComponent(EMBED_KEY))) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { launch?: string };
      const expiry = Number(body.launch?.split('.')[1] ?? 0);
      if (expiry > Date.now() + 10 * 60 * 1000) {
        return new Response(JSON.stringify({ error: 'expired' }), { status: 401 });
      }
      const playerId = 'trwh0123456789abcdef0123456789abcd';
      return new Response(
        JSON.stringify({ ok: true, token: 'book-session', username: `tanvion_${playerId}` }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const result = await h.controller.selfTest('true');
      expect(result.ok).toBe(true);
      expect(result.checks.find((check) => check.check === 'provider_sso_fresh_launch')).toMatchObject({
        ok: true,
      });
      expect(result.checks.find((check) => check.check === 'provider_sso_expiry_rejected')).toMatchObject({
        ok: true,
      });
      const serializedCalls = JSON.stringify(calls);
      expect(serializedCalls).toContain('/tenant/sso');
      expect(serializedCalls).not.toContain(WALLET_API_KEY);
      expect(serializedCalls).not.toContain(CALLBACK_TOKEN);
      expect(JSON.stringify(result)).not.toContain(WALLET_API_KEY);
      expect(JSON.stringify(result)).not.toContain(CALLBACK_TOKEN);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('reports the exact callback endpoints, a masked embed key and live diagnostics', async () => {
    const h = makeHarness();
    h.wallet.diagnosticsSnapshot.mockReturnValue({
      lastCallback: {
        kind: 'balance-change',
        outcome: 'rejected',
        code: 'WINHOUSE_BAD_SIGNATURE',
        status: 401,
        at: '2026-01-01T00:00:00.000Z',
      },
      lastBalanceChange: {
        kind: 'balance-change',
        outcome: 'rejected',
        code: 'WINHOUSE_BAD_SIGNATURE',
        status: 401,
        at: '2026-01-01T00:00:00.000Z',
      },
      lastError: {
        kind: 'balance-change',
        outcome: 'rejected',
        code: 'WINHOUSE_BAD_SIGNATURE',
        status: 401,
        at: '2026-01-01T00:00:00.000Z',
      },
    });

    const view = await h.controller.status();

    expect(view.userDataEndpoint).toBe(`${WALLET_BASE_URL}/user-data`);
    expect(view.balanceChangeEndpoint).toBe(`${WALLET_BASE_URL}/balance-change`);
    expect(view.embedKeyMasked).toMatch(/^ifr_\*{16}4567$/);
    expect(view.embedKeyMasked).not.toBe(EMBED_KEY);
    expect(view.lastError).toMatchObject({ code: 'WINHOUSE_BAD_SIGNATURE', status: 401 });
    expect(view.lastSuccessfulTransaction).toBeNull();
    expect(view.warning).toContain('WINHOUSE_BAD_SIGNATURE');
    expect(JSON.stringify(view)).not.toContain(WALLET_API_KEY);
    expect(JSON.stringify(view)).not.toContain(CALLBACK_TOKEN);
  });

  it('surfaces only a masked key and a sandbox warning when nothing is configured', async () => {
    const h = makeHarness(false);

    const view = await h.controller.status();

    expect(view.embedKeyMasked).toBeNull();
    // The registered callback base is reported even while the integration is
    // incomplete: it is the URL the provider must be pointed at.
    expect(view.userDataEndpoint).toBe(`${WALLET_BASE_URL}/user-data`);
    expect(view.balanceChangeEndpoint).toBe(`${WALLET_BASE_URL}/balance-change`);
    expect(view.lastCallback).toBeNull();
    expect(view.warning).toContain('not configured');
  });

  it('reports no callback endpoints when no provider row exists at all', async () => {
    const h = makeHarness(false);
    h.resolved.row = null;
    h.resolved.domain = null;
    h.resolved.walletBaseUrl = null;

    const view = await h.controller.status();

    expect(view.walletBaseUrl).toBeNull();
    expect(view.userDataEndpoint).toBeNull();
    expect(view.balanceChangeEndpoint).toBeNull();
  });

  it('formats the last movement that reached the TANVION wallet for display', async () => {
    const h = makeHarness();
    h.prisma.winHouseTransaction.findFirst.mockResolvedValue({
      transactionId: 'TX-1',
      ticketId: 'T-9',
      action: 'bet',
      amountWire: '-2.50',
      currency: 'BDT',
      balanceAfter: -250,
      createdAt: new Date('2026-02-01T10:00:00.000Z'),
    });

    const view = await h.controller.status();

    expect(view.lastSuccessfulTransaction).toEqual({
      transactionId: 'TX-1',
      ticketId: 'T-9',
      action: 'bet',
      amount: '-2.50',
      currency: 'BDT',
      balanceAfter: '-2.50',
      at: '2026-02-01T10:00:00.000Z',
    });
  });

  it('fails the self-test when the rolled-back wallet dry run fails', async () => {
    const h = makeHarness();
    h.wallet.probeWalletRoundTrip.mockResolvedValue({
      ok: false,
      detail: 'PrismaClientInitializationError: <redacted-url>',
    });

    const result = await h.controller.selfTest();

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.check === 'wallet_round_trip_rolled_back')).toMatchObject({
      ok: false,
      detail: 'PrismaClientInitializationError: <redacted-url>',
    });
  });

  it('names the missing credentials without ever returning a value', async () => {
    const h = makeHarness(false);

    const result = await h.controller.selfTest();
    const check = result.checks.find((entry) => entry.check === 'required_credentials_resolved');

    expect(check).toMatchObject({ ok: false });
    expect(check?.detail).toContain('WINHOUSE_EMBED_KEY');
    expect(check?.detail).toContain('WINHOUSE_WALLET_API_KEY');
    expect(check?.detail).toContain('WINHOUSE_CALLBACK_TOKEN');
    expect(JSON.stringify(result)).not.toContain(WALLET_API_KEY);
    expect(JSON.stringify(result)).not.toContain(CALLBACK_TOKEN);
  });
});

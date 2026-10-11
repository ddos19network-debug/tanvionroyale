/* eslint-disable @typescript-eslint/no-explicit-any */
import { WinHouseLaunchService } from '../src/modules/winhouse/winhouse-launch.service';
import type { PrismaService } from '../src/database/prisma.service';
import type { WalletService } from '../src/modules/wallet/wallet.service';
import type { WinHouseResolvedProvider } from '../src/modules/winhouse/winhouse-provider.factory';
import {
  WINHOUSE_DEFAULT_LAUNCH_TTL_MS,
  WINHOUSE_MAX_LAUNCH_TTL_MS,
  loadWinHouseEnvConfig,
  parseWinHouseEnvironment,
} from '../src/modules/winhouse/winhouse.config';
import {
  parseLaunchToken,
  mintLaunchToken,
  verifyLaunchToken,
} from '../src/modules/winhouse/winhouse-signature';
import { winhousePlayerId } from '../src/modules/winhouse/winhouse-player-identity';

/**
 * These are pure unit tests over mocked I/O, but they run in the same worker as
 * the whole suite (including ts-jest compilation of sibling suites). An explicit
 * budget keeps a starved worker from reporting a false TIMEOUT instead of a real
 * assertion failure, and every timing assertion below is written so that it can
 * never depend on how long the machine took to get here.
 */
jest.setTimeout(30_000);

/**
 * WinHouse (embedded sportsbook, Model B) SSO launch tests — BIG SPORT entry.
 *
 * Being signed in on TANVION does not sign the player into the provider's book,
 * so every page load mints a SHORT-LIVED launch token server-side:
 *
 *   launch = player_id.expiry.session.HMAC_SHA256("player_id|expiry|session", WALLET_API_KEY)
 *
 * What these tests pin:
 *   - the token the browser receives verifies against the wallet API key and is
 *     NEVER more than the provider's 10-minute maximum;
 *   - the player id is DERIVED from the TANVION user id (stable across page
 *     loads, no PII, no second provider account);
 *   - the browser response carries the PUBLIC embed key and book origin but
 *     NEVER the wallet API key or the callback token;
 *   - an unconfigured/unusable provider answers 503 (no book), never a token.
 */

const USER_ID = 'user-1';
const PROVIDER_ID = 'winhouse-provider-row-1';
const WALLET_API_KEY = 'winhouse-test-wallet-api-key';
const CALLBACK_TOKEN = 'winhouse-test-callback-token';
const EMBED_KEY = 'ifr_0123456789abcdef0123456789abcdef01234567';
const SESSION_ID = 'session-1';
const DOMAIN = 'https://tanvionroyale.vercel.app';
const WALLET_BASE_URL = 'https://tanvionroyale.onrender.com/api/v1/winhouse';
const CURRENCY = 'BDT';

function makeHarness(options: {
  configured?: boolean;
  walletApiKey?: string | null;
  env?: Record<string, string>;
  userAccountType?: 'CUSTOMER' | 'STAFF';
  userStatus?: 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'BANNED' | 'LOCKED' | 'CLOSED';
  walletStatus?: 'ACTIVE' | 'FROZEN' | 'CLOSED';
} = {}) {
  const configured = options.configured ?? true;
  const walletApiKey = options.walletApiKey === undefined ? WALLET_API_KEY : options.walletApiKey;

  const sessions: any[] = [];
  let seq = 0;
  const uuid = (prefix: string) => `${prefix}-${++seq}`;

  const prisma: any = {
    user: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.id === USER_ID
          ? {
              accountType: options.userAccountType ?? 'CUSTOMER',
              status: options.userStatus ?? 'ACTIVE',
            }
          : null,
      ),
    },
    winHouseSession: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const row of sessions) {
          if (row.userId === where.userId && row.providerId === where.providerId && row.status === where.status) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: uuid('wh-session'), launchedAt: new Date(), ...data };
        sessions.push(row);
        return row;
      }),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };

  const wallet: any = {
    getOrCreateWalletForUser: jest.fn(async (userId: string, currency: string) => ({
      id: `wallet-${userId}`,
      userId,
      currency,
      availableBalance: 10_000,
      lockedBalance: 0,
      status: options.walletStatus ?? 'ACTIVE',
    })),
  };

  const config = loadWinHouseEnvConfig({
    WINHOUSE_ENV: 'sandbox',
    ...(options.env ?? {}),
  } as NodeJS.ProcessEnv);

  const resolved: WinHouseResolvedProvider = {
    config,
    row: {
      id: PROVIDER_ID,
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
    credentialsSource: 'environment',
    unavailableReason: configured ? null : 'No embedded sportsbook (WinHouse) provider is configured.',
    embedKey: configured ? EMBED_KEY : null,
    embedBaseUrl: configured ? 'https://iframe.winhouse.bet' : null,
    domain: configured ? DOMAIN : null,
    walletBaseUrl: configured ? WALLET_BASE_URL : null,
    serverIp: null,
    walletApiKey: configured ? walletApiKey : null,
    callbackToken: configured ? CALLBACK_TOKEN : null,
  };

  const providers: any = {
    resolve: jest.fn(async () => resolved),
    config: () => config,
    unavailableMessage: (value: WinHouseResolvedProvider) =>
      value.unavailableReason ?? 'No embedded sportsbook (WinHouse) provider is configured.',
  };

  const service = new WinHouseLaunchService(
    prisma as unknown as PrismaService,
    providers,
    wallet as unknown as WalletService,
  );

  return { service, prisma, wallet, providers, resolved, sessions, config };
}

describe('winhouse launch — Model B SSO hand-off', () => {
  it('mints a launch token the provider can verify with the wallet API key', async () => {
    const h = makeHarness();
    const response = await h.service.launch({ userId: USER_ID, platformSessionId: SESSION_ID });

    const verdict = verifyLaunchToken({
      token: response.launch,
      walletApiKey: WALLET_API_KEY,
      maxTtlMs: WINHOUSE_MAX_LAUNCH_TTL_MS,
    });

    expect(verdict).toEqual({
      ok: true,
      playerId: response.playerId,
      expiryMs: new Date(response.expiresAt).getTime(),
      session: SESSION_ID,
    });
  });

  it('uses the stable, non-identifying player id derived from the TANVION user id', async () => {
    const h = makeHarness();
    const first = await h.service.launch({ userId: USER_ID, platformSessionId: SESSION_ID });
    const second = await h.service.launch({ userId: USER_ID, platformSessionId: 'session-2' });

    expect(first.playerId).toBe(winhousePlayerId(USER_ID));
    expect(first.playerId).toMatch(/^trwh[0-9a-f]{28}$/);
    // A page reload / new login mints a NEW token for the SAME provider player:
    // the book must never provision a second account.
    expect(second.playerId).toBe(first.playerId);
    expect(second.launch).not.toBe(first.launch);
    // No PII: neither the TANVION user id nor any contact detail leaks.
    expect(first.playerId).not.toContain(USER_ID);
    expect(JSON.stringify(first)).not.toContain('@');
  });

  it('derives the token from player|expiry|session only — a same-millisecond reload is harmless', async () => {
    // The provider's contract makes the token a PURE function of those three
    // fields, so two launches that land in the same millisecond produce the
    // byte-identical token. That is safe by construction (same player, same
    // expiry, same session) and is asserted here so nobody "fixes" it by
    // inventing a random component the provider does not accept.
    const now = 1_700_000_000_000;
    const playerId = winhousePlayerId(USER_ID);
    const first = mintLaunchToken({
      playerId,
      walletApiKey: WALLET_API_KEY,
      session: SESSION_ID,
      ttlMs: 60_000,
      maxTtlMs: WINHOUSE_MAX_LAUNCH_TTL_MS,
      now,
    });
    const second = mintLaunchToken({
      playerId,
      walletApiKey: WALLET_API_KEY,
      session: SESSION_ID,
      ttlMs: 60_000,
      maxTtlMs: WINHOUSE_MAX_LAUNCH_TTL_MS,
      now,
    });

    expect(second.token).toBe(first.token);
    expect(
      verifyLaunchToken({
        token: second.token,
        walletApiKey: WALLET_API_KEY,
        maxTtlMs: WINHOUSE_MAX_LAUNCH_TTL_MS,
        now,
      }),
    ).toMatchObject({ ok: true, playerId, session: SESSION_ID });
  });

  it('never exposes the wallet API key or the callback token to the browser', async () => {
    const h = makeHarness();
    const response = await h.service.launch({ userId: USER_ID, platformSessionId: SESSION_ID });
    const serialized = JSON.stringify(response);

    expect(serialized).not.toContain(WALLET_API_KEY);
    expect(serialized).not.toContain(CALLBACK_TOKEN);
    // The two secrets are never even named in the browser payload shape.
    expect(Object.keys(response)).not.toContain('walletApiKey');
    expect(Object.keys(response)).not.toContain('callbackToken');
    // The public embed key + book origin ARE part of the payload (by design).
    expect(response.embedKey).toBe(EMBED_KEY);
    expect(response.embedBaseUrl).toBe('https://iframe.winhouse.bet');
  });

  it('describes the product honestly: BIG SPORT, embedded, environment-scoped', async () => {
    const h = makeHarness();
    const response = await h.service.launch({ userId: USER_ID, platformSessionId: SESSION_ID });

    expect(response).toMatchObject({
      provider: 'WinHouse',
      integration: 'SPORTS_IFRAME',
      product: 'SPORT',
      environment: 'sandbox',
      language: 'en',
      theme: 'dark',
      frameHeight: '900px',
    });
    expect(response.bottomGapPx).toBeGreaterThan(0);
  });

  it('keeps the token lifetime inside the provider maximum of 10 minutes', async () => {
    // A wildly over-long configured TTL is clamped, never honoured.
    const h = makeHarness({ env: { WINHOUSE_LAUNCH_TTL_MS: '3600000' } });
    const response = await h.service.launch({ userId: USER_ID, platformSessionId: SESSION_ID });

    const parsed = parseLaunchToken(response.launch);
    expect(parsed).not.toBeNull();
    // A clamped TTL is exactly the maximum: the token can never be dated further
    // ahead than the provider accepts, and it is still in the future.
    expect(parsed!.expiryMs - Date.now()).toBeLessThanOrEqual(WINHOUSE_MAX_LAUNCH_TTL_MS);
    expect(parsed!.expiryMs - Date.now()).toBeGreaterThan(0);
    expect(h.config.launchTtlMs).toBe(WINHOUSE_MAX_LAUNCH_TTL_MS);
  });

  it('honours the configured lifetime and reports it unchanged to the browser', async () => {
    const h = makeHarness({ env: { WINHOUSE_LAUNCH_TTL_MS: '120000' } });
    const response = await h.service.launch({ userId: USER_ID, platformSessionId: SESSION_ID });

    const parsed = parseLaunchToken(response.launch);
    // The token's own expiry is the authority; the response echoes it verbatim.
    expect(parsed?.expiryMs).toBe(new Date(response.expiresAt).getTime());
    expect(parsed!.expiryMs - Date.now()).toBeLessThanOrEqual(h.config.launchTtlMs);
    expect(parsed!.expiryMs - Date.now()).toBeGreaterThan(0);
  });

  it('defaults to the documented 5-minute lifetime (inside the 10-minute ceiling)', () => {
    const config = loadWinHouseEnvConfig({ WINHOUSE_ENV: 'sandbox' } as NodeJS.ProcessEnv);
    expect(config.launchTtlMs).toBe(WINHOUSE_DEFAULT_LAUNCH_TTL_MS);
    expect(config.launchTtlMs).toBeLessThanOrEqual(WINHOUSE_MAX_LAUNCH_TTL_MS);
  });

  it('accepts only the two explicit environment names', () => {
    expect(parseWinHouseEnvironment('production')).toEqual({
      environment: 'production',
      explicit: true,
    });
    expect(parseWinHouseEnvironment('sandbox')).toEqual({
      environment: 'sandbox',
      explicit: true,
    });
    for (const invalid of [undefined, '', 'live', 'prod', 'test', 'stage', 'invalid']) {
      expect(parseWinHouseEnvironment(invalid).explicit).toBe(false);
    }
  });
});

describe('winhouse launch — session record and honest failure', () => {
  it('records one ACTIVE launch session per user and closes the previous one', async () => {
    const h = makeHarness();
    await h.service.launch({ userId: USER_ID, platformSessionId: SESSION_ID });
    await h.service.launch({ userId: USER_ID, platformSessionId: SESSION_ID });

    expect(h.sessions).toHaveLength(2);
    expect(h.sessions.filter((row) => row.status === 'ACTIVE')).toHaveLength(1);
    expect(h.sessions[0].status).toBe('CLOSED');
    expect(h.sessions[1]).toMatchObject({
      providerId: PROVIDER_ID,
      userId: USER_ID,
      providerPlayerId: winhousePlayerId(USER_ID),
      platformSessionId: SESSION_ID,
      currency: CURRENCY,
      environment: 'sandbox',
      status: 'ACTIVE',
    });
    expect(h.sessions[1].launchExpiresAt).toBeInstanceOf(Date);
  });

  it.each([
    ['staff account', { userAccountType: 'STAFF' as const }],
    ['disabled account', { userStatus: 'SUSPENDED' as const }],
    ['frozen wallet', { walletStatus: 'FROZEN' as const }],
  ])('refuses a %s before minting or recording a launch', async (_label, options) => {
    const h = makeHarness(options);
    await expect(
      h.service.launch({ userId: USER_ID, platformSessionId: SESSION_ID }),
    ).rejects.toMatchObject({ status: 403 });
    expect(h.sessions).toHaveLength(0);
  });

  it('creates the ONE wallet for the player (never a provider-side balance)', async () => {
    const h = makeHarness();
    await h.service.launch({ userId: USER_ID, platformSessionId: SESSION_ID });

    expect(h.wallet.getOrCreateWalletForUser).toHaveBeenCalledWith(USER_ID, CURRENCY);
  });

  it('expires a launch token after its lifetime (the book then loads signed out)', async () => {
    const h = makeHarness({ env: { WINHOUSE_LAUNCH_TTL_MS: '60000' } });
    const response = await h.service.launch({ userId: USER_ID, platformSessionId: SESSION_ID });
    const expiryMs = new Date(response.expiresAt).getTime();

    expect(
      verifyLaunchToken({
        token: response.launch,
        walletApiKey: WALLET_API_KEY,
        maxTtlMs: WINHOUSE_MAX_LAUNCH_TTL_MS,
        now: expiryMs + 1,
      }),
    ).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses with 503 (and mints no token) when no embedded sportsbook is configured', async () => {
    const h = makeHarness({ configured: false });
    await expect(
      h.service.launch({ userId: USER_ID, platformSessionId: SESSION_ID }),
    ).rejects.toMatchObject({ status: 503 });
    expect(h.sessions).toHaveLength(0);
  });

  it('refuses with 503 when the wallet API key is missing (nothing can be signed)', async () => {
    const h = makeHarness({ walletApiKey: null });
    try {
      await h.service.launch({ userId: USER_ID, platformSessionId: SESSION_ID });
      throw new Error('expected a refusal');
    } catch (error) {
      const body = (error as any).getResponse?.() as { message?: string };
      expect((error as any).getStatus()).toBe(503);
      // The message is safe: no key, no token, no signature.
      expect(JSON.stringify(body)).not.toContain(WALLET_API_KEY);
      expect(JSON.stringify(body)).not.toContain(CALLBACK_TOKEN);
    }
    expect(h.sessions).toHaveLength(0);
  });

  it('supports a launch without a platform session (the token keeps four parts)', async () => {
    const h = makeHarness();
    const response = await h.service.launch({ userId: USER_ID, platformSessionId: null });

    expect(response.launch.split('.')).toHaveLength(4);
    expect(
      verifyLaunchToken({
        token: response.launch,
        walletApiKey: WALLET_API_KEY,
        maxTtlMs: WINHOUSE_MAX_LAUNCH_TTL_MS,
      }),
    ).toMatchObject({ ok: true, session: '' });
    expect(h.sessions[0].platformSessionId).toBeNull();
  });
});

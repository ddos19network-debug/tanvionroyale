/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ConflictException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../src/modules/auth/auth.service';
import { OAuthService } from '../src/modules/auth/oauth.service';
import { OtpService } from '../src/modules/auth/otp.service';
import { makeJwtFake, makePrismaFake, makeUser } from './helpers-phase11';

const GOOGLE_ENV = {
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_CALLBACK_URL: 'http://api.test/auth/google/callback',
  OAUTH_ALLOWED_REDIRECTS: 'http://web.test',
};

function fetchOnce(profile: unknown) {
  const tokenResponse = { ok: true, json: async () => ({ access_token: 'provider-token' }) };
  const profileResponse = { ok: true, json: async () => profile };
  return jest.fn().mockResolvedValueOnce(tokenResponse).mockResolvedValueOnce(profileResponse);
}

async function makeOAuthService(env: Record<string, string> = GOOGLE_ENV, jwtOverrides = {}) {
  const { prisma, state } = makePrismaFake();
  const prev = { ...process.env };
  Object.assign(process.env, env);
  const jwt = makeJwtFake({
    signAsync: jest.fn(async () => 'signed-state'),
    verifyAsync: jest.fn(async () => ({ p: 'GOOGLE', mode: 'login' })),
    ...jwtOverrides,
  }) as any;
  const otp = new OtpService(prisma);
  const auth = new AuthService(prisma, makeJwtFake(), otp);
  const oauth = new OAuthService(prisma, jwt, auth, otp);
  return { oauth, auth, otp, state, jwt, cleanup: () => Object.assign(process.env, prev) };
}

describe('Phase 11 — Google/Facebook OAuth (unit)', () => {
  it('start() returns a provider consent URL when configured', async () => {
    const { oauth, cleanup } = await makeOAuthService();
    const url = await oauth.start('GOOGLE', 'login');
    expect(url).toContain('accounts.google.com');
    expect(url).toContain('client_id=test-client-id');
    cleanup();
  });

  it('start() fails safely when the provider is not configured', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CALLBACK_URL;
    const { oauth, cleanup } = await makeOAuthService({});
    await expect(oauth.start('GOOGLE', 'login')).rejects.toThrow(ServiceUnavailableException);
    cleanup();
  });

  it('callback with an invalid state is rejected', async () => {
    const { oauth, cleanup, jwt } = await makeOAuthService(GOOGLE_ENV, {
      verifyAsync: jest.fn(async () => {
        throw new Error('bad state');
      }),
    });
    (global as any).fetch = fetchOnce({ sub: 'g-1', email: 'a@b.c', email_verified: true });
    await expect(oauth.handleCallback('GOOGLE', 'code', 'state')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(jwt.verifyAsync).toHaveBeenCalled();
    cleanup();
  });

  it('start() builds the Google authorization URL with the exact OAuth params', async () => {
    const { oauth, cleanup } = await makeOAuthService();
    const url = new URL(await oauth.start('GOOGLE', 'login'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    // The redirect_uri is the API callback URL — never the frontend origin.
    expect(url.searchParams.get('redirect_uri')).toBe('http://api.test/auth/google/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('state')).toBe('signed-state');
    expect(url.searchParams.get('prompt')).toBe('select_account');
    // No token parameters may ever appear in the consent URL.
    expect(url.searchParams.has('access_token')).toBe(false);
    expect(url.searchParams.has('refresh_token')).toBe(false);
    cleanup();
  });

  it('start() uses GOOGLE_CALLBACK_URL verbatim as the provider redirect_uri', async () => {
    const { oauth, cleanup } = await makeOAuthService({
      ...GOOGLE_ENV,
      GOOGLE_CALLBACK_URL: 'https://tanvionroyale.onrender.com/api/v1/auth/google/callback',
    });
    const url = new URL(await oauth.start('GOOGLE', 'login'));
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://tanvionroyale.onrender.com/api/v1/auth/google/callback',
    );
    // The frontend origin must never leak into the Google redirect_uri.
    expect(url.searchParams.get('redirect_uri')).not.toContain('tanvionroyale.vercel.app');
    cleanup();
  });

  it('callback with a provider MISMATCH in the state is rejected', async () => {
    const { oauth, cleanup, jwt } = await makeOAuthService(GOOGLE_ENV, {
      verifyAsync: jest.fn(async () => ({ p: 'FACEBOOK', mode: 'login' })),
    });
    (global as any).fetch = fetchOnce({ id: 'fb-1', email: 'fb@example.com' });
    await expect(oauth.handleCallback('GOOGLE', 'code', 'state')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(jwt.verifyAsync).toHaveBeenCalled();
    cleanup();
  });

  it('callback without a state or code is rejected before any provider call', async () => {
    const { oauth, cleanup } = await makeOAuthService();
    (global as any).fetch = jest.fn();
    await expect(oauth.handleCallback('GOOGLE', 'code', '')).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(oauth.handleCallback('GOOGLE', '', 'state')).rejects.toThrow(
      BadRequestException,
    );
    expect((global as any).fetch).not.toHaveBeenCalled();
    cleanup();
  });

  it('the frontend exchange redirect contains ONLY the one-time code — never provider tokens', async () => {
    const { oauth, cleanup } = await makeOAuthService();
    (global as any).fetch = fetchOnce({
      sub: 'g-1',
      email: 'a@b.c',
      email_verified: true,
    });
    const redirectUrl = await oauth.handleCallback('GOOGLE', 'code', 'signed-state');
    expect(redirectUrl).toMatch(/^http:\/\/web\.test\/oauth\/callback\?code=[0-9a-f]{64}$/);
    expect(redirectUrl).not.toContain('access_token');
    expect(redirectUrl).not.toContain('refresh_token');
    expect(redirectUrl).not.toContain('provider-token');
    cleanup();
  });

  it('trailing slashes on the allowed redirect are normalized to avoid //oauth/callback', async () => {
    const { oauth, cleanup } = await makeOAuthService({
      ...GOOGLE_ENV,
      OAUTH_ALLOWED_REDIRECTS: ' https://web.test/ , https://backup.test/ ',
    });
    (global as any).fetch = fetchOnce({
      sub: 'g-1',
      email: 'a@b.c',
      email_verified: true,
    });
    const redirectUrl = await oauth.handleCallback('GOOGLE', 'code', 'signed-state');
    expect(redirectUrl).toMatch(/^https:\/\/web\.test\/oauth\/callback\?code=/);
    expect(redirectUrl).not.toContain('//oauth/callback');
    cleanup();
  });

  it('in PRODUCTION a missing allowed redirect fails safely instead of localhost fallback', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const { oauth, cleanup } = await makeOAuthService({ ...GOOGLE_ENV, OAUTH_ALLOWED_REDIRECTS: '' });
    (global as any).fetch = fetchOnce({
      sub: 'g-1',
      email: 'a@b.c',
      email_verified: true,
    });
    await expect(oauth.handleCallback('GOOGLE', 'code', 'signed-state')).rejects.toThrow(
      ServiceUnavailableException,
    );
    process.env.NODE_ENV = prevNodeEnv;
    cleanup();
  });

  it('new Google identity with a VERIFIED email creates an auto-verified account', async () => {
    const { oauth, state, cleanup } = await makeOAuthService();
    (global as any).fetch = fetchOnce({
      sub: 'g-1',
      email: 'New@Example.com',
      email_verified: true,
    });

    const redirectUrl = await oauth.handleCallback('GOOGLE', 'code', 'signed-state');

    expect(redirectUrl).toContain('http://web.test/oauth/callback?code=');
    const user = state.users[0];
    expect(user.email).toBe('new@example.com');
    expect(user.emailVerified).toBe(true);
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(state.identities).toHaveLength(1);
    expect(state.identities[0].provider).toBe('GOOGLE');
    // Google's verified-email claim also persists a VERIFIED EMAIL record.
    const emailVerification = state.verifications.find((v) => v.type === 'EMAIL');
    expect(emailVerification).toBeDefined();
    expect(emailVerification!.status).toBe('VERIFIED');
    // The one-time exchange code is stored hashed, never plaintext.
    expect(state.otps[0].purpose).toBe('OAUTH_EXCHANGE');
    expect(state.otps[0].codeHash).not.toBe(redirectUrl.split('code=')[1]);

    // exchange() turns the one-time code into a real application session.
    const tokens = await oauth.exchange(redirectUrl.split('code=')[1]);
    expect(tokens.accessToken).toBe('access-token');
    expect(state.sessions).toHaveLength(1);
    cleanup();
  });

  it('a Google identity cannot be linked to two different users', async () => {
    const { oauth, state, cleanup } = await makeOAuthService();
    state.users.push(makeUser({ id: 'u1' }));
    state.users.push(makeUser({ id: 'u2', phone: '+447911999999', username: 'other' }));
    state.identities.push({
      id: 'i1',
      provider: 'GOOGLE',
      providerAccountId: 'g-1',
      userId: 'u1',
    });

    await expect(
      oauth['linkIdentity']('GOOGLE', 'u2', {
        providerAccountId: 'g-1',
        email: null,
        emailVerified: false,
      }),
    ).rejects.toThrow(ConflictException);
    expect(state.identities).toHaveLength(1);
    cleanup();
  });

  it('an existing account is auto-linked only when the provider email is VERIFIED', async () => {
    const { oauth, state, cleanup } = await makeOAuthService();
    state.users.push(makeUser({ id: 'u1', email: 'known@example.com', emailVerified: true }));

    (global as any).fetch = fetchOnce({
      sub: 'g-2',
      email: 'known@example.com',
      email_verified: true,
    });
    await oauth.handleCallback('GOOGLE', 'code', 'signed-state');
    expect(state.identities).toHaveLength(1);
    expect(state.identities[0].userId).toBe('u1');
    cleanup();
  });

  it('an UNVERIFIED provider email never auto-merges into an existing account', async () => {
    const { oauth, state, cleanup } = await makeOAuthService();
    state.users.push(makeUser({ id: 'u1', email: 'known@example.com' }));

    (global as any).fetch = fetchOnce({
      sub: 'g-3',
      email: 'known@example.com',
      email_verified: false,
    });
    await expect(oauth.handleCallback('GOOGLE', 'code', 'signed-state')).rejects.toThrow(
      ConflictException,
    );
    expect(state.identities).toHaveLength(0);
    cleanup();
  });

  it('Facebook identities are created but their email is NEVER auto-verified', async () => {
    const { oauth, state, cleanup } = await makeOAuthService(
      {
        FACEBOOK_CLIENT_ID: 'fb-id',
        FACEBOOK_CLIENT_SECRET: 'fb-secret',
        FACEBOOK_CALLBACK_URL: 'http://api.test/auth/facebook/callback',
        OAUTH_ALLOWED_REDIRECTS: 'http://web.test',
      },
      { verifyAsync: jest.fn(async () => ({ p: 'FACEBOOK', mode: 'login' })) },
    );
    (global as any).fetch = fetchOnce({ id: 'fb-1', email: 'fb@example.com' });

    const redirectUrl = await oauth.handleCallback('FACEBOOK', 'code', 'signed-state');
    expect(redirectUrl).toContain('/oauth/callback?code=');
    expect(state.users[0].email).toBe('fb@example.com');
    expect(state.users[0].emailVerified).toBe(false);
    expect(state.users[0].emailVerifiedAt).toBeNull();
    expect(state.identities[0].provider).toBe('FACEBOOK');
    expect(state.identities[0].providerAccountId).toBe('fb-1');
    // Facebook has no reliable verified-email flag, so NO EMAIL verification record.
    expect(state.verifications.find((v) => v.type === 'EMAIL')).toBeUndefined();
    cleanup();
  });

  it('the callback redirect carries ONLY the one-time exchange code (never tokens)', async () => {
    const { oauth, state, cleanup } = await makeOAuthService();
    (global as any).fetch = fetchOnce({
      sub: 'g-9',
      email: 'g9@example.com',
      email_verified: true,
    });
    const redirectUrl = await oauth.handleCallback('GOOGLE', 'code', 'signed-state');
    const url = new URL(redirectUrl);
    expect(url.pathname).toBe('/oauth/callback');
    // The ONLY query parameter is the one-time exchange code — no tokens.
    expect(Array.from(url.searchParams.keys())).toEqual(['code']);
    expect(url.searchParams.get('code')!.length).toBeGreaterThanOrEqual(16);
    expect(/token|access|refresh/i.test(redirectUrl)).toBe(false);
    // Tokens are issued ONLY by the authenticated /auth/oauth/exchange step.
    expect(state.sessions).toHaveLength(0);
    cleanup();
  });
});

describe('Phase 13 — OAuth exchange code security', () => {
  it('an EXPIRED one-time exchange code is rejected', async () => {
    const { oauth, state, cleanup } = await makeOAuthService();
    const code = await oauth['otpService'].createExchangeCode({ userId: 'u1' });
    state.otps[0].expiresAt = new Date(Date.now() - 1000);
    await expect(oauth.exchange(code)).rejects.toThrow(BadRequestException);
    expect(state.sessions).toHaveLength(0);
    cleanup();
  });

  it('a one-time exchange code cannot be REUSED after a successful exchange', async () => {
    const { oauth, state, cleanup } = await makeOAuthService();
    state.users.push(makeUser({ id: 'u1' }));
    const code = await oauth['otpService'].createExchangeCode({ userId: 'u1' });
    await oauth.exchange(code);
    await expect(oauth.exchange(code)).rejects.toThrow(BadRequestException);
    cleanup();
  });

  it('an INVALID provider authorization code fails without creating a session', async () => {
    const { oauth, state, cleanup } = await makeOAuthService();
    // The production error path reads the provider's error body via .text()
    // for diagnostics before throwing, so the mock must expose it too.
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      text: async () => 'provider error body',
      json: async () => ({}),
    });
    await expect(oauth.handleCallback('GOOGLE', 'bad-provider-code', 'signed-state')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(state.otps).toHaveLength(0);
    expect(state.users).toHaveLength(0);
    expect(state.sessions).toHaveLength(0);
    cleanup();
  });

  it('a consumed code WITHOUT a userId in its payload is rejected as 4xx (never a 500)', async () => {
    const { oauth, state, cleanup } = await makeOAuthService();
    const code = await oauth['otpService'].createExchangeCode({});
    await expect(oauth.exchange(code)).rejects.toThrow(UnauthorizedException);
    expect(state.sessions).toHaveLength(0);
    cleanup();
  });

  it('a consumed code with a NULL metadata payload is rejected as 4xx (never a 500)', async () => {
    // Simulates a corrupt/legacy OtpCode row whose metadata column is null.
    const { oauth, state, cleanup } = await makeOAuthService();
    const code = await oauth['otpService'].createExchangeCode({ userId: 'u1' });
    state.otps[0].metadata = null;
    await expect(oauth.exchange(code)).rejects.toThrow(UnauthorizedException);
    expect(state.sessions).toHaveLength(0);
    cleanup();
  });

  it('a consumed code with a non-string userId is rejected as 4xx (never a 500)', async () => {
    const { oauth, state, cleanup } = await makeOAuthService();
    const code = await oauth['otpService'].createExchangeCode({ userId: 4242 });
    await expect(oauth.exchange(code)).rejects.toThrow(UnauthorizedException);
    expect(state.sessions).toHaveLength(0);
    cleanup();
  });
});

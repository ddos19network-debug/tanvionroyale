/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import * as argon2 from 'argon2';
import { Prisma } from '../src/generated/prisma';
import { AuthService } from '../src/modules/auth/auth.service';
import { OtpService } from '../src/modules/auth/otp.service';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { makeJwtFake, makePrismaFake, makeUser } from './helpers-phase11';

/** Same digest the auth service stores at rest. */
function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Hash-aware fake of the Session rotation storage.
 *
 * Emulates the compare-and-set semantics of refreshTokenHash /
 * previousRefreshTokenHash so refresh() race behaviour (current slot, previous
 * slot, replay) can be exercised without a database.
 */
function makeRotationFake(user: Record<string, unknown> = makeUser({})) {
  const slots = { current: sha('token-1'), previous: null as string | null };
  const row = () => ({
    id: 's1',
    userId: 'u1',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 3_600_000),
    user,
    get refreshTokenHash() {
      return slots.current;
    },
    get previousRefreshTokenHash() {
      return slots.previous;
    },
  });

  const { prisma } = makePrismaFake();
  prisma.session.findUnique = jest.fn(async ({ where }: any) => {
    if (where.refreshTokenHash !== undefined) {
      return slots.current === where.refreshTokenHash ? row() : null;
    }
    if (where.previousRefreshTokenHash !== undefined) {
      return slots.previous !== null && slots.previous === where.previousRefreshTokenHash
        ? row()
        : null;
    }
    if (where.id) return row();
    return null;
  }) as any;
  prisma.session.findFirst = jest.fn(async ({ where }: any) => {
    if (where.previousRefreshTokenHash !== undefined) {
      return slots.previous !== null && slots.previous === where.previousRefreshTokenHash
        ? row()
        : null;
    }
    return row();
  }) as any;
  prisma.session.updateMany = jest.fn(async ({ where, data }: any) => {
    if (where.id !== 's1' || where.revokedAt !== null) return { count: 0 };
    if (slots.current !== where.refreshTokenHash) return { count: 0 };
    slots.previous = slots.current;
    slots.current = data.refreshTokenHash;
    return { count: 1 };
  }) as any;
  prisma.session.update = jest.fn(async () => ({})) as any;
  return { prisma, slots };
}

describe('Phase 11 — refresh / logout / session & status enforcement', () => {
  it('refresh: rotates the refresh token and returns a fresh token pair', async () => {
    const { prisma } = makeRotationFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

    const result = await auth.refresh('token-1');
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBeTruthy();
  });

  it('refresh: returns the user together with the rotated pair (session-persistence contract)', async () => {
    const { prisma } = makeRotationFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

    const result = await auth.refresh('token-1');
    // The frontend persists the whole refresh response; a response without
    // `user` once corrupted the cached session and logged users out on the
    // next reload/new tab. The contract REQUIRES the user.
    expect(result.user).toMatchObject({ id: 'u1', username: 'tester' });
    expect(result.refreshToken).toBeTruthy();
  });

  it('refresh: accepts the previous token when a sibling tab already rotated (multi-tab safe)', async () => {
    const { prisma } = makeRotationFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

    await auth.refresh('token-1'); // tab A rotates token-1 -> token-2
    // Tab B still presents token-1 (its storage lagged behind): the previous
    // slot is accepted for exactly one more rotation instead of 401-ing the
    // whole device out.
    const result = await auth.refresh('token-1');
    expect(result.refreshToken).toBeTruthy();
    expect(result.user.id).toBe('u1');
  });

  it('refresh: rejects a token matching neither rotation slot (replay detection)', async () => {
    const { prisma } = makeRotationFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

    const first = await auth.refresh('token-1'); // -> fresh pair (previous = token-1)
    await auth.refresh(first.refreshToken); // -> second fresh pair (previous = the 1st fresh token)
    // token-1 is now two rotations old — a genuine replay.
    await expect(auth.refresh('token-1')).rejects.toThrow(UnauthorizedException);
  });

  it('refresh: rejects a revoked session', async () => {
    const { prisma, state } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));
    const session = {
      id: 's1',
      userId: 'u1',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      user: makeUser({}),
    };
    state.sessions.push(session);
    prisma.session.findUnique = jest.fn(async () => session) as any;

    await expect(auth.refresh('a-long-valid-refresh-token-abcdef123456')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('refresh: blocks a LOCKED/SUSPENDED/CLOSED account', async () => {
    for (const status of ['LOCKED', 'SUSPENDED', 'CLOSED']) {
      const { prisma } = makePrismaFake();
      const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));
      prisma.session.findUnique = jest.fn(async () => ({
        id: 's1',
        userId: 'u1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        user: makeUser({ status }),
      })) as any;

      await expect(auth.refresh('a-long-valid-refresh-token-abcdef123456')).rejects.toThrow(
        ForbiddenException,
      );
    }
  });

  it('logout: revokes the current session', async () => {
    const { prisma } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));
    await auth.logout({ id: 'u1', sessionId: 's1', roles: ['USER'] });
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('refresh: a schema-drift DB fault (P2022, missing column) is NEVER swallowed into a fake 401', async () => {
    // 2026-09-13 production incident — the deployed client queried
    // Session.previousRefreshTokenHash while the live Neon database had no such
    // column (pending migration). The session lookup must throw the REAL error
    // upwards (HTTP 500 + prismaCode=P2022 in the server log). Swallowing it
    // into 401 "Invalid refresh token" would (a) mask the server fault and
    // (b) make the frontend clear a perfectly valid session.
    const { prisma } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));
    const drift = new Prisma.PrismaClientKnownRequestError(
      'Column not found: Session.previousRefreshTokenHash',
      { code: 'P2022', clientVersion: 'test' },
    );
    prisma.session.findUnique = jest.fn(async () => {
      throw drift;
    }) as any;

    await expect(auth.refresh('a-long-valid-refresh-token-abcdef123456')).rejects.toBe(drift);
  });

  it('phone login: blocks a LOCKED account (was previously allowed)', async () => {
    const { prisma, state } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));
    state.users.push(
      makeUser({ status: 'LOCKED', passwordHash: await argon2.hash('RightPassword1') }),
    );

    await expect(
      auth.loginWithPhone({ phone: '+447911123456', password: 'RightPassword1' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('email login: blocks a LOCKED account (was previously allowed)', async () => {
    const { prisma, state } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));
    state.users.push(
      makeUser({
        id: 'u1',
        email: 'a@b.c',
        status: 'LOCKED',
        passwordHash: await argon2.hash('RightPassword1'),
      }),
    );

    await expect(
      auth.login({ identifier: 'a@b.c', password: 'RightPassword1' }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('Phase 11 — JwtAuthGuard enforces session + status on authenticated requests', () => {
  function makeContext(headers: Record<string, string> = {}) {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: 'Bearer tok', ...headers } }),
      }),
    } as any;
  }

  function makeGuard(result: any) {
    const jwt = {
      verifyAsync: jest.fn(async () => ({ sub: 'u1', sid: 's1', roles: ['USER'] })),
    };
    const reflector = { getAllAndOverride: jest.fn(() => false) };
    const prisma = { session: { findUnique: jest.fn(async () => result) } };
    const guard = new JwtAuthGuard(jwt as any, reflector as any, prisma as any);
    return { guard, prisma };
  }

  const validSession = (userStatus = 'ACTIVE') => ({
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    user: { status: userStatus, email: 'someone@example.com', accountType: 'CUSTOMER' },
  });

  it('attaches the session KIND from the authoritative session row (never a token claim)', async () => {
    const { guard } = makeGuard({ ...validSession(), kind: 'STAFF' });
    const req = { headers: { authorization: 'Bearer tok' } } as any;
    await guard.canActivate({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => req }),
    } as any);
    expect(req.user.sessionKind).toBe('STAFF');

    const customer = makeGuard({ ...validSession(), kind: 'CUSTOMER' });
    const req2 = { headers: { authorization: 'Bearer tok' } } as any;
    await customer.guard.canActivate({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => req2 }),
    } as any);
    expect(req2.user.sessionKind).toBe('CUSTOMER');
  });

  it('allows an active user with a valid, non-revoked session', async () => {
    const { guard } = makeGuard(validSession());
    const req = { headers: { authorization: 'Bearer tok' } };
    const ok = await guard.canActivate(
      {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({ getRequest: () => req }),
      } as any,
    );
    expect(ok).toBe(true);
    expect((req as any).user).toMatchObject({ id: 'u1', sessionId: 's1' });
  });

  it('rejects a missing bearer token', async () => {
    const { guard } = makeGuard(validSession());
    await expect(guard.canActivate(makeContext({ authorization: '' }))).rejects.toThrow(
      /Missing access token/,
    );
  });

  it('rejects a revoked session (logout / revocation is enforced immediately)', async () => {
    const { guard } = makeGuard({ ...validSession(), revokedAt: new Date() });
    await expect(guard.canActivate(makeContext())).rejects.toThrow(/Session is no longer valid/);
  });

  it('rejects an expired session', async () => {
    const { guard } = makeGuard({
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
      user: { status: 'ACTIVE' },
    });
    await expect(guard.canActivate(makeContext())).rejects.toThrow(/Session is no longer valid/);
  });

  it('rejects a SUSPENDED user even with a valid token', async () => {
    const { guard } = makeGuard(validSession('SUSPENDED'));
    await expect(guard.canActivate(makeContext())).rejects.toThrow(ForbiddenException);
  });

  it('rejects a LOCKED user even with a valid token', async () => {
    const { guard } = makeGuard(validSession('LOCKED'));
    await expect(guard.canActivate(makeContext())).rejects.toThrow(ForbiddenException);
  });

  it('rejects a CLOSED user even with a valid token', async () => {
    const { guard } = makeGuard(validSession('CLOSED'));
    await expect(guard.canActivate(makeContext())).rejects.toThrow(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------
// SUPER_ADMIN RETENTION — MASTER_ADMIN_EMAILS (capped at 2) is re-checked at
// the authorization boundary on every request (master fix prompt section 2)
// ---------------------------------------------------------------------------

describe('JwtAuthGuard enforces SUPER_ADMIN retention against MASTER_ADMIN_EMAILS', () => {
  const ORIGINAL_ENV = process.env['MASTER_ADMIN_EMAILS'];

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env['MASTER_ADMIN_EMAILS'];
    else process.env['MASTER_ADMIN_EMAILS'] = ORIGINAL_ENV;
  });

  function makeStaffGuard(tokenRoles: string[], sessionUserEmail: string | null) {
    const jwt = {
      verifyAsync: jest.fn(async () => ({ sub: 'u1', sid: 's1', roles: tokenRoles })),
    };
    const reflector = { getAllAndOverride: jest.fn(() => false) };
    const prisma = {
      session: {
        findUnique: jest.fn(async () => ({
          kind: 'STAFF',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          user: { status: 'ACTIVE', email: sessionUserEmail },
        })),
      },
    };
    const guard = new JwtAuthGuard(jwt as any, reflector as any, prisma as any);
    const req = { headers: { authorization: 'Bearer tok' } };
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => req }),
    } as any;
    return { guard, ctx, req: req as any };
  }

  it('KEEPS SUPER_ADMIN when the session user is on the (capped) allowlist', async () => {
    process.env['MASTER_ADMIN_EMAILS'] = 'owner.one@gmail.com,owner.two@gmail.com';
    const { guard, ctx, req } = makeStaffGuard(
      ['SUPER_ADMIN'],
      'owner.one@gmail.com',
    );

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user.roles).toEqual(['SUPER_ADMIN']);
    expect(req.user.sessionKind).toBe('STAFF');
  });

  it('STRIPS SUPER_ADMIN for an address outside the allowlist (retain = fail closed)', async () => {
    process.env['MASTER_ADMIN_EMAILS'] = 'owner.one@gmail.com,owner.two@gmail.com';
    const { guard, ctx, req } = makeStaffGuard(['SUPER_ADMIN'], 'intruder@example.com');

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    // Other roles are untouched; only the unallowlisted SUPER_ADMIN disappears,
    // so RolesGuard then refuses every SUPER_ADMIN-only route.
    expect(req.user.roles).toEqual([]);
  });

  it('STRIPS SUPER_ADMIN when the allowlist is entirely unset (fail closed)', async () => {
    delete process.env['MASTER_ADMIN_EMAILS'];
    const { guard, ctx, req } = makeStaffGuard(['SUPER_ADMIN'], 'anyone@example.com');

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user.roles).toEqual([]);
  });

  it('an address beyond the 2-entry cap can never retain SUPER_ADMIN', async () => {
    process.env['MASTER_ADMIN_EMAILS'] =
      'owner.one@gmail.com,owner.two@gmail.com,extra.three@gmail.com';
    const { guard, ctx, req } = makeStaffGuard(['SUPER_ADMIN'], 'extra.three@gmail.com');

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user.roles).toEqual([]);
  });

  it('never touches non-SUPER_ADMIN roles (ordinary ADMIN sessions are unaffected)', async () => {
    process.env['MASTER_ADMIN_EMAILS'] = 'owner.one@gmail.com';
    const { guard, ctx, req } = makeStaffGuard(['ADMIN'], 'plain.admin@example.com');

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user.roles).toEqual(['ADMIN']);
  });
});

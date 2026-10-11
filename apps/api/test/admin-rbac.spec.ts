/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as argon2 from 'argon2';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../src/common/decorators/permissions.decorator';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { AdminService } from '../src/modules/admin/admin.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { OtpService } from '../src/modules/auth/otp.service';
import { makeJwtFake, makePrismaFake } from './helpers-phase11';
import { sanitizeNextPath } from '../../../packages/validation/src/next-path';

/**
 * Phase 19 â€” Admin panel security + behavior tests.
 *
 * Covers:
 *  1. USER cannot access admin endpoints (RBAC â†’ 403)
 *  2. ADMIN can access admin endpoints
 *  3. SUPER_ADMIN can access admin endpoints
 *  4. Unauthenticated requests are rejected before role checks
 *  5. Routes without @Roles stay public to authenticated users
 *  6. Admin user listing maps rows + roles (read-only)
 *  7. Admin bet listing filters by event through selectionâ†’marketâ†’event
 *  8. Admin event status change is audited with a mandatory reason
 *  9. Event status change on a missing event â†’ 404
 * 10. Audit log listing maps entries (read-only)
 * 11. Login "next" redirect sanitization rejects open-redirect attacks
 * 12. sanitizeNextPath accepts legitimate same-origin paths
 * 13. Staff accounts (ADMIN/SUPER_ADMIN) are refused by the customer login and
 *     must sign in through the staff login; plain customers are unaffected
 */

// ---------------------------------------------------------------------------
// RBAC: the RolesGuard is the backend authorization boundary
// ---------------------------------------------------------------------------

function makeContext(user: any) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as any;
}

function makeGuard(required: string[] | undefined): { guard: RolesGuard; reflector: Reflector } {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) =>
      key === ROLES_KEY ? required : key === PERMISSIONS_KEY ? undefined : undefined,
    ),
  } as unknown as Reflector;
  return { guard: new RolesGuard(reflector), reflector };
}

describe('RolesGuard (admin RBAC)', () => {
  it('rejects a USER from an ADMIN/SUPER_ADMIN endpoint with 403', () => {
    const { guard } = makeGuard(['ADMIN', 'SUPER_ADMIN']);
    const ctx = makeContext({ id: 'u1', roles: ['USER'] });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('allows ADMIN to access admin endpoints', () => {
    const { guard } = makeGuard(['ADMIN', 'SUPER_ADMIN']);
    expect(
      guard.canActivate(makeContext({ id: 'a1', roles: ['ADMIN'], sessionKind: 'STAFF' })),
    ).toBe(true);
  });

  it('allows SUPER_ADMIN to access admin endpoints', () => {
    const { guard } = makeGuard(['ADMIN', 'SUPER_ADMIN']);
    expect(
      guard.canActivate(makeContext({ id: 's1', roles: ['SUPER_ADMIN'], sessionKind: 'STAFF' })),
    ).toBe(true);
  });

  it('rejects a CUSTOMER session even when its token claims a staff role (session separation)', () => {
    // The account was promoted to ADMIN mid-session: /auth/refresh re-signed
    // the roles, but the session was created by a customer login, so it must
    // never authenticate an admin API call. 401 (not 403) so the frontend
    // bounces to the dedicated staff login instead of a dead-end 403 page.
    const { guard } = makeGuard(['ADMIN', 'SUPER_ADMIN']);
    expect(() =>
      guard.canActivate(makeContext({ id: 'a1', roles: ['ADMIN'], sessionKind: 'CUSTOMER' })),
    ).toThrow(UnauthorizedException);
  });

  it('rejects an admin route when sessionKind is missing entirely (fail closed)', () => {
    const { guard } = makeGuard(['ADMIN', 'SUPER_ADMIN']);
    expect(() => guard.canActivate(makeContext({ id: 'a1', roles: ['ADMIN'] }))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects requests without an authenticated user', () => {
    const { guard } = makeGuard(['ADMIN']);
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
  });

  it('allows routes without a role requirement (public/self-service)', () => {
    const { guard } = makeGuard(undefined);
    expect(guard.canActivate(makeContext({ id: 'u2', roles: ['USER'] }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AdminService read model (fake Prisma, following the betting-helpers style)
// ---------------------------------------------------------------------------

function makeAdminFake() {
  const calls: Record<string, unknown[]> = {};
  const record = (key: string, arg: unknown) => {
    calls[key] = calls[key] ?? [];
    calls[key].push(arg);
  };

  const user = {
    groupBy: jest.fn(async () => [
      { status: 'ACTIVE', _count: { _all: 7 } },
      { status: 'PENDING', _count: { _all: 3 } },
    ]),
    count: jest.fn(async () => 2),
    findMany: jest.fn(async (arg: any) => {
      record('user.findMany', arg);
      return [
        {
          id: 'u1',
          email: 'a@example.com',
          username: 'alice',
          phone: null,
          firstName: 'Alice',
          lastName: 'Smith',
          country: 'GB',
          status: 'ACTIVE',
          emailVerified: true,
          phoneVerified: false,
          kycStatus: 'NOT_STARTED',
          lastLoginAt: new Date('2026-09-01T10:00:00Z'),
          createdAt: new Date('2026-08-01T10:00:00Z'),
          userRoles: [{ role: { name: 'ADMIN' } }],
        },
        {
          id: 'u2',
          email: 'bob@example.com',
          username: 'bob',
          phone: '+447900000000',
          firstName: null,
          lastName: null,
          country: null,
          status: 'PENDING',
          emailVerified: false,
          phoneVerified: true,
          kycStatus: 'NOT_STARTED',
          lastLoginAt: null,
          createdAt: new Date('2026-08-02T10:00:00Z'),
          userRoles: [{ role: { name: 'USER' } }],
        },
      ];
    }),
    findUnique: jest.fn(async () => null),
  };

  const event = {
    groupBy: jest.fn(async () => [
      { status: 'LIVE', _count: { _all: 2 } },
      { status: 'SCHEDULED', _count: { _all: 5 } },
    ]),
    count: jest.fn(async () => 4),
    findMany: jest.fn(async () => []),
    findUnique: jest.fn(async () => null),
    update: jest.fn(async (arg: any) => {
      record('event.update', arg);
      return { id: arg.where.id, status: arg.data.status, live: arg.data.live };
    }),
  };

  const auditLog = {
    count: jest.fn(async () => 1),
    findMany: jest.fn(async () => [
      {
        id: 'log1',
        actorId: 'a1',
        actorType: 'ADMIN',
        action: 'ADMIN_EVENT_STATUS_CHANGED',
        entityType: 'Event',
        entityId: 'evt-1',
        ip: '10.0.0.1',
        createdAt: new Date('2026-09-04T00:00:00Z'),
      },
    ]),
    create: jest.fn(async (arg: any) => {
      record('auditLog.create', arg);
      return arg.data;
    }),
  };

  const prisma: any = {
    isHealthy: jest.fn(async () => true),
    user,
    event,
    bet: {
      groupBy: jest.fn(async () => [{ status: 'SETTLED', _count: { _all: 4 } }]),
      count: jest.fn(async () => 0),
      findMany: jest.fn(async (arg: any) => {
        record('bet.findMany', arg);
        return [
          {
            id: 'bet-1',
            userId: 'u1',
            type: 'SINGLE',
            status: 'ACCEPTED',
            stake: 1000,
            potentialPayout: 1850,
            currency: 'BDT',
            result: null,
            settledAt: null,
            payout: null,
            createdAt: new Date('2026-09-03T00:00:00Z'),
            user: { username: 'alice' },
            selections: [
              {
                id: 'bs1',
                selectionId: 'sel-1',
                eventName: 'IPL Final',
                marketName: 'Match Winner',
                selectionName: 'Home',
                priceAtPlacement: '1.85',
                result: null,
                settledAt: null,
              },
            ],
          },
        ];
      }),
    },
    sport: {
      groupBy: jest.fn(async () => [{ status: 'ACTIVE', _count: { _all: 3 } }]),
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null),
    },
    competition: {
      groupBy: jest.fn(async () => [{ status: 'ACTIVE', _count: { _all: 8 } }]),
      findMany: jest.fn(async () => []),
    },
    wallet: {
      groupBy: jest.fn(async () => [
        { currency: 'BDT', _count: { _all: 9 }, _sum: { availableBalance: 150_000, lockedBalance: 5_000 } },
      ]),
      findMany: jest.fn(async () => []),
    },
    walletTransaction: {
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
    },
    session: { count: jest.fn(async () => 1) },
    auditLog,
  };

  const partnerProviders: any = { list: jest.fn(async () => []) };

  return { prisma, partnerProviders, service: new AdminService(prisma, partnerProviders), calls };
}

describe('AdminService (admin panel read model)', () => {
  it('builds the dashboard summary from real aggregates (no fake data)', async () => {
    const { service } = makeAdminFake();
    const summary = await service.getSummary();

    expect(summary.users.total).toBe(10);
    expect(summary.users.active).toBe(7);
    expect(summary.users.pending).toBe(3);
    expect(summary.events.live).toBe(2);
    expect(summary.bets.settled).toBe(4);
    expect(summary.sports.active).toBe(3);
    expect(summary.competitions.active).toBe(8);
    expect(summary.wallets.wallets).toBe(9);
    expect(summary.wallets.byCurrency[0]).toMatchObject({ currency: 'BDT', availableMinor: 150_000 });
    expect(summary.system.database).toBe('up');
  });

  it('maps user rows with roles for the admin directory', async () => {
    const { service } = makeAdminFake();
    const page = await service.listUsers({ q: 'ali', page: 1, limit: 20 } as any);

    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({ username: 'alice', roles: ['ADMIN'], status: 'ACTIVE' });
    expect(page.items[1]).toMatchObject({ username: 'bob', roles: ['USER'], phoneVerified: true });
  });

  it('filters bets by event through selection â†’ market â†’ event', async () => {
    const { service, calls } = makeAdminFake();
    const page = await service.listBets({ eventId: 'evt-9' } as any);

    const where = (calls['bet.findMany']?.[0] as any)?.where;
    expect(where.selections.some.selection.market.eventId).toBe('evt-9');
    expect(page.items[0].selections[0].eventName).toBe('IPL Final');
    expect(page.items[0].username).toBe('alice');
  });

  it('changes event status with live-flag sync and writes an audit entry', async () => {
    const fake = makeAdminFake();
    fake.prisma.event.findUnique = jest.fn(async () => ({ id: 'evt-1', status: 'SCHEDULED' }));
    fake.prisma.event.update = jest.fn(async () => ({
      id: 'evt-1',
      gameId: 'g1',
      name: 'IPL Final',
      homeName: 'A',
      awayName: 'B',
      startTime: new Date(),
      status: 'FINISHED',
      live: false,
      bettingMode: 'NATIVE',
      createdAt: new Date(),
      competition: null,
      partnerProvider: null,
    }));

    const result = await fake.service.updateEventStatus(
      'evt-1',
      'FINISHED',
      'Match completed',
      { id: 'a1' },
      '10.0.0.1',
      'jest',
    );

    expect(result.status).toBe('FINISHED');
    expect(result.live).toBe(false);
    const auditArg = fake.calls['auditLog.create']?.[0] as any;
    expect(auditArg.data.action).toBe('ADMIN_EVENT_STATUS_CHANGED');
    expect(auditArg.data.newValue).toMatchObject({ from: 'SCHEDULED', to: 'FINISHED', reason: 'Match completed' });
  });

  it('throws 404 when changing the status of a missing event', async () => {
    const { service } = makeAdminFake();
    await expect(service.updateEventStatus('nope', 'FINISHED', 'reason', { id: 'a1' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('maps audit log entries read-only', async () => {
    const { service } = makeAdminFake();
    const page = await service.listAuditLogs({ action: 'ADMIN_EVENT' } as any);

    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      id: 'log1',
      action: 'ADMIN_EVENT_STATUS_CHANGED',
      actorType: 'ADMIN',
      entityType: 'Event',
    });
  });
});

// ---------------------------------------------------------------------------
// Open-redirect protection for the login `next` return path
// ---------------------------------------------------------------------------

describe('sanitizeNextPath (open-redirect protection)', () => {
  it('accepts legitimate same-origin admin paths', () => {
    expect(sanitizeNextPath('/admin')).toBe('/admin');
    expect(sanitizeNextPath('/admin/users')).toBe('/admin/users');
    expect(sanitizeNextPath('/admin/betting?tab=bets')).toBe('/admin/betting?tab=bets');
  });

  it('rejects absolute and protocol-relative URLs', () => {
    expect(sanitizeNextPath('https://evil.example/admin')).not.toBe('https://evil.example/admin');
    expect(sanitizeNextPath('//evil.example')).not.toBe('//evil.example');
    expect(sanitizeNextPath('http://evil.example')).not.toBe('http://evil.example');
  });

  it('rejects scheme injection attempts', () => {
    expect(sanitizeNextPath('javascript:alert(1)')).not.toBe('javascript:alert(1)');
    expect(sanitizeNextPath('data:text/html,<script>')).not.toBe('data:text/html,<script>');
  });

  it('rejects backslashes and control characters', () => {
    expect(sanitizeNextPath('/admin\\evil')).not.toBe('/admin\\evil');
    expect(sanitizeNextPath('/admin\n<script>')).not.toBe('/admin\n<script>');
  });

  it('falls back safely for empty/oversized input', () => {
    expect(sanitizeNextPath(null, '/admin')).toBe('/admin');
    expect(sanitizeNextPath('', '/admin')).toBe('/admin');
    expect(sanitizeNextPath('x'.repeat(600), '/admin')).toBe('/admin');
  });
});

// ---------------------------------------------------------------------------
// Staff accounts cannot use the customer login (POST /auth/login)
// ---------------------------------------------------------------------------

const CUSTOMER_PASSWORD = 'Str0ngPassw0rd!';

/** Fake of the Prisma surface AuthService.login/adminLogin touch. */
function makeAuthFake(user: Record<string, unknown>) {
  const sessions: Record<string, unknown>[] = [];
  const securityEvents: { type: string; metadata?: Record<string, unknown> }[] = [];
  const auditActions: string[] = [];

  const prisma: any = {
    user: {
      findUnique: jest.fn(async () => user),
      findFirst: jest.fn(async () => user),
      update: jest.fn(async () => user),
    },
    securityEvent: {
      count: jest.fn(async () => 0),
      create: jest.fn(async (arg: any) => {
        securityEvents.push({ type: arg.data.type, metadata: arg.data.metadata });
        return arg.data;
      }),
    },
    session: {
      create: jest.fn(async (arg: any) => {
        const session = { id: `session-${sessions.length + 1}`, ...arg.data };
        sessions.push(session);
        return session;
      }),
      update: jest.fn(async () => ({})),
    },
    auditLog: {
      create: jest.fn(async (arg: any) => {
        auditActions.push(arg.data.action);
        return arg.data;
      }),
    },
  };

  const jwt: any = { signAsync: jest.fn(async () => 'access-token') };
  return {
    service: new AuthService(prisma, jwt, new OtpService(prisma)),
    prisma,
    sessions,
    securityEvents,
    auditActions,
  };
}

function authUser(roleNames: string[], accountType: 'CUSTOMER' | 'STAFF' = roleNames.includes('ADMIN') || roleNames.includes('SUPER_ADMIN') ? 'STAFF' : 'CUSTOMER') {
  return {
    id: 'u-1',
    email: 'person@example.com',
    username: 'person',
    phone: null,
    firstName: null,
    lastName: null,
    country: null,
    timezone: 'UTC',
    status: 'ACTIVE',
    emailVerified: true,
    phoneVerified: false,
    kycStatus: 'NOT_STARTED',
    // Account-domain classification (accountType column). Staff roles imply a
    // STAFF account so adminLogin()'s AccountType gate passes for ADMIN/
    // SUPER_ADMIN fixtures; USER/SUPPORT fixtures default to CUSTOMER and the
    // tests that model classified staff pass 'STAFF' explicitly.
    accountType,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    userRoles: roleNames.map((name) => ({ role: { name } })),
  };
}

async function authUserWithPassword(
  roleNames: string[],
  accountType?: 'CUSTOMER' | 'STAFF',
) {
  return {
    ...authUser(roleNames, accountType),
    passwordHash: await argon2.hash(CUSTOMER_PASSWORD),
  };
}

describe('Customer login refuses staff accounts (POST /auth/login)', () => {
  it('rejects an ADMIN account with 403, records the attempt and creates no session', async () => {
    const fake = makeAuthFake(await authUserWithPassword(['ADMIN']));

    const error = await fake.service
      .login({ identifier: 'person@example.com', password: CUSTOMER_PASSWORD })
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as Error).message).toBe('Staff accounts must sign in at the staff login.');
    expect(fake.sessions).toHaveLength(0);
    expect(fake.securityEvents).toEqual([
      { type: 'LOGIN_FAILURE', metadata: { method: 'customer-login', reason: 'staff-account' } },
    ]);
  });

  it('rejects a SUPER_ADMIN account the same way', async () => {
    const fake = makeAuthFake(await authUserWithPassword(['SUPER_ADMIN']));

    await expect(
      fake.service.login({ identifier: 'person@example.com', password: CUSTOMER_PASSWORD }),
    ).rejects.toThrow('Staff accounts must sign in at the staff login.');
    expect(fake.sessions).toHaveLength(0);
  });

  it('lets the SAME ADMIN account sign in through the staff login', async () => {
    const fake = makeAuthFake(await authUserWithPassword(['ADMIN']));

    const result = await fake.service.adminLogin({
      identifier: 'person@example.com',
      password: CUSTOMER_PASSWORD,
    });

    expect(result.accessToken).toBe('access-token');
    expect(fake.sessions).toHaveLength(1);
    expect(fake.auditActions).toContain('ADMIN_LOGIN_SUCCESS');
  });

  it('leaves a plain customer account on the customer login unchanged', async () => {
    const fake = makeAuthFake(await authUserWithPassword(['USER']));

    const result = await fake.service.login({
      identifier: 'person@example.com',
      password: CUSTOMER_PASSWORD,
    });

    expect(result.accessToken).toBe('access-token');
    expect(result.user.email).toBe('person@example.com');
    expect(fake.sessions).toHaveLength(1);
  });

  it('scopes the gate to ADMIN/SUPER_ADMIN only (SUPPORT is not blocked here)', async () => {
    // Non-ADMIN staff roles are deliberately out of scope for this change.
    const fake = makeAuthFake(await authUserWithPassword(['SUPPORT']));

    const result = await fake.service.login({
      identifier: 'person@example.com',
      password: CUSTOMER_PASSWORD,
    });

    expect(result.accessToken).toBe('access-token');
    expect(fake.sessions).toHaveLength(1);
  });

  it('still refuses a customer account on the staff login (pre-existing behaviour)', async () => {
    const fake = makeAuthFake(await authUserWithPassword(['USER']));

    const error = await fake.service
      .adminLogin({ identifier: 'person@example.com', password: CUSTOMER_PASSWORD })
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as Error).message).toBe('This login is for staff accounts only.');
    expect(fake.sessions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Account separation: customer login ≠ admin login, customer session ≠ staff
// session (master fix prompt sections 0/5/6)
// ---------------------------------------------------------------------------

describe('Session context separation (SessionKind)', () => {
  it('staff login creates a STAFF session; customer login creates a CUSTOMER session', async () => {
    const staff = makeAuthFake(await authUserWithPassword(['ADMIN']));
    await staff.service.adminLogin({
      identifier: 'person@example.com',
      password: CUSTOMER_PASSWORD,
    });
    expect(staff.sessions).toHaveLength(1);
    expect(staff.sessions[0].kind).toBe('STAFF');

    const customer = makeAuthFake(await authUserWithPassword(['USER']));
    await customer.service.login({ identifier: 'person@example.com', password: CUSTOMER_PASSWORD });
    expect(customer.sessions).toHaveLength(1);
    expect(customer.sessions[0].kind).toBe('CUSTOMER');
  });

  it('admin login accepts the staff USERNAME as identifier (Username / Gmail field)', async () => {
    const fake = makeAuthFake(await authUserWithPassword(['ADMIN']));

    const result = await fake.service.adminLogin({
      identifier: 'person', // authUser() username
      password: CUSTOMER_PASSWORD,
    });

    expect(result.accessToken).toBe('access-token');
    expect(fake.prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ email: 'person' }, { username: 'person' }],
        }),
      }),
    );
    expect(fake.sessions[0].kind).toBe('STAFF');
  });

  it('rejects an invalid admin password with 401, audits it, and creates no session', async () => {
    const fake = makeAuthFake(await authUserWithPassword(['ADMIN']));

    await expect(
      fake.service.adminLogin({ identifier: 'person@example.com', password: 'WrongPassword1!' }),
    ).rejects.toThrow(UnauthorizedException);

    expect(fake.sessions).toHaveLength(0);
    expect(fake.auditActions).toContain('ADMIN_LOGIN_DENIED');
    expect(fake.securityEvents).toEqual([
      { type: 'LOGIN_FAILURE', metadata: { method: 'admin-login' } },
    ]);
  });

  it('rejects an INACTIVE (SUSPENDED) admin with 403 and no session', async () => {
    const fake = makeAuthFake({
      ...(await authUserWithPassword(['ADMIN'])),
      status: 'SUSPENDED',
    });

    await expect(
      fake.service.adminLogin({ identifier: 'person@example.com', password: CUSTOMER_PASSWORD }),
    ).rejects.toThrow('Account is not permitted to sign in');

    expect(fake.sessions).toHaveLength(0);
    expect(fake.auditActions).toContain('ADMIN_LOGIN_DENIED');
  });

  it('an unknown identifier on the staff login is indistinguishable from a bad password', async () => {
    const fake = makeAuthFake(null as unknown as Record<string, unknown>); // no such user

    await expect(
      fake.service.adminLogin({ identifier: 'ghost@example.com', password: CUSTOMER_PASSWORD }),
    ).rejects.toThrow('Invalid credentials');
    expect(fake.sessions).toHaveLength(0);
    // No audit for an unknown identifier — nothing to attribute it to (no enumeration).
    expect(fake.auditActions).not.toContain('ADMIN_LOGIN_DENIED');
  });

  it('customer logout revokes ONLY its session — an unrelated staff session stays valid', async () => {
    const { prisma, state } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

    state.sessions.push(
      {
        id: 's-customer',
        userId: 'u1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 3_600_000),
        kind: 'CUSTOMER',
      },
      {
        id: 's-staff',
        userId: 'u1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 3_600_000),
        kind: 'STAFF',
      },
    );

    await auth.logout({
      id: 'u1',
      sessionId: 's-customer',
      roles: ['USER'],
      sessionKind: 'CUSTOMER',
    });

    expect(state.sessions.find((s) => s.id === 's-customer')?.revokedAt).toBeInstanceOf(Date);
    // The unrelated staff session is untouched by the customer logout.
    expect(state.sessions.find((s) => s.id === 's-staff')?.revokedAt).toBeNull();
  });

  it('admin logout revokes the staff session itself', async () => {
    const { prisma, state } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

    state.sessions.push({
      id: 's-staff',
      userId: 'u1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 3_600_000),
      kind: 'STAFF',
    });

    await auth.logout({ id: 'u1', sessionId: 's-staff', roles: ['ADMIN'], sessionKind: 'STAFF' });

    expect(state.sessions.find((s) => s.id === 's-staff')?.revokedAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// Staff accounts cannot obtain a session through ANY customer flow — phone
// login and OAuth issueSession funnel through the same completeLogin()
// chokepoint as email login (master fix prompt section 5).
// ---------------------------------------------------------------------------

describe('Customer flows refuse staff accounts (completeLogin chokepoint)', () => {
  it('phone login refuses an ADMIN account with 403 and creates no session', async () => {
    const fake = makeAuthFake(await authUserWithPassword(['ADMIN']));

    await expect(
      fake.service.loginWithPhone({ phone: '+15550001111', password: CUSTOMER_PASSWORD }),
    ).rejects.toThrow('Staff accounts must sign in at the staff login.');

    expect(fake.sessions).toHaveLength(0);
    expect(fake.securityEvents).toEqual([
      { type: 'LOGIN_FAILURE', metadata: { method: 'customer-login', reason: 'staff-account' } },
    ]);
  });

  it('OAuth issueSession refuses an ADMIN account with 403 and creates no session', async () => {
    const fake = makeAuthFake(await authUserWithPassword(['ADMIN']));

    await expect(fake.service.issueSession('u-1')).rejects.toThrow(
      'Staff accounts must sign in at the staff login.',
    );

    expect(fake.sessions).toHaveLength(0);
    expect(fake.securityEvents).toEqual([
      { type: 'LOGIN_FAILURE', metadata: { method: 'customer-login', reason: 'staff-account' } },
    ]);
  });

  it('phone login still works for an ordinary customer', async () => {
    const fake = makeAuthFake(await authUserWithPassword(['USER']));

    const result = await fake.service.loginWithPhone({
      phone: '+15550001111',
      password: CUSTOMER_PASSWORD,
    });

    expect(result.accessToken).toBe('access-token');
    expect(fake.sessions).toHaveLength(1);
    expect(fake.sessions[0].kind).toBe('CUSTOMER');
  });
});


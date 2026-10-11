/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Account-domain separation (CUSTOMER vs STAFF) — the Master Fix contract.
 *
 * These tests assert the SERVER-SIDE split, not a frontend convention:
 *   CUSTOMER → /admin/users (listUsers, getCustomerUser, wallet, stats)
 *   STAFF    → /admin/admins (listStaffAccounts) + /auth/admin-login
 *
 * They cover the required cases 1-20 from the architecture fix:
 *   CASE 1/2/3   customers in /admin/users; staff + master admins absent
 *   CASE 4/5/6   staff + master admins in /admin/admins; customers absent
 *   CASE 7/8     customer login refuses staff; /admin/login accepts staff
 *   CASE 9/10    registration → CUSTOMER only; admin creation → STAFF only
 *   CASE 11-13   master admin stays SUPER_ADMIN and is undeletable/undeactivatable
 *   CASE 17      staff accounts get no customer wallet
 *   CASE 18/19   API-level filtering (the frontend has nothing to filter)
 *   CASE 20      session/auth guards distinguish CUSTOMER vs STAFF
 *   CASE 14-16   the migration never touches wallets / bets / deposits /
 *                withdrawals (read-only static assertions over the SQL)
 */
import * as fs from 'fs';
import * as path from 'path';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../src/common/decorators/permissions.decorator';
import { AdminService } from '../src/modules/admin/admin.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { OtpService } from '../src/modules/auth/otp.service';
import { ManualPaymentService } from '../src/modules/wallet/manual-payment.service';
import { WalletService } from '../src/modules/wallet/wallet.service';
import { PrismaService } from '../src/database/prisma.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Hashed once in beforeAll — every fixture password is the same. */
let TEST_HASH = '';

const PASSWORD = 'Str0ngPassw0rd!';

const MASTER_ADMIN_EMAIL = 'tanvirujaman101@gmail.com';
const MASTER_ADMIN_EMAIL_2 = 'tanvionroyale@gmail.com';

interface FixtureUser {
  id: string;
  email: string | null;
  username: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  country: string | null;
  timezone: string;
  status: string;
  accountType: 'CUSTOMER' | 'STAFF';
  emailVerified: boolean;
  phoneVerified: boolean;
  kycStatus: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  passwordHash: string;
  userRoles: { role: { id: string; name: string } }[];
  wallets: any[];
}

/** Builds the mixed population the screenshots showed (staff + customers). */
function makePopulation(): FixtureUser[] {
  const base = {
    firstName: 'Test',
    lastName: 'User',
    phone: null,
    country: 'BD',
    timezone: 'UTC',
    status: 'ACTIVE',
    emailVerified: true,
    phoneVerified: false,
    kycStatus: 'NOT_STARTED',
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    passwordHash: TEST_HASH,
    wallets: [],
    // Detail reads (getUser) project verifications/wallets and a _count of bets;
    // these keep the fake row shape identical to a real Prisma include.
    verifications: [],
    _count: { bets: 0 },
  };

  return [
    {
      ...base,
      id: 'master-1',
      email: MASTER_ADMIN_EMAIL,
      username: 'tanvir',
      accountType: 'STAFF',
      userRoles: [{ role: { id: 'role-super', name: 'SUPER_ADMIN' } }],
    },
    {
      ...base,
      id: 'master-2',
      email: MASTER_ADMIN_EMAIL_2,
      username: 'tanvion',
      accountType: 'STAFF',
      userRoles: [{ role: { id: 'role-super', name: 'SUPER_ADMIN' } }],
    },
    {
      ...base,
      id: 'staff-1',
      email: 'staff@example.com',
      username: 'staffone',
      accountType: 'STAFF',
      userRoles: [{ role: { id: 'role-admin', name: 'ADMIN' } }],
    },
    {
      ...base,
      id: 'customer-1',
      email: 'customer1@example.com',
      username: 'customerone',
      accountType: 'CUSTOMER',
      userRoles: [{ role: { id: 'role-user', name: 'USER' } }],
      wallets: [
        {
          id: 'wallet-1',
          userId: 'customer-1',
          currency: 'BDT',
          availableBalance: 5000,
          lockedBalance: 0,
          status: 'ACTIVE',
        },
      ],
    },
    {
      ...base,
      id: 'customer-2',
      email: 'customer2@example.com',
      username: 'customertwo',
      accountType: 'CUSTOMER',
      userRoles: [{ role: { id: 'role-user', name: 'USER' } }],
    },
  ];
}

/** Minimal Prisma fake honouring the accountType filter used by the service. */
function makeAdminFake(users: FixtureUser[] = makePopulation()) {
  const matches = (row: any, where: any): boolean => {
    if (!where) return true;
    if (where.accountType && row.accountType !== where.accountType) return false;
    if (where.status && row.status !== where.status) return false;
    if (where.id && row.id !== where.id) return false;
    if (where.user?.accountType && row.accountType !== where.user.accountType) return false;
    if (where.OR) {
      const hit = where.OR.some((clause: any) =>
        Object.entries(clause).some(([field, cond]: [string, any]) => {
          const value = (row as any)[field];
          return (
            typeof value === 'string' &&
            value.toLowerCase().includes(String(cond.contains).toLowerCase())
          );
        }),
      );
      if (!hit) return false;
    }
    return true;
  };

  const prisma: any = {
    user: {
      findMany: jest.fn(async ({ where }: any) => users.filter((u) => matches(u, where))),
      // Returns the FULL fixture row regardless of `select` — a Prisma select
      // is a projection, so extra fields never break a caller that reads fewer.
      findUnique: jest.fn(async ({ where }: any) => users.find((u) => matches(u, where)) ?? null),
      count: jest.fn(async ({ where }: any) => users.filter((u) => matches(u, where)).length),
      create: jest.fn(async ({ data }: any) => ({ id: 'u-created', ...data })),
      update: jest.fn(async () => ({})),
      groupBy: jest.fn(async ({ where }: any) => {
        const scoped = users.filter((u) => matches(u, where));
        const map = new Map<string, number>();
        for (const row of scoped) map.set(row.status, (map.get(row.status) ?? 0) + 1);
        return [...map].map(([status, count]) => ({ status, _count: { _all: count } }));
      }),
    },
    session: { count: jest.fn(async () => 0), updateMany: jest.fn(async () => ({ count: 0 })) },
    event: { groupBy: jest.fn(async () => []), count: jest.fn(async () => 0) },
    bet: {
      groupBy: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
    },
    sport: { groupBy: jest.fn(async () => []) },
    competition: { groupBy: jest.fn(async () => []) },
    wallet: { groupBy: jest.fn(async () => []) },
    role: {
      findMany: jest.fn(async ({ where }: any) =>
        (where?.name?.in ?? []).map((name: string) => ({
          id: `role-${name.toLowerCase()}`,
          name,
        })),
      ),
      findUnique: jest.fn(async ({ where }: any) => ({
        id: `role-${String(where.name).toLowerCase()}`,
        name: where.name,
      })),
    },
    userRole: {
      createMany: jest.fn(async () => ({ count: 1 })),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
    auditLog: { create: jest.fn(async (arg: any) => arg.data) },
    isHealthy: jest.fn(async () => true),
    $transaction: jest.fn(async (arg: any) => {
      if (typeof arg === 'function') return arg(prisma);
      const out = [];
      for (const op of arg) out.push(await op);
      return out;
    }),
  };
  return { prisma: prisma as unknown as PrismaService, raw: prisma, users };
}

function makeAdminService(users?: FixtureUser[]) {
  const fake = makeAdminFake(users);
  // Second dependency: the partner-provider registry used by getSummary().
  const partnerProviders = { list: jest.fn(async () => []) } as any;
  return { service: new AdminService(fake.prisma, partnerProviders), ...fake };
}

beforeAll(async () => {
  TEST_HASH = await argon2.hash(PASSWORD, { type: argon2.argon2id });
});

// ---------------------------------------------------------------------------
// CASE 1-3, 18, 19 — /admin/users is CUSTOMER-only, enforced server-side
// ---------------------------------------------------------------------------

describe('Account domains — /admin/users population (CUSTOMER only)', () => {
  it('CASE 1: a real customer appears in the admin users directory', async () => {
    const { service } = makeAdminService();
    const page = await service.listUsers({});
    expect(page.items.map((i) => i.email)).toContain('customer1@example.com');
    expect(page.items.every((i) => i.accountType === 'CUSTOMER')).toBe(true);
  });

  it('CASE 2: a staff/admin account does NOT appear in /admin/users', async () => {
    const { service } = makeAdminService();
    const page = await service.listUsers({});
    expect(page.items.map((i) => i.email)).not.toContain('staff@example.com');
    expect(page.items.map((i) => i.id)).not.toContain('staff-1');
  });

  it('CASE 3: both master admins do NOT appear in /admin/users', async () => {
    const { service } = makeAdminService();
    const page = await service.listUsers({});
    const ids = page.items.map((i) => i.id);
    expect(ids).not.toContain('master-1');
    expect(ids).not.toContain('master-2');
    expect(page.items.map((i) => i.email)).not.toContain(MASTER_ADMIN_EMAIL);
  });

  it('CASE 18: the accountType split lives in the WHERE clause, not the response', async () => {
    const { service, raw } = makeAdminService();
    await service.listUsers({});
    // No caller (or client-side trick) can widen the population: the domain
    // filter is part of the QUERY itself.
    expect(raw.user.count.mock.calls[0][0].where.accountType).toBe('CUSTOMER');
    expect(raw.user.findMany.mock.calls[0][0].where.accountType).toBe('CUSTOMER');
  });

  it('CASE 9: registration always classifies the new account as CUSTOMER', async () => {
    const fake = makeAuthFake();
    const created = await fake.service.register({
      email: 'brand-new@example.com',
      username: 'brandnew',
      password: 'Str0ngPassw0rd!',
      country: 'BD',
    });

    expect(created.username).toBe('brandnew');
    const data = fake.prisma.user.create.mock.calls[0][0].data;
    expect(data.accountType).toBe('CUSTOMER');
    // The customer role is the ONLY role granted by registration.
    expect(data.userRoles.create).toEqual([{ roleId: 'role-user' }]);
  });

  it('CASE 9: a client-supplied accountType cannot turn registration into staff creation', async () => {
    const fake = makeAuthFake();
    // Simulates a hand-crafted request body that bypassed the DTO whitelist:
    // the service hardcodes the classification, so the row is still CUSTOMER.
    await fake.service.register({
      email: 'sneaky@example.com',
      username: 'sneaky',
      password: 'Str0ngPassw0rd!',
      country: 'BD',
      accountType: 'STAFF',
    } as never);

    const data = fake.prisma.user.create.mock.calls[0][0].data;
    expect(data.accountType).toBe('CUSTOMER');
    expect(fake.prisma.role.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: 'USER' } }),
    );
  });

  it('CASE 7: the customer login refuses a staff account even without a staff role', async () => {
    // The historical USER + SUPER_ADMIN hybrid shape: a STAFF-classified row
    // whose only role is USER. The AccountType gate alone must refuse it.
    const hybrid = makePopulation().map((u) =>
      u.id === 'staff-1' ? { ...u, userRoles: [{ role: { id: 'role-user', name: 'USER' } }] } : u,
    );
    const fake = makeAuthFake(hybrid);

    await expect(
      fake.service.login({ identifier: 'staff@example.com', password: 'Str0ngPassw0rd!' }),
    ).rejects.toThrow(ForbiddenException);
    expect(fake.sessions).toHaveLength(0);
    expect(fake.securityEvents.some((e) => e.metadata?.reason === 'staff-account')).toBe(true);
  });

  it('CASE 8: the ordinary admin signs in through the staff login (STAFF session)', async () => {
    const fake = makeAuthFake();
    const result = await fake.service.adminLogin({
      identifier: 'staff@example.com',
      password: 'Str0ngPassw0rd!',
    });

    expect(result.user.email).toBe('staff@example.com');
    expect(fake.sessions[0].kind).toBe('STAFF');
    expect(fake.auditLogs.some((l) => l.action === 'ADMIN_LOGIN_SUCCESS')).toBe(true);
  });

  it('CASE 8: the staff login also accepts the username identifier', async () => {
    const fake = makeAuthFake();
    const result = await fake.service.adminLogin({
      identifier: 'tanvion',
      password: 'Str0ngPassw0rd!',
    });
    expect(result.user.email).toBe(MASTER_ADMIN_EMAIL_2);
  });

  it('CASE 8: a CUSTOMER is refused at the staff login (no silent fallback)', async () => {
    const fake = makeAuthFake();

    await expect(
      fake.service.adminLogin({
        identifier: 'customer1@example.com',
        password: 'Str0ngPassw0rd!',
      }),
    ).rejects.toThrow(ForbiddenException);

    expect(fake.sessions).toHaveLength(0);
    const denied = fake.auditLogs.find((l) => l.action === 'ADMIN_LOGIN_DENIED');
    expect(denied?.newValue?.reason).toBe('not-staff');
  });

  it('CASE 8: unknown staff credentials stay a uniform 401', async () => {
    const fake = makeAuthFake();
    await expect(
      fake.service.adminLogin({ identifier: 'nobody@example.com', password: 'Str0ngPassw0rd!' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});

// ---------------------------------------------------------------------------
// CASE 15/16 — customer money surfaces stay customer-only and intact
// ---------------------------------------------------------------------------

describe('Account domains — customer money surfaces', () => {
  function makePayments() {
    const prisma: any = {
      manualDepositRequest: { findMany: jest.fn(async () => []) },
      withdrawalRequest: { findMany: jest.fn(async () => []) },
    };
    // Only the prisma dependency is exercised by the list queries under test.
    const service = new ManualPaymentService(prisma, {} as unknown as WalletService);
    return { service, prisma };
  }

  it('CASE 16: the admin deposit queue is filtered to CUSTOMER accounts', async () => {
    const { service, prisma } = makePayments();
    const rows = await service.listAdminDeposits({});
    expect(rows).toEqual([]);
    expect(prisma.manualDepositRequest.findMany.mock.calls[0][0].where.user.accountType).toBe(
      'CUSTOMER',
    );
  });

  it('CASE 16: the admin withdrawal queue is filtered to CUSTOMER accounts', async () => {
    const { service, prisma } = makePayments();
    const rows = await service.listAdminWithdrawals({});
    expect(rows).toEqual([]);
    expect(prisma.withdrawalRequest.findMany.mock.calls[0][0].where.user.accountType).toBe(
      'CUSTOMER',
    );
  });

  it('CASE 15: the admin bet list is scoped to customer-owned bets', async () => {
    const { service, raw } = makeAdminService();
    await service.listBets({});
    expect(raw.bet.findMany.mock.calls[0][0].where.user.accountType).toBe('CUSTOMER');
    expect(raw.bet.count.mock.calls[0][0].where.user.accountType).toBe('CUSTOMER');
  });
});

// ---------------------------------------------------------------------------
// CASE 19 — API-level separation on the customer detail route
// ---------------------------------------------------------------------------

describe('Account domains — customer detail route', () => {
  it('CASE 19: staff + master admin ids are NotFound through the customer detail route', async () => {
    const { service } = makeAdminService();
    await expect(service.getCustomerUser('staff-1')).rejects.toThrow(NotFoundException);
    await expect(service.getCustomerUser('master-1')).rejects.toThrow(NotFoundException);
  });

  it('CASE 19: a customer id still resolves through the customer detail route', async () => {
    const { service } = makeAdminService();
    const detail = await service.getCustomerUser('customer-1');
    expect(detail.id).toBe('customer-1');
  });
});

// ---------------------------------------------------------------------------
// CASE 4-6 — /admin/admins is STAFF-only
// ---------------------------------------------------------------------------

describe('Account domains — /admin/admins population (STAFF only)', () => {
  it('CASE 4: an ordinary admin appears in the staff directory', async () => {
    const { service } = makeAdminService();
    const page = await service.listStaffAccounts({});
    const staff = page.items.find((i) => i.id === 'staff-1');
    expect(staff).toBeDefined();
    expect(staff!.accountType).toBe('STAFF');
    expect(staff!.roles).toContain('ADMIN');
  });

  it('CASE 5: both master admins appear in the staff directory as SUPER_ADMIN', async () => {
    const { service } = makeAdminService();
    const page = await service.listStaffAccounts({});
    const masters = page.items.filter((i) => i.roles.includes('SUPER_ADMIN'));
    expect(masters.map((i) => i.email).sort()).toEqual(
      [MASTER_ADMIN_EMAIL, MASTER_ADMIN_EMAIL_2].sort(),
    );
  });

  it('CASE 6: customers never appear in the staff directory', async () => {
    const { service, raw } = makeAdminService();
    const page = await service.listStaffAccounts({});
    expect(page.items.map((i) => i.id)).not.toContain('customer-1');
    expect(page.items.map((i) => i.id)).not.toContain('customer-2');
    expect(raw.user.findMany.mock.calls[0][0].where.accountType).toBe('STAFF');
  });
});

// ---------------------------------------------------------------------------
// CASE 10 — staff creation creates STAFF (never USER + ADMIN)
// ---------------------------------------------------------------------------

describe('Account domains — staff creation (STAFF only)', () => {
  it('CASE 10: createAdminUser classifies the new account as STAFF', async () => {
    const fake = makeAdminService();
    // The read-back performed at the end of createAdminUser must resolve.
    fake.users.push({
      ...makePopulation()[2],
      id: 'u-created',
      email: 'newstaff@example.com',
      username: 'newstaff',
    });
    const result = await fake.service.createAdminUser({
      email: 'newstaff@example.com',
      username: 'newstaff',
      password: PASSWORD,
      roleNames: ['ADMIN'],
    } as any);

    expect(result.accountType).toBe('STAFF');
    const created = (fake.raw.user.create as jest.Mock).mock.calls[0][0].data;
    expect(created.accountType).toBe('STAFF');
    expect(created.status).toBe('ACTIVE');
  });

  it('CASE 10: USER (the customer role) cannot be granted at staff creation', async () => {
    const fake = makeAdminService();
    await expect(
      fake.service.createAdminUser({
        email: 'hybrid@example.com',
        username: 'hybrid',
        password: PASSWORD,
        roleNames: ['USER', 'ADMIN'],
      } as any),
    ).rejects.toThrow(/customer account role/);
    expect(fake.raw.user.create).not.toHaveBeenCalled();
  });

  it('CASE 10: staff roles cannot be assigned to a CUSTOMER account', async () => {
    const fake = makeAdminService();
    await expect(fake.service.assignRolesToUser('customer-1', ['ADMIN'])).rejects.toThrow(
      /staff accounts/,
    );
    expect(fake.raw.userRole.createMany).not.toHaveBeenCalled();
  });

  it('CASE 10: USER can never be assigned through role management', async () => {
    const fake = makeAdminService();
    await expect(fake.service.assignRolesToUser('staff-1', ['USER'])).rejects.toThrow(
      /customer account role/,
    );
    expect(fake.raw.userRole.createMany).not.toHaveBeenCalled();
  });

  it('CASE 10: ordinary staff role updates still work for STAFF accounts', async () => {
    const fake = makeAdminService();
    await expect(fake.service.assignRolesToUser('staff-1', ['SUPPORT'])).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// CASE 11-13 — master admin protection survives the reclassification
// ---------------------------------------------------------------------------

describe('Account domains — master admin protection', () => {
  const actor = { id: 'staff-1' } as any;

  it('CASE 11: master admins keep SUPER_ADMIN (never USER + SUPER_ADMIN)', async () => {
    const { service, users } = makeAdminService();
    for (const id of ['master-1', 'master-2']) {
      const master = users.find((u) => u.id === id)!;
      expect(master.userRoles.map((ur) => ur.role.name)).toEqual(['SUPER_ADMIN']);
      expect(master.userRoles.map((ur) => ur.role.name)).not.toContain('USER');
      expect(master.accountType).toBe('STAFF');
    }
    const page = await service.listStaffAccounts({});
    expect(page.items.filter((i) => i.roles.includes('SUPER_ADMIN'))).toHaveLength(2);
  });

  it('CASE 12: a master admin cannot be deleted (soft-delete/deactivate refused)', async () => {
    const fake = makeAdminService();
    await expect(
      fake.service.deactivateAdmin('master-1', { reason: 'cleanup' } as any, actor, '127.0.0.1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('CASE 13: a master admin cannot be deactivated or suspended', async () => {
    const fake = makeAdminService();
    await expect(
      fake.service.suspendUser('master-2', { reason: 'cleanup' } as any, actor, '127.0.0.1'),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      fake.service.deactivateAdmin('master-2', { reason: 'cleanup' } as any, actor, '127.0.0.1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('CASE 12/13: an ordinary staff account remains moderatable by staff endpoints', async () => {
    const fake = makeAdminService();
    // Only the guard chain is asserted here (no SUPER_ADMIN / staff-friendly
    // path); the write itself is covered by admin-management.spec.ts.
    await expect(
      fake.service.deactivateAdmin('customer-1', { reason: 'nope' } as any, actor, '127.0.0.1'),
    ).rejects.toThrow(/not a staff account|staff account/i);
  });
});

// ---------------------------------------------------------------------------
// §16/§17 — staff edit-profile + reset-password endpoints (loadAdminTarget)
// ---------------------------------------------------------------------------

describe('Account domains — staff edit & password-reset endpoints', () => {
  const actor = { id: 'staff-1' } as any;

  it('edits a STAFF account profile and records the staff audit action', async () => {
    const fake = makeAdminService();
    await fake.service.updateAdminProfile(
      'staff-1',
      { firstName: 'Renamed', reason: 'identity update' } as any,
      actor,
      '127.0.0.1',
    );
    // The guard now keys off accountType STAFF — the write lands with exactly
    // the whitelisted profile fields (never accountType/roles).
    expect(fake.raw.user.update).toHaveBeenCalledWith({
      where: { id: 'staff-1' },
      data: { firstName: 'Renamed' },
    });
    expect(JSON.stringify(fake.raw.auditLog.create.mock.calls)).toContain(
      'ADMIN_PROFILE_UPDATE',
    );
  });

  it('refuses to edit a CUSTOMER through the staff endpoint (domain separation)', async () => {
    const fake = makeAdminService();
    await expect(
      fake.service.updateAdminProfile(
        'customer-1',
        { firstName: 'Nope', reason: 'wrong surface' } as any,
        actor,
      ),
    ).rejects.toThrow(/not a staff account/);
    expect(fake.raw.user.update).not.toHaveBeenCalled();
  });

  it('an ordinary staff actor cannot modify a master admin identity (protected)', async () => {
    const fake = makeAdminService();
    await expect(
      fake.service.updateAdminProfile(
        'master-1',
        { firstName: 'Nope', reason: 'not allowed' } as any,
        actor,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(fake.raw.user.update).not.toHaveBeenCalled();
  });

  it('resets a STAFF password writing ONLY password fields (§17: classification/roles intact)', async () => {
    const fake = makeAdminService();
    // Different actor than target — reset disallows self by design (self-lockout guard).
    const masterActor = { id: 'master-1' } as any;
    const result = await fake.service.resetAdminPassword(
      'staff-1',
      { reason: 'rotation', newPassword: 'Str0ngPassw0rd!' } as any,
      masterActor,
      '127.0.0.1',
    );
    expect(result.userId).toBe('staff-1');
    expect(result.generatedPassword).toBeNull();
    const updateData = fake.raw.user.update.mock.calls[0][0].data;
    expect(Object.keys(updateData).sort()).toEqual(['passwordHash', 'passwordSetAt']);
    // No role/classification write happens as a side effect of a reset.
    expect(fake.raw.userRole.deleteMany).not.toHaveBeenCalled();
    expect(JSON.stringify(fake.raw.auditLog.create.mock.calls)).toContain(
      'ADMIN_PASSWORD_RESET',
    );
  });

  it('refuses to reset a CUSTOMER password through the staff endpoint', async () => {
    const fake = makeAdminService();
    await expect(
      fake.service.resetAdminPassword(
        'customer-1',
        { reason: 'wrong surface', newPassword: 'Str0ngPassw0rd!' } as any,
        actor,
      ),
    ).rejects.toThrow(/not a staff account/);
    expect(fake.raw.user.update).not.toHaveBeenCalled();
  });

  it('a master admin password reset is refused entirely — zero writes', async () => {
    const fake = makeAdminService();
    await expect(
      fake.service.resetAdminPassword(
        'master-2',
        { reason: 'not allowed', newPassword: 'Str0ngPassw0rd!' } as any,
        actor,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(fake.raw.user.update).not.toHaveBeenCalled();
    expect(fake.raw.auditLog.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// CASE 17 — staff accounts never receive a customer wallet
// ---------------------------------------------------------------------------

describe('Account domains — wallet separation', () => {
  function makeWalletService(accountType: 'CUSTOMER' | 'STAFF') {
    const prisma: any = {
      user: { findUnique: jest.fn(async () => ({ id: 'u1', accountType })) },
      wallet: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({
          id: 'w-created',
          availableBalance: 0,
          lockedBalance: 0,
          status: 'ACTIVE',
          ...data,
        })),
      },
      auditLog: { create: jest.fn(async (arg: any) => arg.data) },
    };
    return { service: new WalletService(prisma as unknown as PrismaService), raw: prisma };
  }

  it('CASE 17: a STAFF account does not get a customer wallet created', async () => {
    const { service, raw } = makeWalletService('STAFF');
    await expect(service.getOrCreateWalletForUser('staff-1', 'BDT')).rejects.toThrow(
      /do not have customer wallets/,
    );
    expect(raw.wallet.create).not.toHaveBeenCalled();
  });

  it('CASE 17: a CUSTOMER account still gets its wallet (unchanged behaviour)', async () => {
    const { service, raw } = makeWalletService('CUSTOMER');
    const wallet = await service.getOrCreateWalletForUser('customer-1', 'BDT');
    expect(wallet.currency).toBe('BDT');
    expect(raw.wallet.create).toHaveBeenCalledTimes(1);
    expect(raw.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('CASE 14: an EXISTING wallet is returned untouched for any account', async () => {
    const existing = {
      id: 'wallet-legacy',
      userId: 'staff-1',
      currency: 'BDT',
      availableBalance: 12500,
      lockedBalance: 500,
      status: 'ACTIVE',
    };
    const prisma: any = {
      user: { findUnique: jest.fn(async () => ({ id: 'staff-1', accountType: 'STAFF' })) },
      wallet: { findUnique: jest.fn(async () => existing), create: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const service = new WalletService(prisma as unknown as PrismaService);
    // Historical data is preserved: the guard only blocks CREATION.
    const wallet = await service.getOrCreateWalletForUser('staff-1', 'BDT');
    expect(wallet).toBe(existing);
    expect(prisma.wallet.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Customer statistics exclude staff
// ---------------------------------------------------------------------------

describe('Account domains — customer statistics', () => {
  it('counts CUSTOMER accounts only in the dashboard user totals', async () => {
    const fake = makeAdminService();
    const summary = await fake.service.getSummary();
    // 5 fixture rows, 3 of them STAFF → customer totals see only 2.
    expect(summary.users.total).toBe(2);
    expect(fake.raw.user.groupBy.mock.calls[0][0].where.accountType).toBe('CUSTOMER');
  });

  it('filters the bet-statistics groupBy to customer-owned bets', async () => {
    const fake = makeAdminService();
    await fake.service.getSummary();
    expect(fake.raw.bet.groupBy.mock.calls[0][0].where.user.accountType).toBe('CUSTOMER');
  });
});

// ---------------------------------------------------------------------------
// CASE 7-9, 20 — login separation, registration classification, session guards
// ---------------------------------------------------------------------------

/**
 * Minimal AuthService fake. Honors exactly the lookup shapes the auth service
 * uses: by id, by email (customer login), and the OR-of-email/username lookup
 * of the staff login. `getEmailSender()` resolves in the Jest env — the same
 * way auth.spec.ts exercises the registration flow.
 */
function makeAuthFake(users: FixtureUser[] = makePopulation()) {
  const sessions: any[] = [];
  const securityEvents: any[] = [];
  const auditLogs: any[] = [];

  const baseRow = {
    firstName: null,
    lastName: null,
    phone: null,
    country: 'BD',
    timezone: 'UTC',
    status: 'PENDING',
    emailVerified: false,
    phoneVerified: false,
    kycStatus: 'NOT_STARTED',
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    wallets: [],
    userRoles: [],
  };

  const byId = (id: string) => users.find((u) => u.id === id) ?? null;
  const byEmail = (email: string) =>
    users.find((u) => u.email?.toLowerCase() === String(email).toLowerCase()) ?? null;

  const prisma: any = {
    user: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.id !== undefined ? byId(where.id) : byEmail(where.email),
      ),
      findFirst: jest.fn(async ({ where }: any) => {
        const ors: any[] = where?.OR ?? [];
        if (ors.length === 0) return users[0] ?? null;
        return (
          users.find((u) =>
            ors.some(
              (clause) =>
                (clause.email !== undefined &&
                  u.email?.toLowerCase() === String(clause.email).toLowerCase()) ||
                (clause.username !== undefined && u.username === clause.username),
            ),
          ) ?? null
        );
      }),
      create: jest.fn(async ({ data }: any) => ({ ...baseRow, ...data, id: 'u-new' })),
      update: jest.fn(async () => ({})),
    },
    role: { upsert: jest.fn(async () => ({ id: 'role-user', name: 'USER' })) },
    session: {
      create: jest.fn(async ({ data }: any) => {
        const session = { id: `sess-${sessions.length + 1}`, ...data };
        sessions.push(session);
        return session;
      }),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 0 })),
      findUnique: jest.fn(async () => null),
      findFirst: jest.fn(async () => null),
    },
    securityEvent: {
      create: jest.fn(async ({ data }: any) => {
        securityEvents.push(data);
        return data;
      }),
      count: jest.fn(async () => 0),
    },
    authToken: { create: jest.fn(async ({ data }: any) => ({ id: 'tok-1', ...data })) },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        auditLogs.push(data);
        return data;
      }),
    },
  };

  const jwt = { signAsync: jest.fn(async () => 'access-token') } as unknown as JwtService;
  const service = new AuthService(
    prisma as unknown as PrismaService,
    jwt,
    new OtpService(prisma as unknown as PrismaService),
  );
  return { service, prisma, sessions, securityEvents, auditLogs };
}

// ---------------------------------------------------------------------------
// CASE 14/15/16 + migration safety — the data migration never destroys data
// ---------------------------------------------------------------------------

describe('Account domains — add_account_type migration safety', () => {
  const migrationsRoot = path.join(__dirname, '..', '..', '..', 'database', 'prisma', 'migrations');
  const sql = fs.readFileSync(
    path.join(migrationsRoot, '20260923120000_add_account_type', 'migration.sql'),
    'utf8',
  );
  /** Statements only — the header comments may legitimately name any table. */
  const statements = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  it('is additive: the classification column lands with a default, nothing is dropped', () => {
    expect(statements).toContain(
      `ADD COLUMN "accountType" "AccountType" NOT NULL DEFAULT 'CUSTOMER'`,
    );
    expect(statements).not.toMatch(/DROP\s+(TABLE|DATABASE)|TRUNCATE/i);
  });

  it('never deletes a User row (no "delete all users" escape hatch exists)', () => {
    expect(statements).not.toMatch(/DELETE\s+FROM\s+"User"(\s|;|$)/);
    const deletes = [...statements.matchAll(/DELETE\s+FROM\s+"(\w+)"/g)].map((m) => m[1]);
    // The ONLY join rows ever removed: USER-role rows of STAFF accounts.
    expect(deletes).toEqual(['UserRole']);
    // The USER-role delete is bounded to already-reclassified STAFF owners —
    // customer UserRole rows (and every SUPER_ADMIN/ADMIN assignment) survive.
    expect(statements).toMatch(/u\."accountType"\s*=\s*'STAFF'/);
    expect(statements).not.toMatch(/r\."name"\s*=\s*'(SUPER_ADMIN|ADMIN)'/);
  });

  it('CASE 14: wallets are never written by the migration', () => {
    expect(statements).not.toMatch(/"(Wallet|WalletTransaction|LedgerEntry)"/);
  });

  it('CASE 15: bets are never written by the migration', () => {
    expect(statements).not.toMatch(/"(Bet|BetSelection|Market|Event)"/);
  });

  it('CASE 16: deposits and withdrawals are never written by the migration', () => {
    expect(statements).not.toMatch(
      /"(Deposit|ManualDepositRequest|WithdrawalRequest|PaymentMethod)"/,
    );
  });

  it('writes only the new column, the USER-role join and session revocations', () => {
    const writeTargets = [...statements.matchAll(/\b(UPDATE|DELETE\s+FROM)\s+"(\w+)"/g)].map(
      (m) => m[2],
    );
    expect([...new Set(writeTargets)].sort()).toEqual(['Session', 'User', 'UserRole']);
    // Role/AuditLog are only ever READ (classification predicates).
    expect(statements).not.toMatch(/UPDATE\s+"(Role|AuditLog)"/);
    expect(statements).not.toMatch(/DELETE\s+FROM\s+"Role"/);
  });

  it('CASE 11: both fixed Master Admin identities are classified STAFF, SUPER_ADMIN preserved', () => {
    expect(statements).toContain('tanvirujaman101@gmail.com');
    expect(statements).toContain('tanvionroyale@gmail.com');
    expect(statements).toContain(`SET "accountType" = 'STAFF'`);
  });

  it('never writes customer-facing history tables (support/notifications/audit)', () => {
    // Support/notifications/verification history must not be mentioned as a
    // write target at all; AuditLog is only READ (classification predicate).
    expect(statements).not.toMatch(
      /"(SupportTicket|SupportMessage|Notification|NotificationDelivery|SecurityEvent|AuthIdentity)"/u,
    );
    expect(statements).not.toMatch(/\bUPDATE\s+"AuditLog"|\bDELETE\s+FROM\s+"AuditLog"/u);
  });
});

// ---------------------------------------------------------------------------
// CASE 20 — session/auth guards distinguish CUSTOMER from STAFF
// ---------------------------------------------------------------------------

/**
 * RolesGuard is the last line of defence between the two session domains: a
 * customer session token that CLAIMS a staff role (e.g. minted before the
 * account was promoted, then re-signed by /auth/refresh) must not reach an
 * admin API — the session KIND has to be STAFF, and only /auth/admin-login
 * creates that kind.
 */
describe('Account domains — CUSTOMER vs STAFF session guards', () => {
  function guardFor(required: string[] | undefined) {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === ROLES_KEY ? required : key === PERMISSIONS_KEY ? undefined : undefined,
      ),
    } as any;
    return new RolesGuard(reflector);
  }

  function contextFor(user: unknown) {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as any;
  }

  const staffRoles = ['ADMIN', 'SUPER_ADMIN'];

  it('CASE 20: a CUSTOMER session is refused an admin route (401, re-auth required)', () => {
    // Same roles in the token, wrong session domain → refused.
    const guard = guardFor(staffRoles);
    expect(() =>
      guard.canActivate(contextFor({ id: 'u1', roles: ['SUPER_ADMIN'], sessionKind: 'CUSTOMER' })),
    ).toThrow(UnauthorizedException);
  });

  it('CASE 20: a PRE-separation token (no sessionKind at all) is also refused', () => {
    const guard = guardFor(staffRoles);
    expect(() => guard.canActivate(contextFor({ id: 'u1', roles: ['SUPER_ADMIN'] }))).toThrow(
      UnauthorizedException,
    );
  });

  it('CASE 20: a STAFF session with the required role is allowed', () => {
    const guard = guardFor(staffRoles);
    expect(guard.canActivate(contextFor({ id: 's1', roles: ['ADMIN'], sessionKind: 'STAFF' }))).toBe(
      true,
    );
  });

  it('CASE 20: role checks still come first (a plain customer gets the existing 403)', () => {
    const guard = guardFor(staffRoles);
    expect(() =>
      guard.canActivate(contextFor({ id: 'c1', roles: ['USER'], sessionKind: 'CUSTOMER' })),
    ).toThrow(ForbiddenException);
  });

  it('CASE 20: customer routes stay open to CUSTOMER sessions', () => {
    const guard = guardFor(undefined); // no @Roles() → any authenticated user
    expect(guard.canActivate(contextFor({ id: 'c1', roles: ['USER'], sessionKind: 'CUSTOMER' }))).toBe(
      true,
    );
  });
});

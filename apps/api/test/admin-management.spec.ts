/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { validate } from 'class-validator';
import * as argon2 from 'argon2';
import { Prisma } from '../src/generated/prisma';
import { AdminService } from '../src/modules/admin/admin.service';
import { CreateAdminUserDto } from '../src/modules/admin/dto/admin-management.dto';
import { bootstrapMasterAdmin } from '../../../database/scripts/bootstrap-master-admin';
import { promoteAdminToSuperAdmin } from '../../../database/scripts/promote-admin';
import {
  assertMasterAdminEmail,
  getMasterAdminEmails,
  isMasterAdminEmail,
  warnIfMasterAdminsUnconfigured,
} from '../src/config/master-admins';

/**
 * Admin management (SUPER_ADMIN only) — service-level behavior tests.
 *
 * Covers:
 *  1. SUPER_ADMIN can never be granted via createAdminUser / assignRolesToUser (403)
 *  2. Happy-path staff creation hashes with argon2id, sets ACTIVE + assigns roles
 *  3. Duplicate email/username (P2002) maps to 409
 *  4. Unknown role names → 400; missing user → 404
 *  5. SUPER_ADMIN role permissions are fixed (403); unknown permissions → 400
 *  6. Role permission replacement writes the full new set transactionally
 *  7. DTO validation rejects malformed payloads
 *  8. MASTER_ADMIN_EMAILS is the one allowlist that grants/keeps SUPER_ADMIN:
 *     bootstrap-master-admin.ts / promote-admin.ts refuse every other address
 *     before touching the database
 *  9. Master admin accounts can never be deactivated (even by another
 *     SUPER_ADMIN, even when other SUPER_ADMINs are active)
 * 10. Existing-account guard: both scripts print the target row's
 *     createdAt/status/emailVerified/username and REFUSE (zero writes) unless
 *     --confirm-existing was passed, before ever attaching SUPER_ADMIN to a
 *     row they did not create
 */

const ROLES = [
  { id: 'role-super', name: 'SUPER_ADMIN' },
  { id: 'role-admin', name: 'ADMIN' },
  { id: 'role-support', name: 'SUPPORT' },
];

const PERMISSIONS = [
  { id: 'perm-users-read', name: 'users.read' },
  { id: 'perm-support-update', name: 'support.update' },
];

function userRow(id: string, roleNames: string[]) {
  return {
    id,
    email: 'new.staff@example.com',
    username: 'newstaff',
    phone: null,
    firstName: 'New',
    lastName: 'Staff',
    country: null,
    status: 'ACTIVE',
    emailVerified: false,
    phoneVerified: false,
    emailVerifiedAt: null,
    phoneVerifiedAt: null,
    kycStatus: 'NOT_STARTED',
    // Staff-domain row: these fixtures drive the Admin -> Admins endpoints
    // (roles/profile/password/deactivate), which now require STAFF classification.
    accountType: 'STAFF' as const,
    lastLoginAt: null,
    createdAt: new Date('2026-09-04T00:00:00Z'),
    userRoles: roleNames.map((name) => ({ role: { name } })),
    verifications: [],
    wallets: [],
    _count: { bets: 0, sessions: 0 },
  };
}

function makeFake() {
  const state = { nextUser: null as any };

  const roleFindMany = jest.fn(async (arg: any) => {
    if (arg?.where) {
      const wanted: string[] = arg.where.name?.in ?? [];
      return ROLES.filter((r) => wanted.includes(r.name));
    }
    return ROLES.map((r) => ({ ...r, permissions: [] }));
  });

  const userRole = {
    deleteMany: jest.fn(async () => ({ count: 1 })),
    createMany: jest.fn(async (arg: any) => ({ count: arg.data.length })),
  };

  const rolePermission = {
    deleteMany: jest.fn(async () => ({ count: 1 })),
    createMany: jest.fn(async (arg: any) => ({ count: arg.data.length })),
  };

  // Interactive-transaction surface used by the shared soft-delete routine
  // (deactivateAdmin soft-deletes through prisma.$transaction(callback)).
  const tx: any = {
    user: { update: jest.fn(async () => ({})) },
    userRole: { deleteMany: jest.fn(async () => ({ count: 1 })) },
    session: { updateMany: jest.fn(async () => ({ count: 2 })) },
  };

  const prisma: any = {
    user: {
      create: jest.fn(async (arg: any) => ({ id: 'u-new', ...arg.data })),
      findUnique: jest.fn(async () => state.nextUser),
      count: jest.fn(async () => 0),
    },
    session: { count: jest.fn(async () => 0), updateMany: jest.fn(async () => ({ count: 0 })) },
    role: {
      findMany: roleFindMany,
      findUnique: jest.fn(async (arg: any) => ROLES.find((r) => r.id === arg.where.id) ?? null),
    },
    permission: {
      findMany: jest.fn(async (arg: any) => {
        if (!arg?.where) return PERMISSIONS;
        const wanted: string[] = arg.where.name?.in ?? [];
        return PERMISSIONS.filter((p) => wanted.includes(p.name));
      }),
    },
    userRole,
    rolePermission,
    auditLog: { create: jest.fn(async (arg: any) => arg.data) },
    $transaction: jest.fn(async (arg: any) => {
      // Interactive callback (soft delete) or the array form used elsewhere.
      if (typeof arg === 'function') return arg(tx);
      const out = [];
      for (const op of arg) out.push(await op);
      return out;
    }),
  };

  return { prisma, state, tx, userRole, rolePermission, roleFindMany };
}

function makeService(fake: ReturnType<typeof makeFake>): AdminService {
  return new AdminService(fake.prisma, {} as any);
}

describe('Admin management service (SUPER_ADMIN only)', () => {
  it('rejects granting SUPER_ADMIN through createAdminUser with 403', async () => {
    const fake = makeFake();
    const service = makeService(fake);
    await expect(
      service.createAdminUser({
        email: 'staff@example.com',
        username: 'staff',
        password: 'Str0ngPassw0rd!',
        roleNames: ['SUPER_ADMIN'],
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(fake.prisma.user.create).not.toHaveBeenCalled();
    expect(fake.prisma.role.findMany).not.toHaveBeenCalled();
  });

  it('rejects assigning SUPER_ADMIN through assignRolesToUser with 403', async () => {
    const fake = makeFake();
    fake.state.nextUser = userRow('u1', ['SUPPORT']);
    const service = makeService(fake);
    await expect(service.assignRolesToUser('u1', ['SUPER_ADMIN'])).rejects.toThrow(
      ForbiddenException,
    );
    expect(fake.userRole.deleteMany).not.toHaveBeenCalled();
  });

  it('creates a staff user with an argon2id hash, ACTIVE status and assigned roles', async () => {
    const fake = makeFake();
    fake.state.nextUser = userRow('u-new', ['SUPPORT']);
    const service = makeService(fake);

    const result = await service.createAdminUser({
      email: 'staff@example.com',
      username: 'newstaff',
      password: 'Str0ngPassw0rd!',
      firstName: 'New',
      roleNames: ['SUPPORT'],
    });

    expect(result.id).toBe('u-new');
    expect(result.roles).toEqual(['SUPPORT']);

    const created = fake.prisma.user.create.mock.calls[0][0].data;
    expect(created.status).toBe('ACTIVE');
    expect(created.passwordSetAt).toBeInstanceOf(Date);
    expect(created.passwordHash).not.toBe('Str0ngPassw0rd!');
    expect(await argon2.verify(created.passwordHash, 'Str0ngPassw0rd!')).toBe(true);

    expect(fake.roleFindMany).toHaveBeenCalledWith({ where: { name: { in: ['SUPPORT'] } } });
    expect(fake.userRole.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'u-new', roleId: 'role-support' }],
      skipDuplicates: true,
    });
  });

  it('maps a duplicate email/username (P2002) to 409 Conflict', async () => {
    const fake = makeFake();
    fake.prisma.user.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
    );
    const service = makeService(fake);
    await expect(
      service.createAdminUser({
        email: 'taken@example.com',
        username: 'taken',
        password: 'Str0ngPassw0rd!',
        roleNames: ['SUPPORT'],
      }),
    ).rejects.toThrow(ConflictException);
  });
  it('rejects unknown role names with 400', async () => {
    const fake = makeFake();
    fake.state.nextUser = userRow('u1', []);
    const service = makeService(fake);
    await expect(service.assignRolesToUser('u1', ['SUPPORT', 'NOT_A_ROLE'])).rejects.toThrow(
      BadRequestException,
    );
    expect(fake.userRole.deleteMany).not.toHaveBeenCalled();
  });

  it('returns 404 when assigning roles to a missing user', async () => {
    const fake = makeFake();
    const service = makeService(fake);
    await expect(service.assignRolesToUser('missing', ['SUPPORT'])).rejects.toThrow(
      NotFoundException,
    );
  });

  it('replaces roles transactionally, preserving any existing SUPER_ADMIN assignment', async () => {
    const fake = makeFake();
    fake.state.nextUser = userRow('u1', ['SUPER_ADMIN', 'SUPPORT']);
    const service = makeService(fake);

    const result = await service.assignRolesToUser('u1', ['ADMIN', 'SUPPORT']);

    expect(result.roles).toEqual(['SUPER_ADMIN', 'SUPPORT']);
    expect(fake.userRole.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', role: { name: { not: 'SUPER_ADMIN' } } },
    });
    const createCall = fake.userRole.createMany.mock.calls[0][0];
    expect(createCall.skipDuplicates).toBe(true);
    expect(createCall.data).toHaveLength(2);
    expect(createCall.data).toEqual(
      expect.arrayContaining([
        { userId: 'u1', roleId: 'role-admin' },
        { userId: 'u1', roleId: 'role-support' },
      ]),
    );
    expect(fake.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects editing SUPER_ADMIN permissions with 403', async () => {
    const fake = makeFake();
    const service = makeService(fake);
    await expect(service.updateRolePermissions('role-super', ['users.read'])).rejects.toThrow(
      ForbiddenException,
    );
    expect(fake.rolePermission.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects unknown permission names with 400', async () => {
    const fake = makeFake();
    const service = makeService(fake);
    await expect(
      service.updateRolePermissions('role-support', ['users.read', 'not.a.permission']),
    ).rejects.toThrow(BadRequestException);
    expect(fake.rolePermission.deleteMany).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing role', async () => {
    const fake = makeFake();
    const service = makeService(fake);
    await expect(service.updateRolePermissions('role-missing', [])).rejects.toThrow(
      NotFoundException,
    );
  });

  it('replaces role permissions transactionally with the full new set', async () => {
    const fake = makeFake();
    const service = makeService(fake);

    const roles = await service.updateRolePermissions('role-support', [
      'support.update',
      'users.read',
    ]);

    expect(roles).toHaveLength(3);
    expect(fake.rolePermission.deleteMany).toHaveBeenCalledWith({
      where: { roleId: 'role-support' },
    });
    const createCall = fake.rolePermission.createMany.mock.calls[0][0];
    expect(createCall.skipDuplicates).toBe(true);
    expect(createCall.data).toHaveLength(2);
    expect(createCall.data).toEqual(
      expect.arrayContaining([
        { roleId: 'role-support', permissionId: 'perm-support-update' },
        { roleId: 'role-support', permissionId: 'perm-users-read' },
      ]),
    );
    expect(fake.roleFindMany).toHaveBeenCalledWith({
      include: { permissions: { include: { permission: true } } },
      orderBy: { name: 'asc' },
    });
  });

  it('lists permissions ordered by name', async () => {
    const fake = makeFake();
    const service = makeService(fake);
    const result = await service.listPermissions();
    expect(result).toEqual(PERMISSIONS);
    expect(fake.prisma.permission.findMany).toHaveBeenCalledWith({ orderBy: { name: 'asc' } });
  });
});

describe('Admin management DTO validation', () => {
  it('rejects a malformed CreateAdminUserDto', async () => {
    const dto = new CreateAdminUserDto();
    dto.email = 'not-an-email';
    dto.username = 'no';
    dto.password = 'short';
    dto.roleNames = 'SUPPORT' as any;

    const errors = await validate(dto);
    expect(errors.map((e) => e.property).sort()).toEqual([
      'email',
      'password',
      'roleNames',
      'username',
    ]);
  });

  it('accepts a valid CreateAdminUserDto', async () => {
    const dto = new CreateAdminUserDto();
    dto.email = 'staff@example.com';
    dto.username = 'staff_user';
    dto.password = 'Str0ngPassw0rd!';
    dto.roleNames = ['SUPPORT'];

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});



// ---------------------------------------------------------------------------
// Master admin allowlist — the fixed SUPER_ADMIN owners (MASTER_ADMIN_EMAILS)
// ---------------------------------------------------------------------------

const MASTER_ADMIN_ENV = 'MASTER_ADMIN_EMAILS';

/** Original MASTER_ADMIN_EMAILS value; restored after every test below. */
const ORIGINAL_MASTER_ADMIN_ENV = process.env[MASTER_ADMIN_ENV];

function setMasterAdminEmails(value: string | undefined): void {
  if (value === undefined) delete process.env[MASTER_ADMIN_ENV];
  else process.env[MASTER_ADMIN_ENV] = value;
}

function restoreMasterAdminEmails(): void {
  setMasterAdminEmails(ORIGINAL_MASTER_ADMIN_ENV);
}

describe('Master admin allowlist (MASTER_ADMIN_EMAILS)', () => {
  afterEach(restoreMasterAdminEmails);

  it('parses, trims and lower-cases the comma-separated list', () => {
    setMasterAdminEmails(' Master.One@Gmail.com , master.two@gmail.com ,, ');
    expect(getMasterAdminEmails()).toEqual(['master.one@gmail.com', 'master.two@gmail.com']);
    expect(isMasterAdminEmail('MASTER.ONE@gmail.com ')).toBe(true);
    expect(isMasterAdminEmail('intruder@gmail.com')).toBe(false);
  });

  it('matches nobody while the list is unset or blank', () => {
    setMasterAdminEmails(undefined);
    expect(getMasterAdminEmails()).toEqual([]);
    expect(isMasterAdminEmail('master.one@gmail.com')).toBe(false);
    expect(isMasterAdminEmail(null)).toBe(false);
    expect(isMasterAdminEmail('')).toBe(false);

    setMasterAdminEmails(' , ');
    expect(getMasterAdminEmails()).toEqual([]);
    expect(isMasterAdminEmail('master.one@gmail.com')).toBe(false);
  });

  it('assertMasterAdminEmail accepts only a listed address', () => {
    setMasterAdminEmails('master.one@gmail.com');
    expect(() => assertMasterAdminEmail('master.one@gmail.com')).not.toThrow();
    expect(() => assertMasterAdminEmail('someone.else@gmail.com')).toThrow(/MASTER_ADMIN_EMAILS/);
  });

  it('caps the allowlist at MASTER_ADMIN_LIMIT (2) — extra addresses never match', () => {
    // The policy allows exactly TWO permanent master admins. A longer env list
    // is a misconfiguration: entries beyond the first two are ignored so they
    // can never receive or retain SUPER_ADMIN.
    setMasterAdminEmails('one@gmail.com,two@gmail.com,three@gmail.com,four@gmail.com');

    expect(getMasterAdminEmails()).toEqual(['one@gmail.com', 'two@gmail.com']);
    expect(isMasterAdminEmail('three@gmail.com')).toBe(false);
    expect(isMasterAdminEmail('four@gmail.com')).toBe(false);
    expect(() => assertMasterAdminEmail('three@gmail.com')).toThrow(/MASTER_ADMIN_EMAILS/);
  });

  it('deduplicates before applying the cap', () => {
    setMasterAdminEmails('one@gmail.com,one@gmail.com,two@gmail.com');
    expect(getMasterAdminEmails()).toEqual(['one@gmail.com', 'two@gmail.com']);
  });

  it('the over-length startup warning prints COUNTS only — never the addresses', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      setMasterAdminEmails('one@gmail.com,two@gmail.com,three@gmail.com');
      warnIfMasterAdminsUnconfigured();
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0][0]);
      expect(message).toMatch(/lists 3 addresses/);
      expect(message).not.toContain('one@gmail.com');
      expect(message).not.toContain('two@gmail.com');
      expect(message).not.toContain('three@gmail.com');
    } finally {
      warn.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// The two scripts that can grant SUPER_ADMIN
// ---------------------------------------------------------------------------

describe('bootstrap-master-admin / promote-admin (allowlist + existing-account guards)', () => {
  afterEach(restoreMasterAdminEmails);

  function makeScriptPrisma(existingUserId: string | null = null) {
    // Writes performed inside the interactive transaction.
    const tx: any = {
      role: { findUnique: jest.fn(async () => ({ id: 'role-super', name: 'SUPER_ADMIN' })) },
      user: { create: jest.fn(async (arg: any) => ({ id: 'u-master', ...arg.data })) },
      userRole: { create: jest.fn(async () => ({})) },
    };
    const prisma: any = {
      user: {
        // The pre-existing row the guard must inspect: the four safe fields it
        // prints, plus a passwordHash so the tests can prove it is never shown
        // (promote-admin fetches the whole row, not a select subset).
        findUnique: jest.fn(async () =>
          existingUserId
            ? {
                id: existingUserId,
                username: 'existing_master',
                passwordHash: '$argon2id$v=19$m=65536,t=1,p=1$FAKEHASH',
                status: 'ACTIVE',
                emailVerified: true,
                createdAt: new Date('2026-01-15T00:00:00.000Z'),
              }
            : null,
        ),
        create: jest.fn(async (arg: any) => ({ id: 'u-master', ...arg.data })),
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      role: { findUnique: jest.fn(async () => ({ id: 'role-super', name: 'SUPER_ADMIN' })) },
      userRole: {
        upsert: jest.fn(async () => ({})),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    };
    return { prisma, tx };
  }

  /**
   * The exact refusal for the mocked existing row above — locked verbatim so
   * the operator-facing takeover warning can never drift between the two
   * scripts or lose its --confirm-existing instruction.
   */
  const EXISTING_ACCOUNT_REFUSAL =
    'An account with this email already exists (created 2026-01-15T00:00:00.000Z, verified: true). ' +
    'If this is NOT an account you or the other master admin created, DO NOT proceed — ' +
    'treat this as a possible takeover attempt. Re-run with --confirm-existing only after ' +
    "you have verified this account's origin out of band.";

  it('promote-admin refuses a non-allowlisted email before any database access', async () => {
    setMasterAdminEmails('master.one@gmail.com');
    const { prisma } = makeScriptPrisma('u-existing');

    await expect(promoteAdminToSuperAdmin(prisma, 'intruder@example.com')).rejects.toThrow(
      /MASTER_ADMIN_EMAILS/,
    );

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.userRole.upsert).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('bootstrap-master-admin refuses a non-allowlisted email before any database access', async () => {
    setMasterAdminEmails('master.one@gmail.com');
    const { prisma } = makeScriptPrisma();

    await expect(
      bootstrapMasterAdmin({
        prisma,
        email: 'Intruder@Example.com',
        username: 'intruder',
        password: 'Str0ngPassw0rd!',
      }),
    ).rejects.toThrow(/MASTER_ADMIN_EMAILS/);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses every address while MASTER_ADMIN_EMAILS is unset', async () => {
    setMasterAdminEmails(undefined);
    const { prisma } = makeScriptPrisma('u-existing');

    await expect(promoteAdminToSuperAdmin(prisma, 'master.one@gmail.com')).rejects.toThrow(
      /MASTER_ADMIN_EMAILS/,
    );
    expect(prisma.userRole.upsert).not.toHaveBeenCalled();
  });

  it('bootstrap-master-admin creates an ACTIVE, email-verified user + SUPER_ADMIN in one transaction', async () => {
    setMasterAdminEmails('master.one@gmail.com');
    const { prisma, tx } = makeScriptPrisma();

    const result = await bootstrapMasterAdmin({
      prisma,
      email: 'Master.One@Gmail.com',
      username: 'master_one',
      password: 'Str0ngPassw0rd!',
      firstName: 'Master',
    });

    expect(result).toEqual({ userId: 'u-master', created: true });
    // The row is created INSIDE the transaction, together with the role.
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    const created = tx.user.create.mock.calls[0][0].data;
    expect(created.email).toBe('master.one@gmail.com');
    expect(created.username).toBe('master_one');
    expect(created.status).toBe('ACTIVE');
    expect(created.emailVerified).toBe(true);
    expect(created.emailVerifiedAt).toBeInstanceOf(Date);
    expect(created.passwordSetAt).toBeInstanceOf(Date);
    expect(created.passwordHash).not.toBe('Str0ngPassw0rd!');
    expect(await argon2.verify(created.passwordHash, 'Str0ngPassw0rd!')).toBe(true);
    expect(tx.userRole.create).toHaveBeenCalledWith({
      data: { userId: 'u-master', roleId: 'role-super' },
    });
  });

  it('bootstrap-master-admin refuses an existing account WITHOUT --confirm-existing (prints details, zero writes)', async () => {
    setMasterAdminEmails('master.one@gmail.com');
    const { prisma } = makeScriptPrisma('u-existing');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await expect(
        bootstrapMasterAdmin({
          prisma,
          email: 'master.one@gmail.com',
          username: 'master_one',
          password: 'Str0ngPassw0rd!',
        }),
      ).rejects.toThrow(EXISTING_ACCOUNT_REFUSAL);

      // 1. The existing account's safe fields are printed for out-of-band
      //    verification — never its password/hash.
      const printed = logSpy.mock.calls.flat().join('\n');
      expect(printed).toContain('username=existing_master');
      expect(printed).toContain('status=ACTIVE');
      expect(printed).toContain('emailVerified=true');
      expect(printed).toContain('createdAt=2026-01-15T00:00:00.000Z');
      expect(printed).not.toContain('passwordHash');
      expect(printed).not.toContain('$argon2id$');

      // 4. Zero writes: refused before the role upsert, any user write or a
      //    transaction — the CLI wrapper turns the throw into exit 1.
      expect(prisma.role.findUnique).not.toHaveBeenCalled();
      expect(prisma.userRole.upsert).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('bootstrap-master-admin WITH --confirm-existing re-run on an existing account only ensures SUPER_ADMIN', async () => {
    setMasterAdminEmails('master.one@gmail.com');
    const { prisma } = makeScriptPrisma('u-existing');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      const result = await bootstrapMasterAdmin({
        prisma,
        email: 'master.one@gmail.com',
        username: 'ignored_username',
        password: 'Ignored0rd!',
        confirmExisting: true,
      });

      expect(result).toEqual({ userId: 'u-existing', created: false });
      expect(prisma.userRole.upsert).toHaveBeenCalledWith({
        where: { userId_roleId: { userId: 'u-existing', roleId: 'role-super' } },
        update: {},
        create: { userId: 'u-existing', roleId: 'role-super' },
      });
      // STAFF classification + USER-role drop only — no password/username/
      // profile overwrite, no second user row.
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-existing' },
        data: { accountType: 'STAFF' },
      });
      expect(prisma.userRole.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u-existing', role: { name: 'USER' } },
      });
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      // The account details are still printed when proceeding (audit trail),
      // and the hash stays out of the output either way.
      const printed = logSpy.mock.calls.flat().join('\n');
      expect(printed).toContain('username=existing_master');
      expect(printed).not.toContain('$argon2id$');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('promote-admin refuses an existing account WITHOUT --confirm-existing (prints details, zero writes)', async () => {
    setMasterAdminEmails('master.one@gmail.com');
    const { prisma } = makeScriptPrisma('u-existing');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      // Same two-argument call the CLI makes when --confirm-existing is absent.
      await expect(promoteAdminToSuperAdmin(prisma, 'Master.One@Gmail.com')).rejects.toThrow(
        EXISTING_ACCOUNT_REFUSAL,
      );

      // 1. The existing account's safe fields are printed for out-of-band
      //    verification — never its password/hash.
      const printed = logSpy.mock.calls.flat().join('\n');
      expect(printed).toContain('username=existing_master');
      expect(printed).toContain('status=ACTIVE');
      expect(printed).toContain('emailVerified=true');
      expect(printed).toContain('createdAt=2026-01-15T00:00:00.000Z');
      expect(printed).not.toContain('passwordHash');
      expect(printed).not.toContain('$argon2id$');

      // 4. Zero writes: refused before the role lookup/upsert or any user
      //    mutation — the CLI wrapper turns the throw into exit 1.
      expect(prisma.role.findUnique).not.toHaveBeenCalled();
      expect(prisma.userRole.upsert).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('promote-admin WITH --confirm-existing grants SUPER_ADMIN to an existing allowlisted user', async () => {
    setMasterAdminEmails('master.one@gmail.com');
    const { prisma } = makeScriptPrisma('u-existing');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await expect(
        promoteAdminToSuperAdmin(prisma, 'Master.One@Gmail.com', true),
      ).resolves.toBe('master.one@gmail.com is now SUPER_ADMIN.');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'master.one@gmail.com' },
      });
      expect(prisma.userRole.upsert).toHaveBeenCalledWith({
        where: { userId_roleId: { userId: 'u-existing', roleId: 'role-super' } },
        update: {},
        create: { userId: 'u-existing', roleId: 'role-super' },
      });
      // Role attached + account reclassified as STAFF with the USER role
      // dropped — password/profile of the existing row untouched.
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-existing' },
        data: { accountType: 'STAFF' },
      });
      expect(prisma.userRole.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u-existing', role: { name: 'USER' } },
      });
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
      const printed = logSpy.mock.calls.flat().join('\n');
      expect(printed).toContain('username=existing_master');
      expect(printed).not.toContain('$argon2id$');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('promote-admin still requires the account to exist (allowlisted or not)', async () => {
    setMasterAdminEmails('master.one@gmail.com');
    const { prisma } = makeScriptPrisma(null);

    await expect(promoteAdminToSuperAdmin(prisma, 'master.one@gmail.com')).rejects.toThrow(
      /No user found with email master\.one@gmail\.com/,
    );
    expect(prisma.userRole.upsert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Master admin accounts are permanent — DELETE /admin/admins/:userId
// ---------------------------------------------------------------------------

describe('Master admin accounts can never be deactivated', () => {
  afterEach(restoreMasterAdminEmails);

  it('rejects a master-admin address with a distinct message and writes nothing', async () => {
    setMasterAdminEmails('master.one@gmail.com,master.two@gmail.com');
    const fake = makeFake();
    // Email comparison is case-insensitive, exactly like every stored email.
    fake.prisma.user.findUnique = jest.fn(async () => ({
      id: 'm1',
      email: 'MASTER.ONE@Gmail.com',
    }));
    const service = makeService(fake);

    await expect(
      service.deactivateAdmin('m1', { reason: 'cleanup' } as any, { id: 'actor-1' }),
    ).rejects.toThrow('This account is a permanent master admin and cannot be deactivated.');

    expect(fake.prisma.$transaction).not.toHaveBeenCalled();
    expect(fake.userRole.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects a master-admin SUPER_ADMIN even while other SUPER_ADMINs are active', async () => {
    setMasterAdminEmails('master.one@gmail.com');
    const fake = makeFake();
    fake.prisma.user.count = jest.fn(async () => 1);
    fake.prisma.user.findUnique = jest.fn(async () => ({
      id: 'm1',
      email: 'master.one@gmail.com',
    }));
    const service = makeService(fake);

    // The acting account is the OTHER master admin: two active SUPER_ADMINs
    // exist, so the "last SUPER_ADMIN" floor alone would not stop this.
    await expect(
      service.deactivateAdmin('m1', { reason: 'handover' } as any, { id: 'master-two' }),
    ).rejects.toThrow(/permanent master admin/);

    // The master-admin guard runs BEFORE the last-SUPER_ADMIN floor check.
    expect(fake.prisma.user.count).not.toHaveBeenCalled();
    expect(fake.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('still deactivates an ordinary ADMIN account (unchanged behaviour)', async () => {
    setMasterAdminEmails('master.one@gmail.com');
    const fake = makeFake();
    fake.state.nextUser = userRow('u-staff', ['ADMIN']);
    const service = makeService(fake);

    const result = await service.deactivateAdmin(
      'u-staff',
      { reason: 'offboarding' } as any,
      { id: 'actor-3' },
    );

    expect(result.deactivated).toBe(true);
    expect(result.rolesRemoved).toEqual(['ADMIN']);
    expect(result.sessionsRevoked).toBe(2);
    expect(fake.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(fake.tx.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u-staff' } });
  });

  it('a Master Admin cannot deactivate ITSELF', async () => {
    setMasterAdminEmails('master.one@gmail.com,master.two@gmail.com');
    const fake = makeFake();
    fake.prisma.user.findUnique = jest.fn(async () => ({
      id: 'm1',
      email: 'master.one@gmail.com',
    }));
    const service = makeService(fake);

    await expect(
      service.deactivateAdmin('m1', { reason: 'cleanup' } as any, { id: 'm1' }),
    ).rejects.toThrow('This account is a permanent master admin and cannot be deactivated.');

    expect(fake.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('an ordinary Admin cannot deactivate their own account (self-action guard)', async () => {
    setMasterAdminEmails('master.one@gmail.com');
    const fake = makeFake();
    fake.state.nextUser = userRow('u-self', ['ADMIN']);
    const service = makeService(fake);

    await expect(
      service.deactivateAdmin('u-self', { reason: 'cleanup' } as any, { id: 'u-self' }),
    ).rejects.toThrow('You cannot perform this action on your own account.');

    expect(fake.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('a DEACTIVATED admin (roles stripped) can no longer authenticate through the staff login', async () => {
    // Post-deactivation shape from applySoftDelete: every role stripped and
    // status CLOSED — the staff login must refuse even with a valid password.
    const passwordHash = await argon2.hash('Str0ngPassw0rd!');
    const prisma: any = {
      user: {
        findFirst: jest.fn(async () => ({
          id: 'u-gone',
          email: 'deleted-abc@deleted.tanvionroyale.local',
          username: 'deleted-abc',
          status: 'CLOSED',
          passwordHash,
          userRoles: [], // roles stripped by deactivateAdmin
        })),
        findUnique: jest.fn(async () => null),
        update: jest.fn(async () => ({})),
      },
      securityEvent: {
        count: jest.fn(async () => 0),
        create: jest.fn(async (arg: any) => arg.data),
      },
      session: { create: jest.fn(async () => ({})), update: jest.fn(async () => ({})) },
      auditLog: { create: jest.fn(async (arg: any) => arg.data) },
    };
    const jwt: any = { signAsync: jest.fn(async () => 'access-token') };
    // Import cycle avoidance: construct AuthService the same way admin-rbac does.
    const { AuthService } = await import('../src/modules/auth/auth.service');
    const { OtpService } = await import('../src/modules/auth/otp.service');
    const service = new AuthService(prisma, jwt, new OtpService(prisma));

    await expect(
      service.adminLogin({ identifier: 'deleted-abc', password: 'Str0ngPassw0rd!' }),
    ).rejects.toThrow('This login is for staff accounts only.');
    expect(prisma.session.create).not.toHaveBeenCalled();
  });
});


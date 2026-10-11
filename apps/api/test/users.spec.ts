/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { UsersService } from '../src/modules/users/users.service';
import { PrismaService } from '../src/database/prisma.service';

/** In-memory fake of the Prisma surface used by UsersService. */
function makePrismaFake() {
  const auditLogs: Record<string, unknown>[] = [];
  const securityEvents: Record<string, unknown>[] = [];

  const baseUser = {
    id: 'u1',
    email: 'a@b.c',
    username: 'tester',
    firstName: null as string | null,
    lastName: null as string | null,
    phone: null as string | null,
    country: null as string | null,
    timezone: 'UTC',
    status: 'ACTIVE',
    emailVerified: true,
    phoneVerified: false,
    kycStatus: 'NOT_STARTED',
    passwordHash: 'hash',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const prisma = {
    user: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.select ? { id: baseUser.id, passwordHash: 'hash' } : { ...baseUser },
      ),
      update: jest.fn(async ({ data }: any) => ({ ...baseUser, ...data })),
    },
    session: {
      findUnique: jest.fn(),
      findMany: jest.fn(async () => [
        {
          id: 's-current',
          userId: 'u1',
          ip: '1.2.3.4',
          userAgent: 'UA',
          createdAt: new Date('2026-01-01'),
          expiresAt: new Date(Date.now() + 86_400_000),
          revokedAt: null,
        },
        {
          id: 's-other',
          userId: 'u1',
          ip: '5.6.7.8',
          userAgent: 'UA2',
          createdAt: new Date('2026-01-02'),
          expiresAt: new Date(Date.now() + 86_400_000),
          revokedAt: null,
        },
      ]),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    securityEvent: {
      create: jest.fn(async ({ data }: any) => securityEvents.push(data)),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => auditLogs.push(data)),
    },
    $transaction: jest.fn(async (ops: any[]) => ops),
  };

  return { prisma: prisma as unknown as PrismaService, auditLogs, securityEvents, raw: prisma };
}

const auth = { id: 'u1', sessionId: 's-current', roles: ['USER'] };

/** Extract recorded security-event types from the fake. */
function securityEventTypes(prisma: PrismaService): string[] {
  return ((prisma as unknown as { securityEvent: { create: jest.Mock } }).securityEvent.create.mock.calls
    .map((call: unknown[]) => (call[0] as { data: { type: string } }).data.type));
}

describe('UsersService', () => {
  it('returns the public profile for the authenticated user', async () => {
    const { prisma } = makePrismaFake();
    const service = new UsersService(prisma);
    const me = await service.getMe(auth);
    expect(me.username).toBe('tester');
    expect(me).not.toHaveProperty('passwordHash');
  });

  it('updates only changed fields and writes an audit log', async () => {
    const { prisma, auditLogs, raw } = makePrismaFake();
    const service = new UsersService(prisma);
    const updated = await service.updateProfile(auth, { firstName: 'Jane', country: 'GB' }, '1.1.1.1', 'UA');
    expect(updated.firstName).toBe('Jane');
    expect(raw.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { firstName: 'Jane', country: 'GB' },
    });
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toMatchObject({ action: 'USER_PROFILE_UPDATED', actorId: 'u1' });
  });

  it('skips the update when nothing changed', async () => {
    const { prisma, auditLogs, raw } = makePrismaFake();
    const service = new UsersService(prisma);
    await service.updateProfile(auth, {});
    expect(raw.user.update).not.toHaveBeenCalled();
    expect(auditLogs).toHaveLength(0);
  });

  it('updates the username when it is free', async () => {
    const { prisma, raw } = makePrismaFake();
    (raw.user.findUnique as jest.Mock).mockImplementation(async ({ where }: { where: { id?: string; username?: string } }) => {
      if (where.username) return null;
      return { id: 'u1', email: 'a@b.c', username: 'tester', firstName: null, lastName: null, phone: null, country: null, timezone: 'UTC', status: 'ACTIVE', emailVerified: true, phoneVerified: false, kycStatus: 'NOT_STARTED', passwordHash: 'hash', createdAt: new Date(), updatedAt: new Date() };
    });
    const service = new UsersService(prisma);
    const updated = await service.updateProfile(auth, { username: 'new_name01' });
    expect(updated.username).toBe('new_name01');
    expect(raw.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { username: 'new_name01' } });
  });

  it('rejects a taken username', async () => {
    const { prisma, raw } = makePrismaFake();
    (raw.user.findUnique as jest.Mock).mockImplementation(async ({ where }: { where: { id?: string; username?: string } }) => {
      if (where.username) return { id: 'other', username: where.username };
      return { id: 'u1', email: 'a@b.c', username: 'tester', firstName: null, lastName: null, phone: null, country: null, timezone: 'UTC', status: 'ACTIVE', emailVerified: true, phoneVerified: false, kycStatus: 'NOT_STARTED', passwordHash: 'hash', createdAt: new Date(), updatedAt: new Date() };
    });
    const service = new UsersService(prisma);
    await expect(service.updateProfile(auth, { username: 'taken_name' })).rejects.toThrow('Username is already taken');
    expect(raw.user.update).not.toHaveBeenCalled();
  });

  it('changes the password and revokes other sessions in a transaction', async () => {
    const { prisma, raw } = makePrismaFake();
    const hash = await argon2.hash('old-pass', { type: argon2.argon2id });
    (raw.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', passwordHash: hash });
    const service = new UsersService(prisma);
    await service.changePassword(auth, { currentPassword: 'old-pass', newPassword: 'NewPassword123' });
    expect(raw.$transaction).toHaveBeenCalledTimes(1);
    expect(raw.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', id: { not: 's-current' }, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('rejects a wrong current password without changing anything', async () => {
    const { prisma, raw } = makePrismaFake();
    const hash = await argon2.hash('old-pass', { type: argon2.argon2id });
    (raw.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', passwordHash: hash });
    const service = new UsersService(prisma);
    await expect(
      service.changePassword(auth, { currentPassword: 'wrong', newPassword: 'NewPassword123' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(raw.$transaction).not.toHaveBeenCalled();
    expect(securityEventTypes(prisma)).toContain('PASSWORD_CHANGE_FAILURE');
  });

  it('lists active sessions with the current one flagged', async () => {
    const { prisma } = makePrismaFake();
    const service = new UsersService(prisma);
    const sessions = await service.listSessions(auth);
    expect(sessions).toHaveLength(2);
    const current = sessions.find((s) => s.current);
    expect(current?.id).toBe('s-current');
    expect(sessions.every((s) => !('tokenHash' in s))).toBe(true);
  });

  it('revokes another own session', async () => {
    const { prisma, raw } = makePrismaFake();
    (raw.session.findUnique as jest.Mock).mockResolvedValue({
      id: 's-other',
      userId: 'u1',
      revokedAt: null,
    });
    const service = new UsersService(prisma);
    await service.revokeSession(auth, 's-other');
    expect(raw.session.update).toHaveBeenCalledWith({
      where: { id: 's-other' },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('refuses to revoke the current session via the revoke endpoint', async () => {
    const { prisma, raw } = makePrismaFake();
    (raw.session.findUnique as jest.Mock).mockResolvedValue({
      id: 's-current',
      userId: 'u1',
      revokedAt: null,
    });
    const service = new UsersService(prisma);
    await expect(service.revokeSession(auth, 's-current')).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFound when the session does not belong to the user', async () => {
    const { prisma, raw } = makePrismaFake();
    (raw.session.findUnique as jest.Mock).mockResolvedValue({
      id: 's-foreign',
      userId: 'someone-else',
      revokedAt: null,
    });
    const service = new UsersService(prisma);
    await expect(service.revokeSession(auth, 's-foreign')).rejects.toThrow(NotFoundException);
  });
});

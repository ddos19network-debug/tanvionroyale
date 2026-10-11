/* eslint-disable @typescript-eslint/no-explicit-any */
import { ConflictException, ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OtpService } from '../src/modules/auth/otp.service';
import * as argon2 from 'argon2';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/database/prisma.service';

/** In-memory fake of the Prisma surface used by AuthService. */
function makePrismaFake() {
  const sessions: Record<string, unknown>[] = [];
  const securityEvents: { userId: string; type: string; createdAt: Date }[] = [];
  const auditLogs: Record<string, unknown>[] = [];

  const baseUser = {
    firstName: null,
    lastName: null,
    country: null,
    emailVerified: false,
    phoneVerified: false,
    kycStatus: 'NOT_STARTED',
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  let seq = 0;
  return {
    sessions,
    securityEvents,
    auditLogs,
    prisma: {
      user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          const user = { ...baseUser, ...data, id: `user-${++seq}` };
          return user;
        }),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      role: { upsert: jest.fn(async () => ({ id: 'role-user', name: 'USER' })) },
      session: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          const session = { ...data, revokedAt: null };
          sessions.push(session);
          return session;
        }),
        update: jest.fn(),
        updateMany: jest.fn(),
        findUnique: jest.fn(),
      },
      securityEvent: {
        create: jest.fn(({ data }: { data: { userId: string; type: string } }) => {
          securityEvents.push({ ...data, createdAt: new Date() });
          return data;
        }),
        count: jest.fn(async () => 0),
      },
      authToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      auditLog: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => auditLogs.push(data)),
      },
      $transaction: jest.fn(async (ops: unknown[]) => ops),
    } as unknown as PrismaService,
  };
}

function makeJwtFake() {
  return { signAsync: jest.fn(async () => 'access-token') } as unknown as JwtService;
}

function fullUser(overrides: Record<string, unknown>) {
  return {
    id: 'u1',
    email: 'a@b.c',
    username: 'a',
    status: 'ACTIVE',
    userRoles: [{ role: { name: 'USER' } }],
    createdAt: new Date(),
    updatedAt: new Date(),
    firstName: null,
    lastName: null,
    country: null,
    emailVerified: true,
    phoneVerified: false,
    kycStatus: 'NOT_STARTED',
    ...overrides,
  };
}

describe('AuthService (unit)', () => {
  it('registers a user in PENDING state with audit + security events', async () => {
    const fake = makePrismaFake();
    const svc = new AuthService(fake.prisma, makeJwtFake(), new OtpService(fake.prisma));

    const user = await svc.register(
      { email: 'Test@Example.com', username: 'tester', password: 'Str0ngPass!' },
      '127.0.0.1',
      'jest',
    );

    expect(user.email).toBe('test@example.com');
    expect(user.status).toBe('PENDING');
    expect(fake.securityEvents.some((e) => e.type === 'REGISTER')).toBe(true);
    expect(fake.auditLogs.some((a) => a.action === 'AUTH_REGISTER')).toBe(true);
  });

  it('rejects duplicate email or username', async () => {
    const fake = makePrismaFake();
    const svc = new AuthService(fake.prisma, makeJwtFake(), new OtpService(fake.prisma));
    fake.prisma.user.findFirst = jest.fn(async () => ({ email: 'x', username: 'y' })) as any;

    await expect(
      svc.register({ email: 'x', username: 'y', password: 'Str0ngPass!' }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects wrong password and records LOGIN_FAILURE', async () => {
    const fake = makePrismaFake();
    const svc = new AuthService(fake.prisma, makeJwtFake(), new OtpService(fake.prisma));
    fake.prisma.user.findUnique = jest.fn(async () => ({
      ...fullUser({}),
      passwordHash: await argon2.hash('RightPassword1'),
    })) as any;
    fake.prisma.securityEvent.count = jest.fn(async () => 0) as any;

    await expect(svc.login({ identifier: 'a@b.c', password: 'WrongPassword1' })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(fake.securityEvents.some((e) => e.type === 'LOGIN_FAILURE')).toBe(true);
  });

  it('locks out after repeated failures and records LOCKOUT', async () => {
    const fake = makePrismaFake();
    const svc = new AuthService(fake.prisma, makeJwtFake(), new OtpService(fake.prisma));
    for (let i = 0; i < 5; i++) {
      fake.securityEvents.push({ userId: 'u1', type: 'LOGIN_FAILURE', createdAt: new Date() });
    }
    fake.prisma.user.findUnique = jest.fn(async () => ({
      ...fullUser({}),
      passwordHash: 'x',
      userRoles: [],
    })) as any;
    fake.prisma.securityEvent.count = jest.fn(async () => 5) as any;

    await expect(svc.login({ identifier: 'a@b.c', password: 'Whatever1' })).rejects.toThrow(
      HttpException,
    );
    expect(fake.securityEvents.some((e) => e.type === 'LOCKOUT')).toBe(true);
  });

  it('blocks suspended accounts from signing in', async () => {
    const fake = makePrismaFake();
    const svc = new AuthService(fake.prisma, makeJwtFake(), new OtpService(fake.prisma));
    fake.prisma.user.findUnique = jest.fn(async () => ({
      ...fullUser({ status: 'SUSPENDED' }),
      passwordHash: await argon2.hash('RightPassword1'),
    })) as any;
    fake.prisma.securityEvent.count = jest.fn(async () => 0) as any;

    await expect(svc.login({ identifier: 'a@b.c', password: 'RightPassword1' })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('successful login creates a session, tokens and a LOGIN_SUCCESS event', async () => {
    const fake = makePrismaFake();
    const svc = new AuthService(fake.prisma, makeJwtFake(), new OtpService(fake.prisma));
    fake.prisma.user.findUnique = jest.fn(async () => ({
      ...fullUser({}),
      passwordHash: await argon2.hash('RightPassword1'),
    })) as any;
    fake.prisma.securityEvent.count = jest.fn(async () => 0) as any;

    const result = await svc.login({ identifier: 'a@b.c', password: 'RightPassword1' });

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBeTruthy();
    expect(result.user.email).toBe('a@b.c');
    expect(fake.sessions).toHaveLength(1);
    expect(fake.securityEvents.some((e) => e.type === 'LOGIN_SUCCESS')).toBe(true);
  });
});


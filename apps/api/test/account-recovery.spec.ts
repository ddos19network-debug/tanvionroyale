/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from '../src/modules/auth/auth.service';
import { OtpService } from '../src/modules/auth/otp.service';
import { UsersService } from '../src/modules/users/users.service';
import { PrismaService } from '../src/database/prisma.service';
import { makePrismaFake, makeJwtFake, makeUser, otpHash } from './helpers-phase11';
import { sha256 } from '../src/common/utils/crypto';

const PHONE = '+447911123456';
const EMAIL = 'reset@example.com';
const PWD = 'Str0ngPassw0rd!';

/** Minimal UsersService fake focusing on passwordSetAt + session revocation. */
function makeUsersFake(overrides: Record<string, unknown> = {}) {
  const securityEvents: Record<string, any>[] = [];
  const auditLogs: Record<string, any>[] = [];
  const sessions = [
    { id: 's-current', userId: 'u1', revokedAt: null },
    { id: 's-other', userId: 'u1', revokedAt: null },
  ];
  const prisma: any = {
    user: {
      findUnique: jest.fn(async () => ({
        id: 'u1',
        passwordSetAt: null,
        ...overrides,
      })),
      update: jest.fn(async ({ data }: any) => ({ id: 'u1', ...data })),
    },
    session: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        sessions
          .filter(
            (s) =>
              s.userId === where.userId &&
              (!where['id'] || where['id']['not'] !== s.id) &&
              s.revokedAt === null,
          )
          .forEach((s) => Object.assign(s, data));
        return { count: 1 };
      }),
    },
    securityEvent: { create: jest.fn(async ({ data }: any) => securityEvents.push(data)) },
    auditLog: { create: jest.fn(async ({ data }: any) => auditLogs.push(data)) },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  };
  return {
    prisma: prisma as unknown as PrismaService,
    raw: prisma,
    securityEvents,
    auditLogs,
    sessions,
  };
}
describe('Phase 12 — account recovery', () => {
  describe('phone recovery', () => {
    it('sends a hashed PHONE_RECOVERY code to a registered verified phone', async () => {
      const { prisma, state } = makePrismaFake();
      state.users.push(makeUser({ phoneVerified: true }));
      const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

      const res = await auth.startPhoneRecovery(PHONE);

      expect(res.message).toContain('recovery code has been sent');
      expect(state.otps).toHaveLength(1);
      expect(state.otps[0].purpose).toBe('PHONE_RECOVERY');
      expect(state.otps[0].codeHash).not.toMatch(/^\d{6}$/); // never plaintext
    });

    it('does not reveal whether a phone is registered', async () => {
      const { prisma, state } = makePrismaFake();
      const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

      const res = await auth.startPhoneRecovery('+447999999999');

      expect(res.message).toContain('recovery code has been sent');
      expect(state.otps).toHaveLength(0);
    });

    it('recovers an account: correct OTP sets a new password and revokes all sessions', async () => {
      const { prisma, state } = makePrismaFake();
      const oldHash = await argon2.hash('OldPassword1');
      state.users.push(makeUser({ phoneVerified: true, passwordHash: oldHash }));
      state.sessions.push(
        { id: 's1', userId: 'u1', revokedAt: null },
        { id: 's2', userId: 'u1', revokedAt: null },
      );
      const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

      await auth.startPhoneRecovery(PHONE);
      state.otps[0].codeHash = otpHash('PHONE_RECOVERY', PHONE, '123456');
      await auth.completePhoneRecovery(PHONE, '123456', PWD, '1.2.3.4', 'jest');

      const user = state.users[0];
      expect(user.passwordHash).not.toBe(oldHash);
      expect(await argon2.verify(user.passwordHash, PWD)).toBe(true);
      expect(state.sessions.every((s) => s.revokedAt !== null)).toBe(true);
      expect(state.securityEvents.some((e) => e.type === 'RECOVERY_SUCCESS')).toBe(true);
    });

    it('rejects a wrong OTP, records RECOVERY_FAILURE and keeps the old password', async () => {
      const { prisma, state } = makePrismaFake();
      const oldHash = await argon2.hash('OldPassword1');
      state.users.push(makeUser({ phoneVerified: true, passwordHash: oldHash }));
      const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

      await auth.startPhoneRecovery(PHONE);
      state.otps[0].codeHash = otpHash('PHONE_RECOVERY', PHONE, '123456');

      await expect(
        auth.completePhoneRecovery(PHONE, '000000', PWD),
      ).rejects.toThrow(BadRequestException);

      expect(state.users[0].passwordHash).toBe(oldHash);
      expect(state.securityEvents.some((e) => e.type === 'RECOVERY_FAILURE')).toBe(true);
      expect(state.securityEvents.some((e) => e.type === 'RECOVERY_SUCCESS')).toBe(false);
    });

    it('rejects an expired recovery OTP', async () => {
      const { prisma, state } = makePrismaFake();
      state.users.push(makeUser({ phoneVerified: true }));
      const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

      await auth.startPhoneRecovery(PHONE);
      state.otps[0].expiresAt = new Date(Date.now() - 1000);
      state.otps[0].codeHash = otpHash('PHONE_RECOVERY', PHONE, '123456');

      await expect(
        auth.completePhoneRecovery(PHONE, '123456', PWD),
      ).rejects.toThrow(/Invalid or expired/i);
      expect(state.securityEvents.some((e) => e.type === 'RECOVERY_FAILURE')).toBe(true);
    });
  });

  describe('email recovery', () => {
    it('requests a reset: stores a hashed PASSWORD_RESET token and records the event', async () => {
      const { prisma, state } = makePrismaFake();
      state.users.push(makeUser({ email: EMAIL, emailVerified: true, phone: null }));
      const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

      await auth.requestPasswordReset(EMAIL);

      expect(state.authTokens).toHaveLength(1);
      const token = state.authTokens[0];
      expect(token.type).toBe('PASSWORD_RESET');
      expect(token.tokenHash).toMatch(/^[0-9a-f]{64}$/); // sha256, never raw
      expect(state.securityEvents.some((e) => e.type === 'PASSWORD_RESET_REQUESTED')).toBe(true);
    });

    it('does not issue a token for an unknown or unverified email', async () => {
      const { prisma, state } = makePrismaFake();
      state.users.push(makeUser({ email: EMAIL, emailVerified: false, phone: null }));
      const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

      await auth.requestPasswordReset('unknown@example.com');
      await auth.requestPasswordReset('reset@example.com');

      expect(state.authTokens).toHaveLength(0);
    });
  });
});
describe('Phase 12 — email recovery (reset)', () => {
  it('resets the password, invalidates the token, revokes sessions and records success', async () => {
    const { prisma, state } = makePrismaFake();
    state.users.push(makeUser({ email: EMAIL, emailVerified: true, phone: null }));
    state.sessions.push(
      { id: 's1', userId: 'u1', revokedAt: null },
      { id: 's2', userId: 'u1', revokedAt: null },
    );
    const rawToken = 'A'.repeat(64);
    state.authTokens.push({
      id: 't1',
      userId: 'u1',
      type: 'PASSWORD_RESET',
      tokenHash: sha256(rawToken),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      createdAt: new Date(),
    });
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

    await auth.resetPassword(rawToken, PWD, '1.2.3.4', 'jest');

    const user = state.users[0];
    expect(await argon2.verify(user.passwordHash, PWD)).toBe(true);
    expect(state.authTokens[0].usedAt).not.toBeNull(); // single-use consumed
    expect(state.sessions.every((s) => s.revokedAt !== null)).toBe(true); // refresh tokens dead
    expect(state.securityEvents.some((e) => e.type === 'PASSWORD_RESET_SUCCESS')).toBe(true);
  });

  it('rejects an expired reset token', async () => {
    const { prisma, state } = makePrismaFake();
    state.users.push(makeUser({ email: EMAIL, emailVerified: true, phone: null }));
    const rawToken = 'B'.repeat(64);
    state.authTokens.push({
      id: 't1',
      userId: 'u1',
      type: 'PASSWORD_RESET',
      tokenHash: sha256(rawToken),
      expiresAt: new Date(Date.now() - 1000),
      usedAt: null,
      createdAt: new Date(),
    });
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

    await expect(auth.resetPassword(rawToken, PWD)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects reusing the same reset token (single-use)', async () => {
    const { prisma, state } = makePrismaFake();
    state.users.push(makeUser({ email: EMAIL, emailVerified: true, phone: null }));
    const rawToken = 'C'.repeat(64);
    state.authTokens.push({
      id: 't1',
      userId: 'u1',
      type: 'PASSWORD_RESET',
      tokenHash: sha256(rawToken),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      createdAt: new Date(),
    });
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

    await auth.resetPassword(rawToken, PWD);
    await expect(auth.resetPassword(rawToken, PWD)).rejects.toThrow(UnauthorizedException);
    expect(
      state.securityEvents.filter((e) => e.type === 'PASSWORD_RESET_SUCCESS'),
    ).toHaveLength(1);
  });

  it('rejects a wrong reset token', async () => {
    const { prisma, state } = makePrismaFake();
    state.users.push(makeUser({ email: EMAIL, emailVerified: true, phone: null }));
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

    await expect(auth.resetPassword('N'.repeat(64), PWD)).rejects.toThrow(UnauthorizedException);
    expect(state.securityEvents.some((e) => e.type === 'PASSWORD_RESET_SUCCESS')).toBe(false);
  });
});

describe('Phase 12 — OAuth-only set password', () => {
  it('sets a password for a passwordless OAuth account and revokes other sessions', async () => {
    const { prisma, raw, sessions, securityEvents } = makeUsersFake({ passwordSetAt: null });
    const service = new UsersService(prisma);

    await service.setPassword({ id: 'u1', sessionId: 's-current', roles: ['USER'] }, PWD);

    expect(raw.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { passwordHash: expect.any(String), passwordSetAt: expect.any(Date) },
    });
    expect(sessions.find((s) => s.id === 's-current')!.revokedAt).toBeNull();
    expect(sessions.find((s) => s.id === 's-other')!.revokedAt).not.toBeNull();
    expect(securityEvents.some((e) => e.type === 'PASSWORD_CHANGED')).toBe(true);
  });

  it('refuses to set a password when one is already set (use change-password)', async () => {
    const { prisma, raw } = makeUsersFake({ passwordSetAt: new Date() });
    const service = new UsersService(prisma);

    await expect(
      service.setPassword({ id: 'u1', sessionId: 's-current', roles: ['USER'] }, PWD),
    ).rejects.toThrow(ConflictException);
    expect(raw.user.update).not.toHaveBeenCalled();
  });
});

describe('Phase 12 — brute force throttling', () => {
  interface Route {
    name: string;
    limit: number;
  }

  const metadata = (fn: unknown): number | undefined => {
    const raw = (Reflect as any).getMetadata('THROTTLER:LIMITdefault', fn);
    return typeof raw === 'number' ? raw : undefined;
  };

  const routesOf = (instance: object): Route[] =>
    Object.getOwnPropertyNames(Object.getPrototypeOf(instance))
      .filter((k) => k !== 'constructor')
      .map((k) => ({
        name: k,
        limit: metadata(Object.getPrototypeOf(instance)[k]),
      }))
      .filter((r): r is Route => r.limit !== undefined);

  it('applies strict throttle limits to every recovery / password endpoint', () => {
    const { AuthController } = require('../src/modules/auth/auth.controller') as {
      AuthController: new (...args: never[]) => object;
    };
    const { UsersController } = require('../src/modules/users/users.controller') as {
      UsersController: new (...args: never[]) => object;
    };

    const routes = [
      ...routesOf(new AuthController()),
      ...routesOf(new UsersController()),
    ];
    const byName = new Map(routes.map((r) => [r.name, r.limit]));

    // recovery + reset endpoints must be the tightest (<= 5/min)
    expect(byName.get('phoneRecoverySendOtp')).toBeLessThanOrEqual(3);
    expect(byName.get('phoneRecoveryReset')).toBeLessThanOrEqual(5);
    expect(byName.get('forgotPassword')).toBeLessThanOrEqual(3);
    expect(byName.get('resetPassword')).toBeLessThanOrEqual(5);
    // authenticated password changes
    expect(byName.get('changePassword')).toBeLessThanOrEqual(5);
    expect(byName.get('setPassword')).toBeLessThanOrEqual(5);
    // login stays throttled too
    expect(byName.get('login')).toBeLessThanOrEqual(10);
  });
});
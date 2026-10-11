/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Unified customer login — identifier = email OR phone (master prompt Parts
 * 20–27 + test items 14–26).
 *
 * Covers the single AuthService.login() authentication path that backs
 * POST /auth/login:
 *   * email identifier (trim + case-insensitive normalization),
 *   * phone identifier (canonical E.164, shared with /auth/phone/login),
 *   * wrong password / unknown identifier → uniform 401 (no enumeration),
 *   * STAFF accounts refused through EITHER identifier (403, no session),
 *   * CUSTOMER session kind on success for both shapes,
 *   * lockout probe still enforced,
 *   * LoginDto strictness (identifier + password only).
 */
import { ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { validate } from 'class-validator';
import { AuthService } from '../src/modules/auth/auth.service';
import { OtpService } from '../src/modules/auth/otp.service';
import { LoginDto } from '../src/modules/auth/dto/login.dto';
import { makeJwtFake, makePrismaFake, makeUser } from './helpers-phase11';

const PASSWORD = 'RightPassword1';

function makeService() {
  const { prisma, state } = makePrismaFake();
  const service = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));
  return { service, state, prisma };
}

describe('Customer login — unified identifier (email OR phone, POST /auth/login)', () => {
  // --------------------------------------------------------------------------
  // LoginDto strictness (Part 23)
  // --------------------------------------------------------------------------
  describe('LoginDto validation', () => {
    it('accepts a well-formed identifier + password', async () => {
      const dto = new LoginDto();
      dto.identifier = 'user@example.com';
      dto.password = 'Str0ngPass1!';
      expect(await validate(dto)).toEqual([]);
    });

    it('rejects a missing or too-short identifier', async () => {
      const missing = new LoginDto();
      missing.password = 'Str0ngPass1!';
      expect((await validate(missing)).length).toBeGreaterThan(0);

      const shortId = new LoginDto();
      shortId.identifier = 'ab';
      shortId.password = 'Str0ngPass1!';
      expect((await validate(shortId)).length).toBeGreaterThan(0);
    });

    it('keeps the password bar unchanged (min 8 / max 128)', async () => {
      const shortPassword = new LoginDto();
      shortPassword.identifier = 'user@example.com';
      shortPassword.password = 'short';
      expect((await validate(shortPassword)).length).toBeGreaterThan(0);

      const longPassword = new LoginDto();
      longPassword.identifier = 'user@example.com';
      longPassword.password = 'x'.repeat(129);
      expect((await validate(longPassword)).length).toBeGreaterThan(0);
    });

    it('carries no legacy email field — identifier only (no arbitrary fields)', () => {
      const dto = new LoginDto() as unknown as Record<string, unknown>;
      expect(dto.email).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // 14 — email + password works (with normalization)
  // --------------------------------------------------------------------------
  it('email identifier: trims + lower-cases and signs the customer in', async () => {
    const { service, state } = makeService();
    state.users.push(
      makeUser({ email: 'customer@example.com', passwordHash: await argon2.hash(PASSWORD) }),
    );

    const result = await service.login({
      identifier: '  Customer@Example.COM  ',
      password: PASSWORD,
    });

    expect(result.accessToken).toBe('access-token');
    expect(result.user.email).toBe('customer@example.com');
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].kind).toBe('CUSTOMER');
    expect(state.securityEvents.some((e) => e.type === 'LOGIN_SUCCESS')).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 15 — phone + password works (canonical E.164 preserved)
  // --------------------------------------------------------------------------
  it('phone identifier: canonical E.164 (trimmed) signs the customer in', async () => {
    const { service, state } = makeService();
    state.users.push(makeUser({ email: null, passwordHash: await argon2.hash(PASSWORD) }));

    const result = await service.login({
      identifier: ' +447911123456 ',
      password: PASSWORD,
    });

    expect(result.accessToken).toBe('access-token');
    expect(result.user.phone).toBe('+447911123456');
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].kind).toBe('CUSTOMER');
  });

  // --------------------------------------------------------------------------
  // 16/17 — wrong password rejected for both identifier kinds
  // --------------------------------------------------------------------------
  it('wrong password on an email identifier → uniform 401 + LOGIN_FAILURE', async () => {
    const { service, state } = makeService();
    state.users.push(
      makeUser({ email: 'customer@example.com', passwordHash: await argon2.hash(PASSWORD) }),
    );

    await expect(
      service.login({ identifier: 'customer@example.com', password: 'WrongPassword1' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(state.sessions).toHaveLength(0);
    const failure = state.securityEvents.find((e) => e.type === 'LOGIN_FAILURE');
    expect(failure?.metadata).toMatchObject({ method: 'email' });
  });

  it('wrong password on a phone identifier → uniform 401 + LOGIN_FAILURE', async () => {
    const { service, state } = makeService();
    state.users.push(makeUser({ passwordHash: await argon2.hash(PASSWORD) }));

    await expect(
      service.login({ identifier: '+447911123456', password: 'WrongPassword1' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(state.sessions).toHaveLength(0);
    const failure = state.securityEvents.find((e) => e.type === 'LOGIN_FAILURE');
    expect(failure?.metadata).toMatchObject({ method: 'phone' });
  });

  // --------------------------------------------------------------------------
  // 18 — unknown identifier rejected (no enumeration)
  // --------------------------------------------------------------------------
  it('unknown email identifier fails with the same uniform 401', async () => {
    const { service, state } = makeService();

    await expect(
      service.login({ identifier: 'nobody@example.com', password: PASSWORD }),
    ).rejects.toThrow(UnauthorizedException);
    expect(state.sessions).toHaveLength(0);
    expect(state.securityEvents).toHaveLength(0); // no user row → no per-user event
  });

  it('unknown phone identifier fails with the same uniform 401', async () => {
    const { service, state } = makeService();

    await expect(
      service.login({ identifier: '+15550009999', password: PASSWORD }),
    ).rejects.toThrow(UnauthorizedException);
    expect(state.sessions).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // 21/22 — staff cannot customer-login through EITHER identifier
  // --------------------------------------------------------------------------
  it('staff email identifier cannot customer-login (403, no session)', async () => {
    const { service, state } = makeService();
    state.users.push(
      makeUser({
        email: 'staff@example.com',
        accountType: 'STAFF',
        userRoles: [{ role: { name: 'ADMIN' } }],
        passwordHash: await argon2.hash(PASSWORD),
      }),
    );

    await expect(
      service.login({ identifier: 'staff@example.com', password: PASSWORD }),
    ).rejects.toThrow(ForbiddenException);
    expect(state.sessions).toHaveLength(0);
    expect(
      state.securityEvents.some(
        (e) => e.type === 'LOGIN_FAILURE' && (e.metadata as any)?.reason === 'staff-account',
      ),
    ).toBe(true);
  });

  it('staff phone identifier cannot customer-login (403, no session)', async () => {
    const { service, state } = makeService();
    state.users.push(
      makeUser({
        phone: '+15551234567',
        accountType: 'STAFF',
        userRoles: [{ role: { name: 'USER' } }],
        passwordHash: await argon2.hash(PASSWORD),
      }),
    );

    await expect(
      service.login({ identifier: '+15551234567', password: PASSWORD }),
    ).rejects.toThrow(ForbiddenException);
    expect(state.sessions).toHaveLength(0);
  });

  it('a staff ROLE on a customer-classified row is refused too (defense-in-depth)', async () => {
    const { service, state } = makeService();
    state.users.push(
      makeUser({
        email: 'roleadmin@example.com',
        accountType: 'CUSTOMER',
        userRoles: [{ role: { name: 'ADMIN' } }],
        passwordHash: await argon2.hash(PASSWORD),
      }),
    );

    await expect(
      service.login({ identifier: 'roleadmin@example.com', password: PASSWORD }),
    ).rejects.toThrow(ForbiddenException);
    expect(state.sessions).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // 23/24 — session kinds
  // --------------------------------------------------------------------------
  it('BOTH identifier paths create a CUSTOMER session only', async () => {
    const { service, state } = makeService();
    state.users.push(
      makeUser({
        email: 'both@example.com',
        passwordHash: await argon2.hash(PASSWORD),
      }),
    );

    await service.login({ identifier: 'both@example.com', password: PASSWORD });
    await service.login({ identifier: '+447911123456', password: PASSWORD });

    expect(state.sessions).toHaveLength(2);
    expect(state.sessions.every((s) => s.kind === 'CUSTOMER')).toBe(true);
  });

  it('the dedicated phone endpoint shares the same path and still works (Part 27)', async () => {
    const { service, state } = makeService();
    state.users.push(makeUser({ passwordHash: await argon2.hash(PASSWORD) }));

    const result = await service.loginWithPhone({
      phone: '+447911123456',
      password: PASSWORD,
    });

    expect(result.accessToken).toBe('access-token');
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].kind).toBe('CUSTOMER');
  });

  // --------------------------------------------------------------------------
  // 26 — lockout/rate-limit remains correct for identifier login
  // --------------------------------------------------------------------------
  it('lockout still applies: 5 recent failures → 423 before password check', async () => {
    const { service, state, prisma } = makeService();
    state.users.push(
      makeUser({ email: 'locked@example.com', passwordHash: await argon2.hash(PASSWORD) }),
    );
    (prisma.securityEvent as any).count = jest.fn(async () => 5);

    await expect(
      service.login({ identifier: 'locked@example.com', password: PASSWORD }),
    ).rejects.toThrow(HttpException);
    expect(state.sessions).toHaveLength(0);
  });
});



/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Settings Account & Security Center — backend contract (master prompt
 * Parts 4–20 / 27 / 29 items 1–18, 28–30).
 *
 * Covers, against the real VerificationService / UsersService with the shared
 * in-memory Prisma fake:
 *   EMAIL    — add, change (never auto-verifies), invalid/duplicate rejected,
 *              unsafe removal prevented, credential burn, audit entries
 *   PHONE    — change resets verification (no auto-verify carry-over), OTP flow
 *              end-to-end, duplicate rejected, unsafe removal prevented
 *   PROFILE  — phone change resets verification + E.164 + uniqueness
 *   KYC      — server-authoritative only: customer writes can never set it
 *   PASSWORD — successful change, failed change, nothing sensitive audited
 */
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { VerificationService } from '../src/modules/verification/verification.service';
import { UsersService } from '../src/modules/users/users.service';
import { OtpService } from '../src/modules/auth/otp.service';
import { UpdateProfileDto } from '../src/modules/users/dto/update-profile.dto';
import {
  SetEmailDto,
  RemoveIdentifierDto,
} from '../src/modules/verification/dto/verification-management.dto';
import { makePrismaFake, makeUser, otpHash } from './helpers-phase11';
import { PHONE_MESSAGE_BD, PHONE_MESSAGE_GENERIC } from '../src/common/utils/phone';

const PASSWORD = 'Str0ngPassw0rd!';

async function makeServices() {
  const { prisma, state } = makePrismaFake();
  const otp = new OtpService(prisma);
  const verification = new VerificationService(prisma, otp);
  const users = new UsersService(prisma);
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  const auth = { id: 'u1', sessionId: 's1', roles: ['USER'], sessionKind: 'CUSTOMER' } as any;
  return { prisma, state, verification, users, passwordHash, auth };
}

function passwordedUser(hash: string, overrides: Record<string, unknown> = {}) {
  return makeUser({ passwordHash: hash, passwordSetAt: new Date(), ...overrides });
}

describe('Settings — email add / change / remove (server-authoritative)', () => {
  it('adds a missing email, normalizes it and NEVER marks it verified (Part 5)', async () => {
    const { state, verification, passwordHash } = await makeServices();
    state.users.push(passwordedUser(passwordHash, { email: null, phone: '+447911123456' }));

    const status = await verification.setEmail('u1', '  TanvirX@Gmail.COM  ', PASSWORD);

    expect(state.users[0].email).toBe('tanvirx@gmail.com');
    expect(state.users[0].emailVerified).toBe(false);
    expect(state.users[0].emailVerifiedAt).toBeNull();
    expect(status.email).toEqual({
      status: 'NOT_STARTED',
      email: 'tanvirx@gmail.com',
      verifiedAt: null,
    });
    expect(state.verifications.find((v) => v.type === 'EMAIL')?.status).toBe('NOT_STARTED');
    expect(state.auditLogs.some((a) => a.action === 'USER_EMAIL_ADDED')).toBe(true);
  });

  it('changing an existing VERIFIED email drops verification (Part 6)', async () => {
    const { state, verification, passwordHash } = await makeServices();
    state.users.push(
      passwordedUser(passwordHash, {
        email: 'old@example.com',
        emailVerified: true,
        emailVerifiedAt: new Date(),
        phone: '+447911123456',
      }),
    );
    state.verifications.push({
      userId: 'u1',
      type: 'EMAIL',
      status: 'VERIFIED',
      verifiedAt: new Date(),
    });

    const status = await verification.setEmail('u1', 'new-address@example.com', PASSWORD);

    expect(state.users[0].email).toBe('new-address@example.com');
    expect(state.users[0].emailVerified).toBe(false);
    expect(state.users[0].emailVerifiedAt).toBeNull();
    expect(status.email.status).toBe('NOT_STARTED');
    expect(state.verifications[0].status).toBe('NOT_STARTED');
    expect(state.verifications[0].verifiedAt).toBeNull();
    expect(state.auditLogs.some((a) => a.action === 'USER_EMAIL_CHANGED')).toBe(true);
  });

  it('burns outstanding emailed links and codes for the OLD address on change', async () => {
    const { state, verification, passwordHash } = await makeServices();
    state.users.push(
      passwordedUser(passwordHash, { email: 'old@example.com', phone: '+447911123456' }),
    );
    state.authTokens.push({
      id: 't1',
      userId: 'u1',
      type: 'EMAIL_VERIFICATION',
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 3_600_000),
      usedAt: null,
      createdAt: new Date(),
    });
    state.otps.push({
      id: 'o1',
      identifier: 'old@example.com',
      purpose: 'EMAIL_VERIFY',
      codeHash: 'x',
      attempts: 0,
      expiresAt: new Date(Date.now() + 300_000),
      consumedAt: null,
      lastSentAt: new Date(),
    });

    await verification.setEmail('u1', 'brand-new@example.com', PASSWORD);

    expect(state.authTokens[0].usedAt).toBeInstanceOf(Date);
    expect(state.otps[0].consumedAt).toBeInstanceOf(Date);
  });

  it('rejects an invalid email (Part 29.5)', async () => {
    const { state, verification, passwordHash } = await makeServices();
    state.users.push(passwordedUser(passwordHash, { email: null }));

    await expect(verification.setEmail('u1', 'not-an-email', PASSWORD)).rejects.toThrow(
      BadRequestException,
    );
    expect(state.users[0].email).toBeNull();
  });

  it('rejects a duplicate email owned by another account (Part 29.6)', async () => {
    const { state, verification, passwordHash } = await makeServices();
    state.users.push(passwordedUser(passwordHash, { email: null }));
    state.users.push(
      makeUser({ id: 'u2', email: 'taken@example.com', username: 'other', phone: null }),
    );

    await expect(verification.setEmail('u1', 'taken@example.com', PASSWORD)).rejects.toThrow(
      ConflictException,
    );
    expect(state.users[0].email).toBeNull();
  });
  it('rejects a wrong confirmation password and changes nothing', async () => {
    const { state, verification, passwordHash } = await makeServices();
    state.users.push(passwordedUser(passwordHash, { email: null }));

    await expect(verification.setEmail('u1', 'x@y.zz', 'WrongPass1!')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(state.users[0].email).toBeNull();
    expect(state.auditLogs).toHaveLength(0);
  });

  it('refuses passwordless (OAuth-only) accounts with set-password guidance', async () => {
    const { state, verification } = await makeServices();
    state.users.push(makeUser({ email: null, passwordSetAt: null }));

    await expect(verification.setEmail('u1', 'x@y.zz', PASSWORD)).rejects.toThrow(
      /Set a password first/,
    );
  });

  it('prevents removing the LAST login/recovery path (email-only account) (Part 29.8)', async () => {
    const { state, verification, passwordHash } = await makeServices();
    state.users.push(passwordedUser(passwordHash, { email: 'only@example.com', phone: null }));

    await expect(verification.removeEmail('u1', PASSWORD)).rejects.toThrow(ConflictException);
    expect(state.users[0].email).toBe('only@example.com');
    expect(state.auditLogs).toHaveLength(0);
  });

  it('removes the email when a phone remains, resetting state + auditing (Part 7)', async () => {
    const { state, verification, passwordHash } = await makeServices();
    state.users.push(
      passwordedUser(passwordHash, {
        email: 'go@example.com',
        emailVerified: true,
        emailVerifiedAt: new Date(),
        phone: '+447911123456',
      }),
    );

    const status = await verification.removeEmail('u1', PASSWORD);

    expect(state.users[0].email).toBeNull();
    expect(state.users[0].emailVerified).toBe(false);
    expect(status.email.status).toBe('UNAVAILABLE');
    expect(state.auditLogs.some((a) => a.action === 'USER_EMAIL_REMOVED')).toBe(true);
  });

  it('allows email removal for a Google-linked account without a phone', async () => {
    const { state, verification, passwordHash } = await makeServices();
    state.users.push(passwordedUser(passwordHash, { email: 'go@example.com', phone: null }));
    state.identities.push({
      id: 'i1',
      provider: 'GOOGLE',
      providerAccountId: 'g-1',
      userId: 'u1',
    });

    await verification.removeEmail('u1', PASSWORD);
    expect(state.users[0].email).toBeNull();
  });
});
describe('Settings — phone change / OTP / removal (Parts 8–11)', () => {
  it('CHANGING a verified phone resets verification and requires a fresh OTP (Part 10)', async () => {
    const { state, verification } = await makeServices();
    state.users.push(
      makeUser({
        phone: '+447911123456',
        phoneVerified: true,
        phoneVerifiedAt: new Date(),
        phoneVerifiedDuringSignupAt: new Date(),
      }),
    );
    state.verifications.push({
      userId: 'u1',
      type: 'PHONE',
      status: 'VERIFIED',
      verifiedAt: new Date(),
    });

    // The historical bug: the phone was written first and then the request
    // threw, leaving the NEW number flagged verified. Now: stored UNVERIFIED.
    const result = await verification.sendPhoneVerification('u1', '+15550001111');
    expect(result.message).toContain('verification code has been sent');

    expect(state.users[0].phone).toBe('+15550001111');
    expect(state.users[0].phoneVerified).toBe(false);
    expect(state.users[0].phoneVerifiedAt).toBeNull();
    expect(state.users[0].phoneVerifiedDuringSignupAt).toBeNull();
    // The new number is unverified and the successfully delivered OTP makes
    // the canonical Verification row PENDING — never VERIFIED by the change.
    expect(state.verifications[0].status).toBe('PENDING');
    // A fresh OTP went to the NEW number only.
    expect(
      state.otps.some(
        (o) => o.identifier === '+15550001111' && o.purpose === 'PHONE_VERIFY' && !o.consumedAt,
      ),
    ).toBe(true);
    expect(state.auditLogs.some((a) => a.action === 'USER_PHONE_CHANGED')).toBe(true);
  });

  it('the full change flow reaches VERIFIED only through the OTP to the new number', async () => {
    const { state, verification } = await makeServices();
    state.users.push(makeUser({ phone: '+447911123456', phoneVerified: true }));

    await verification.sendPhoneVerification('u1', '+15550001111');
    // Simulate the user entering the code that was sent to the new number.
    state.otps[0].codeHash = otpHash('PHONE_VERIFY', '+15550001111', '246810');
    const status = await verification.verifyPhone('u1', '246810');

    expect(status.phone.status).toBe('VERIFIED');
    expect(status.phone.phone).toBe('+15550001111');
    // Manual Verification Center verification is never flagged as signup-auto.
    expect(status.phone.autoVerifiedDuringSignup).toBe(false);
    expect(state.users[0].phoneVerified).toBe(true);
    expect(state.auditLogs.some((a) => a.action === 'USER_PHONE_VERIFIED')).toBe(true);
  });

  it('an unchanged verified phone still conflicts (no spurious re-send) (Part 29.15)', async () => {
    const { state, verification } = await makeServices();
    state.users.push(makeUser({ phone: '+447911123456', phoneVerified: true }));

    await expect(verification.sendPhoneVerification('u1')).rejects.toThrow(
      'Phone already verified',
    );
  });

  it('rejects a duplicate phone before anything is written (Part 29.17)', async () => {
    const { state, verification } = await makeServices();
    state.users.push(makeUser({ phone: '+447911123456', phoneVerified: false }));
    state.users.push(
      makeUser({ id: 'u2', phone: '+15550002222', username: 'other', email: 'o@x.zz' }),
    );

    await expect(verification.sendPhoneVerification('u1', '+15550002222')).rejects.toThrow(
      ConflictException,
    );
    expect(state.users[0].phone).toBe('+447911123456');
  });

  it('rejects a non-E.164 phone with the canonical format message (Part 8)', async () => {
    const { state, verification } = await makeServices();
    state.users.push(makeUser({ phone: null, phoneVerified: false }));

    await expect(verification.sendPhoneVerification('u1', '0712345678')).rejects.toThrow(
      // Canonical normalizer copy: a `0…`-shaped miss gets the BD-specific message
      // (the old class-validator "phone must be a valid E.164 number" is gone).
      PHONE_MESSAGE_BD,
    );
  });
  it('prevents removing the LAST login/recovery path (phone-only account) (Part 29.18)', async () => {
    const { state, verification, passwordHash } = await makeServices();
    state.users.push(passwordedUser(passwordHash, { phone: '+447911123456', email: null }));

    await expect(verification.removePhone('u1', PASSWORD)).rejects.toThrow(ConflictException);
    expect(state.users[0].phone).toBe('+447911123456');
  });

  it('removes the phone when an email remains: flags reset, identity + codes burned, audited', async () => {
    const { state, verification, passwordHash } = await makeServices();
    state.users.push(
      passwordedUser(passwordHash, {
        email: 'keep@example.com',
        phone: '+447911123456',
        phoneVerified: true,
        phoneVerifiedAt: new Date(),
      }),
    );
    state.identities.push({
      id: 'i1',
      provider: 'PHONE',
      providerAccountId: '+447911123456',
      userId: 'u1',
    });
    state.otps.push({
      id: 'o1',
      identifier: '+447911123456',
      purpose: 'PHONE_RECOVERY',
      codeHash: 'x',
      attempts: 0,
      expiresAt: new Date(Date.now() + 300_000),
      consumedAt: null,
      lastSentAt: new Date(),
    });

    const status = await verification.removePhone('u1', PASSWORD);

    expect(state.users[0].phone).toBeNull();
    expect(state.users[0].phoneVerified).toBe(false);
    expect(state.users[0].phoneVerifiedAt).toBeNull();
    expect(status.phone.phone).toBeNull();
    expect(status.phone.status).toBe('NOT_STARTED');
    expect(state.identities).toHaveLength(0);
    expect(state.otps[0].consumedAt).toBeInstanceOf(Date);
    expect(state.auditLogs.some((a) => a.action === 'USER_PHONE_REMOVED')).toBe(true);
  });
});

describe('Settings — profile phone edit hardening (Part 10)', () => {
  it('a profile phone change clears verification flags + Verification row', async () => {
    const { state, users, auth } = await makeServices();
    state.users.push(
      makeUser({
        phone: '+447911123456',
        phoneVerified: true,
        phoneVerifiedAt: new Date(),
        phoneVerifiedDuringSignupAt: new Date(),
      }),
    );
    state.verifications.push({
      userId: 'u1',
      type: 'PHONE',
      status: 'VERIFIED',
      verifiedAt: new Date(),
    });

    await users.updateProfile(auth, { phone: '+15550003333' } as UpdateProfileDto);

    expect(state.users[0].phone).toBe('+15550003333');
    expect(state.users[0].phoneVerified).toBe(false);
    expect(state.users[0].phoneVerifiedAt).toBeNull();
    expect(state.verifications[0].status).toBe('NOT_STARTED');
  });

  it('rejects a duplicate profile phone (Part 29.17)', async () => {
    const { state, users, auth } = await makeServices();
    state.users.push(makeUser({ phone: '+447911123456', phoneVerified: true }));
    state.users.push(
      makeUser({ id: 'u2', phone: '+15550004444', username: 'other', email: 'o@x.zz' }),
    );

    await expect(
      users.updateProfile(auth, { phone: '+15550004444' } as UpdateProfileDto),
    ).rejects.toThrow(ConflictException);
    expect(state.users[0].phone).toBe('+447911123456');
  });

  it('rejects a non-E.164 profile phone with the canonical message', async () => {
    const { state, users, auth } = await makeServices();
    state.users.push(makeUser({ phone: '+447911123456' }));

    await expect(
      users.updateProfile(auth, { phone: 'not-a-number' } as UpdateProfileDto),
    ).rejects.toThrow(PHONE_MESSAGE_GENERIC);
  });

  it('an unchanged phone keeps its verified state (no false reset)', async () => {
    const { state, users, auth } = await makeServices();
    state.users.push(
      makeUser({ phone: '+447911123456', phoneVerified: true, phoneVerifiedAt: new Date() }),
    );

    await users.updateProfile(auth, { phone: '+447911123456' } as UpdateProfileDto);
    expect(state.users[0].phoneVerified).toBe(true);
  });
});
describe('Settings — KYC is server-authoritative only (Parts 13/16/19/29.23)', () => {
  it('the customer profile DTO accepts no kycStatus field (whitelist rejects unknowns)', () => {
    expect('kycStatus' in new UpdateProfileDto()).toBe(false);
    expect('kycStatus' in new SetEmailDto()).toBe(false);
    expect('kycStatus' in new RemoveIdentifierDto()).toBe(false);
  });

  it('a smuggled kycStatus in the profile payload never reaches the account', async () => {
    const { state, users, auth } = await makeServices();
    state.users.push(makeUser({ kycStatus: 'NOT_STARTED' }));

    // Simulate a hostile payload reaching the service layer directly: the
    // service only ever writes its EDITABLE_FIELDS whitelist.
    await users.updateProfile(auth, {
      kycStatus: 'VERIFIED',
      emailVerified: true,
      phoneVerified: true,
    } as unknown as UpdateProfileDto);

    expect(state.users[0].kycStatus).toBe('NOT_STARTED');
    expect(state.users[0].emailVerified).toBe(false);
    expect(state.users[0].phoneVerified).toBe(false);
  });

  it('verification status responses never contain a KYC field (no mixing)', async () => {
    const { state, verification } = await makeServices();
    state.users.push(makeUser({ kycStatus: 'PENDING' }));

    const status = (await verification.getStatus('u1')) as unknown as Record<string, unknown>;
    expect(Object.keys(status)).not.toContain('kyc');
    expect(Object.keys(status)).not.toContain('kycStatus');
  });

  it('getMe exposes the backend kycStatus for the Settings card to DISPLAY', async () => {
    const { state, users, auth } = await makeServices();
    state.users.push(makeUser({ kycStatus: 'REJECTED' }));

    const me = await users.getMe(auth);
    expect(me.kycStatus).toBe('REJECTED');
  });
});

describe('Settings — password change (Parts 20/29.28–30)', () => {
  it('a successful change rewrites the hash, revokes other sessions, audits safely', async () => {
    const { state, users, auth, passwordHash } = await makeServices();
    state.users.push(passwordedUser(passwordHash));
    state.sessions.push(
      { id: 's1', userId: 'u1', revokedAt: null, expiresAt: new Date(Date.now() + 3_600_000) },
      { id: 's-other', userId: 'u1', revokedAt: null, expiresAt: new Date(Date.now() + 3_600_000) },
    );

    await users.changePassword(
      auth,
      { currentPassword: PASSWORD, newPassword: 'BrandNew99!' } as any,
      '127.0.0.1',
      'jest',
    );

    expect(state.users[0].passwordHash).not.toBe(passwordHash);
    expect(await argon2.verify(state.users[0].passwordHash, 'BrandNew99!')).toBe(true);
    expect(state.sessions.find((s) => s.id === 's1')?.revokedAt).toBeNull();
    expect(state.sessions.find((s) => s.id === 's-other')?.revokedAt).toBeInstanceOf(Date);
    expect(state.securityEvents.some((e) => e.type === 'PASSWORD_CHANGED')).toBe(true);
    // The audit entry for the change never carries a credential.
    const audit = state.auditLogs.find((a) => a.action === 'USER_PASSWORD_CHANGED');
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);
  });

  it('a failed change keeps the account intact and records the failure event', async () => {
    const { state, users, auth, passwordHash } = await makeServices();
    state.users.push(passwordedUser(passwordHash));

    await expect(
      users.changePassword(auth, { currentPassword: 'Nope1234!', newPassword: 'X' } as any),
    ).rejects.toThrow(UnauthorizedException);
    expect(state.users[0].passwordHash).toBe(passwordHash);
    expect(state.securityEvents.some((e) => e.type === 'PASSWORD_CHANGE_FAILURE')).toBe(true);
  });

  it('passwords never appear in audit logs, security events or logger calls (Part 29.30)', async () => {
    const { state, users, verification, auth, passwordHash } = await makeServices();
    state.users.push(passwordedUser(passwordHash, { email: null, phone: '+447911123456' }));

    await users.changePassword(
      auth,
      { currentPassword: PASSWORD, newPassword: 'AnotherPass7!' } as any,
    );
    await verification.setEmail('u1', 'audit-check@example.com', 'AnotherPass7!');
    await verification.removeEmail('u1', 'AnotherPass7!');

    const haystack = JSON.stringify(state.auditLogs) + JSON.stringify(state.securityEvents);
    expect(haystack).not.toContain(PASSWORD);
    expect(haystack).not.toContain('AnotherPass7!');
    expect(haystack).not.toContain('passwordHash');

    // No ad-hoc console output and no logger call interpolates a credential.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path') as typeof import('path');
    const files = [
      path.join(__dirname, '..', 'src', 'modules', 'verification', 'verification.service.ts'),
      path.join(__dirname, '..', 'src', 'modules', 'users', 'users.service.ts'),
    ];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      expect(src).not.toMatch(/console\.(log|debug|info|warn|error)/);
      expect(src).not.toMatch(/logger\.\w+\([^)]*(currentPassword|newPassword|passwordHash)/);
    }
  });
});





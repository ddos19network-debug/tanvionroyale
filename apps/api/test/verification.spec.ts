/* eslint-disable @typescript-eslint/no-explicit-any */
import { VerificationService } from '../src/modules/verification/verification.service';
import { OtpService } from '../src/modules/auth/otp.service';
import { makePrismaFake, makeUser, otpHash } from './helpers-phase11';

function makeVerificationService() {
  const { prisma, state } = makePrismaFake();
  const svc = new VerificationService(prisma, new OtpService(prisma));
  return { svc, state };
}

describe('Phase 11 — verification center (unit)', () => {
  it('status: reports phone verified (auto during signup) and email unavailable for phone-only accounts', async () => {
    const { svc, state } = makeVerificationService();
    state.users.push(
      makeUser({
        phoneVerified: true,
        phoneVerifiedAt: new Date('2026-01-01T00:00:00Z'),
        phoneVerifiedDuringSignupAt: new Date('2026-01-01T00:00:00Z'),
        email: null,
      }),
    );

    const status = await svc.getStatus('u1');

    expect(status.phone.status).toBe('VERIFIED');
    expect(status.phone.autoVerifiedDuringSignup).toBe(true);
    expect(status.email.status).toBe('UNAVAILABLE');
    expect(status.face.status).toBe('NOT_STARTED');
  });

  it('status: a manually verified phone is NOT flagged as auto-verified during signup', async () => {
    const { svc, state } = makeVerificationService();
    state.users.push(
      makeUser({
        phoneVerified: true,
        phoneVerifiedAt: new Date('2026-01-02T00:00:00Z'),
        // phoneVerifiedDuringSignupAt stays NULL for manual verification.
      }),
    );

    const status = await svc.getStatus('u1');
    expect(status.phone.status).toBe('VERIFIED');
    expect(status.phone.autoVerifiedDuringSignup).toBe(false);
  });

  it('status: a phone verified during signup IS flagged as auto-verified', async () => {
    const { svc, state } = makeVerificationService();
    state.users.push(
      makeUser({
        phoneVerified: true,
        phoneVerifiedAt: new Date('2026-01-01T00:00:00Z'),
        phoneVerifiedDuringSignupAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );

    const status = await svc.getStatus('u1');
    expect(status.phone.autoVerifiedDuringSignup).toBe(true);
  });

  it('status: reports an unverified email when one is set', async () => {
    const { svc, state } = makeVerificationService();
    state.users.push(makeUser({ email: 'x@y.z', phone: null }));

    const status = await svc.getStatus('u1');
    expect(status.email.status).toBe('NOT_STARTED');
    expect(status.email.email).toBe('x@y.z');
  });

  it('phone verification: sending for an already-verified phone conflicts', async () => {
    const { svc, state } = makeVerificationService();
    state.users.push(makeUser({ phoneVerified: true }));

    await expect(svc.sendPhoneVerification('u1')).rejects.toThrow('Phone already verified');
  });

  it('phone verification: verifies with a valid OTP and records the verification row', async () => {
    const { svc, state } = makeVerificationService();
    state.users.push(makeUser());

    await svc.sendPhoneVerification('u1');
    state.otps[0].codeHash = otpHash('PHONE_VERIFY', '+447911123456', '246810');
    const status = await svc.verifyPhone('u1', '246810');

    expect(status.phone.status).toBe('VERIFIED');
    // Manual Verification Center verification must NOT be flagged as automatic.
    expect(status.phone.autoVerifiedDuringSignup).toBe(false);
    const user = state.users[0];
    expect(user.phoneVerified).toBe(true);
    expect(user.phoneVerifiedAt).not.toBeNull();
    expect(user.phoneVerifiedDuringSignupAt).toBeNull();
    expect(state.verifications.find((v) => v.type === 'PHONE')!.status).toBe('VERIFIED');
  });

  it('email verification: sending a link marks the channel PENDING until verification', async () => {
    const { svc, state } = makeVerificationService();
    state.users.push(makeUser({ email: 'pending@example.com', phone: null }));

    const pending = await svc.getStatus('u1');
    expect(pending.email.status).toBe('NOT_STARTED');

    await svc.sendEmailVerification('u1');
    expect((await svc.getStatus('u1')).email.status).toBe('PENDING');
    expect(state.verifications.find((v) => v.type === 'EMAIL')?.status).toBe('PENDING');
  });

  it('phone verification: sending an OTP marks the channel PENDING until verification', async () => {
    const { svc, state } = makeVerificationService();
    state.users.push(makeUser());

    await svc.sendPhoneVerification('u1');
    expect((await svc.getStatus('u1')).phone.status).toBe('PENDING');
    expect(state.verifications.find((v) => v.type === 'PHONE')?.status).toBe('PENDING');
  });

  it('phone verification: rejects a wrong OTP', async () => {
    const { svc, state } = makeVerificationService();
    state.users.push(makeUser());

    await svc.sendPhoneVerification('u1');
    await expect(svc.verifyPhone('u1', '000000')).rejects.toThrow(/Invalid code/);
    expect(state.users[0].phoneVerified).toBe(false);
  });

  it('email verification: issues a one-time hashed token and verifies it once', async () => {
    const { svc, state } = makeVerificationService();
    state.users.push(makeUser({ email: 'x@y.z', phone: null }));

    await svc.sendEmailVerification('u1');
    const rawToken = 'raw-email-verification-token-abcdef';
    // Simulate what the emailed token would hash to.
    const { createHash } = require('crypto') as typeof import('crypto');
    state.authTokens[0].tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const status = await svc.verifyEmail(rawToken);
    expect(status.email.status).toBe('VERIFIED');
    expect(state.users[0].emailVerified).toBe(true);
    expect(state.users[0].emailVerifiedAt).not.toBeNull();

    // Single use: the same token cannot verify again.
    await expect(svc.verifyEmail(rawToken)).rejects.toThrow('Invalid or expired token');
  });

  it('email verification: an unknown/never-issued token is rejected', async () => {
    const { svc } = makeVerificationService();
    await expect(svc.verifyEmail('garbage-token')).rejects.toThrow('Invalid or expired token');
  });

  it('face verification: starts as PENDING (manual review) and never auto-verifies', async () => {
    const { svc, state } = makeVerificationService();
    state.users.push(makeUser({ phoneVerified: true, emailVerified: true }));

    const status = await svc.startFaceVerification('u1');

    expect(status.face.status).toBe('PENDING'); // NOT VERIFIED — independent state
    expect(status.face.provider).toBe('mock');
    expect(state.verifications.find((v) => v.type === 'FACE')!.providerRef).toContain('face-manual');
    expect(state.verifications.find((v) => v.type === 'FACE')!.status).not.toBe('VERIFIED');
  });

  it('face verification: a pending case cannot be restarted', async () => {
    const { svc, state } = makeVerificationService();
    state.users.push(makeUser());

    await svc.startFaceVerification('u1');
    await expect(svc.startFaceVerification('u1')).rejects.toThrow('Verification pending');
  });

  it('login methods: a user with a single method cannot disconnect it (lockout protection)', async () => {
    const { svc, state } = makeVerificationService();
    state.users.push(makeUser());
    state.identities.push({
      id: 'i1',
      provider: 'GOOGLE',
      providerAccountId: 'g-1',
      userId: 'u1',
    });

    const methods = await svc.getLoginMethods('u1');
    expect(methods.google).toBe(true);
    expect(methods.facebook).toBe(false);

    await expect(svc.disconnectMethod('u1', 'GOOGLE')).rejects.toThrow(
      'You need at least one other login method before disconnecting this one',
    );
  });

  it('login methods: with two methods one can be disconnected', async () => {
    const { svc, state } = makeVerificationService();
    state.users.push(makeUser());
    state.identities.push(
      { id: 'i1', provider: 'GOOGLE', providerAccountId: 'g-1', userId: 'u1' },
      { id: 'i2', provider: 'PHONE', providerAccountId: '+447911123456', userId: 'u1' },
    );

    const methods = await svc.disconnectMethod('u1', 'GOOGLE');
    expect(methods.google).toBe(false);
    expect(methods.phone).toEqual(['+447911123456']);
  });

  it('email verification: an expired token is rejected (expiration enforced)', async () => {
    const { svc, state } = makeVerificationService();
    state.users.push(makeUser({ email: 'x@y.z', phone: null }));

    await svc.sendEmailVerification('u1');
    const rawToken = 'expired-email-verification-token';
    const { createHash } = require('crypto') as typeof import('crypto');
    state.authTokens[0].tokenHash = createHash('sha256').update(rawToken).digest('hex');
    state.authTokens[0].expiresAt = new Date(Date.now() - 1000);

    await expect(svc.verifyEmail(rawToken)).rejects.toThrow('Invalid or expired token');
    expect(state.users[0].emailVerified).toBe(false);
  });

  it('authorization: operations are scoped to the requesting user (no cross-user access)', async () => {
    const { svc, state } = makeVerificationService();
    state.users.push(
      makeUser({ id: 'u1' }),
      makeUser({ id: 'u2', phone: '+447911999999', username: 'other' }),
    );
    state.identities.push(
      { id: 'i1', provider: 'GOOGLE', providerAccountId: 'g-1', userId: 'u1' },
      { id: 'i2', provider: 'PHONE', providerAccountId: '+447911123456', userId: 'u1' },
      { id: 'i3', provider: 'FACEBOOK', providerAccountId: 'f-1', userId: 'u2' },
    );

    // Status reflects only the requesting user — never another user's phone.
    const status = await svc.getStatus('u1');
    expect(status.phone.phone).toBe('+447911123456');
    expect(status.face.status).toBe('NOT_STARTED');

    // Methods return only the requester's linked identities.
    const methods = await svc.getLoginMethods('u1');
    expect(methods.google).toBe(true);
    expect(methods.facebook).toBe(false);

    // Disconnecting u1's method must not touch u2's identity.
    await svc.disconnectMethod('u1', 'GOOGLE');
    expect(state.identities.some((i) => i.userId === 'u2')).toBe(true);
    expect(state.identities.some((i) => i.userId === 'u1' && i.provider === 'GOOGLE')).toBe(false);
  });
});


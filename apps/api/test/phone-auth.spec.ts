/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from '../src/modules/auth/auth.service';
import {
  OtpService,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
} from '../src/modules/auth/otp.service';
import { makeJwtFake, makePrismaFake, makeUser, otpHash } from './helpers-phase11';

describe('Phase 11 — phone authentication + OTP (unit)', () => {
  it('phone signup: creates a PENDING user, a PHONE identity and issues a hashed OTP', async () => {
    const { prisma, state } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

    const res = await auth.sendPhoneSignupOtp({
      phone: '+447911123456',
      password: 'Str0ngPass!',
    });

    expect(res.message).toContain('code has been sent');
    expect(state.users).toHaveLength(1);
    expect(state.users[0].status).toBe('PENDING');
    expect(state.users[0].email).toBeNull();
    expect(state.identities).toHaveLength(1);
    expect(state.identities[0].provider).toBe('PHONE');
    expect(state.otps).toHaveLength(1);
    expect(state.otps[0].codeHash).not.toMatch(/^\d{6}$/); // never store plaintext
  });

  it('phone signup: rejects an already-registered verified phone', async () => {
    const { prisma, state } = makePrismaFake();
    state.users.push(makeUser({ phoneVerified: true }));
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

    await expect(
      auth.sendPhoneSignupOtp({ phone: '+447911123456', password: 'Str0ngPass!' }),
    ).rejects.toThrow(ConflictException);
  });

  it('phone signup verify: correct OTP activates the account and auto-verifies the phone', async () => {
    const { prisma, state } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

    await auth.sendPhoneSignupOtp({ phone: '+447911123456', password: 'Str0ngPass!' });
    state.otps[0].codeHash = otpHash('PHONE_SIGNUP', '+447911123456', '123456');

    const result = await auth.verifyPhoneSignup({ phone: '+447911123456', code: '123456' });

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBeTruthy();
    const user = state.users[0];
    expect(user.phoneVerified).toBe(true);
    expect(user.phoneVerifiedAt).not.toBeNull();
    // Phase 11.4: signup OTP verification is explicitly marked as automatic.
    expect(user.phoneVerifiedDuringSignupAt).not.toBeNull();
    expect(user.status).toBe('ACTIVE');
    expect(state.securityEvents.some((e) => e.type === 'PHONE_VERIFIED')).toBe(true);
    expect(state.sessions).toHaveLength(1);
    // The authoritative phone OTP channel also persists the VERIFIED record.
    const phoneVerification = state.verifications.find((v) => v.type === 'PHONE');
    expect(phoneVerification).toBeDefined();
    expect(phoneVerification!.status).toBe('VERIFIED');
    expect(phoneVerification!.userId).toBe(state.users[0].id);
  });

  it('phone signup verify: invalid OTP is rejected and the account stays unverified', async () => {
    const { prisma, state } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

    await auth.sendPhoneSignupOtp({ phone: '+447911123456', password: 'Str0ngPass!' });

    await expect(
      auth.verifyPhoneSignup({ phone: '+447911123456', code: '000000' }),
    ).rejects.toThrow(BadRequestException);
    expect(state.users[0].phoneVerified).toBe(false);
  });

  it('OTP: cannot be reused after successful verification', async () => {
    const { prisma, state } = makePrismaFake();
    const otp = new OtpService(prisma);

    await otp.issue('+447911123456', 'PHONE_VERIFY', 'sms');
    state.otps[0].codeHash = otpHash('PHONE_VERIFY', '+447911123456', '654321');

    await otp.verify('+447911123456', 'PHONE_VERIFY', '654321');
    await expect(otp.verify('+447911123456', 'PHONE_VERIFY', '654321')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('OTP: expired codes are rejected', async () => {
    const { prisma, state } = makePrismaFake();
    const otp = new OtpService(prisma);

    await otp.issue('+447911123456', 'PHONE_VERIFY', 'sms');
    state.otps[0].expiresAt = new Date(Date.now() - 1000);

    await expect(otp.verify('+447911123456', 'PHONE_VERIFY', '111111')).rejects.toThrow(
      /Invalid or expired code/,
    );
  });

  it('OTP: too many wrong attempts burn the code', async () => {
    const { prisma, state } = makePrismaFake();
    const otp = new OtpService(prisma);

    await otp.issue('+447911123456', 'PHONE_VERIFY', 'sms');
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await expect(otp.verify('+447911123456', 'PHONE_VERIFY', '000000')).rejects.toThrow(
        BadRequestException,
      );
    }
    expect(state.otps[0].consumedAt).not.toBeNull();
    await expect(otp.verify('+447911123456', 'PHONE_VERIFY', '111111')).rejects.toThrow(
      /Too many attempts|Invalid or expired/,
    );
  });

  it('OTP: resend cooldown is enforced', async () => {
    const { prisma } = makePrismaFake();
    const otp = new OtpService(prisma);

    await otp.issue('+447911123456', 'PHONE_VERIFY', 'sms');
    await expect(otp.issue('+447911123456', 'PHONE_VERIFY', 'sms')).rejects.toThrow(
      ConflictException,
    );
    expect(OTP_RESEND_COOLDOWN_MS).toBe(60_000);
  });

  it('phone login: correct credentials return tokens and create a session', async () => {
    const { prisma, state } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));
    state.users.push(makeUser({ passwordHash: await argon2.hash('RightPassword1') }));

    const result = await auth.loginWithPhone({
      phone: '+447911123456',
      password: 'RightPassword1',
    });

    expect(result.accessToken).toBe('access-token');
    expect(result.user.email).toBe('');
    expect(state.sessions).toHaveLength(1);
    expect(state.securityEvents.some((e) => e.type === 'LOGIN_SUCCESS')).toBe(true);
  });

  it('phone login: wrong password fails uniformly and records LOGIN_FAILURE', async () => {
    const { prisma, state } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));
    state.users.push(makeUser({ passwordHash: await argon2.hash('RightPassword1') }));

    await expect(
      auth.loginWithPhone({ phone: '+447911123456', password: 'WrongPassword1' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(state.securityEvents.some((e) => e.type === 'LOGIN_FAILURE')).toBe(true);
  });

  it('phone login: unknown phone fails with the same uniform error', async () => {
    const { prisma } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

    await expect(
      auth.loginWithPhone({ phone: '+447999999999', password: 'Whatever123' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});

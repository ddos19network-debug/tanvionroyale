/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * CANONICAL PHONE NORMALIZATION (production 400 fix).
 *
 * The signup form sent the raw `01712345678`, the DTO layer required strict
 * E.164, and the customer got a 400 rendered as "Something went wrong". These
 * tests pin the single normalizer every phone code path now shares, and the
 * end-to-end signup -> OTP -> verify -> login -> recovery behaviour built on it.
 */
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from '../src/modules/auth/auth.service';
import { OtpService } from '../src/modules/auth/otp.service';
import {
  tryNormalizePhone,
  normalizePhone,
  isCanonicalPhone,
  maskPhone,
  scrubPhoneFromMessage,
  PHONE_REGEX,
  BD_LOCAL_MOBILE_REGEX,
  PHONE_MESSAGE_BD,
} from '../src/common/utils/phone';
import { makeJwtFake, makePrismaFake, makeUser, otpHash } from './helpers-phase11';

const BD_LOCAL = '01712345678';
const BD_E164 = '+8801712345678';

function expectCanonical(input: unknown, expected: string): void {
  const result = tryNormalizePhone(input);
  expect(result).toEqual({ ok: true, phone: expected });
  expect(normalizePhone(input)).toBe(expected);
}

function expectRejected(input: unknown, message?: string): void {
  const result = tryNormalizePhone(input);
  expect(result.ok).toBe(false);
  if (message) expect((result as { message: string }).message).toBe(message);
  expect(() => normalizePhone(input)).toThrow(BadRequestException);
}

describe('phone normalization — Bangladesh local', () => {
  it('01712345678 -> +8801712345678', () => expectCanonical(BD_LOCAL, BD_E164));

  it('accepts the full Bangladeshi mobile range (013-019 operators)', () => {
    // 0 + <operator digit 3-9> + 8 subscriber digits = 11 local digits.
    // Normalizes to +880 + <operator digit> + 8 digits (the trunk 0 is dropped).
    for (const operator of ['3', '4', '5', '6', '7', '8', '9']) {
      expectCanonical(`01${operator}12345678`, `+8801${operator}12345678`);
    }
  });

  it('strips the formatting a customer actually types', () => {
    expectCanonical('01712-345678', BD_E164);
    expectCanonical('01712 345678', BD_E164);
    expectCanonical('01712 345 678', BD_E164);
    expectCanonical('  +880 1712-345678  ', BD_E164);
    expectCanonical('(01712) 345678', BD_E164);
  });
});

describe('phone normalization — international', () => {
  it('leaves a Bangladesh E.164 number UNCHANGED (never double-prefixed)', () => {
    expectCanonical(BD_E164, BD_E164);
    // The exact production regression: +8808801712345678 must never be produced.
    expect(normalizePhone(BD_E164)).not.toBe('+8808801712345678');
  });

  it('leaves other international E.164 numbers unchanged', () => {
    expectCanonical('+447911123456', '+447911123456');
    expectCanonical('+15550001111', '+15550001111');
  });

  it('accepts the ISO 00 prefix and a bare 880 country code', () => {
    expectCanonical('008801712345678', BD_E164);
    expectCanonical('8801712345678', BD_E164);
  });

  it('never invents a country code for an unknown international LOCAL number', () => {
    // A UK local number is NOT auto-converted: its country is unknown, so the
    // safe answer is to reject it rather than fabricate a wrong identity.
    expectRejected('0712345678');
    expectRejected('5550001111');
  });
});

describe('phone normalization — invalid input', () => {
  it('rejects every unusable shape with an actionable message', () => {
    for (const bad of ['017123', '123456789', '+880', 'abc', '', '   ', '+', '0', '01', '0112345678']) {
      expectRejected(bad);
    }
  });

  it('explains a Bangladesh-shaped mistake in Bangladesh terms', () => {
    expectRejected('0123456789', PHONE_MESSAGE_BD); // 12 local digits, invalid operator
    expectRejected('0171234', PHONE_MESSAGE_BD);
  });

  it('rejects non-strings without throwing a TypeError', () => {
    expectRejected(1712345678);
    expectRejected(null);
    expectRejected(undefined);
    expectRejected({ phone: BD_LOCAL });
  });
});

describe('phone normalization — helpers', () => {
  it('is idempotent: normalizing a canonical value changes nothing', () => {
    expect(normalizePhone(normalizePhone(BD_LOCAL))).toBe(BD_E164);
    expect(normalizePhone(BD_E164)).toBe(BD_E164);
  });

  it('isCanonicalPhone only accepts true E.164', () => {
    expect(isCanonicalPhone(BD_E164)).toBe(true);
    expect(isCanonicalPhone('+447911123456')).toBe(true);
    expect(isCanonicalPhone(BD_LOCAL)).toBe(false);
    expect(isCanonicalPhone('01712-345678')).toBe(false);
  });

  it('exposes the documented regexes', () => {
    expect(PHONE_REGEX.test(BD_E164)).toBe(true);
    expect(PHONE_REGEX.test(BD_LOCAL)).toBe(false);
    expect(BD_LOCAL_MOBILE_REGEX.test(BD_LOCAL)).toBe(true);
    expect(BD_LOCAL_MOBILE_REGEX.test('0123456789')).toBe(false);
  });

  it('masks a phone for logs without hiding the country code', () => {
    expect(maskPhone(BD_E164)).toBe('+88017******78');
    expect(maskPhone(BD_E164)).not.toContain('1712345678');
  });

  it('scrubs a phone number out of a free-text log message', () => {
    const scrubbed = scrubPhoneFromMessage(`phone ${BD_LOCAL} is not registered`);
    expect(scrubbed).not.toContain(BD_LOCAL);
    expect(scrubbed).toContain('phone');
  });
});

describe('phone signup — normalization across the whole flow', () => {
  it('stores the canonical E.164 value when the user types the local number', async () => {
    const { prisma, state } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

    const res = await auth.sendPhoneSignupOtp({ phone: BD_LOCAL, password: 'Str0ngPass!' });

    // The canonical value is echoed back so the client can verify against it.
    expect(res.phone).toBe(BD_E164);
    expect(state.users).toHaveLength(1);
    expect(state.users[0].phone).toBe(BD_E164);
    // The PHONE identity is keyed by the SAME canonical value.
    expect(state.identities[0].providerAccountId).toBe(BD_E164);
    expect(state.otps).toHaveLength(1);
  });

  it('issues the OTP for the canonical value and verifies against it', async () => {
    const { prisma, state } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

    await auth.sendPhoneSignupOtp({ phone: BD_LOCAL, password: 'Str0ngPass!' });
    // The OTP identifier is the canonical phone, not the raw local input.
    state.otps[0].codeHash = otpHash('PHONE_SIGNUP', BD_E164, '123456');

    // The user may still type the LOCAL number on the verify screen; the
    // normalizer makes it resolve to the same account and the same OTP.
    const result = await auth.verifyPhoneSignup({ phone: BD_LOCAL, code: '123456' });

    expect(result.accessToken).toBe('access-token');
    const user = state.users[0];
    expect(user.status).toBe('ACTIVE');
    expect(user.phoneVerified).toBe(true);
    expect(user.phoneVerifiedDuringSignupAt).not.toBeNull();
    expect(user.phone).toBe(BD_E164);
    expect(state.sessions).toHaveLength(1);
  });

  it('completes the E2E flow for an already-international number too', async () => {
    const { prisma, state } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

    const res = await auth.sendPhoneSignupOtp({ phone: BD_E164, password: 'Str0ngPass!' });
    expect(res.phone).toBe(BD_E164);
    state.otps[0].codeHash = otpHash('PHONE_SIGNUP', BD_E164, '123456');

    const result = await auth.verifyPhoneSignup({ phone: BD_E164, code: '123456' });

    expect(result.accessToken).toBe('access-token');
    expect(state.users[0].status).toBe('ACTIVE');
    expect(state.users[0].phoneVerified).toBe(true);
  });

  it('rejects a wrong OTP without activating the account', async () => {
    const { prisma, state } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

    await auth.sendPhoneSignupOtp({ phone: BD_LOCAL, password: 'Str0ngPass!' });

    await expect(
      auth.verifyPhoneSignup({ phone: BD_LOCAL, code: '000000' }),
    ).rejects.toThrow(BadRequestException);
    expect(state.users[0].phoneVerified).toBe(false);
    expect(state.users[0].status).toBe('PENDING');
  });

  it('refuses an invalid number with an actionable message, not a validator stack', async () => {
    const { prisma } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

    await expect(
      auth.sendPhoneSignupOtp({ phone: 'abc', password: 'Str0ngPass!' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      auth.sendPhoneSignupOtp({ phone: 'abc', password: 'Str0ngPass!' }),
    ).rejects.not.toThrow(/class-validator|ValidationPipe/);
  });
});

describe('duplicate representation — one account per number', () => {
  it('signup with the local number, then with E.164 => Phone already registered', async () => {
    const { prisma, state } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

    // First signup with the LOCAL number, verified (so the account is ACTIVE).
    await auth.sendPhoneSignupOtp({ phone: BD_LOCAL, password: 'Str0ngPass!' });
    state.otps[0].codeHash = otpHash('PHONE_SIGNUP', BD_E164, '123456');
    await auth.verifyPhoneSignup({ phone: BD_E164, code: '123456' });
    expect(state.users).toHaveLength(1);

    // Second signup with the E.164 spelling of the SAME number must conflict,
    // not create a second account.
    await expect(
      auth.sendPhoneSignupOtp({ phone: BD_E164, password: 'Str0ngPass!' }),
    ).rejects.toThrow(ConflictException);
    expect(state.users).toHaveLength(1);
  });

  it('the reverse order conflicts identically (E.164 first, then local)', async () => {
    const { prisma, state } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

    await auth.sendPhoneSignupOtp({ phone: BD_E164, password: 'Str0ngPass!' });
    state.otps[0].codeHash = otpHash('PHONE_SIGNUP', BD_E164, '123456');
    await auth.verifyPhoneSignup({ phone: BD_E164, code: '123456' });

    await expect(
      auth.sendPhoneSignupOtp({ phone: BD_LOCAL, password: 'Str0ngPass!' }),
    ).rejects.toThrow(ConflictException);
    expect(state.users).toHaveLength(1);
  });

  it('a formatted spelling maps onto the same account, not a new one', async () => {
    const { prisma, state } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

    await auth.sendPhoneSignupOtp({ phone: '01712-345678', password: 'Str0ngPass!' });
    state.otps[0].codeHash = otpHash('PHONE_SIGNUP', BD_E164, '123456');
    await auth.verifyPhoneSignup({ phone: '01712 345 678', code: '123456' });

    await expect(
      auth.sendPhoneSignupOtp({ phone: BD_E164, password: 'Str0ngPass!' }),
    ).rejects.toThrow(ConflictException);
    expect(state.users).toHaveLength(1);
    expect(state.users[0].phone).toBe(BD_E164);
  });
});

describe('phone login — finds the same account from either spelling', () => {
  async function seedVerifiedPhone(state: { users: any[] }): Promise<void> {
    state.users.push(makeUser({ phone: BD_E164, phoneVerified: true, status: 'ACTIVE' }));
    state.users[0].passwordHash = await argon2.hash('Str0ngPass!', { type: argon2.argon2id });
  }

  it('loginWithPhone accepts the local number for a canonically stored account', async () => {
    const { prisma, state } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));
    await seedVerifiedPhone(state);

    const result = await auth.loginWithPhone({ phone: BD_LOCAL, password: 'Str0ngPass!' });
    expect(result.accessToken).toBe('access-token');
  });

  it('the unified /auth/login identifier routes a local number to the phone path', async () => {
    const { prisma, state } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));
    await seedVerifiedPhone(state);

    // `01712345678` must be detected as a PHONE, not treated as an email.
    const result = await auth.login({ identifier: BD_LOCAL, password: 'Str0ngPass!' });
    expect(result.accessToken).toBe('access-token');
  });

  it('an unknown local number still yields the uniform 401 (no enumeration)', async () => {
    const { prisma } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

    await expect(
      auth.loginWithPhone({ phone: '01799999999', password: 'Str0ngPass!' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});

describe('phone recovery — both spellings reach the same account', () => {
  it('start + complete recovery work with the local number', async () => {
    const { prisma, state } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));
    state.users.push(makeUser({ phone: BD_E164, phoneVerified: true, status: 'ACTIVE' }));

    const res = await auth.startPhoneRecovery(BD_LOCAL);
    expect(res.message).toContain('recovery code has been sent');
    // The recovery OTP is bound to the canonical identifier.
    expect(state.otps[0].identifier).toBe(BD_E164);
    state.otps[0].codeHash = otpHash('PHONE_RECOVERY', BD_E164, '123456');

    // Reset is completed with the E.164 spelling: same account, same OTP.
    await auth.completePhoneRecovery(BD_E164, '123456', 'N3wPassw0rd!');
    expect(state.users[0].phone).toBe(BD_E164);
  });

  it('rejects an invalid recovery number instead of silently doing nothing', async () => {
    const { prisma } = makePrismaFake();
    const auth = new AuthService(prisma, makeJwtFake(), new OtpService(prisma));

    await expect(auth.startPhoneRecovery('abc')).rejects.toThrow(BadRequestException);
  });
});

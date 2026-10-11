/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { OtpService } from '../src/modules/auth/otp.service';
import {
  createEmailCodeSender,
  EmailCodeSender,
  otpEmailBody,
} from '../src/modules/auth/otp-sender.factory';
import { VerificationService } from '../src/modules/verification/verification.service';
import { getEmailSender, SmtpEmailSender } from '../src/modules/notifications/email-sender';
import { makePrismaFake, makeUser, otpHash } from './helpers-phase11';

const ENV = process.env;

afterEach(() => {
  process.env = ENV;
  jest.restoreAllMocks();
});

function withEnv(overrides: Record<string, string | undefined>) {
  process.env = { ...ENV, ...overrides };
}

// The email OTP sender routes through the shared EmailSender abstraction, so
// mocking nodemailer gives us the real EMAIL_PROVIDER=smtp wiring end-to-end.
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn(async () => ({})),
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodemailer = require('nodemailer') as { createTransport: jest.Mock };

describe('One-of-two verification — email OTP delivery', () => {
  it('EMAIL_PROVIDER=smtp wires a real SMTP (nodemailer) sender for OTP emails', async () => {
    withEnv({
      NODE_ENV: 'production',
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.test.example',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_USER: 'otp-sender@test.example',
      SMTP_PASSWORD: 'not-a-real-secret',
      EMAIL_FROM: 'TANVIONROYALE <no-reply@test.example>',
    });
    const { prisma, state } = makePrismaFake();
    const otp = new OtpService(prisma);

    await otp.issue('user@gmail.com', 'EMAIL_VERIFY', 'email');

    // A real SMTP transport was created from the env config (credentials only
    // via env — nothing hardcoded) and an email was actually sent.
    expect(nodemailer.createTransport).toHaveBeenCalled();
    const results = nodemailer.createTransport.mock.results;
    const transport = results[results.length - 1].value;
    expect(transport.sendMail).toHaveBeenCalledTimes(1);
    const message = transport.sendMail.mock.calls[0][0];
    expect(message.to).toBe('user@gmail.com');
    expect(message.subject).toBe('Your TANVIONROYALE verification code');
    expect(message.text).toMatch(/^\d{6}$/m);
    expect(message.text).toContain('This code expires in 5 minutes.');
    expect(message.text).toContain('Never share this code with anyone.');
    // The code is delivered out-of-band only — the DB never sees plaintext.
    expect(state.otps[0].codeHash).not.toMatch(/^\d{6}$/);
    expect(state.otps[0].consumedAt).toBeNull();
  });

  it('the OTP email body is the professional template with the exact subject', () => {
    const body = otpEmailBody('123456', 'EMAIL_VERIFY');
    expect(body).toContain('Hello,');
    expect(body).toContain('123456');
    expect(body).toContain('This code expires in 5 minutes.');
    expect(body).toContain('Never share this code with anyone.');
    expect(body).toContain('TANVIONROYALE');
  });

  it('unconfigured email delivery in production fails safely and burns the OTP', async () => {
    withEnv({ NODE_ENV: 'production', EMAIL_PROVIDER: '' });
    const { prisma, state } = makePrismaFake();
    const otp = new OtpService(prisma);

    await expect(otp.issue('user@gmail.com', 'EMAIL_VERIFY', 'email')).rejects.toThrow(
      'Email delivery is not configured',
    );
    // The sender resolves BEFORE anything is persisted — no code exists that
    // could ever be verified, and emailVerified stays untouched.
    expect(state.otps).toHaveLength(0);
    await expect(otp.verify('user@gmail.com', 'EMAIL_VERIFY', '123456')).rejects.toThrow(
      'Invalid or expired code',
    );
  });

  it('failed SMTP delivery burns the OTP', async () => {
    withEnv({
      NODE_ENV: 'production',
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.test.example',
      EMAIL_FROM: 'no-reply@test.example',
    });
    nodemailer.createTransport.mockImplementationOnce(() => ({
      sendMail: jest.fn(async () => {
        throw new Error('SMTP connection refused');
      }),
    }));
    const { prisma, state } = makePrismaFake();
    const otp = new OtpService(prisma);

    await expect(otp.issue('user@gmail.com', 'EMAIL_VERIFY', 'email')).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(state.otps[0].consumedAt).not.toBeNull();
    await expect(otp.verify('user@gmail.com', 'EMAIL_VERIFY', '123456')).rejects.toThrow(
      'Invalid or expired code',
    );
  });

  it('unknown email provider names fail safely (never silently dropped)', () => {
    withEnv({ NODE_ENV: 'production', EMAIL_PROVIDER: 'mailgun' });
    expect(() => getEmailSender()).toThrow(ServiceUnavailableException);
    expect(() => createEmailCodeSender()).toThrow(ServiceUnavailableException);
  });

  it('failed SMS delivery burns the OTP (Twilio parity)', async () => {
    withEnv({ NODE_ENV: 'production' });
    const { prisma, state } = makePrismaFake();
    const otp = new OtpService(prisma);
    otp.registerSender('sms', {
      channel: 'sms',
      send: async () => {
        throw new Error('Twilio API 500');
      },
    } as any);

    await expect(otp.issue('+447911123456', 'PHONE_VERIFY', 'sms')).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(state.otps[0].consumedAt).not.toBeNull();
    await expect(otp.verify('+447911123456', 'PHONE_VERIFY', '123456')).rejects.toThrow(
      'Invalid or expired code',
    );
  });

  it('phone OTP send uses the Twilio HTTP API with env credentials (never hardcoded)', async () => {
    withEnv({
      NODE_ENV: 'production',
      SMS_PROVIDER: 'twilio',
      SMS_ACCOUNT_SID: 'ACTESTSID',
      SMS_AUTH_TOKEN: 'test-auth-token',
      SMS_FROM_NUMBER: '+15005550006',
    });
    const fetchMock = jest.fn(async () => ({ ok: true }) as Response);
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock as any);
    const { prisma, state } = makePrismaFake();
    const otp = new OtpService(prisma);

    await otp.issue('+447911123456', 'PHONE_VERIFY', 'sms');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('api.twilio.com/2010-04-01/Accounts/ACTESTSID/Messages.json');
    expect(String((init.headers as Record<string, string>)['Authorization'])).toContain(
      Buffer.from('ACTESTSID:test-auth-token').toString('base64'),
    );
    const body = String(init.body);
    expect(body).toContain('To=%2B447911123456');
    expect(body).toContain('From=%2B15005550006');
    expect(body).toMatch(/code\+is\+\d{6}/);
    expect(state.otps[0].consumedAt).toBeNull();
  });

  it('SMTP_SECURE=true / port 465 yields an implicit-TLS transport (Gmail-capable)', () => {
    withEnv({
      NODE_ENV: 'production',
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_PORT: '465',
      SMTP_USER: 'app-account@gmail.com',
      SMTP_PASSWORD: 'app-password',
      EMAIL_FROM: 'no-reply@gmail.com',
    });
    const sender = getEmailSender();
    expect(sender).toBeInstanceOf(SmtpEmailSender);
    const options = nodemailer.createTransport.mock.calls.at(-1)[0];
    expect(options.host).toBe('smtp.gmail.com');
    expect(options.port).toBe(465);
    expect(options.secure).toBe(true);
    // Auth comes from env only — never from source or NEXT_PUBLIC_*.
    expect(options.auth).toEqual({
      user: 'app-account@gmail.com',
      pass: 'app-password',
    });
  });
});

describe('One-of-two verification — OTP security guarantees', () => {
  function makeOtp(channel: 'email' | 'sms') {
    const { prisma, state } = makePrismaFake();
    const otp = new OtpService(prisma);
    otp.registerSender(channel, { channel, send: async () => undefined } as any);
    return { otp, state };
  }

  it('OTP is stored hashed only (sha256 of purpose:identifier:code), never plaintext', async () => {
    withEnv({ NODE_ENV: 'development' });
    const { prisma, state } = makePrismaFake();
    const otp = new OtpService(prisma);
    let delivered = '';
    otp.registerSender('email', {
      channel: 'email',
      send: async (_id: string, code: string) => {
        delivered = code;
      },
    } as any);

    await otp.issue('user@gmail.com', 'EMAIL_VERIFY', 'email');

    expect(delivered).toMatch(/^\d{6}$/);
    // The stored hash corresponds EXACTLY to the delivered code bound to its
    // purpose + identifier, and the plaintext code is nowhere in the row.
    expect(state.otps[0].codeHash).toBe(otpHash('EMAIL_VERIFY', 'user@gmail.com', delivered));
    expect(JSON.stringify(state.otps[0])).not.toContain(delivered);
  });

  it('OTP expires after 5 minutes', async () => {
    withEnv({ NODE_ENV: 'development' });
    const { otp, state } = makeOtp('email');

    await otp.issue('user@gmail.com', 'EMAIL_VERIFY', 'email');
    state.otps[0].codeHash = otpHash('EMAIL_VERIFY', 'user@gmail.com', '111111');
    state.otps[0].expiresAt = new Date(Date.now() - 1000);

    await expect(otp.verify('user@gmail.com', 'EMAIL_VERIFY', '111111')).rejects.toThrow(
      'Invalid or expired code',
    );
  });

  it('OTP is single-use (cannot be reused after consumption)', async () => {
    withEnv({ NODE_ENV: 'development' });
    const { otp, state } = makeOtp('email');

    await otp.issue('user@gmail.com', 'EMAIL_VERIFY', 'email');
    state.otps[0].codeHash = otpHash('EMAIL_VERIFY', 'user@gmail.com', '222222');

    await otp.verify('user@gmail.com', 'EMAIL_VERIFY', '222222');
    await expect(otp.verify('user@gmail.com', 'EMAIL_VERIFY', '222222')).rejects.toThrow(
      'Invalid or expired code',
    );
  });

  it('OTP cannot exceed 5 attempts (budget exhausted burns the code)', async () => {
    withEnv({ NODE_ENV: 'development' });
    const { otp, state } = makeOtp('email');

    await otp.issue('user@gmail.com', 'EMAIL_VERIFY', 'email');
    state.otps[0].codeHash = otpHash('EMAIL_VERIFY', 'user@gmail.com', '333333');

    for (let i = 0; i < 4; i++) {
      await expect(otp.verify('user@gmail.com', 'EMAIL_VERIFY', '000000')).rejects.toThrow(
        'Invalid code',
      );
    }
    // The 5th wrong attempt exhausts the budget and burns the code.
    await expect(otp.verify('user@gmail.com', 'EMAIL_VERIFY', '000000')).rejects.toThrow(
      'Too many attempts. Request a new code.',
    );
    expect(state.otps[0].consumedAt).not.toBeNull();
    // Even the CORRECT code is now dead.
    await expect(otp.verify('user@gmail.com', 'EMAIL_VERIFY', '333333')).rejects.toThrow(
      'Invalid or expired code',
    );
  });

  it('resend cooldown is enforced (60s); another identifier is not throttled', async () => {
    withEnv({ NODE_ENV: 'development' });
    const { otp } = makeOtp('email');

    await otp.issue('user@gmail.com', 'EMAIL_VERIFY', 'email');
    await expect(otp.issue('user@gmail.com', 'EMAIL_VERIFY', 'email')).rejects.toThrow(
      ConflictException,
    );
    await expect(otp.issue('other@gmail.com', 'EMAIL_VERIFY', 'email')).resolves.toBeUndefined();
  });

  it('an EMAIL_VERIFY code can never be used as a PHONE_VERIFY code (and vice versa)', async () => {
    withEnv({ NODE_ENV: 'development' });
    const { prisma, state } = makePrismaFake();
    const otp = new OtpService(prisma);
    otp.registerSender('email', { channel: 'email', send: async () => undefined } as any);
    otp.registerSender('sms', { channel: 'sms', send: async () => undefined } as any);

    await otp.issue('user@gmail.com', 'EMAIL_VERIFY', 'email');
    state.otps[0].codeHash = otpHash('EMAIL_VERIFY', 'user@gmail.com', '445566');

    // Same identifier + same code + WRONG purpose must fail...
    await expect(otp.verify('user@gmail.com', 'PHONE_VERIFY', '445566')).rejects.toThrow(
      'Invalid or expired code',
    );
    // ...and the correct purpose still works afterwards (no cross-consumption).
    await otp.verify('user@gmail.com', 'EMAIL_VERIFY', '445566');

    // Reverse direction: a PHONE_VERIFY code cannot satisfy EMAIL_VERIFY.
    await otp.issue('+447911123456', 'PHONE_VERIFY', 'sms');
    state.otps.at(-1)!.codeHash = otpHash('PHONE_VERIFY', '+447911123456', '778899');
    await expect(otp.verify('+447911123456', 'EMAIL_VERIFY', '778899')).rejects.toThrow(
      'Invalid or expired code',
    );
  });

  it('the email OTP channel rides the shared OtpService sender abstraction', () => {
    withEnv({ NODE_ENV: 'development' });
    expect(createEmailCodeSender().channel).toBe('email');
    expect(new EmailCodeSender().channel).toBe('email');
  });
});

describe('One-of-two verification — status logic (OR condition)', () => {
  function makeVerificationService() {
    const { prisma, state } = makePrismaFake();
    const svc = new VerificationService(prisma, new OtpService(prisma));
    return { svc, state };
  }

  it('emailVerified alone completes the requirement (phone unverified)', async () => {
    const { svc, state } = makeVerificationService();
    state.users.push(makeUser({ email: 'user@gmail.com', phone: null, emailVerified: true }));
    const status = await svc.getStatus('u1');
    expect(status.initialVerificationComplete).toBe(true);
    expect(status.email.status).toBe('VERIFIED');
    expect(status.phone.status).toBe('NOT_STARTED');
  });

  it('phoneVerified alone completes the requirement (email unverified)', async () => {
    const { svc, state } = makeVerificationService();
    state.users.push(makeUser({ phoneVerified: true, email: null }));
    const status = await svc.getStatus('u1');
    expect(status.initialVerificationComplete).toBe(true);
    expect(status.phone.status).toBe('VERIFIED');
    expect(status.email.status).toBe('UNAVAILABLE');
  });

  it('both false keeps the requirement incomplete (user stays on /verification)', async () => {
    const { svc, state } = makeVerificationService();
    state.users.push(makeUser({ email: 'user@gmail.com' }));
    const status = await svc.getStatus('u1');
    expect(status.initialVerificationComplete).toBe(false);
  });

  it('face NOT_STARTED never blocks a completed phone/email requirement', async () => {
    const { svc, state } = makeVerificationService();
    state.users.push(makeUser({ email: 'user@gmail.com', emailVerified: true }));
    const status = await svc.getStatus('u1');
    expect(status.face.status).toBe('NOT_STARTED');
    expect(status.initialVerificationComplete).toBe(true);
  });

  it('verifying the email OTP marks emailVerified and reports the complete requirement', async () => {
    withEnv({ NODE_ENV: 'development' });
    const { prisma, state } = makePrismaFake();
    const otp = new OtpService(prisma);
    otp.registerSender('email', { channel: 'email', send: async () => undefined } as any);
    const svc = new VerificationService(prisma, otp);
    state.users.push(makeUser({ email: 'user@gmail.com', phone: null }));

    await svc.sendEmailOtp('u1');
    state.otps[0].codeHash = otpHash('EMAIL_VERIFY', 'user@gmail.com', '990011');
    const status = await svc.verifyEmailOtp('u1', '990011');

    expect(state.users[0].emailVerified).toBe(true);
    expect(state.users[0].emailVerifiedAt).toBeInstanceOf(Date);
    expect(status.email.status).toBe('VERIFIED');
    expect(status.initialVerificationComplete).toBe(true);
  });

  it('verifying the phone OTP marks phoneVerified and reports the complete requirement', async () => {
    withEnv({ NODE_ENV: 'development' });
    const { prisma, state } = makePrismaFake();
    const otp = new OtpService(prisma);
    otp.registerSender('sms', { channel: 'sms', send: async () => undefined } as any);
    const svc = new VerificationService(prisma, otp);
    state.users.push(makeUser());

    await svc.sendPhoneVerification('u1');
    state.otps[0].codeHash = otpHash('PHONE_VERIFY', '+447911123456', '554433');
    const status = await svc.verifyPhone('u1', '554433');

    expect(state.users[0].phoneVerified).toBe(true);
    expect(status.phone.status).toBe('VERIFIED');
    expect(status.initialVerificationComplete).toBe(true);
  });

  it('email OTP refuses an already verified email (no forced re-verification)', async () => {
    const { svc, state } = makeVerificationService();
    state.users.push(makeUser({ email: 'user@gmail.com', phone: null, emailVerified: true }));
    await expect(svc.sendEmailOtp('u1')).rejects.toThrow(ConflictException);
    await expect(svc.verifyEmailOtp('u1', '123456')).rejects.toThrow(ConflictException);
  });

  it('email OTP requires an email on the account', async () => {
    const { svc, state } = makeVerificationService();
    state.users.push(makeUser({ email: null }));
    await expect(svc.sendEmailOtp('u1')).rejects.toThrow(BadRequestException);
  });

  it('a wrong email OTP code keeps emailVerified false (no success state, no redirect)', async () => {
    withEnv({ NODE_ENV: 'development' });
    const { prisma, state } = makePrismaFake();
    const otp = new OtpService(prisma);
    otp.registerSender('email', { channel: 'email', send: async () => undefined } as any);
    const svc = new VerificationService(prisma, otp);
    state.users.push(makeUser({ email: 'user@gmail.com', phone: null }));

    await svc.sendEmailOtp('u1');
    await expect(svc.verifyEmailOtp('u1', '000000')).rejects.toThrow(BadRequestException);
    expect(state.users[0].emailVerified).toBe(false);
  });

  it('failed email delivery keeps emailVerified false and nothing verifiable behind', async () => {
    withEnv({
      NODE_ENV: 'production',
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.test.example',
      EMAIL_FROM: 'no-reply@test.example',
    });
    nodemailer.createTransport.mockImplementationOnce(() => ({
      sendMail: jest.fn(async () => {
        throw new Error('delivery down');
      }),
    }));
    const { prisma, state } = makePrismaFake();
    const svc = new VerificationService(prisma, new OtpService(prisma));
    state.users.push(makeUser({ email: 'user@gmail.com', phone: null }));

    await expect(svc.sendEmailOtp('u1')).rejects.toThrow(ServiceUnavailableException);
    await expect(svc.verifyEmailOtp('u1', '123456')).rejects.toThrow('Invalid or expired code');
    expect(state.users[0].emailVerified).toBe(false);
  });
});
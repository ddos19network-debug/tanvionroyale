/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OtpService, MockCodeSender, OneTimeCodeSender } from '../src/modules/auth/otp.service';
import {
  createSmsCodeSender,
  TwilioSmsCodeSender,
} from '../src/modules/auth/otp-sender.factory';
import {
  createEmailSender,
  DevLogEmailSender,
  getEmailSender,
} from '../src/modules/notifications/email-sender';
import { makePrismaFake } from './helpers-phase11';

const ENV = process.env;

afterEach(() => {
  process.env = ENV;
  jest.restoreAllMocks();
});

function withEnv(overrides: Record<string, string | undefined>) {
  process.env = { ...ENV, ...overrides };
}

describe('Phase 13 â€” OTP delivery (SMS channel)', () => {
  it('mock sender delivers in development and the issued code is live', async () => {
    withEnv({ NODE_ENV: 'development' });
    const { prisma, state } = makePrismaFake();
    const otp = new OtpService(prisma);

    await otp.issue('+447911123456', 'PHONE_SIGNUP', 'sms');

    expect(state.otps).toHaveLength(1);
    expect(state.otps[0].consumedAt).toBeNull();
    expect(state.otps[0].codeHash).toBeDefined();
  });

  it('never logs the plaintext code or identifier in the development mock sender', async () => {
    withEnv({ NODE_ENV: 'development' });
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const sender = new MockCodeSender('PHONE_VERIFY');
    await sender.send('+447911123456', '123456');
    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('delivery simulated');
    expect(output).not.toContain('123456');
    expect(output).not.toContain('+447911123456');
  });

  it('MockCodeSender.send() refuses to operate in production', async () => {
    withEnv({ NODE_ENV: 'production' });
    const sender = new MockCodeSender('PHONE_SIGNUP');
    await expect(sender.send('+447911123456', '123456')).rejects.toThrow(
      'Mock code sender must never run in production',
    );
  });

  it('provider unavailable in production: fails safely, persists nothing', async () => {
    withEnv({ NODE_ENV: 'production' });
    const { prisma, state } = makePrismaFake();
    const otp = new OtpService(prisma);

    await expect(otp.issue('+447911123456', 'PHONE_SIGNUP', 'sms')).rejects.toThrow(
      ServiceUnavailableException,
    );
    await expect(otp.issue('+447911123456', 'PHONE_SIGNUP', 'sms')).rejects.toThrow(
      'Message delivery is not configured',
    );
    // No OTP row was ever persisted â€” nothing exists to falsely verify.
    expect(state.otps).toHaveLength(0);
  });

  it('provider success: code is delivered and verifies', async () => {
    withEnv({ NODE_ENV: 'production' });
    const { prisma, state } = makePrismaFake();
    const otp = new OtpService(prisma);
    let delivered = '';
    otp.registerSender('sms', {
      channel: 'sms',
      send: async (_id, code) => {
        delivered = code;
      },
    } as OneTimeCodeSender);

    await otp.issue('+447911123456', 'PHONE_SIGNUP', 'sms');
    expect(delivered).toMatch(/^\d{6}$/);
    expect(state.otps[0].consumedAt).toBeNull();

    // Wrong code fails; correct code consumes.
    await expect(otp.verify('+447911123456', 'PHONE_SIGNUP', '000000')).rejects.toThrow(
      BadRequestException,
    );
    await otp.verify('+447911123456', 'PHONE_SIGNUP', delivered);
    expect(state.otps[0].consumedAt).not.toBeNull();
  });

  it('provider failure: code is burned, never falsely verifiable', async () => {
    withEnv({ NODE_ENV: 'production' });
    const { prisma, state } = makePrismaFake();
    const otp = new OtpService(prisma);
    otp.registerSender('sms', {
      channel: 'sms',
      send: async () => {
        throw new Error('SMS gateway timeout');
      },
    } as OneTimeCodeSender);

    await expect(otp.issue('+447911123456', 'PHONE_SIGNUP', 'sms')).rejects.toThrow(
      'Message delivery is not configured',
    );
    // The row was burned on failed delivery.
    expect(state.otps[0].consumedAt).not.toBeNull();
    // No unconsumed record remains, so any code is unverifiable.
    await expect(otp.verify('+447911123456', 'PHONE_SIGNUP', '123456')).rejects.toThrow(
      'Invalid or expired code',
    );
  });
});

describe('Phase 14 â€” Twilio SMS provider configuration (server-side only, fail-safe)', () => {
  it('SMS_PROVIDER=twilio with missing credentials fails safely in production (never a mock)', () => {
    withEnv({
      NODE_ENV: 'production',
      SMS_PROVIDER: 'twilio',
      SMS_ACCOUNT_SID: '',
      SMS_AUTH_TOKEN: '',
      SMS_FROM_NUMBER: '',
    });
    expect(() => createSmsCodeSender()).toThrow(ServiceUnavailableException);
    expect(() => createSmsCodeSender()).toThrow(
      /SMS_ACCOUNT_SID \/ SMS_AUTH_TOKEN \/ SMS_FROM_NUMBER/,
    );
  });

  it('SMS_PROVIDER=twilio with partial credentials also fails safely in development', () => {
    withEnv({
      NODE_ENV: 'development',
      SMS_PROVIDER: 'twilio',
      SMS_ACCOUNT_SID: 'ACTESTONLYFAKE',
      SMS_AUTH_TOKEN: '',
      SMS_FROM_NUMBER: '+15550001111',
    });
    expect(() => createSmsCodeSender()).toThrow(ServiceUnavailableException);
  });

  it('SMS_PROVIDER=twilio with full credentials selects the real Twilio adapter', () => {
    withEnv({
      NODE_ENV: 'production',
      SMS_PROVIDER: 'twilio',
      SMS_ACCOUNT_SID: 'ACTESTONLYFAKE',
      SMS_AUTH_TOKEN: 'fake-token-for-unit-test',
      SMS_FROM_NUMBER: '+15550001111',
    });
    const sender = createSmsCodeSender();
    expect(sender).toBeInstanceOf(TwilioSmsCodeSender);
    expect(sender.channel).toBe('sms');
  });

  it('SMS_PROVIDER unset/mock in production fails safely (no fake OTP success)', () => {
    withEnv({ NODE_ENV: 'production', SMS_PROVIDER: '' });
    expect(() => createSmsCodeSender()).toThrow(ServiceUnavailableException);
    expect(() => createSmsCodeSender()).toThrow('Message delivery is not configured');

    withEnv({ NODE_ENV: 'production', SMS_PROVIDER: 'unknown-provider' });
    expect(() => createSmsCodeSender()).toThrow(ServiceUnavailableException);
  });

  it('Twilio adapter posts the OTP to the Messages API with Basic auth and never leaks the Auth Token', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async () => ({ ok: true, status: 201 }) as any);

    const sender = new TwilioSmsCodeSender('ACTESTONLYFAKE', 'fake-token-for-unit-test', '+15550001111');
    await expect(sender.send('+447911123456', '123456', 'PHONE_SIGNUP')).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe(
      'https://api.twilio.com/2010-04-01/Accounts/ACTESTONLYFAKE/Messages.json',
    );
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    // Basic auth carries the credentials; the token never appears anywhere else.
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from('ACTESTONLYFAKE:fake-token-for-unit-test').toString('base64')}`,
    );
    const body = String(init.body);
    expect(body).toContain('To=%2B447911123456');
    expect(body).toContain('From=%2B15550001111');
    expect(body).toContain('123456');

    // The error path is the only message the caller sees â€” it must never
    // embed the credentials.
    fetchSpy.mockImplementationOnce(async () => ({ ok: false, status: 401 }) as any);
    try {
      await sender.send('+447911123456', '123456', 'PHONE_SIGNUP');
      throw new Error('expected the Twilio send to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as Error).message).toBe('SMS delivery failed');
      expect(String(error)).not.toContain('fake-token-for-unit-test');
      expect(String(error)).not.toContain('ACTESTONLYFAKE');
    }
  });

  it('Twilio adapter surfaces delivery failure as a safe 503 the OTP service can burn the code for', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      throw new TypeError('fetch failed');
    });

    const sender = new TwilioSmsCodeSender('ACTESTONLYFAKE', 'fake-token-for-unit-test', '+15550001111');
    await expect(sender.send('+447911123456', '123456', 'PHONE_SIGNUP')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});

describe('Phase 13 â€” EmailSender', () => {
  it('dev-log sender works outside production and refuses production', async () => {
    withEnv({ NODE_ENV: 'development', EMAIL_PROVIDER: '' });
    const dev = createEmailSender();
    expect(dev).toBeInstanceOf(DevLogEmailSender);
    await expect(dev.send({ to: 'a@b.c', subject: 's', body: 'b' })).resolves.toBeUndefined();

    withEnv({ NODE_ENV: 'production', EMAIL_PROVIDER: '' });
    await expect(
      new DevLogEmailSender().send({ to: 'a@b.c', subject: 's', body: 'b' }),
    ).rejects.toThrow('DevLogEmailSender must never run in production');
  });

  it('unconfigured provider in production fails safely via getEmailSender', () => {
    withEnv({ NODE_ENV: 'production', EMAIL_PROVIDER: '' });
    expect(() => getEmailSender()).toThrow(ServiceUnavailableException);
    expect(() => getEmailSender()).toThrow('Email delivery is not configured');
  });

  it('named provider without an implemented adapter fails safely', () => {
    withEnv({ NODE_ENV: 'production', EMAIL_PROVIDER: 'sendgrid' });
    expect(() => getEmailSender()).toThrow(ServiceUnavailableException);
    withEnv({ NODE_ENV: 'development', EMAIL_PROVIDER: 'sendgrid' });
    expect(() => getEmailSender()).toThrow(ServiceUnavailableException);
  });

  it('no secret-bearing variables are exposed through NEXT_PUBLIC_*', () => {
    const publicKeys = Object.keys(process.env).filter((k) => k.startsWith('NEXT_PUBLIC_'));
    for (const key of publicKeys) {
      expect(key).not.toMatch(/API_KEY|API_SECRET|SECRET|PASSWORD|TOKEN/i);
    }
  });
});

/**
 * Phase 17 — Twilio rejection diagnostics.
 *
 * A production 503 must be DIAGNOSABLE (status / Twilio code / Twilio
 * message) without ever becoming a secret leak: no Account SID, no Auth
 * Token, no Basic-auth header value, no OTP plaintext, no recipient number,
 * no unbounded provider body. The client-facing error stays generic.
 *
 * global.fetch is ALWAYS mocked here — these tests never call Twilio.
 */
describe('Phase 17 — Twilio rejection diagnostics (safe, never a secret leak)', () => {
  const SID = 'ACTESTONLYFAKE';
  const TOKEN = 'fake-token-for-unit-test';
  const TO = '+8801712345678';
  const CODE = '123456';

  function newSender(from = '+15550001111') {
    return new TwilioSmsCodeSender(SID, TOKEN, from);
  }

  /** Collects every log line the adapter emits, whatever the level. */
  function captureLogs() {
    const all: string[] = [];
    const collect = (...args: unknown[]) => {
      all.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
    };
    jest.spyOn(Logger.prototype, 'log').mockImplementation(collect);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(collect);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(collect);
    return all;
  }

  function mockResponse(init: { ok: boolean; status: number; body?: string }) {
    return jest.spyOn(global, 'fetch').mockImplementation(
      async () =>
        ({
          ok: init.ok,
          status: init.status,
          text: async () => init.body ?? '',
        }) as any,
    );
  }

  /** Fails the suite if any collected log line carries a forbidden value. */
  function expectNoSecrets(logs: string[]) {
    const output = logs.join('\n');
    expect(output).not.toContain(SID);
    expect(output).not.toContain(TOKEN);
    expect(output).not.toContain(Buffer.from(`${SID}:${TOKEN}`).toString('base64'));
    expect(output).not.toContain(CODE);
    expect(output).not.toContain(TO);
    expect(output).not.toContain('8801712345678');
  }

  it('1. Twilio 2xx resolves successfully and logs no rejection', async () => {
    mockResponse({ ok: true, status: 201 });
    const logs = captureLogs();

    await expect(newSender().send(TO, CODE, 'PHONE_SIGNUP')).resolves.toBeUndefined();

    const output = logs.join('\n');
    expect(output).not.toContain('Twilio SMS rejected');
    expectNoSecrets(logs);
  });

  it('2. Twilio 400 with a JSON error: safe 503, diagnostic log, no secrets', async () => {
    // Realistic Bangladesh sender rejection: Twilio quotes the numbers back.
    mockResponse({
      ok: false,
      status: 400,
      body: JSON.stringify({
        code: 21211,
        message: `The 'To' number ${TO} and the 'From' number +15550001111 are not a valid pair.`,
        more_info: 'https://www.twilio.com/docs/errors/21211',
        status: 400,
      }),
    });
    const logs = captureLogs();

    let thrown: unknown;
    try {
      await newSender().send(TO, CODE, 'PHONE_SIGNUP');
    } catch (error) {
      thrown = error;
    }

    // The client-facing contract is unchanged: a generic, safe 503.
    expect(thrown).toBeInstanceOf(ServiceUnavailableException);
    expect((thrown as Error).message).toBe('SMS delivery failed');
    expect((thrown as ServiceUnavailableException).getStatus()).toBe(503);

    // The operator finally sees WHY Twilio refused.
    const output = logs.join('\n');
    expect(output).toContain('Twilio SMS rejected: status=400 code=21211');
    expect(output).toContain('not a valid pair');

    // ...but never the credentials, the OTP or the recipient number.
    expectNoSecrets(logs);
  });

  it('3. Twilio 401 (bad Account SID / Auth Token) is reported with its code', async () => {
    mockResponse({
      ok: false,
      status: 401,
      body: JSON.stringify({ code: 20003, message: 'Authenticate', status: 401 }),
    });
    const logs = captureLogs();

    await expect(newSender().send(TO, CODE, 'PHONE_SIGNUP')).rejects.toThrow(
      'SMS delivery failed',
    );

    const output = logs.join('\n');
    expect(output).toContain('Twilio SMS rejected: status=401 code=20003');
    expect(output).toContain('Authenticate');
    expectNoSecrets(logs);
  });

  it('4. Twilio network failure yields a safe 503 and a transport-level log', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      throw new TypeError('fetch failed');
    });
    const logs = captureLogs();

    let thrown: unknown;
    try {
      await newSender().send(TO, CODE, 'PHONE_SIGNUP');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ServiceUnavailableException);
    expect((thrown as Error).message).toBe('SMS delivery failed');
    expect(logs.join('\n')).toContain('Twilio SMS request failed before a response');
    expectNoSecrets(logs);
  });

  it('5. Twilio malformed / non-JSON error body is logged as a bounded body', async () => {
    mockResponse({
      ok: false,
      status: 502,
      body: '<html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>',
    });
    const logs = captureLogs();

    await expect(newSender().send(TO, CODE, 'PHONE_SIGNUP')).rejects.toThrow(
      'SMS delivery failed',
    );

    const output = logs.join('\n');
    expect(output).toContain('Twilio SMS rejected: status=502 body=');
    // Non-JSON: there is no code= / message= pair to report.
    expect(output).not.toMatch(/Twilio SMS rejected: status=502 code=/);
    expectNoSecrets(logs);
  });

  it('5b. a huge non-JSON body is truncated to a safe short length', async () => {
    mockResponse({ ok: false, status: 500, body: 'x'.repeat(50_000) });
    const logs = captureLogs();

    await expect(newSender().send(TO, CODE, 'PHONE_SIGNUP')).rejects.toThrow(
      'SMS delivery failed',
    );

    const line = logs.find((l) => l.includes('Twilio SMS rejected'));
    expect(line).toBeDefined();
    // 500 characters of provider text plus the ellipsis marker.
    expect((line as string).length).toBeLessThan(600);
    expect(line).toContain('…');
  });

  it('5c. an empty error body still reports the status, never a fake code', async () => {
    mockResponse({ ok: false, status: 429 });
    const logs = captureLogs();

    await expect(newSender().send(TO, CODE, 'PHONE_SIGNUP')).rejects.toThrow(
      'SMS delivery failed',
    );

    const output = logs.join('\n');
    expect(output).toContain('Twilio SMS rejected: status=429 code=unknown');
    expectNoSecrets(logs);
  });

  it('6. missing-credential fail-safe still holds for a twilio config', () => {
    withEnv({
      NODE_ENV: 'production',
      SMS_PROVIDER: 'twilio',
      SMS_ACCOUNT_SID: '',
      SMS_AUTH_TOKEN: '',
      SMS_FROM_NUMBER: '',
    });
    expect(() => createSmsCodeSender()).toThrow(ServiceUnavailableException);
    expect(() => createSmsCodeSender()).toThrow(
      /SMS_ACCOUNT_SID \/ SMS_AUTH_TOKEN \/ SMS_FROM_NUMBER/,
    );
  });

  it('7. production fail-safe: a Twilio rejection burns the OTP and never fakes delivery', async () => {
    withEnv({
      NODE_ENV: 'production',
      SMS_PROVIDER: 'twilio',
      SMS_ACCOUNT_SID: SID,
      SMS_AUTH_TOKEN: TOKEN,
      SMS_FROM_NUMBER: '+15550001111',
    });
    mockResponse({
      ok: false,
      status: 400,
      body: JSON.stringify({ code: 21211, message: 'The requested resource is unavailable' }),
    });
    captureLogs();
    const { prisma, state } = makePrismaFake();
    const otp = new OtpService(prisma);

    await expect(otp.issue(TO, 'PHONE_SIGNUP', 'sms')).rejects.toThrow('SMS delivery failed');

    // Delivery failed => the code is burned and can never be verified.
    expect(state.otps[0].consumedAt).not.toBeNull();
    await expect(otp.verify(TO, 'PHONE_SIGNUP', CODE)).rejects.toThrow('Invalid or expired code');
  });

  it('8. an approved Alphanumeric Sender ID is passed to Twilio verbatim (never invented)', async () => {
    withEnv({
      NODE_ENV: 'production',
      SMS_PROVIDER: 'twilio',
      SMS_ACCOUNT_SID: SID,
      SMS_AUTH_TOKEN: TOKEN,
      // Bangladeshi destination: Twilio may require a pre-registered
      // alphanumeric sender ID instead of a phone number.
      SMS_FROM_NUMBER: 'TANVION',
    });
    const fetchSpy = mockResponse({ ok: true, status: 201 });

    await expect(createSmsCodeSender().send(TO, CODE, 'PHONE_SIGNUP')).resolves.toBeUndefined();

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(init.body)).toContain('From=TANVION');
    expect(String(init.body)).toContain('To=%2B8801712345678');
  });

  it('8b. an E.164 sender is still sent unchanged and is only labelled in logs', async () => {
    mockResponse({ ok: true, status: 201 });
    const logs = captureLogs();

    await newSender('+447700900123').send(TO, CODE, 'PHONE_SIGNUP');

    const output = logs.join('\n');
    expect(output).toContain('sender=e164');
    // The sender value itself is not logged.
    expect(output).not.toContain('+447700900123');
  });
});

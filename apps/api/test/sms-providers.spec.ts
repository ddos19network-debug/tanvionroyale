/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * MULTI-PROVIDER SMS DELIVERY (Twilio | Vonage | auto failover).
 *
 * External SMS APIs are ALWAYS mocked: these tests never send a real message.
 *
 * Covers, in order:
 *   1.  Twilio provider selected (env + Admin Panel selection)
 *   2.  Vonage provider selected
 *   3.  auto mode, primary (Twilio) succeeds
 *   4.  auto mode, primary fails and the fallback (Vonage) succeeds
 *   5.  auto mode, both providers fail -> the existing generic delivery error
 *   6.  missing Twilio configuration fails safely
 *   7.  missing Vonage configuration fails safely
 *   8.  an invalid provider name fails safely (never silently dropped)
 *   9.  an authorized Admin can read the provider configuration
 *  10.  an authorized Admin can change the provider selection
 *  11.  an unauthorized caller cannot read or change it (existing RBAC)
 *  12.  the admin view never contains a credential
 *  13.  OTP generation is unchanged by any provider
 *  14.  phone normalization is unchanged by any provider
 *  15.  OTP verification is unchanged by any provider
 *  16.  the failover reuses ONE code and never burns or re-issues an OTP
 */
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../src/common/decorators/permissions.decorator';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { normalizePhone } from '../src/common/utils/phone';
import { OtpService, type OneTimeCodeSender } from '../src/modules/auth/otp.service';
import {
  AutoFailoverSmsCodeSender,
  TwilioSmsCodeSender,
  VonageSmsCodeSender,
  createSmsCodeSender,
} from '../src/modules/auth/otp-sender.factory';
import { SmsProviderSettingsService } from '../src/modules/auth/sms-provider-settings.service';
import { AdminSmsProviderController } from '../src/modules/admin/admin-sms-provider.controller';
import { UpdateSmsProviderSettingsDto } from '../src/modules/admin/dto/admin-sms-provider.dto';
import { getSmsProviderConfigurationStatus } from '../src/modules/auth/sms-provider-config';
import { buildSmsOtpBody } from '../src/modules/auth/sms-provider-common';
import { makePrismaFake } from './helpers-phase11';

const ENV = process.env;

/** Obviously fake values — none of these is a real credential. */
const SID = 'ACTESTONLYFAKE';
const TOKEN = 'fake-twilio-token-for-unit-test';
const VONAGE_KEY = 'fake-vonage-key';
const VONAGE_SECRET = 'fake-vonage-secret-for-unit-test';
const TO = '+8801712345678';
const CODE = '123456';

const TWILIO_ENV = {
  SMS_ACCOUNT_SID: SID,
  SMS_AUTH_TOKEN: TOKEN,
  SMS_FROM_NUMBER: '+15550001111',
};
const VONAGE_ENV = {
  SMS_VONAGE_API_KEY: VONAGE_KEY,
  SMS_VONAGE_API_SECRET: VONAGE_SECRET,
  SMS_VONAGE_FROM: 'TANVION',
};

/** Every SMS provider environment variable, cleared. */
const CLEAN_SMS_ENV = {
  SMS_PROVIDER: '',
  SMS_PRIMARY_PROVIDER: '',
  SMS_FALLBACK_PROVIDER: '',
  SMS_ACCOUNT_SID: '',
  SMS_AUTH_TOKEN: '',
  SMS_FROM_NUMBER: '',
  SMS_TWILIO_ACCOUNT_SID: '',
  SMS_TWILIO_AUTH_TOKEN: '',
  SMS_TWILIO_FROM: '',
  SMS_VONAGE_API_KEY: '',
  SMS_VONAGE_API_SECRET: '',
  SMS_VONAGE_FROM: '',
};

afterEach(() => {
  process.env = ENV;
  jest.restoreAllMocks();
});

function withEnv(overrides: Record<string, string | undefined>) {
  process.env = { ...ENV, ...CLEAN_SMS_ENV, NODE_ENV: 'production', ...overrides };
}

/** Collects every log line any provider emits, whatever the level. */
function captureLogs(): string[] {
  const all: string[] = [];
  const collect = (...args: unknown[]) => {
    all.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  };
  jest.spyOn(Logger.prototype, 'log').mockImplementation(collect);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(collect);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(collect);
  return all;
}

/**
 * A queued fetch mock. Each entry answers ONE provider call, so a failover can
 * be scripted as "Twilio fails, then Vonage answers".
 */
function mockProviderResponses(
  responses: Array<{ ok: boolean; status: number; body?: string }>,
): jest.SpyInstance {
  let call = 0;
  return jest.spyOn(global, 'fetch').mockImplementation(async () => {
    const next = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return { ok: next.ok, status: next.status, text: async () => next.body ?? '' } as any;
  });
}

/** Vonage success: HTTP 200 with per-message status "0". */
const VONAGE_OK = {
  ok: true,
  status: 200,
  body: JSON.stringify({
    'message-count': '1',
    messages: [{ status: '0', 'message-id': '0A0000000123ABCD' }],
  }),
};

/** Vonage rejection: HTTP 200 but a non-zero per-message status. */
const VONAGE_REJECTED = {
  ok: true,
  status: 200,
  body: JSON.stringify({
    'message-count': '1',
    messages: [{ status: '4', 'error-text': 'Invalid credentials' }],
  }),
};

/** Twilio rejection (an unapproved sender for the destination). */
const TWILIO_REJECTED = {
  ok: false,
  status: 400,
  body: JSON.stringify({ code: 21211, message: 'The To/From pair is not valid' }),
};

/** A no-op sender used to assert the failover chain without any HTTP. */
function stubSender(behaviour: 'ok' | 'fail'): OneTimeCodeSender {
  return {
    channel: 'sms',
    send: async () => {
      if (behaviour === 'fail') throw new ServiceUnavailableException('SMS delivery failed');
    },
  } as OneTimeCodeSender;
}

/** In-memory Prisma fake for the SMS provider settings singleton. */
function makeSettingsFake() {
  const state: { row: Record<string, any> | null; auditLogs: Record<string, any>[] } = {
    row: null,
    auditLogs: [],
  };
  const prisma: any = {
    smsProviderSettings: {
      findUnique: jest.fn(async () => (state.row ? { ...state.row } : null)),
      upsert: jest.fn(async ({ create, update }: any) => {
        state.row = state.row
          ? { ...state.row, ...update, updatedAt: new Date() }
          : { ...create, updatedAt: new Date() };
        return { ...state.row };
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        state.auditLogs.push(data);
        return data;
      }),
    },
  };
  return { prisma, state };
}

describe('1. Twilio provider selected (unchanged behavior)', () => {
  it('SMS_PROVIDER=twilio selects the real Twilio adapter', () => {
    withEnv({ SMS_PROVIDER: 'twilio', ...TWILIO_ENV });
    const sender = createSmsCodeSender();
    expect(sender).toBeInstanceOf(TwilioSmsCodeSender);
    expect(sender.channel).toBe('sms');
  });

  it('an Admin Panel selection of twilio also selects the Twilio adapter', () => {
    withEnv({ ...TWILIO_ENV });
    const sender = createSmsCodeSender({
      smsProvider: 'twilio',
      primarySmsProvider: 'twilio',
      fallbackSmsProvider: 'vonage',
    });
    expect(sender).toBeInstanceOf(TwilioSmsCodeSender);
  });

  it('posts the unchanged OTP body to the Twilio Messages API', async () => {
    withEnv({ SMS_PROVIDER: 'twilio', ...TWILIO_ENV });
    const fetchSpy = mockProviderResponses([{ ok: true, status: 201 }]);
    const logs = captureLogs();

    await createSmsCodeSender().send(TO, CODE, 'PHONE_SIGNUP');

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe(
      'https://api.twilio.com/2010-04-01/Accounts/ACTESTONLYFAKE/Messages.json',
    );
    const body = new URLSearchParams(String(init.body));
    expect(body.get('Body')).toBe(buildSmsOtpBody(CODE, 'PHONE_SIGNUP'));
    expect(body.get('To')).toBe(TO);
    expect(logs.join('\n')).toContain('[SMS] provider=twilio result=success');
  });
});

describe('2. Vonage provider selected', () => {
  it('SMS_PROVIDER=vonage selects the real Vonage adapter', () => {
    withEnv({ SMS_PROVIDER: 'vonage', ...VONAGE_ENV });
    const sender = createSmsCodeSender();
    expect(sender).toBeInstanceOf(VonageSmsCodeSender);
  });

  it('an Admin Panel selection of vonage also selects the Vonage adapter', () => {
    withEnv({ ...VONAGE_ENV });
    const sender = createSmsCodeSender({
      smsProvider: 'vonage',
      primarySmsProvider: 'vonage',
      fallbackSmsProvider: 'twilio',
    });
    expect(sender).toBeInstanceOf(VonageSmsCodeSender);
  });

  it('posts the SAME OTP body to the Vonage SMS API with the canonical number', async () => {
    withEnv({ SMS_PROVIDER: 'vonage', ...VONAGE_ENV });
    const fetchSpy = mockProviderResponses([VONAGE_OK]);
    const logs = captureLogs();

    await expect(createSmsCodeSender().send(TO, CODE, 'PHONE_SIGNUP')).resolves.toBeUndefined();

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe('https://rest.nexmo.com/sms/json');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('text')).toBe(buildSmsOtpBody(CODE, 'PHONE_SIGNUP'));
    expect(body.get('to')).toBe('+8801712345678');
    expect(body.get('from')).toBe('TANVION');
    expect(logs.join('\n')).toContain('[SMS] provider=vonage result=success');
  });

  it('never logs the Vonage API key, secret, code or recipient', async () => {
    withEnv({ SMS_PROVIDER: 'vonage', ...VONAGE_ENV });
    mockProviderResponses([VONAGE_REJECTED]);
    const logs = captureLogs();

    await expect(createSmsCodeSender().send(TO, CODE, 'PHONE_SIGNUP')).rejects.toThrow(
      'SMS delivery failed',
    );

    const output = logs.join('\n');
    expect(output).toContain('[SMS] provider=vonage result=failed status=200 code=4');
    expect(output).toContain('Invalid credentials');
    for (const secret of [VONAGE_KEY, VONAGE_SECRET, CODE, TO, '8801712345678']) {
      expect(output).not.toContain(secret);
    }
  });

  it('treats a Vonage HTTP 200 with a non-zero message status as a failure', async () => {
    withEnv({ SMS_PROVIDER: 'vonage', ...VONAGE_ENV });
    mockProviderResponses([VONAGE_REJECTED]);
    let thrown: unknown;
    try {
      await createSmsCodeSender().send(TO, CODE, 'PHONE_SIGNUP');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ServiceUnavailableException);
    expect((thrown as Error).message).toBe('SMS delivery failed');
  });
});

describe('3. auto mode — the primary provider succeeds', () => {
  it('builds a failover sender and delivers through Twilio only', async () => {
    withEnv({ SMS_PROVIDER: 'auto', SMS_PRIMARY_PROVIDER: 'twilio', ...TWILIO_ENV, ...VONAGE_ENV });
    const sender = createSmsCodeSender();
    expect(sender).toBeInstanceOf(AutoFailoverSmsCodeSender);

    const fetchSpy = mockProviderResponses([{ ok: true, status: 201 }]);
    const logs = captureLogs();

    await expect(sender.send(TO, CODE, 'PHONE_SIGNUP')).resolves.toBeUndefined();

    // Exactly ONE provider call: the fallback is never touched on success.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('api.twilio.com');
    expect(logs.join('\n')).toContain('[SMS] provider=twilio result=success');
  });
});

describe('4. auto mode — the primary fails and the fallback succeeds', () => {
  it('attempts the fallback exactly once and reports success', async () => {
    withEnv({ SMS_PROVIDER: 'auto', ...TWILIO_ENV, ...VONAGE_ENV });
    const fetchSpy = mockProviderResponses([TWILIO_REJECTED, VONAGE_OK]);
    const logs = captureLogs();

    await expect(createSmsCodeSender().send(TO, CODE, 'PHONE_SIGNUP')).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('api.twilio.com');
    expect(String(fetchSpy.mock.calls[1][0])).toBe('https://rest.nexmo.com/sms/json');

    const output = logs.join('\n');
    expect(output).toContain('[SMS] primary=twilio failed, attempting fallback=vonage');
    expect(output).toContain('[SMS] fallback=vonage result=success');
    for (const secret of [SID, TOKEN, VONAGE_KEY, VONAGE_SECRET, CODE, TO]) {
      expect(output).not.toContain(secret);
    }
  });

  it('sends the SAME code and recipient to the fallback (no second OTP)', async () => {
    withEnv({ SMS_PROVIDER: 'auto', ...TWILIO_ENV, ...VONAGE_ENV });
    const fetchSpy = mockProviderResponses([TWILIO_REJECTED, VONAGE_OK]);

    await createSmsCodeSender().send(TO, CODE, 'PHONE_SIGNUP');

    const fallbackBody = new URLSearchParams(String(fetchSpy.mock.calls[1][1]?.body));
    expect(fallbackBody.get('to')).toBe(TO);
    expect(fallbackBody.get('text')).toBe(buildSmsOtpBody(CODE, 'PHONE_SIGNUP'));
  });
});

describe('5. auto mode — both providers fail', () => {
  it('returns the existing generic delivery error and burns the OTP once', async () => {
    withEnv({ SMS_PROVIDER: 'auto', ...TWILIO_ENV, ...VONAGE_ENV });
    const fetchSpy = mockProviderResponses([TWILIO_REJECTED, VONAGE_REJECTED]);
    const logs = captureLogs();
    const { prisma, state } = makePrismaFake();
    const otp = new OtpService(prisma);

    await expect(otp.issue(TO, 'PHONE_SIGNUP', 'sms')).rejects.toThrow('SMS delivery failed');

    // Exactly one attempt per provider: no retry storm.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(state.otps).toHaveLength(1);
    expect(state.otps[0].consumedAt).not.toBeNull();

    const output = logs.join('\n');
    expect(output).toContain('[SMS] primary=twilio failed, attempting fallback=vonage');
    expect(output).toContain('[SMS] fallback=vonage result=failed');
  });
});

describe('6-8. fail-safe configuration handling', () => {
  it('6. missing Twilio configuration fails safely (never a mock, never a fake success)', () => {
    withEnv({ SMS_PROVIDER: 'twilio', SMS_ACCOUNT_SID: '', SMS_AUTH_TOKEN: '', SMS_FROM_NUMBER: '' });
    expect(() => createSmsCodeSender()).toThrow(ServiceUnavailableException);
    expect(() => createSmsCodeSender()).toThrow(
      /SMS_ACCOUNT_SID \/ SMS_AUTH_TOKEN \/ SMS_FROM_NUMBER/,
    );
  });

  it('7. missing Vonage configuration fails safely', () => {
    withEnv({ SMS_PROVIDER: 'vonage', ...VONAGE_ENV, SMS_VONAGE_API_SECRET: '' });
    expect(() => createSmsCodeSender()).toThrow(ServiceUnavailableException);
    expect(() => createSmsCodeSender()).toThrow(
      /SMS_VONAGE_API_KEY \/ SMS_VONAGE_API_SECRET \/ SMS_VONAGE_FROM/,
    );
  });

  it('8. an unknown provider name fails safely and is never silently ignored', () => {
    withEnv({ SMS_PROVIDER: 'messagebird', ...TWILIO_ENV });
    expect(() => createSmsCodeSender()).toThrow(ServiceUnavailableException);
    expect(() => createSmsCodeSender()).toThrow(/Message delivery is not configured/);
  });

  it('8b. auto mode with no provider configured at all fails safely', () => {
    withEnv({ SMS_PROVIDER: 'auto' });
    expect(() => createSmsCodeSender()).toThrow(ServiceUnavailableException);
  });

  it('8c. unset provider in production still fails safely (unchanged)', () => {
    withEnv({ SMS_PROVIDER: '' });
    expect(() => createSmsCodeSender()).toThrow('Message delivery is not configured');
  });
});

describe('8d. provider configuration status (health check, no SMS is sent)', () => {
  it('reports both providers as configured only when every variable exists', () => {
    withEnv({ ...TWILIO_ENV, ...VONAGE_ENV });
    expect(getSmsProviderConfigurationStatus()).toEqual({
      twilio: { configured: true },
      vonage: { configured: true },
    });

    withEnv({ ...TWILIO_ENV });
    expect(getSmsProviderConfigurationStatus()).toEqual({
      twilio: { configured: true },
      vonage: { configured: false },
    });

    withEnv({});
    expect(getSmsProviderConfigurationStatus()).toEqual({
      twilio: { configured: false },
      vonage: { configured: false },
    });
  });

  it('never contacts a provider while reporting status', () => {
    withEnv({ ...TWILIO_ENV, ...VONAGE_ENV });
    const fetchSpy = jest.spyOn(global, 'fetch');
    getSmsProviderConfigurationStatus();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('9-12. Admin SMS provider configuration (read, change, authorize, no secrets)', () => {
  const ADMIN = { id: 'admin-1' } as any;

  it('9. an Admin can read the current configuration, sourced from the environment', async () => {
    withEnv({ SMS_PROVIDER: 'twilio', ...TWILIO_ENV, ...VONAGE_ENV });
    const { prisma } = makeSettingsFake();
    const view = await new SmsProviderSettingsService(prisma).getView();

    expect(view).toEqual({
      smsProvider: 'twilio',
      primarySmsProvider: 'twilio',
      fallbackSmsProvider: 'vonage',
      source: 'environment',
      twilio: { configured: true },
      vonage: { configured: true },
      updatedAt: null,
      updatedBy: null,
    });
  });

  it('10. an authorized Admin can change the provider and the change is persisted + audited', async () => {
    withEnv({ ...TWILIO_ENV, ...VONAGE_ENV });
    const { prisma, state } = makeSettingsFake();
    const service = new SmsProviderSettingsService(prisma);

    const view = await service.update(
      {
        smsProvider: 'auto',
        primarySmsProvider: 'twilio',
        fallbackSmsProvider: 'vonage',
      },
      ADMIN.id,
    );

    expect(view.smsProvider).toBe('auto');
    expect(view.source).toBe('database');
    expect(state.row).toMatchObject({
      id: 1,
      smsProvider: 'AUTO',
      primarySmsProvider: 'TWILIO',
      fallbackSmsProvider: 'VONAGE',
      updatedBy: 'admin-1',
    });
    expect(state.auditLogs[0]).toMatchObject({
      action: 'SMS_PROVIDER_SETTINGS_UPDATED',
      entityType: 'SmsProviderSettings',
      actorId: 'admin-1',
    });

    // A stored selection wins over the environment on the next delivery.
    const { prisma: otpPrisma } = makePrismaFake();
    const otp = new OtpService(otpPrisma, service);
    mockProviderResponses([{ ok: true, status: 201 }]);
    await expect(otp.issue(TO, 'PHONE_SIGNUP', 'sms')).resolves.toBeUndefined();
  });

  it('10b. switching the stored selection to vonage changes the delivering provider', async () => {
    withEnv({ ...TWILIO_ENV, ...VONAGE_ENV });
    const { prisma } = makeSettingsFake();
    const service = new SmsProviderSettingsService(prisma);
    await service.update(
      { smsProvider: 'vonage', primarySmsProvider: 'vonage', fallbackSmsProvider: 'twilio' },
      ADMIN.id,
    );

    const fetchSpy = mockProviderResponses([VONAGE_OK]);
    const { prisma: otpPrisma } = makePrismaFake();
    const otp = new OtpService(otpPrisma, service);
    await otp.issue(TO, 'PHONE_SIGNUP', 'sms');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe('https://rest.nexmo.com/sms/json');
  });

  it('10c. a same-provider failover is rejected instead of stored', async () => {
    withEnv({ ...TWILIO_ENV });
    const { prisma } = makeSettingsFake();
    const service = new SmsProviderSettingsService(prisma);
    await expect(
      service.update(
        { smsProvider: 'auto', primarySmsProvider: 'twilio', fallbackSmsProvider: 'twilio' },
        ADMIN.id,
      ),
    ).rejects.toThrow('The fallback provider must be different from the primary provider');
  });

  it('11. the routes require the existing staff role + capability metadata', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminSmsProviderController)).toEqual([
      'ADMIN',
      'SUPER_ADMIN',
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AdminSmsProviderController)).toEqual([
      ADMIN_PERMISSIONS.SETTINGS_READ,
    ]);
    for (const handler of ['updateSmsProvider', 'patchSmsProvider'] as const) {
      expect(
        Reflect.getMetadata(PERMISSIONS_KEY, AdminSmsProviderController.prototype[handler]),
      ).toEqual([ADMIN_PERMISSIONS.SETTINGS_WRITE]);
    }
  });

  it('11b. a USER, or a staff session without settings.write, is refused (403)', () => {
    const makeGuard = (required: string[], requiredPermissions: string[]) => {
      const reflector = {
        getAllAndOverride: jest.fn((key: string) =>
          key === ROLES_KEY
            ? required
            : key === PERMISSIONS_KEY
              ? requiredPermissions
              : undefined,
        ),
      } as unknown as Reflector;
      return new RolesGuard(reflector);
    };
    const context = (user: any) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
        getHandler: () => undefined,
        getClass: () => undefined,
      }) as any;

    const WRITE = [ADMIN_PERMISSIONS.SETTINGS_WRITE];

    // A plain customer can never reach an ADMIN/SUPER_ADMIN route.
    expect(() =>
      makeGuard(['ADMIN', 'SUPER_ADMIN'], WRITE).canActivate(
        context({ id: 'u1', roles: ['USER'] }),
      ),
    ).toThrow('Insufficient role');

    // A staff session missing the capability fails closed.
    expect(() =>
      makeGuard([], WRITE).canActivate(
        context({
          id: 'a1',
          roles: ['ADMIN'],
          sessionKind: 'STAFF',
          permissions: [ADMIN_PERMISSIONS.SETTINGS_READ],
        }),
      ),
    ).toThrow('Missing admin permission: settings.write');

    // The capability holder passes.
    expect(
      makeGuard([], WRITE).canActivate(
        context({
          id: 'a1',
          roles: ['ADMIN'],
          sessionKind: 'STAFF',
          permissions: [ADMIN_PERMISSIONS.SETTINGS_READ, ADMIN_PERMISSIONS.SETTINGS_WRITE],
        }),
      ),
    ).toBe(true);
  });

  it('12. the admin view never returns a credential of any provider', async () => {
    withEnv({ SMS_PROVIDER: 'auto', ...TWILIO_ENV, ...VONAGE_ENV });
    const { prisma } = makeSettingsFake();
    const service = new SmsProviderSettingsService(prisma);
    const view = await service.update(
      { smsProvider: 'auto', primarySmsProvider: 'twilio', fallbackSmsProvider: 'vonage' },
      ADMIN.id,
    );

    const serialized = JSON.stringify(view);
    for (const secret of [SID, TOKEN, VONAGE_KEY, VONAGE_SECRET, '+15550001111', 'TANVION']) {
      expect(serialized).not.toContain(secret);
    }
    for (const forbidden of ['authToken', 'apiSecret', 'apiKey', 'accountSid', 'password']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    // The frontend only receives availability information.
    expect(view.twilio).toEqual({ configured: true });
    expect(view.vonage).toEqual({ configured: true });
  });

  it('12b. the write DTO exposes no credential field at all', () => {
    const dto = new UpdateSmsProviderSettingsDto();
    expect(Object.keys(dto)).toEqual([]);
    expect(JSON.stringify({ ...dto, smsProvider: 'auto' })).toBe('{"smsProvider":"auto"}');
  });
});

describe('13-16. the OTP flow itself is unchanged by the provider', () => {
  it('13. the generated code is still 6 digits, hashed, single-use and 5-minute', async () => {
    withEnv({ SMS_PROVIDER: 'vonage', ...VONAGE_ENV });
    mockProviderResponses([VONAGE_OK]);
    const { prisma, state } = makePrismaFake();
    const otp = new OtpService(prisma);

    await otp.issue(TO, 'PHONE_SIGNUP', 'sms');

    expect(state.otps).toHaveLength(1);
    const row = state.otps[0];
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.consumedAt).toBeNull();
    // The unchanged 5-minute expiry window.
    const ttl = row.expiresAt.getTime() - row.lastSentAt.getTime();
    expect(ttl).toBe(5 * 60 * 1000);
  });

  it('15. verification still consumes the code exactly once', async () => {
    withEnv({ SMS_PROVIDER: 'vonage', ...VONAGE_ENV });
    let delivered = '';
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      delivered = new URLSearchParams(String(init?.body)).get('text') ?? '';
      return { ok: true, status: 200, text: async () => VONAGE_OK.body } as any;
    });

    const { prisma } = makePrismaFake();
    const otp = new OtpService(prisma);
    await otp.issue(TO, 'PHONE_VERIFY', 'sms');

    const code = /code is (\d{6})/.exec(delivered)?.[1] ?? '';
    expect(code).toMatch(/^\d{6}$/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await otp.verify(TO, 'PHONE_VERIFY', code);
    await expect(otp.verify(TO, 'PHONE_VERIFY', code)).rejects.toThrow('Invalid or expired code');
  });

  it('14. phone normalization is untouched by the provider selection', () => {
    // The canonical rules are provider-independent: the adapter only ever
    // receives the already-normalized E.164 identifier.
    expect(normalizePhone('01712345678')).toBe('+8801712345678');
    expect(normalizePhone('+8801712345678')).toBe('+8801712345678');
    expect(normalizePhone('008801712345678')).toBe('+8801712345678');
    expect(() => normalizePhone('0712345678')).toThrow(/valid Bangladesh mobile/);
  });

  it('16. a delivery failure burns the code whatever the provider was', async () => {
    withEnv({ SMS_PROVIDER: 'vonage', ...VONAGE_ENV });
    mockProviderResponses([VONAGE_REJECTED]);
    const { prisma, state } = makePrismaFake();
    const otp = new OtpService(prisma);

    await expect(otp.issue(TO, 'PHONE_SIGNUP', 'sms')).rejects.toThrow('SMS delivery failed');
    expect(state.otps[0].consumedAt).not.toBeNull();
  });

  it('16b. the failover sender never re-delivers a code after it was accepted', async () => {
    const primary = stubSender('ok');
    const fallback = jest.fn(stubSender('ok').send);
    const sender = new AutoFailoverSmsCodeSender(
      { name: 'twilio', sender: primary },
      { name: 'vonage', sender: { channel: 'sms', send: fallback } },
    );

    await sender.send(TO, CODE, 'PHONE_SIGNUP');

    expect(fallback).not.toHaveBeenCalled();
  });
});

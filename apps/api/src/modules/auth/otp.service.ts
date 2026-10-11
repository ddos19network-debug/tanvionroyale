import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes, randomInt } from 'crypto';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import { sha256 } from '../../common/utils/crypto';
import { createSmsCodeSender, createEmailCodeSender } from './otp-sender.factory';
import { SmsProviderSettingsService } from './sms-provider-settings.service';
import type { SmsProviderSelection } from './sms-provider-common';

/**
 * Phase 11 — one-time code (OTP) service.
 *
 * Security properties:
 * - Codes are generated with a CSPRNG (6 decimal digits).
 * - Only the sha256 hash is persisted; plaintext codes are never stored and
 *   never returned in API responses. They are logged ONLY in non-production
 *   through the mock sender.
 * - Short TTL, one-time use, per-code attempt limit, resend cooldown.
 * - Transport (SMS/email) is abstracted behind OneTimeCodeSender so real
 *   providers can be plugged in without touching this logic.
 */
export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

/** Abstraction over the delivery channel (SMS provider, email, ...). */
export interface OneTimeCodeSender {
  readonly channel: string;
  send(identifier: string, code: string, purpose: string): Promise<void>;
}

/** Development-only mock sender. Never enabled in production. */
export class MockCodeSender implements OneTimeCodeSender {
  readonly channel = 'mock';
  private readonly logger = new Logger(MockCodeSender.name);
  constructor(private readonly purpose: string) {}

  async send(_identifier: string, _code: string): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      // A production misconfiguration — the OtpService catches this send
      // failure, burns the code, and surfaces 503 (never a generic 500).
      throw new Error('Mock code sender must never run in production');
    }
    // Development convenience only. Never log the identifier or plaintext code;
    // delivery is simulated without creating a secret-bearing log record.
    this.logger.log(`[DEV ONLY] ${this.purpose} code delivery simulated`);
  }
}

@Injectable()
export class OtpService {
  private readonly senders = new Map<string, OneTimeCodeSender>();
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Optional so a unit test that news this service up with only the Prisma
    // dependency keeps compiling and behaving exactly as before. At runtime the
    // module always injects it, which is what lets the Admin Panel choose the
    // SMS provider without any change to the OTP rules below.
    @Optional() private readonly smsProviderSettings?: SmsProviderSettingsService,
  ) {}

  /** Registers (or replaces) the sender for a channel key, e.g. "sms", "email". */
  registerSender(key: string, sender: OneTimeCodeSender): void {
    this.senders.set(key, sender);
  }

  /**
   * The SMS provider SELECTION saved by the Admin Panel, or `null` to keep the
   * environment authoritative. Read per delivery so a provider switch takes
   * effect immediately on every instance. Any read failure degrades to the
   * environment rather than blocking an OTP.
   */
  private async smsProviderSelection(): Promise<SmsProviderSelection | null> {
    if (!this.smsProviderSettings) return null;
    try {
      return await this.smsProviderSettings.getSelection();
    } catch (error) {
      this.logger.warn(
        `sms provider selection unavailable, using the environment default (reason=${
          error instanceof Error ? error.name : 'unknown'
        })`,
      );
      return null;
    }
  }

  private async sender(channel: string): Promise<OneTimeCodeSender> {
    // An explicitly registered sender always wins (tests and any future
    // programmatic override), exactly as before.
    const registered = this.senders.get(channel);
    if (registered) return registered;
    if (channel === 'sms') {
      // Deliberately NOT cached: the provider selection is resolved per
      // delivery, so an Admin Panel switch takes effect immediately instead of
      // waiting for a restart. Resolving is a pure environment read plus, when
      // the admin saved a preference, one single-row lookup.
      return createSmsCodeSender(await this.smsProviderSelection());
    }
    if (channel === 'email') {
      // Real email delivery (EMAIL_PROVIDER=smtp) or the dev-only log sender.
      // Production without configuration fails safely and the OTP is burned.
      const email = createEmailCodeSender();
      this.senders.set(channel, email);
      return email;
    }
    if (process.env.NODE_ENV !== 'production') {
      const mock = new MockCodeSender(channel);
      this.senders.set(channel, mock);
      return mock;
    }
    throw new ServiceUnavailableException('Message delivery is not configured');
  }

  /** Issues a new one-time code, enforcing the resend cooldown. */
  async issue(
    identifier: string,
    purpose: 'PHONE_SIGNUP' | 'PHONE_VERIFY' | 'EMAIL_VERIFY' | 'PHONE_RECOVERY',
    channel: string,
  ): Promise<void> {
    const now = new Date();
    const latest = await this.prisma.otpCode.findFirst({
      where: { identifier, purpose, consumedAt: null },
      orderBy: { lastSentAt: 'desc' },
    });
    if (latest && now.getTime() - latest.lastSentAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
      throw new ConflictException('Please wait before requesting another code');
    }

    // Resolve the delivery sender BEFORE persisting anything. In production an
    // unconfigured channel fails safely here, before any code exists.
    const sender = await this.sender(channel);

    // Invalidate previous unconsumed codes for this (identifier, purpose).
    await this.prisma.otpCode.updateMany({
      where: { identifier, purpose, consumedAt: null },
      data: { consumedAt: now },
    });

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.otpCode.create({
      data: {
        identifier,
        purpose,
        codeHash: sha256(`${purpose}:${identifier}:${code}`),
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        lastSentAt: now,
      },
    });

    try {
      await sender.send(identifier, code, purpose);
    } catch (error) {
      // Delivery failed. Burn the just-created code so it can never be
      // verified, and surface a safe error instead of pretending the
      // message was sent. Never mark verification as successful here.
      this.logger.error(
        `OTP delivery failed (channel=${channel}, purpose=${purpose}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.prisma.otpCode.updateMany({
        where: { identifier, purpose, consumedAt: null, lastSentAt: now },
        data: { consumedAt: new Date() },
      });
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Message delivery is not configured');
    }
  }

  /**
   * Verifies and consumes a one-time code.
   * Throws safe, user-facing errors; never leaks whether an identifier exists.
   */
  async verify(
    identifier: string,
    purpose: 'PHONE_SIGNUP' | 'PHONE_VERIFY' | 'EMAIL_VERIFY' | 'PHONE_RECOVERY',
    code: string,
  ): Promise<void> {
    if (!/^\d{6}$/.test(code)) {
      throw new BadRequestException('Invalid code');
    }
    const record = await this.prisma.otpCode.findFirst({
      where: { identifier, purpose, consumedAt: null },
      orderBy: { lastSentAt: 'desc' },
    });
    if (!record || record.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired code');
    }
    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      throw new BadRequestException('Too many attempts. Request a new code.');
    }
    if (record.codeHash !== sha256(`${purpose}:${identifier}:${code}`)) {
      const attempts = record.attempts + 1;
      await this.prisma.otpCode.update({
        where: { id: record.id },
        data: {
          attempts,
          // Burn the code once the attempt budget is exhausted.
          ...(attempts >= OTP_MAX_ATTEMPTS ? { consumedAt: new Date() } : {}),
        },
      });
      throw new BadRequestException(
        attempts >= OTP_MAX_ATTEMPTS ? 'Too many attempts. Request a new code.' : 'Invalid code',
      );
    }

    await this.prisma.otpCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
  }

  // ------------------------------------------------------------------
  // Short-lived one-time OAuth exchange codes (frontend code-for-token).
  // Reuses the same hashed, single-use storage as OTPs.
  // ------------------------------------------------------------------

  async createExchangeCode(payload: Record<string, unknown>): Promise<string> {
    const code = randomBytes(32).toString('hex');
    await this.prisma.otpCode.create({
      data: {
        identifier: 'oauth-exchange',
        purpose: 'OAUTH_EXCHANGE',
        codeHash: sha256(code),
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        metadata: payload as Prisma.InputJsonValue,
      },
    });
    return code;
  }

  async consumeExchangeCode<T>(code: string): Promise<T> {
    const record = await this.prisma.otpCode.findFirst({
      where: { purpose: 'OAUTH_EXCHANGE', codeHash: sha256(code), consumedAt: null },
    });
    if (!record || record.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired authorization code');
    }
    await this.prisma.otpCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    return record.metadata as T;
  }
}

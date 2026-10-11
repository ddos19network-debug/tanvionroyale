import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { OneTimeCodeSender } from './otp.service';
import { SMS_DELIVERY_FAILED } from './sms-provider-common';

/**
 * AUTO FAILOVER SENDER (SMS_PROVIDER=auto).
 *
 * ONE LOGICAL DELIVERY ATTEMPT
 *   OtpService calls `send()` exactly once per issued code. This sender tries
 *   the primary provider and, ONLY if the provider itself failed, hands THE
 *   SAME identifier + THE SAME code + THE SAME purpose to the fallback. No
 *   second OTP is generated, none is burned between providers, and the caller's
 *   success/failure contract is unchanged: it resolves only when a provider
 *   accepted the message.
 *
 * EXACTLY ONE FALLBACK ATTEMPT
 *   There is no retry loop and no third provider: a failing provider is
 *   attempted once, the fallback once. Retrying storm is therefore impossible
 *   regardless of how the providers behave.
 *
 * NOTHING IS SWALLOWED
 *   The primary failure is never hidden: it is logged (provider name + the safe
 *   failure class) before the fallback runs, and the adapters themselves have
 *   already logged their own status/code diagnostics. If BOTH fail the caller
 *   gets the same generic 503 any single-provider failure produces, so a
 *   failover can never turn a delivery failure into a fake success.
 */

/** A named provider instance participating in the failover chain. */
export interface SmsProviderAttempt {
  readonly name: string;
  readonly sender: OneTimeCodeSender;
}

/** Real auto-failover sender: primary first, fallback exactly once. */
export class AutoFailoverSmsCodeSender implements OneTimeCodeSender {
  readonly channel = 'sms';
  private readonly logger = new Logger(AutoFailoverSmsCodeSender.name);

  constructor(
    private readonly primary: SmsProviderAttempt,
    private readonly fallback: SmsProviderAttempt,
  ) {}

  async send(identifier: string, code: string, purpose: string): Promise<void> {
    try {
      await this.primary.sender.send(identifier, code, purpose);
      return;
    } catch (error) {
      this.logger.warn(
        `[SMS] primary=${this.primary.name} failed, attempting fallback=${this.fallback.name} (reason=${
          error instanceof Error ? error.name : 'unknown'
        })`,
      );
    }

    try {
      await this.fallback.sender.send(identifier, code, purpose);
      this.logger.log(`[SMS] fallback=${this.fallback.name} result=success`);
      return;
    } catch (error) {
      this.logger.error(
        `[SMS] fallback=${this.fallback.name} result=failed (reason=${
          error instanceof Error ? error.name : 'unknown'
        })`,
      );
    }

    // Both providers refused the message. The client-facing error is the SAME
    // generic one every provider failure returns — never a provider name, a
    // status code or a credential.
    throw new ServiceUnavailableException(SMS_DELIVERY_FAILED);
  }
}

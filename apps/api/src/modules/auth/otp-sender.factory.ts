import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { OneTimeCodeSender } from './otp.service';
import { getEmailSender } from '../notifications/email-sender';
import {
  MAX_LOGGED_PROVIDER_BODY,
  MAX_LOGGED_PROVIDER_MESSAGE,
  SMS_DELIVERY_FAILED,
  boundLogText,
  buildSmsOtpBody,
  isRedactableSecret,
  purposeLabel,
  sanitizeProviderText,
  smsDeliveryLogLine,
  type SmsProviderName,
  type SmsProviderSelection,
} from './sms-provider-common';
import {
  normalizeSmsProviderSelection,
  readSmsProviderSelectionFromEnv,
  readTwilioCredentials,
  readVonageCredentials,
} from './sms-provider-config';
import { VonageSmsCodeSender } from './vonage-sms-code-sender';
import {
  AutoFailoverSmsCodeSender,
  type SmsProviderAttempt,
} from './auto-failover-sms-code-sender';

// Re-exported so every SMS provider can be imported from ONE place (the
// factory), which is also where the existing Twilio adapter is exported from.
export { VonageSmsCodeSender } from './vonage-sms-code-sender';
export { AutoFailoverSmsCodeSender } from './auto-failover-sms-code-sender';
export type { SmsProviderAttempt } from './auto-failover-sms-code-sender';

/**
 * SMS/OTP delivery factory (Phase 14 fail-safe + Phase 16 hardening +
 * Phase 17 Twilio rejection diagnostics + multi-provider SMS delivery).
 *
 * PROVIDER-AGNOSTIC BY CONSTRUCTION
 *   `createSmsCodeSender()` resolves ONE sender for the SMS channel from the
 *   operator's selection: Twilio, Vonage, or an automatic primary -> fallback
 *   chain. Every adapter builds the same OTP body (sms-provider-common) and
 *   raises the same generic client error, so adding a provider never touches
 *   OTP generation, expiry, verification, phone normalization or rate limiting.
 *
 *   Twilio remains the historical, fully working provider and keeps its own
 *   adapter and diagnostics; Vonage was added alongside it, never in place of
 *   it.
 *
 * Production NEVER falls back to a mock sender: unset/mock/unknown
 * providers fail safely with ServiceUnavailableException so the signup flow
 * reports "SMS delivery is not configured" instead of faking delivery.
 *
 * When a real provider is configured (e.g. SMS_PROVIDER=twilio), the
 * real adapter is used with credentials from the environment (never source,
 * never NEXT_PUBLIC_* variables).
 *
 * DIAGNOSTICS (Phase 17)
 *   A provider rejection is reported with the provider's OWN answer -- HTTP
 *   status, provider error code and provider error message -- so an incident can
 *   be diagnosed from the logs instead of guessing (bad credentials, an
 *   unapproved sender, a destination the provider will not serve, a restriction
 *   or an out-of-balance account). The client still receives the generic
 *   "SMS delivery failed": provider detail never reaches the frontend.
 *
 *   NEVER logged: Account SID, Auth Token, Vonage API key/secret, the
 *   Authorization header value, the one-time code, the request body, or the
 *   recipient number (masked through the canonical scrubPhoneFromMessage()
 *   helper).
 */

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

/**
 * The Twilio-specific aliases below are THIN WRAPPERS over the shared,
 * provider-agnostic helpers in `sms-provider-common`. The redaction rules
 * (secret removal + phone masking + length bounding) are now defined exactly
 * once for every SMS provider, so Vonage is covered by the same guarantees
 * Twilio has always had, without this file re-implementing them.
 */

/** Removes secrets and phone numbers from Twilio-controlled text (shared rule). */
function sanitizeTwilioText(raw: string, secrets: readonly string[]): string {
  return sanitizeProviderText(raw, secrets);
}

/**
 * Shape of the configured Twilio sender, used ONLY for a one-time log label so
 * a misconfigured sender can be told apart from a rejected one. The value is
 * never logged. Deliberately permissive — whether a sender is usable is
 * Twilio's decision, not this adapter's — and NOT a validation gate, so an
 * approved Alphanumeric Sender ID is passed to Twilio exactly as configured.
 */
function describeSenderShape(sender: string): string {
  const value = sender.trim();
  if (/^\+[1-9]\d{6,14}$/.test(value)) return 'e164';
  if (/^[A-Za-z][A-Za-z0-9 ._-]{0,31}$/.test(value)) return 'alphanumeric';
  return 'unrecognized';
}

/** Real Twilio SMS adapter -- the only concrete production SMS adapter. */
export class TwilioSmsCodeSender implements OneTimeCodeSender {
  readonly channel = 'sms';
  private readonly logger = new Logger(TwilioSmsCodeSender.name);

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    /**
     * The Twilio `From` value. Deliberately NOT restricted to a phone number:
     * destinations such as Bangladesh may require an APPROVED Alphanumeric
     * Sender ID, so whatever the operator configured in SMS_FROM_NUMBER is
     * passed through verbatim. Nothing is invented or defaulted here.
     */
    private readonly from: string,
  ) {}

  async send(identifier: string, code: string, purpose: string): Promise<void> {
    const url = `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`;
    const body = new URLSearchParams({
      To: identifier,
      // Configured sender, unchanged: an E.164 number OR an approved
      // Alphanumeric Sender ID required by some destinations.
      From: this.from,
      // The identical OTP body every SMS provider sends (shared builder), so
      // switching provider changes WHO delivers the code, never WHAT it says.
      Body: buildSmsOtpBody(code, purpose),
    });
    // Everything that must never reach a log line. The request body (which
    // embeds the code) is never logged; the code and the recipient number are
    // redacted defensively in case the provider echoes them back.
    const secrets = [
      this.accountSid,
      this.authToken,
      Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64'),
      code,
      identifier,
    ].filter(isRedactableSecret);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
        },
        body: body.toString(),
        signal: controller.signal,
      });

      if (!res.ok) {
        // Non-2xx: surface Twilio's OWN answer (status / code / message) so the
        // rejection can be diagnosed, then fall through to the safe 503.
        await this.logTwilioRejection(res, secrets);
      } else {
        this.logger.log(
          `Twilio SMS accepted (status=${res.status}, sender=${describeSenderShape(this.from)})`,
        );
        // Canonical, operator-facing one-line summary (never carries a value).
        this.logger.log(smsDeliveryLogLine('twilio', 'success'));
        return;
      }
    } catch (error) {
      // Transport-level failure (DNS/TLS/abort/offline): no provider payload
      // exists, so log the failure class only — never credentials or the code.
      this.logger.error(
        `Twilio SMS request failed before a response (reason=${
          error instanceof Error ? error.name : 'unknown'
        })`,
      );
    } finally {
      clearTimeout(timeout);
    }

    // The client-facing error stays generic and safe in EVERY failure mode;
    // OtpService then burns the just-issued code and surfaces the 503.
    throw new ServiceUnavailableException(SMS_DELIVERY_FAILED);
  }

  /**
   * Reads the Twilio error response safely (reading a body can itself fail),
   * parses it when it is JSON, and logs ONLY non-secret diagnostics:
   * status, Twilio error code, Twilio error message. Never the credentials,
   * never the code, never the recipient, never an unbounded body.
   */
  private async logTwilioRejection(
    res: Response,
    secrets: readonly string[],
  ): Promise<void> {
    const status = typeof res?.status === 'number' ? res.status : 0;

    let raw = '';
    try {
      // `text` is optional so a minimal (or mocked) Response cannot break us.
      const text =
        typeof (res as Response | undefined)?.text === 'function' ? await res.text() : '';
      raw = typeof text === 'string' ? text : '';
    } catch {
      // Body unavailable (aborted stream, unreadable body): report the status
      // alone rather than a body we could not safely read.
      raw = '';
    }

    const trimmed = raw.trim();
    if (!trimmed) {
      this.logger.error(
        `Twilio SMS rejected: status=${status} code=unknown message="(no error body returned)"`,
      );
      return;
    }

    // A body that is NOT valid JSON (HTML error page, proxy text, truncated
    // payload) is still worth having — but bounded, so an arbitrary or huge
    // provider response can never flood the log.
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      this.logger.error(
        `Twilio SMS rejected: status=${status} body=${boundLogText(
          sanitizeTwilioText(trimmed, secrets),
          MAX_LOGGED_PROVIDER_BODY,
        )}`,
      );
      return;
    }

    const detail = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<
      string,
      unknown
    >;
    const { code, message } = detail;
    this.logger.error(
      `Twilio SMS rejected: status=${status} code=${
        typeof code === 'number' || typeof code === 'string' ? String(code) : 'unknown'
      } message="${boundLogText(
        sanitizeTwilioText(typeof message === 'string' ? message : '', secrets),
        MAX_LOGGED_PROVIDER_MESSAGE,
      )}"`,
    );
  }
}

/** Development-only SMS sender. Logs the code server-side; NEVER in production. */
class DevLogSmsCodeSender implements OneTimeCodeSender {
  readonly channel = 'sms';
  private readonly logger = new Logger('DevLogSmsCodeSender');

  async send(_identifier: string, _code: string, purpose: string): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException('Message delivery is not configured');
    }
    // Do not log the identifier or plaintext code, even in development.
    this.logger.log(`[DEV ONLY] ${purpose} SMS delivery simulated`);
  }
}

/**
 * Builds ONE concrete provider adapter, or throws a safe 503 when that
 * provider's environment credentials are incomplete. Every message is a
 * VARIABLE NAME only — a missing SID, key or sender is named, never a value.
 */
function buildSmsProviderAttempt(provider: SmsProviderName): SmsProviderAttempt {
  if (provider === 'twilio') {
    const { accountSid, authToken, from } = readTwilioCredentials();
    // SMS_FROM_NUMBER is the Twilio `From` SENDER value. It is intentionally
    // NOT validated as a phone number: Twilio accepts either an E.164 number
    // OR an approved Alphanumeric Sender ID (e.g. Bangladesh), and only the
    // account owner knows which one Twilio has approved. The value is passed
    // through verbatim — never guessed, never defaulted, never invented here.
    if (!accountSid || !authToken || !from) {
      throw new ServiceUnavailableException(
        'SMS_PROVIDER is set to "twilio" but SMS_ACCOUNT_SID / SMS_AUTH_TOKEN / SMS_FROM_NUMBER are not all configured',
      );
    }
    return { name: 'twilio', sender: new TwilioSmsCodeSender(accountSid, authToken, from) };
  }

  const { apiKey, apiSecret, from } = readVonageCredentials();
  if (!apiKey || !apiSecret || !from) {
    throw new ServiceUnavailableException(
      'SMS_PROVIDER is set to "vonage" but SMS_VONAGE_API_KEY / SMS_VONAGE_API_SECRET / SMS_VONAGE_FROM are not all configured',
    );
  }
  return { name: 'vonage', sender: new VonageSmsCodeSender(apiKey, apiSecret, from) };
}

/** Build one provider, or `null` when that provider is not configured. */
function tryBuildSmsProviderAttempt(provider: SmsProviderName): SmsProviderAttempt | null {
  try {
    return buildSmsProviderAttempt(provider);
  } catch {
    return null;
  }
}

/**
 * AUTO MODE: primary first, fallback exactly once.
 *
 * Degradation is deliberate but NEVER silent: if only one side of the pair is
 * configured, the missing side is logged and the configured provider is used on
 * its own (failing over to a provider with no credentials could only fail).
 */
function buildAutoFailoverSender(selection: SmsProviderSelection): OneTimeCodeSender {
  const logger = new Logger('SmsProviderAuto');
  const primary = tryBuildSmsProviderAttempt(selection.primarySmsProvider);
  const fallback = tryBuildSmsProviderAttempt(selection.fallbackSmsProvider);

  if (!primary && !fallback) {
    throw new ServiceUnavailableException(
      `SMS provider "auto" is selected but neither ${selection.primarySmsProvider} nor ${selection.fallbackSmsProvider} is configured`,
    );
  }
  if (!primary && fallback) {
    logger.warn(
      `[SMS] primary=${selection.primarySmsProvider} is not configured, using fallback=${selection.fallbackSmsProvider}`,
    );
    return fallback.sender;
  }
  if (primary && !fallback) {
    logger.warn(
      `[SMS] fallback=${selection.fallbackSmsProvider} is not configured, using primary=${selection.primarySmsProvider} only`,
    );
    return primary.sender;
  }
  return new AutoFailoverSmsCodeSender(primary as SmsProviderAttempt, fallback as SmsProviderAttempt);
}

/**
 * Returns the configured SMS sender or fails safely (never mocks in production).
 *
 * PRECEDENCE (unchanged for an existing Twilio deployment)
 *   1. An Admin Panel selection, when one has been stored (the admin setting
 *      wins, because it is the operator's most recent, explicit decision).
 *   2. Otherwise `SMS_PROVIDER` from the environment, exactly as before.
 *
 * SUPPORTED PROVIDER VALUES
 *   twilio -> Twilio only, vonage -> Vonage only, auto -> primary then fallback
 *   (SMS_PRIMARY_PROVIDER / SMS_FALLBACK_PROVIDER), unset/mock -> the historic
 *   behavior (safe 503 in production, dev-only log sender elsewhere).
 *
 * FAIL-SAFE
 *   Unknown provider names and incomplete credentials still fail safely with
 *   ServiceUnavailableException, so a code is never silently dropped.
 */
export function createSmsCodeSender(selection?: SmsProviderSelection | null): OneTimeCodeSender {
  let envSelection: SmsProviderSelection | null;
  try {
    envSelection = readSmsProviderSelectionFromEnv();
  } catch {
    // Unknown provider names also fail safely -- never silently drop the code.
    const provider = (process.env.SMS_PROVIDER ?? '').trim().toLowerCase();
    throw new ServiceUnavailableException(
      `SMS provider "${provider}" is configured but no adapter is implemented yet. Message delivery is not configured.`,
    );
  }

  // The Admin Panel has not stored a preference: keep the environment exactly
  // as authoritative as it has always been.
  if (!selection) {
    if (!envSelection) {
      if (process.env.NODE_ENV === 'production') {
        throw new ServiceUnavailableException('Message delivery is not configured');
      }
      return new DevLogSmsCodeSender();
    }
    if (envSelection.smsProvider === 'auto') {
      return buildAutoFailoverSender(normalizeSmsProviderSelection(envSelection));
    }
    return buildSmsProviderAttempt(envSelection.primarySmsProvider).sender;
  }

  const effective = normalizeSmsProviderSelection(selection);
  if (effective.smsProvider === 'auto') {
    return buildAutoFailoverSender(effective);
  }
  return buildSmsProviderAttempt(effective.primarySmsProvider).sender;
}

// ---------------------------------------------------------------------------
// Email OTP channel. The OTP email is delivered through the shared EmailSender
// abstraction (notifications/email-sender), so EMAIL_PROVIDER=smtp yields real
// SMTP delivery (nodemailer) for verification OTPs AND the legacy email
// verification link alike. Recipients can be any address (e.g. user@gmail.com);
// the SMTP sender account is the application account configured by the owner.
// ---------------------------------------------------------------------------

/** Professional OTP email body shared by every purpose. */
export function otpEmailBody(code: string, purpose: string): string {
  const label = purpose === 'EMAIL_VERIFY' ? 'verification' : purposeLabel(purpose);
  return [
    'Hello,',
    '',
    `Your TANVIONROYALE ${label} code is:`,
    '',
    code,
    '',
    'This code expires in 5 minutes.',
    '',
    'If you did not request this code, you can safely ignore this email.',
    '',
    'Never share this code with anyone.',
    '',
    'TANVIONROYALE',
  ].join('\n');
}

/** Development-only email OTP sender. Logs the code server-side; NEVER in production. */
class DevLogEmailCodeSender implements OneTimeCodeSender {
  readonly channel = 'email';
  private readonly logger = new Logger('DevLogEmailCodeSender');

  async send(_identifier: string, _code: string, purpose: string): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException('Email delivery is not configured');
    }
    // Do not log the identifier or plaintext code, even in development.
    this.logger.log(`[DEV ONLY] ${purpose} email delivery simulated`);
  }
}

/**
 * Real email OTP adapter. Delegates to the configured EmailSender, so the
 * fail-safe rules live in exactly one place (notifications/email-sender):
 * EMAIL_PROVIDER unset/mock in production -> ServiceUnavailableException,
 * EMAIL_PROVIDER=smtp -> nodemailer SMTP delivery.
 */
export class EmailCodeSender implements OneTimeCodeSender {
  readonly channel = 'email';

  async send(identifier: string, code: string, purpose: string): Promise<void> {
    // getEmailSender() throws the safe ServiceUnavailableException("Email
    // delivery is not configured") when nothing is configured; OtpService then
    // burns the just-created code instead of pretending an email was sent.
    await getEmailSender().send({
      to: identifier,
      subject: 'Your TANVIONROYALE verification code',
      body: otpEmailBody(code, purpose),
    });
  }
}

/** Returns the configured email OTP sender or fails safely (never mocks in production). */
export function createEmailCodeSender(): OneTimeCodeSender {
  const provider = (process.env.EMAIL_PROVIDER ?? '').trim().toLowerCase();

  if (!provider || provider === 'mock') {
    if (process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException('Email delivery is not configured');
    }
    return new DevLogEmailCodeSender();
  }

  if (provider === 'smtp') {
    return new EmailCodeSender();
  }

  // Unknown provider names also fail safely -- never silently drop the code.
  throw new ServiceUnavailableException(
    `Email provider "${provider}" is configured but no adapter is implemented yet. Email delivery is not configured.`,
  );
}
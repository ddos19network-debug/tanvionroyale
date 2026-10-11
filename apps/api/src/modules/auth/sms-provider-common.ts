import { scrubPhoneFromMessage } from '../../common/utils/phone';

/**
 * SHARED SMS PROVIDER PRIMITIVES (multi-provider SMS delivery).
 *
 * Everything in this file is provider-AGNOSTIC on purpose: the Twilio and the
 * Vonage adapters both build the SAME OTP body through `buildSmsOtpBody()` and
 * both redact provider text through the SAME helpers, so adding a third
 * provider can never introduce a second (drifting) copy of the rules that keep
 * secrets, OTPs and recipient numbers out of the log.
 *
 * This module deliberately has NO NestJS and NO provider dependency: it can be
 * imported by the factory, by the admin settings service and by unit tests
 * without creating an import cycle.
 */

/** The ONLY message a client ever receives for a failed SMS delivery. */
export const SMS_DELIVERY_FAILED = 'SMS delivery failed';

/** Concrete SMS providers that can be selected. */
export const SMS_PROVIDER_NAMES = ['twilio', 'vonage'] as const;
export type SmsProviderName = (typeof SMS_PROVIDER_NAMES)[number];

/** Provider selection modes: a single provider, or primary + fallback. */
export const SMS_PROVIDER_MODES = ['twilio', 'vonage', 'auto'] as const;
export type SmsProviderMode = (typeof SMS_PROVIDER_MODES)[number];

/**
 * Recommended defaults, applied when neither the Admin Panel nor the
 * environment states a preference. Twilio first (the historical, already
 * working provider) with Vonage as the failover target.
 */
export const DEFAULT_SMS_PROVIDER_MODE: SmsProviderMode = 'twilio';
export const DEFAULT_PRIMARY_SMS_PROVIDER: SmsProviderName = 'twilio';
export const DEFAULT_FALLBACK_SMS_PROVIDER: SmsProviderName = 'vonage';

/** Type guard for a concrete provider name (used by every inbound validator). */
export function isSmsProviderName(value: unknown): value is SmsProviderName {
  return (
    typeof value === 'string' && (SMS_PROVIDER_NAMES as readonly string[]).includes(value)
  );
}

/** Type guard for a provider selection mode. */
export function isSmsProviderMode(value: unknown): value is SmsProviderMode {
  return (
    typeof value === 'string' && (SMS_PROVIDER_MODES as readonly string[]).includes(value)
  );
}

/**
 * The provider SELECTION only — never a credential, never an env value. This is
 * what the Admin Panel persists and what the delivery factory resolves against.
 */
export interface SmsProviderSelection {
  smsProvider: SmsProviderMode;
  primarySmsProvider: SmsProviderName;
  fallbackSmsProvider: SmsProviderName;
}

/**
 * Per-provider configuration status. Deliberately a BOOLEAN and nothing else:
 * the Admin Panel only needs to know whether a provider is usable, and a value
 * (an Account SID, an API key) must never leave the server.
 */
export interface SmsProviderConfigurationStatus {
  twilio: { configured: boolean };
  vonage: { configured: boolean };
}

/** Human label for an OTP purpose, shared by every provider's message body. */
export function purposeLabel(purpose: string): string {
  switch (purpose) {
    case 'PHONE_SIGNUP':
      return 'signup';
    case 'PHONE_VERIFY':
      return 'verification';
    case 'PHONE_RECOVERY':
      return 'account recovery';
    case 'EMAIL_VERIFY':
      return 'email verification';
    default:
      return 'verification';
  }
}

/**
 * THE SMS OTP MESSAGE. Byte-for-byte the message Twilio sends today, so a
 * provider switch changes WHO delivers the code and never WHAT the customer
 * reads. The code itself is passed in by the caller (OtpService) and is never
 * generated, re-generated or stored by a provider adapter.
 */
export function buildSmsOtpBody(code: string, purpose: string): string {
  return `Your TANVIONROYALE ${purposeLabel(purpose)} code is ${code}. It expires in 5 minutes. Never share it with anyone.`;
}

/**
 * Caps on provider-controlled text copied into a log line. Provider error copy
 * is untrusted input, so it is always bounded before it reaches the log.
 */
export const MAX_LOGGED_PROVIDER_MESSAGE = 300;
export const MAX_LOGGED_PROVIDER_BODY = 500;

/** True when the value is long enough to be a secret worth redacting. */
export function isRedactableSecret(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 4;
}

/** Hard cap for any sanitized text copied into a log line. */
export function boundLogText(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * Removes every known secret from provider text, then masks anything
 * phone-shaped (providers happily quote the number back in error copy).
 * Runs BEFORE length-bounding, so a truncated value can never expose a
 * partial secret either.
 */
export function sanitizeProviderText(raw: string, secrets: readonly string[]): string {
  let out = raw;
  for (const secret of secrets) {
    if (!isRedactableSecret(secret)) continue;
    out = out.split(secret).join('[redacted]');
  }
  return scrubPhoneFromMessage(out);
}

/**
 * A single safe log line describing a delivery attempt, in the canonical
 * operator-facing format. It carries the provider name, the outcome and — for a
 * failure — the provider's own HTTP status / error code. It never carries a
 * credential, a code or a recipient number.
 */
export function smsDeliveryLogLine(
  provider: string,
  result: 'success' | 'failed',
  detail?: { status?: number | string; code?: number | string },
): string {
  const base = `[SMS] provider=${provider} result=${result}`;
  if (result !== 'failed' || !detail) return base;
  const status = detail.status === undefined || detail.status === '' ? 'unknown' : detail.status;
  const code = detail.code === undefined || detail.code === '' ? 'unknown' : detail.code;
  return `${base} status=${status} code=${code}`;
}

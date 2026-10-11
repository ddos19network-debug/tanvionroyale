import {
  DEFAULT_FALLBACK_SMS_PROVIDER,
  DEFAULT_PRIMARY_SMS_PROVIDER,
  type SmsProviderConfigurationStatus,
  type SmsProviderName,
  type SmsProviderSelection,
  isSmsProviderName,
} from './sms-provider-common';

/**
 * SMS PROVIDER CONFIGURATION (server-side, environment only).
 *
 * This module is the ONLY place that reads SMS provider environment variables.
 * It resolves a SELECTION (which provider, and in which order) and reports
 * whether a provider is CONFIGURED. It never returns a credential value, so it
 * is safe to use from the Admin API, and it contains no provider transport so
 * the delivery factory can depend on it without an import cycle.
 *
 * CREDENTIALS STAY SERVER-SIDE
 *   Nothing here is ever serialized to a response, a log line or the frontend.
 *   `isSmsProviderConfigured()` is a boolean derived from the PRESENCE of the
 *   variables and is the only thing the Admin Panel ever sees about them.
 */

/** Reads a trimmed environment value. */
function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

/**
 * Reads the FIRST non-empty value from a list of accepted variable names.
 * Aliases exist so an existing deployment never has to be renamed: the historic
 * `SMS_*` names keep working and the provider-scoped names are only consulted
 * when the primary one is absent.
 */
function firstEnv(...names: string[]): string {
  for (const name of names) {
    const value = env(name);
    if (value) return value;
  }
  return '';
}

/** Twilio credentials, or empty strings when the provider is not configured. */
export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
  from: string;
}

/**
 * TWILIO CREDENTIALS - BACKWARD COMPATIBLE.
 * `SMS_ACCOUNT_SID` / `SMS_AUTH_TOKEN` / `SMS_FROM_NUMBER` remain the primary
 * (and already documented) names; the provider-scoped aliases are used ONLY
 * when the primary one is absent, so no existing deployment changes behavior.
 */
export function readTwilioCredentials(): TwilioCredentials {
  return {
    accountSid: firstEnv('SMS_ACCOUNT_SID', 'SMS_TWILIO_ACCOUNT_SID'),
    authToken: firstEnv('SMS_AUTH_TOKEN', 'SMS_TWILIO_AUTH_TOKEN'),
    from: firstEnv('SMS_FROM_NUMBER', 'SMS_TWILIO_FROM'),
  };
}

/** Vonage credentials, or empty strings when the provider is not configured. */
export interface VonageCredentials {
  apiKey: string;
  apiSecret: string;
  from: string;
}

/**
 * VONAGE CREDENTIALS.
 * `SMS_VONAGE_API_KEY` / `SMS_VONAGE_API_SECRET` / `SMS_VONAGE_FROM` are the
 * documented names; the bare `VONAGE_*` spellings are accepted as aliases for
 * operators who prefer Vonage's own naming.
 */
export function readVonageCredentials(): VonageCredentials {
  return {
    apiKey: firstEnv('SMS_VONAGE_API_KEY', 'VONAGE_API_KEY'),
    apiSecret: firstEnv('SMS_VONAGE_API_SECRET', 'VONAGE_API_SECRET'),
    from: firstEnv('SMS_VONAGE_FROM', 'VONAGE_FROM'),
  };
}

/**
 * Safe configuration probe (Phase 8). A provider is "configured" only when
 * EVERY required variable exists - it never contacts the provider, never sends
 * a test SMS and never reveals a value.
 */
export function isSmsProviderConfigured(provider: SmsProviderName): boolean {
  if (provider === 'twilio') {
    const { accountSid, authToken, from } = readTwilioCredentials();
    return Boolean(accountSid && authToken && from);
  }
  const { apiKey, apiSecret, from } = readVonageCredentials();
  return Boolean(apiKey && apiSecret && from);
}

/** Both providers' configuration status, safe to expose to an Admin. */
export function getSmsProviderConfigurationStatus(): SmsProviderConfigurationStatus {
  return {
    twilio: { configured: isSmsProviderConfigured('twilio') },
    vonage: { configured: isSmsProviderConfigured('vonage') },
  };
}

/** The other concrete provider (twilio <-> vonage). */
export function otherProvider(provider: SmsProviderName): SmsProviderName {
  return provider === 'twilio' ? 'vonage' : 'twilio';
}

/** Falls back to the recommended default when a value is not a known provider. */
function normalizeProviderName(value: string, fallback: SmsProviderName): SmsProviderName {
  const normalized = value.trim().toLowerCase();
  return isSmsProviderName(normalized) ? normalized : fallback;
}

/**
 * The selection expressed by the ENVIRONMENT, used when the Admin Panel has not
 * stored a preference. Returns `null` for an unset/mock provider (the caller
 * decides what "no provider" means in the current environment) and throws for
 * an unknown provider name, so a typo can never silently pick a provider.
 */
export function readSmsProviderSelectionFromEnv(): SmsProviderSelection | null {
  const provider = env('SMS_PROVIDER').toLowerCase();

  if (!provider || provider === 'mock') return null;

  if (isSmsProviderName(provider)) {
    return {
      smsProvider: provider,
      primarySmsProvider: provider,
      fallbackSmsProvider: otherProvider(provider),
    };
  }

  if (provider === 'auto') {
    return {
      smsProvider: 'auto',
      primarySmsProvider: normalizeProviderName(
        firstEnv('SMS_PRIMARY_PROVIDER'),
        DEFAULT_PRIMARY_SMS_PROVIDER,
      ),
      fallbackSmsProvider: normalizeProviderName(
        firstEnv('SMS_FALLBACK_PROVIDER'),
        DEFAULT_FALLBACK_SMS_PROVIDER,
      ),
    };
  }

  throw new Error(`UNSUPPORTED_SMS_PROVIDER:${provider}`);
}

/**
 * Normalizes a stored/inbound selection and repairs the ONE structurally
 * impossible combination: a primary equal to its own fallback would make the
 * "auto" mode retry the provider that just failed, so the fallback is switched
 * to the other concrete provider instead.
 */
export function normalizeSmsProviderSelection(
  selection: SmsProviderSelection,
): SmsProviderSelection {
  const primary: SmsProviderName = isSmsProviderName(selection.primarySmsProvider)
    ? selection.primarySmsProvider
    : DEFAULT_PRIMARY_SMS_PROVIDER;
  const requestedFallback: SmsProviderName = isSmsProviderName(selection.fallbackSmsProvider)
    ? selection.fallbackSmsProvider
    : DEFAULT_FALLBACK_SMS_PROVIDER;
  const fallback: SmsProviderName =
    requestedFallback === primary ? otherProvider(primary) : requestedFallback;

  return {
    // A single-provider mode always names exactly one provider; only "auto"
    // keeps an ordered primary/fallback pair.
    smsProvider: selection.smsProvider === 'auto' ? 'auto' : primary,
    primarySmsProvider: primary,
    fallbackSmsProvider: fallback,
  };
}

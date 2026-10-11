import { BadRequestException } from '@nestjs/common';

/**
 * CANONICAL PHONE NORMALIZATION — the single source of truth for every phone
 * number that enters the system (signup, send-OTP, verify-OTP, phone login,
 * phone recovery, verification center, profile phone update, identifier login).
 *
 * WHY THIS FILE EXISTS
 *   The signup form used to require a full E.164 number (`+8801712345678`).
 *   The DTO layer rejected the normal Bangladesh local number (`01712345678`)
 *   with a 400 BEFORE the service ran, and the frontend had no mapping for
 *   that message, so the customer only ever saw "Something went wrong".
 *   Normalization is centralized here instead of being re-implemented (and
 *   drifting) per controller.
 *
 * RULES (deliberately narrow — no guessing)
 *   1. Formatting characters (spaces, dashes, dots, parentheses) are removed.
 *   2. `+…`    -> validated as E.164 and returned UNCHANGED.
 *      `00…`  -> the ISO international prefix becomes `+…`.
 *      `880…` -> the Bangladesh country code is unambiguous, so it gains the
 *                `+` (never double-prefixed: `+880…` never becomes
 *                `+880880…`).
 *   3. `01XXXXXXXXX` -> Bangladesh LOCAL mobile (11 digits) becomes
 *                       `+8801XXXXXXXXX`.
 *   4. Anything else -> rejected with an actionable message.
 *
 *   Arbitrary international LOCAL numbers are NEVER auto-converted: their
 *   country is unknown, and inventing `+` for `0712345678` (UK) would create
 *   wrong identities. Only the known 11-digit Bangladesh national format is
 *   translated.
 *
 * STORAGE INVARIANT
 *   The database (User.phone, AuthIdentity.providerAccountId, OtpCode
 *   .identifier) only ever receives the canonical E.164 form, so
 *   `01712345678` and `+8801712345678` can never become two separate users.
 */

/** Canonical E.164 phone number, e.g. +447911123456 / +8801712345678. */
export const PHONE_REGEX = /^\+[1-9]\d{7,14}$/;

/** Bangladesh country calling code (without the `+`). */
export const BD_COUNTRY_CODE = '880';

/**
 * Bangladesh national mobile format: `01` + operator digit (3-9) + 8 digits
 * = 11 digits. The operator digit is REQUIRED so arbitrary `01…` strings
 * (landline-ish or truncated input) are not silently treated as mobiles.
 */
export const BD_LOCAL_MOBILE_REGEX = /^01[3-9]\d{8}$/;

/** ISO international dialing prefix (`00…` == `+…`). */
const INTERNATIONAL_PREFIX = '00';

/** Formatting characters a human may type into a phone field. */
const FORMATTING_CHARS = /[\s\-().]/g;

/** Example shown in the generic message. */
export const PHONE_EXAMPLE_E164 = '+8801712345678';

/** Actionable copy for a generic (non-Bangladesh-shaped) input. */
export const PHONE_MESSAGE_GENERIC =
  'Enter a valid mobile number, e.g. 01712345678 or +8801712345678.';

/** Actionable copy for input that is clearly meant to be a BD number. */
export const PHONE_MESSAGE_BD = 'Enter a valid Bangladesh mobile number, e.g. 01712345678.';

export type PhoneNormalization =
  | { ok: true; phone: string }
  | { ok: false; message: string };

/**
 * Normalizes any accepted user input to canonical E.164, or explains what is
 * wrong. Never throws, never logs, and NEVER returns a partially-normalized
 * value — an unusable input returns `ok: false` with copy safe to show a user.
 */
export function tryNormalizePhone(input: unknown): PhoneNormalization {
  if (typeof input !== 'string') return { ok: false, message: PHONE_MESSAGE_GENERIC };

  const raw = input.trim();
  if (!raw) return { ok: false, message: PHONE_MESSAGE_GENERIC };

  // "01712-345678", "01712 345 678", "(01712) 345678" -> "01712345678"
  const compact = raw.replace(FORMATTING_CHARS, '');
  if (!/^\+?\d+$/.test(compact)) return { ok: false, message: PHONE_MESSAGE_GENERIC };

  const asE164 = (candidate: string): PhoneNormalization =>
    PHONE_REGEX.test(candidate)
      ? { ok: true, phone: candidate }
      : { ok: false, message: PHONE_MESSAGE_GENERIC };

  // Already international: `+8801712345678` stays EXACTLY as typed. This branch
  // runs first, which is what guarantees no `+880880…` double-prefix.
  if (compact.startsWith('+')) return asE164(compact);

  // ISO international prefix: `008801712345678` -> `+8801712345678`.
  if (compact.startsWith(INTERNATIONAL_PREFIX) && compact.length > 2) {
    return asE164(`+${compact.slice(2)}`);
  }

  // Bare Bangladesh country code: `8801712345678` -> `+8801712345678`.
  if (compact.startsWith(BD_COUNTRY_CODE)) return asE164(`+${compact}`);

  // Bangladesh national mobile: `01712345678` -> `+8801712345678`.
  // The national TRUNK prefix `0` is STRIPPED, not concatenated — concatenating
  // it would yield the invalid `+88001712345678`.
  if (BD_LOCAL_MOBILE_REGEX.test(compact)) {
    return { ok: true, phone: `+${BD_COUNTRY_CODE}${compact.slice(1)}` };
  }

  // National trunk-prefix shape (starts with 0) but not a valid BD mobile.
  if (compact.startsWith('0')) return { ok: false, message: PHONE_MESSAGE_BD };

  return { ok: false, message: PHONE_MESSAGE_GENERIC };
}

/**
 * Canonicalizing variant for service/controller code paths: returns the E.164
 * value or throws a 400 carrying the actionable message (never a class-validator
 * stack). Use this everywhere a phone is about to be stored, looked up or sent.
 */
export function normalizePhone(input: unknown): string {
  const result = tryNormalizePhone(input);
  if (!result.ok) throw new BadRequestException(result.message);
  return result.phone;
}

/** True when the value is ALREADY canonical E.164 (no conversion needed). */
export function isCanonicalPhone(value: unknown): value is string {
  return typeof value === 'string' && PHONE_REGEX.test(value);
}

/**
 * Masks a phone for logs: `+8801712345678` -> `+88017******78`. The country code
 * and last two digits stay visible (enough to tell two numbers apart during an
 * incident) while the subscriber digits never reach a log line.
 */
export function maskPhone(value: string): string {
  if (value.length <= 8) return '*'.repeat(Math.max(value.length, 1));
  return `${value.slice(0, 6)}${'*'.repeat(value.length - 8)}${value.slice(-2)}`;
}

/**
 * Scrubs anything phone-shaped out of a free-text log message. Error copy can
 * embed a number (e.g. "phone 01712345678 is not valid"), and a log line must
 * never carry a full subscriber number.
 */
export function scrubPhoneFromMessage(message: string): string {
  return message
    .replace(/\+?\d[\d\s\-().]{7,}\d/g, (match) =>
      maskPhone(match.replace(FORMATTING_CHARS, '')),
    )
    .replace(/[\s\-().]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

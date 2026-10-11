/**
 * Client-side password rules — the EXACT mirror of the backend's DTO rules
 * (`PhoneSignupStartDto` / `PhoneRecoveryResetDto` / `RegisterDto`):
 *
 *   @MinLength(8) @MaxLength(128)
 *   @Matches(/[a-z]/)  lowercase
 *   @Matches(/[A-Z]/)  uppercase
 *   @Matches(/\d/)     digit
 *
 * The backend rules are NOT weakened — these only let the signup form explain
 * the requirement before the round trip instead of after it. The API always
 * re-validates; this is UX, never a trust boundary.
 *
 * The first unmet rule is returned so the message stays short and actionable
 * rather than a wall of rules.
 */
export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must contain at least 8 characters.';
  if (password.length > 128) return 'Password must be at most 128 characters.';
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter.';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter.';
  if (!/\d/.test(password)) return 'Password must contain a number.';
  return null;
}

/**
 * Password guidance shown under the field. Mirrors `validatePassword` exactly,
 * so what the user is told up front is what the API will check.
 */
export const PASSWORD_REQUIREMENTS: readonly string[] = [
  'At least 8 characters',
  'A lowercase letter',
  'An uppercase letter',
  'A number',
];

/**
 * Friendly auth error messages.
 *
 * Backend error payloads (messages, codes, stack traces) are NEVER shown to
 * users. This mapper translates known backend failure modes into short,
 * human, actionable copy and falls back to generic copy for anything unknown.
 */
import { ApiClientError } from '@/lib/api/client';

type Context = 'login' | 'signup' | 'oauth' | 'verification';

const KNOWN: Array<[RegExp, string]> = [
  // ---- Phone number (the production 400: `phone must be a valid E.164
  // number` had no mapping, so the customer only saw "Something went wrong").
  // Ordered before the generic rules because the backend now accepts a
  // Bangladesh LOCAL number and only rejects genuinely unusable input.
  [
    /enter a valid bangladesh mobile number/i,
    'Enter a valid Bangladesh mobile number, e.g. 01712345678.',
  ],
  [
    /phone must be a valid|enter a valid mobile number/i,
    'Enter a valid mobile number, e.g. 01712345678.',
  ],
  [/invalid credentials/i, 'Incorrect email/phone number or password. Please try again.'],
  [/invalid or expired code/i, 'That code is invalid or has expired. Please request a new one.'],
  [/^invalid code$/i, 'That code is not correct. Please check it and try again.'],
  [/too many attempts/i, 'Too many attempts. Please wait a moment and request a new code.'],
  [/too many failed attempts/i, 'Too many failed attempts. Please try again later.'],
  [/please wait before requesting/i, 'Please wait a minute before requesting another code.'],
  [/phone already registered/i, 'This phone number is already registered. Try signing in instead.'],
  [/username already registered/i, 'This username is taken. Please choose another one.'],
  [/email or username already registered/i, 'This email or username is already registered. Try signing in instead.'],
  [/already linked to another user/i, 'This account is already linked to another TANVIONROYALE account.'],
  [/verification pending/i, 'Your verification is already in progress. Please check back shortly.'],
  [/account is not permitted/i, 'Your account is currently suspended. Please contact support.'],
  [/session is no longer valid|invalid or expired (access )?token|invalid refresh token/i, 'Your session has expired. Please sign in again.'],
  [/invalid oauth state|authentication failed|missing authorization code/i, 'We could not complete the sign-in. Please try again.'],
  [/add a phone number first|user not found/i, 'We could not process that request. Please refresh and try again.'],
];

/**
 * Password requirement copy, mapped from the backend's class-validator
 * messages. The API is still the authority; this only turns a 400 that used
 * to surface as "Something went wrong" into the specific unmet rule.
 */
const PASSWORD_RULES: Array<[RegExp, string]> = [
  [/password must contain at least 8 characters/i, 'Password must contain at least 8 characters.'],
  [/password must be shorter than 129 characters/i, 'Password must be at most 128 characters.'],
  [/password must contain a lowercase letter/i, 'Password must contain a lowercase letter.'],
  [/password must contain an uppercase letter/i, 'Password must contain an uppercase letter.'],
  [/password must contain a number/i, 'Password must contain a number.'],
  [/password must contain a digit/i, 'Password must contain a number.'],
  [/username may only contain/i, 'Username may only contain letters, numbers and underscores.'],
];

/**
 * Resolves a 400 to the FIRST specific rule it violated, or null when the
 * message is not a recognised validation rule.
 *
 * `ApiClientError.message` is the joined class-validator message list, so each
 * segment is tested independently. Order matters: the specific rules are
 * checked before any generic fallback.
 */
function matchValidationMessage(message: string): string | null {
  for (const [pattern, copy] of [...PASSWORD_RULES, ...KNOWN]) {
    if (pattern.test(message)) return copy;
  }
  return null;
}


export function friendlyAuthError(err: unknown, context: Context = 'login'): string {
  if (err instanceof ApiClientError) {
    // Staff accounts are refused at the customer login with a dedicated 403.
    // The generic 403 copy below says the account is suspended, which would be
    // wrong (and alarming) here — this case gets its own message.
    if (/staff accounts must sign in/i.test(err.message)) {
      return "This account can't sign in here — staff accounts use the staff login.";
    }
    for (const [pattern, message] of KNOWN) {
      if (pattern.test(err.message)) return message;
    }
    // A 400 whose message names a specific, actionable rule (phone format,
    // password composition) is shown as that rule — NOT as "Something went
    // wrong". This is the fix for the production signup 400.
    if (err.status === 400) {
      const specific = matchValidationMessage(err.message);
      if (specific) return specific;
      // A 400 we do not recognise is still a client-side problem worth
      // reporting plainly rather than hiding behind a generic apology, but it
      // is never the raw backend payload.
      return 'We could not process that request. Please check the details and try again.';
    }
    switch (err.status) {
      case 401:
        return context === 'login'
          ? 'Sign-in failed. Please check your details and try again.'
          : 'Please sign in again to continue.';
      case 403:
        return 'Your account is currently suspended. Please contact support.';
      case 409:
        return 'That request conflicts with your current account state. Please refresh and try again.';
      // 503 "Message delivery is not configured" is an HONEST server state: the
      // number is fine, but SMS/email delivery is not set up. We must NOT tell
      // the user a code was sent, and we must not fake one — the copy asks them
      // to try again shortly.
      case 503:
        return 'We could not send the code right now. Please try again in a moment.';
      case 423:
        return 'Too many failed attempts. Please try again later.';
      case 429:
        return 'Too many requests. Please wait a moment and try again.';
      default:
        break;
    }
  }
  return 'Something went wrong. Please try again.';
}


/**
 * Staff-login error copy (Part A). Never surfaces backend payloads: a wrong
 * password AND a correct password on a non-staff account both collapse to the
 * same staff-only message, matching the backend's generic 403.
 */
export function friendlyAdminError(err: unknown): string {
  if (err instanceof ApiClientError) {
    // A staff-only 403 carries the backend's generic message verbatim — reuse
    // it instead of inventing new copy (keeps the "no enumeration" wording
    // identical between client and server).
    if (err.status === 403 && /staff accounts only/i.test(err.message)) {
      return 'This login is for staff accounts only. Use the customer login for player accounts.';
    }
    for (const [pattern, message] of KNOWN) {
      if (pattern.test(err.message)) return message;
    }
    switch (err.status) {
      case 401:
        return 'Sign-in failed. Check your staff username/Gmail and password and try again.';
      case 423:
        return 'Too many failed attempts. Please try again later.';
      case 429:
        return 'Too many requests. Please wait a moment and try again.';
      default:
        break;
    }
  }
  return 'Something went wrong. Please try again.';
}

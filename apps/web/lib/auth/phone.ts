/**
 * Frontend phone normalization — the UX mirror of the backend's canonical
 * normalizer (`apps/api/src/common/utils/phone.ts`).
 *
 * WHY IT EXISTS
 *   The customer types whatever Bangladeshi customers actually type
 *   (`01712345678`, `01712-345678`, `01712 345 678`). Sending that raw made the
 *   API answer 400, and the form then showed "Something went wrong". This
 *   module canonicalizes the value for display/UX so the user sees a
 *   predictable number, and so the OTP is verified against the SAME value the
 *   backend issued it for.
 *
 * THE BACKEND REMAINS AUTHORITATIVE
 *   This is a convenience, never a trust boundary: every value produced here is
 *   re-normalized and re-validated server-side before it is stored, looked up
 *   or messaged. A mismatch can never create a second account, because the
 *   unique key is the canonical E.164 string the API computes.
 *
 *   The rules are intentionally identical to the backend's:
 *     `01712345678`     -> `+8801712345678`  (Bangladesh local mobile)
 *     `01712-345678`    -> `+8801712345678`  (formatting stripped)
 *     `+8801712345678`  -> unchanged          (ALREADY prefixed — never
 *                                              re-prefixed to +880880…)
 *     `+447911123456`   -> unchanged          (international E.164)
 *   Arbitrary international LOCAL numbers are never auto-converted: their
 *   country is unknown, so guessing a `+` would fabricate a wrong identity.
 */

/** Canonical E.164 shape — identical to the backend's PHONE_REGEX. */
const PHONE_E164 = /^\+[1-9]\d{7,14}$/;

/** Bangladesh country code (without the `+`). */
const BD_COUNTRY_CODE = '880';

/** `01` + operator digit (3-9) + 8 digits = the 11-digit BD national mobile. */
const BD_LOCAL_MOBILE = /^01[3-9]\d{8}$/;

/** Spaces, dashes, dots and parentheses a human may type into a phone field. */
const FORMATTING_CHARS = /[\s\-().]/g;

/** The canonical value the API echoes back on a successful send-otp. */
export function normalizePhoneInput(input: string): string {
  const compact = (input ?? '').trim().replace(FORMATTING_CHARS, '');
  if (!/^\+?\d+$/.test(compact)) return '';

  // `+880…` short-circuits first, which is what prevents a double `+880` prefix.
  if (compact.startsWith('+')) return PHONE_E164.test(compact) ? compact : '';
  if (compact.startsWith('00') && compact.length > 2) {
    const candidate = `+${compact.slice(2)}`;
    return PHONE_E164.test(candidate) ? candidate : '';
  }
  if (compact.startsWith(BD_COUNTRY_CODE)) {
    const candidate = `+${compact}`;
    return PHONE_E164.test(candidate) ? candidate : '';
  }
  // The national TRUNK prefix `0` is STRIPPED, not concatenated — concatenating
  // it would yield the invalid `+88001712345678`.
  if (BD_LOCAL_MOBILE.test(compact)) return `+${BD_COUNTRY_CODE}${compact.slice(1)}`;
  return '';
}

/** True when the typed value is a phone this app will accept. */
export function isValidPhoneInput(input: string): boolean {
  return normalizePhoneInput(input) !== '';
}

/**
 * Masks a phone for display: `+8801712345678` -> `+88017••••••78`. The country
 * code and last two digits stay readable so the user can recognise their own
 * number without the full subscriber part being visible on screen.
 */
export function maskPhoneForDisplay(value: string): string {
  if (value.length <= 8) return value;
  return `${value.slice(0, 6)}${'•'.repeat(value.length - 8)}${value.slice(-2)}`;
}

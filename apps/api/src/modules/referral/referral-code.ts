import { randomInt } from 'node:crypto';

/**
 * REFERRAL CODE GENERATOR — pure, deterministic-shape, collision-resolved.
 *
 * Format: `TANV` + 12 characters = 16 characters total, e.g. `TANV8K2P4QZ7M1X`.
 *
 * WHY THIS SHAPE
 *   - The `TANV` prefix makes the code recognisable as a TANVIONROYALE code and
 *     matches the deterministic backfill written by the referral migration
 *     (`'TANV' + 12 hex chars`), so every code looks the same whether the
 *     account was created by the backfill or by a new registration.
 *   - The suffix uses Crockford-style base32 with the visually ambiguous
 *     characters removed (no I, L, O, 0, 1, U). A user reading the code aloud or
 *     retyping it from a screenshot cannot plausibly mistype it.
 *   - 12 base32 characters = 60 bits of entropy. A referral code is a mild
 *     public identifier, not a credential, but 60 bits makes guessing
 *     infeasible even for an attacker enumerating codes at the signup endpoint
 *     (which is additionally rate-limited by the existing auth throttler).
 *
 * STABILITY: a code is generated ONCE, stored on `User.referralCode` and never
 * regenerated. It is never rotated, so a link somebody already shared keeps
 * working forever.
 */

/** Crockford-style alphabet: digits and letters, no I/L/O/U/0/1. */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_SUFFIX_LENGTH = 12;
export const REFERRAL_CODE_PREFIX = 'TANV';
export const REFERRAL_CODE_LENGTH = REFERRAL_CODE_PREFIX.length + CODE_SUFFIX_LENGTH;

/**
 * Builds one candidate code.
 *
 * `random` is injectable so tests can pin the output; production passes
 * `randomInt` from node:crypto (a CSPRNG — never `Math.random`).
 */
export function generateReferralCode(
  random: (maxExclusive: number) => number = (max) => randomInt(max),
): string {
  let suffix = '';
  for (let index = 0; index < CODE_SUFFIX_LENGTH; index += 1) {
    suffix += CODE_ALPHABET[random(CODE_ALPHABET.length)];
  }
  return `${REFERRAL_CODE_PREFIX}${suffix}`;
}

/** True when a string has the exact shape this service issues. */
export function isValidReferralCodeShape(value: string): boolean {
  if (value.length !== REFERRAL_CODE_LENGTH) return false;
  if (!value.startsWith(REFERRAL_CODE_PREFIX)) return false;
  for (const character of value.slice(REFERRAL_CODE_PREFIX.length)) {
    if (!CODE_ALPHABET.includes(character)) return false;
  }
  return true;
}

/**
 * Normalises user input into a comparable code.
 *
 * Codes are stored uppercase, so a user who pastes `tanv8k2p4qz7m1x` (or adds a
 * space) must still resolve. Anything that cannot be a code at all returns
 * `null` so the caller can treat it as "no referral" instead of failing the
 * registration.
 */
export function normalizeReferralCode(
  value: string | null | undefined,
): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  // Tolerate a pasted full link as well as a bare code. The match is
  // case-insensitive because the value may be upper-cased first (a pasted
  // `?ref=` becomes `?REF=`).
  const fromUrl = trimmed.match(/[?&]ref=([A-Za-z0-9]+)/i);
  const candidate = (fromUrl ? fromUrl[1] : trimmed).toUpperCase();
  return isValidReferralCodeShape(candidate) ? candidate : null;
}

/** The idempotency key a reward of `recipient` for `referralId` must use. */
export function referralRewardEventKey(
  referralId: string,
  recipient: 'REFERRER' | 'REFERRED',
): string {
  return `referral_reward:${referralId}:${recipient}`;
}

/** The idempotency key of one qualifying signal. */
export function referralEventKey(
  referralId: string,
  kind: 'REGISTRATION' | 'DEPOSIT' | 'WAGER',
  sourceId: string,
): string {
  return `referral_${kind.toLowerCase()}:${referralId}:${sourceId}`;
}

export type ReferralBonusType = 'FIXED_AMOUNT' | 'PERCENTAGE';
export type ReferralQualificationRule =
  | 'REGISTRATION'
  | 'VERIFIED_ACCOUNT'
  | 'MIN_DEPOSIT'
  | 'MIN_WAGER'
  | 'DEPOSIT_AND_WAGER';

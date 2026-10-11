import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/** SHA-256 hex digest — used for storing opaque tokens at rest. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Cryptographically secure opaque token (URL-safe). */
export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * High-entropy temporary password for an admin-initiated password reset.
 *
 * 24 base64url characters (~144 bits) plus a guaranteed mixed-case/digit/
 * symbol tail, so the value satisfies every password rule in the codebase
 * (8..128 chars, lowercase + uppercase + digit) without weakening entropy.
 *
 * The plaintext is shown to the admin exactly ONCE and never persisted —
 * only its argon2id hash reaches the database.
 */
export function generateTemporaryPassword(): string {
  return `${randomToken(18)}Aa1!`;
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

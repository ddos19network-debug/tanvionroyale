/**
 * Account statuses that may NEVER sign in and may NEVER hold a usable session.
 *
 * This is the single source of truth for the auth boundary: every login path
 * (password/email, phone OTP, OAuth exchange, session restore), the
 * authenticated-request guard and admin broadcasts all consult it, so a new
 * status (e.g. BANNED) can never be enforced in one place and forgotten in
 * another.
 *
 *   SUSPENDED — temporary/reviewable (admin can unsuspend)
 *   BANNED    — permanent/severe (admin must deliberately unban)
 *   LOCKED    — automatic lockout after repeated failed sign-ins
 *   CLOSED    — self-closed or admin soft-deleted (anonymized, unusable login)
 */
export const BLOCKED_ACCOUNT_STATUSES = ['SUSPENDED', 'BANNED', 'LOCKED', 'CLOSED'] as const;

/** True when the account status must be refused at the auth boundary. */
export function isBlockedAccountStatus(status: string): boolean {
  return (BLOCKED_ACCOUNT_STATUSES as readonly string[]).includes(status);
}
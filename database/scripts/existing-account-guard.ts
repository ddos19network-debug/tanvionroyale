/**
 * Shared safety guard for the two scripts that can attach SUPER_ADMIN to an
 * ALREADY EXISTING User row (bootstrap-master-admin.ts re-runs and
 * promote-admin.ts — the latter's whole job is granting the role to a row that
 * already exists).
 *
 * Both paths used to trust the allowlist alone: once the email was listed in
 * MASTER_ADMIN_EMAILS they silently attached SUPER_ADMIN to whatever account
 * already owned that address. That is a blind-trust assumption — if the
 * mailbox (or the row) was taken over before the allowlist entry was added,
 * the script would elevate the attacker.
 *
 * The guard therefore, on finding a pre-existing account:
 *   1. prints the account's createdAt / status / emailVerified / username to
 *      the console (NEVER the password or its hash) so the operator can verify
 *      its origin out of band;
 *   2. refuses by default with a takeover-aware message;
 *   3. only lets the caller proceed when the operator explicitly passed
 *      --confirm-existing (wired through by each script's CLI entry point).
 *
 * Like every other guard in these scripts it THROWS — never exits — so the CLI
 * wrapper reports the reason and exits 1 before any write, while unit tests
 * can assert the refusal directly.
 *
 * Note: explicit .ts import extension + suppressed TS5097 follow the same
 * Node ≥22.18 native-ESM / ts-node CommonJS convention as the sibling scripts.
 */
export interface ExistingAccountSummary {
  id: string;
  createdAt: Date | string;
  status: string;
  emailVerified: boolean;
  username: string;
}

/** ISO string when available — unambiguous in logs and refusal messages. */
function formatCreatedAt(createdAt: Date | string): string {
  return createdAt instanceof Date ? createdAt.toISOString() : String(createdAt);
}

/**
 * Prints the existing account's safe-to-show fields and throws unless the
 * operator confirmed with --confirm-existing. Returns void only when confirmed.
 */
export function guardExistingAccount(
  account: ExistingAccountSummary,
  confirmExisting: boolean,
): void {
  // 1. Show exactly what this account looks like — password/hash excluded —
  //    both when refusing (to verify out of band) and when proceeding (audit).
  console.log(
    `[existing-account] username=${account.username} status=${account.status} ` +
      `emailVerified=${account.emailVerified} createdAt=${formatCreatedAt(account.createdAt)}`,
  );

  // 2. Refuse by default: attaching SUPER_ADMIN to a pre-existing row is the
  //    classic privilege-escalation-by-takeover shape.
  if (confirmExisting) return;
  throw new Error(
    `An account with this email already exists (created ${formatCreatedAt(account.createdAt)}, ` +
      `verified: ${account.emailVerified}). If this is NOT an account you or the other master ` +
      'admin created, DO NOT proceed — treat this as a possible takeover attempt. Re-run with ' +
      '--confirm-existing only after you have verified this account\'s origin out of band.',
  );
}

/**
 * Master admin allowlist — the ONLY accounts that may ever hold SUPER_ADMIN.
 *
 * One env-driven source of truth, shared by every path that can create, grant
 * or remove SUPER_ADMIN:
 *   * database/scripts/bootstrap-master-admin.ts — creates the master admin
 *     accounts directly (never through customer signup);
 *   * database/scripts/promote-admin.ts — refuses to grant SUPER_ADMIN to any
 *     other address;
 *   * AdminService.deactivateAdmin — refuses to deactivate these accounts, even
 *     for another SUPER_ADMIN.
 *
 * MASTER_ADMIN_EMAILS is a comma-separated list of staff addresses, e.g.
 * "owner1@gmail.com,owner2@gmail.com". The real value lives ONLY in the
 * deployment environment (set in the Render dashboard, `sync: false` in
 * render.yaml) — never in source control and never in a commit message.
 * Addresses are compared trimmed + lower-cased, exactly like every stored
 * user email (AuthService.register lower-cases on signup).
 *
 * CAP — exactly two master admins: the platform has exactly two permanent
 * Master Admin identities. `getMasterAdminEmails()` honors at most the FIRST
 * TWO distinct configured entries; any further entry is ignored (fail closed
 * for the extra address — it can never receive or retain SUPER_ADMIN) and a
 * warning (counts only, never the addresses themselves) is emitted at startup.
 */
const MASTER_ADMIN_ENV_VAR = 'MASTER_ADMIN_EMAILS';

/**
 * Maximum number of permanent master admins. The two configured addresses in
 * the deployment environment are the only accounts that can hold SUPER_ADMIN;
 * a longer list is a misconfiguration, not an invitation to expand the
 * allowlist.
 */
export const MASTER_ADMIN_LIMIT = 2;

/** Parses MASTER_ADMIN_EMAILS (trimmed, lower-cased, blanks + dupes dropped). */
function parseMasterAdminEmails(): string[] {
  return [
    ...new Set(
      (process.env[MASTER_ADMIN_ENV_VAR] ?? '')
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

/**
 * The configured master admins — at most MASTER_ADMIN_LIMIT entries (the
 * first two configured). Everything beyond the cap is ignored so an
 * over-long env value can never widen who is a master admin.
 */
export function getMasterAdminEmails(): string[] {
  return parseMasterAdminEmails().slice(0, MASTER_ADMIN_LIMIT);
}

/**
 * True when the address is one of the configured master admins. `null`/blank
 * never matches (User.email is nullable, and an unset allowlist matches nobody).
 */
export function isMasterAdminEmail(email: string | null | undefined): boolean {
  const normalized = (email ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return getMasterAdminEmails().includes(normalized);
}

/**
 * Guard shared by both SUPER_ADMIN scripts: throws (never exits) so the CLI
 * wrapper reports the reason and stops before a single database read/write.
 */
export function assertMasterAdminEmail(email: string): void {
  if (isMasterAdminEmail(email)) return;
  throw new Error(
    `${email} is not listed in ${MASTER_ADMIN_ENV_VAR} — SUPER_ADMIN is restricted to the ` +
      `configured master admins. Set ${MASTER_ADMIN_ENV_VAR} in the deployment environment ` +
      '(Render dashboard, never in source) before granting SUPER_ADMIN.',
  );
}

/**
 * Startup warning for a misconfigured deploy: an empty allowlist means nobody
 * can be bootstrapped/promoted and the master-admin protection matches no
 * account; an over-long allowlist has its entries beyond the cap ignored.
 * Deliberately a warning — the API still starts (customer traffic is
 * unaffected), scripts simply refuse to grant SUPER_ADMIN to anything outside
 * the capped first two entries, and the warning prints COUNTS only (never the
 * configured addresses — they must not appear in logs).
 */
export function warnIfMasterAdminsUnconfigured(): void {
  const parsed = parseMasterAdminEmails();
  if (parsed.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[master-admins] ${MASTER_ADMIN_ENV_VAR} is empty or unset — no account is a master admin: ` +
        'bootstrap-master-admin/promote-admin will refuse to grant SUPER_ADMIN and the master-admin ' +
        'deactivation guard protects nobody. Set it in the deployment environment ' +
        '(comma-separated master admin email addresses).',
    );
    return;
  }
  if (parsed.length > MASTER_ADMIN_LIMIT) {
    // eslint-disable-next-line no-console
    console.warn(
      `[master-admins] ${MASTER_ADMIN_ENV_VAR} lists ${parsed.length} addresses but only the first ` +
        `${MASTER_ADMIN_LIMIT} are honored — SUPER_ADMIN is restricted to exactly ` +
        `${MASTER_ADMIN_LIMIT} master admins. Remove the extra entries from the deployment environment.`,
    );
  }
}

// Evaluated once per process, on first import. AdminService imports this module
// during API bootstrap, so a misconfigured deploy is visible in the API logs —
// and both staff scripts evaluate it before touching the database.
warnIfMasterAdminsUnconfigured();

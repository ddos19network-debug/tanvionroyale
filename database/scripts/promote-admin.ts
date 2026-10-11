/**
 * Promotes an existing user to SUPER_ADMIN by email. Safe to run in
 * production — touches only User/Role/UserRole, never mock/demo data.
 *
 * Unlike seed.ts (which refuses to run against production because it also
 * provisions mock sports/partner data), this script is MEANT to run against
 * production: it only upserts a single UserRole assignment and never creates
 * roles, permissions, sports, events or providers.
 *
 * MASTER-ADMIN ONLY: SUPER_ADMIN is restricted to the addresses listed in
 * MASTER_ADMIN_EMAILS (apps/api/src/config/master-admins.ts) — the same
 * allowlist guard bootstrap-master-admin.ts enforces. Any other address is
 * refused before a single database read or write.
 *
 * The "user must already exist" path carries the same blind-trust assumption
 * bootstrap-master-admin.ts used to have: the allowlist check passed and the
 * script attached SUPER_ADMIN to whatever account already owned that address.
 * It now prints the existing account's createdAt/status/emailVerified/username
 * and REFUSES (exit 1, zero writes) unless --confirm-existing is passed after
 * the account's origin has been verified out of band — see
 * existing-account-guard.ts.
 *
 * Usage (from apps/api): npx ts-node ../../database/scripts/promote-admin.ts <email> [--confirm-existing]
 * Or:                    pnpm promote-admin <email> [--confirm-existing]
 *
 * Prerequisites:
 *  - The user must already exist (they sign up normally first).
 *  - The SUPER_ADMIN role must already exist (roles/permissions seed run once).
 *  - The address must be listed in MASTER_ADMIN_EMAILS.
 *
 * Note: the generated Prisma client is imported via its explicit /index.js —
 * required for Node ≥22.18 where native type-stripping loads this script as
 * ESM (directory imports are unsupported there), while still working under
 * ts-node's CommonJS compilation. Workspace helpers use explicit .ts import
 * paths for the same reason; TS5097 is suppressed inline because ts-node
 * type-checks this file before Node's native ESM loader executes it.
 */
import { PrismaClient } from '../../apps/api/src/generated/prisma/index.js';
// @ts-expect-error TS5097 - Node's native ESM loader requires the explicit .ts extension.
import { assertMasterAdminEmail } from '../../apps/api/src/config/master-admins.ts';
// @ts-expect-error TS5097 - Node's native ESM loader requires the explicit .ts extension.
import { guardExistingAccount } from './existing-account-guard.ts';

/**
 * Grants SUPER_ADMIN to an existing, allowlisted user (idempotent). Throws —
 * never exits — so the CLI wrapper reports the reason and unit tests can assert
 * it. Exported so the guard can be tested without running the CLI.
 *
 * confirmExisting mirrors the --confirm-existing CLI flag: without it the
 * existing-account guard prints the target row's safe fields and refuses, so a
 * blind run grants nothing.
 */
export async function promoteAdminToSuperAdmin(
  prisma: PrismaClient,
  email: string,
  confirmExisting = false,
): Promise<string> {
  // Master-admin gate FIRST: no database access for a non-allowlisted address.
  const normalizedEmail = email.trim().toLowerCase();
  assertMasterAdminEmail(normalizedEmail);

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) {
    throw new Error(`No user found with email ${normalizedEmail}. They must sign up first.`);
  }

  // Same print + refuse guard as bootstrap-master-admin.ts, applied to this
  // script's "user must already exist" path BEFORE any write: without an
  // explicit --confirm-existing this throws and SUPER_ADMIN is never granted.
  guardExistingAccount(user, confirmExisting);

  const role = await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } });
  if (!role) {
    throw new Error('SUPER_ADMIN role not found — run the roles/permissions seed first.');
  }

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    update: {},
    create: { userId: user.id, roleId: role.id },
  });
  // Account-domain invariant: a promoted master admin becomes a STAFF account
  // and drops the customer USER role — the architecture is STAFF + SUPER_ADMIN,
  // never USER + SUPER_ADMIN. Only the classification column and the USER join
  // row are touched; password, profile and all other data stay untouched
  // (idempotent: re-running on an already-classified master is a no-op write).
  await prisma.user.update({ where: { id: user.id }, data: { accountType: 'STAFF' } });
  await prisma.userRole.deleteMany({ where: { userId: user.id, role: { name: 'USER' } } });

  return `${normalizedEmail} is now SUPER_ADMIN.`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const confirmExisting = args.includes('--confirm-existing');
  const email = args.find((arg) => arg !== '--confirm-existing');
  if (!email) {
    console.error('Usage: promote-admin.ts <email> [--confirm-existing]');
    process.exit(1);
  }

  // The client is created here (not at import time) so importing this module
  // never opens a database connection.
  const prisma = new PrismaClient();
  try {
    console.log(await promoteAdminToSuperAdmin(prisma, email, confirmExisting));
  } finally {
    await prisma.$disconnect();
  }
}

/** True only when this file is the process entry point (never when imported). */
function isCliEntryPoint(fileName: string): boolean {
  return (process.argv[1] ?? '').endsWith(fileName);
}

if (isCliEntryPoint('promote-admin.ts') || isCliEntryPoint('promote-admin.js')) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

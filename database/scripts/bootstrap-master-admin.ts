/**
 * Creates a MASTER ADMIN (a fixed owner account holding SUPER_ADMIN) directly —
 * the ONLY code path in the system that creates a user without going through
 * customer signup or an admin-created-by-SUPER_ADMIN flow.
 *
 * It is therefore restricted as tightly as possible:
 *   1. the email must be listed in MASTER_ADMIN_EMAILS (checked BEFORE any
 *      database access — a non-allowlisted email never reaches Prisma);
 *   2. the account is created ACTIVE + emailVerified (the owner controls that
 *      mailbox, so no verification email is needed);
 *   3. the User row and its SUPER_ADMIN assignment are written in ONE
 *      transaction, so a master admin can never exist without SUPER_ADMIN.
 *
 * Idempotent: if a user with that email already exists, ONLY the SUPER_ADMIN
 * assignment is ensured (the existing password, username and profile are never
 * overwritten) — the same upsert pattern as promote-admin.ts. Because that
 * means attaching SUPER_ADMIN to a row THIS run did not create, the script
 * prints the existing account's createdAt/status/emailVerified/username and
 * REFUSES (exit 1, zero writes) unless --confirm-existing is passed after the
 * account's origin has been verified out of band — see existing-account-guard.ts.
 *
 * Usage (from apps/api):
 *   npx ts-node ../../database/scripts/bootstrap-master-admin.ts <email> <username> <password> [firstName] [lastName] [--confirm-existing]
 *
 * Prerequisites:
 *  - The SUPER_ADMIN role must already exist (pnpm prisma:seed-roles).
 *  - MASTER_ADMIN_EMAILS must be set in the environment (Render dashboard,
 *    never committed).
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
import { hashPassword } from '../../apps/api/src/common/utils/password.ts';
// @ts-expect-error TS5097 - Node's native ESM loader requires the explicit .ts extension.
import { guardExistingAccount } from './existing-account-guard.ts';

export interface BootstrapMasterAdminInput {
  prisma: PrismaClient;
  email: string;
  username: string;
  password: string;
  firstName?: string;
  lastName?: string;
  /**
   * Required (true) when the email ALREADY has a User row — defaults to false,
   * so a blind re-run refuses (exit 1, zero writes) instead of silently
   * attaching SUPER_ADMIN to an account this run did not create. Wired from
   * the --confirm-existing CLI flag.
   */
  confirmExisting?: boolean;
}

export interface BootstrapMasterAdminResult {
  userId: string;
  /** true = the account was created; false = an existing account was re-used. */
  created: boolean;
}

/** Ensures the SUPER_ADMIN role assignment + STAFF classification, nothing else. */
async function ensureSuperAdminRole(prisma: PrismaClient, userId: string): Promise<void> {
  const role = await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } });
  if (!role) {
    throw new Error('SUPER_ADMIN role not found — run the roles/permissions seed first.');
  }
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId, roleId: role.id } },
    update: {},
    create: { userId, roleId: role.id },
  });
  // Account-domain invariant: a master admin is a STAFF account, never a
  // customer one, and never carries the customer USER role (requirement:
  // STAFF + SUPER_ADMIN, not USER + SUPER_ADMIN). Additive/idempotent — only
  // the classification column and the USER join row are touched; password,
  // profile and every other role are untouched.
  await prisma.user.update({ where: { id: userId }, data: { accountType: 'STAFF' } });
  await prisma.userRole.deleteMany({ where: { userId, role: { name: 'USER' } } });
}

/**
 * Bootstraps one master admin. Throws — never exits — so the CLI wrapper
 * reports the reason and unit tests can assert it.
 */
export async function bootstrapMasterAdmin(
  input: BootstrapMasterAdminInput,
): Promise<BootstrapMasterAdminResult> {
  const { prisma } = input;
  const email = input.email.trim().toLowerCase();

  // 1. Master-admin gate FIRST: no database read for a non-allowlisted email.
  assertMasterAdminEmail(email);

  // 2. Existing account → print its provenance details and REFUSE unless the
  //    operator explicitly confirmed with --confirm-existing; only then is the
  //    role assignment ensured. The password, username and profile of an
  //    existing master admin are never overwritten (re-running this script can
  //    never lock the owner out).
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, createdAt: true, status: true, emailVerified: true, username: true },
  });
  if (existing) {
    guardExistingAccount(existing, input.confirmExisting ?? false);
    await ensureSuperAdminRole(prisma, existing.id);
    return { userId: existing.id, created: false };
  }

  // 3. New account: the SAME hashing scheme as every other password in the
  //    system (argon2id — see AuthService.register / AdminService.createAdminUser),
  //    created together with the SUPER_ADMIN assignment in one transaction.
  const passwordHash = await hashPassword(input.password);

  const user = await prisma.$transaction(async (tx) => {
    const role = await tx.role.findUnique({ where: { name: 'SUPER_ADMIN' } });
    if (!role) {
      throw new Error('SUPER_ADMIN role not found — run the roles/permissions seed first.');
    }
    const created = await tx.user.create({
      data: {
        email,
        username: input.username,
        passwordHash,
        passwordSetAt: new Date(),
        firstName: input.firstName,
        lastName: input.lastName,
        status: 'ACTIVE',
        emailVerified: true,
        emailVerifiedAt: new Date(),
        // Master admins are STAFF accounts — never classified as CUSTOMER.
        accountType: 'STAFF',
      },
    });
    await tx.userRole.create({ data: { userId: created.id, roleId: role.id } });
    return created;
  });

  return { userId: user.id, created: true };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const confirmExisting = args.includes('--confirm-existing');
  const [email, username, password, firstName, lastName] = args.filter(
    (arg) => arg !== '--confirm-existing',
  );
  if (!email || !username || !password) {
    console.error(
      'Usage: bootstrap-master-admin.ts <email> <username> <password> [firstName] [lastName] [--confirm-existing]',
    );
    process.exit(1);
  }

  // The client is created here (not at import time) so importing this module
  // never opens a database connection.
  const prisma = new PrismaClient();
  try {
    const result = await bootstrapMasterAdmin({
      prisma,
      email,
      username,
      password,
      firstName,
      lastName,
      confirmExisting,
    });
    console.log(
      result.created
        ? `${email} created as a master admin (SUPER_ADMIN).`
        : `${email} already existed — SUPER_ADMIN ensured (password/username/profile unchanged).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

/** True only when this file is the process entry point (never when imported). */
function isCliEntryPoint(fileName: string): boolean {
  return (process.argv[1] ?? '').endsWith(fileName);
}

if (isCliEntryPoint('bootstrap-master-admin.ts') || isCliEntryPoint('bootstrap-master-admin.js')) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

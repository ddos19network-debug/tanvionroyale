/**
 * Seeds ONLY the RBAC foundation: all platform roles and their default
 * permissions. This is the roles/permissions logic lifted out of seed.ts,
 * minus the mock/demo data (sports, competitions, providers, betting
 * domain, partner events) and minus the NODE_ENV === 'production' guard.
 *
 * Safe to run in production: it only ever upserts Permission, Role, and
 * RolePermission rows, so it is idempotent and never writes fake data —
 * the same production-safety posture as promote-admin.ts.
 *
 * Usage (from apps/api): npx ts-node ../../database/scripts/seed-roles.ts
 * Or:                    pnpm prisma:seed-roles
 */
import { PrismaClient } from '../../apps/api/src/generated/prisma/index.js';
import { ADMIN_PERMISSION_NAMES } from '../../packages/types/src/admin';

/**
 * PRODUCTION SAFETY: this script is explicitly meant to run against a
 * production database. Unlike seed.ts, it contains NO mock/demo data and only
 * upserts roles/permissions (idempotent). That is why there is deliberately
 * no NODE_ENV === 'production' guard here.
 */
const prisma = new PrismaClient();

const PERMISSIONS = [...ADMIN_PERMISSION_NAMES];

const has = (name: string): boolean => PERMISSIONS.includes(name as (typeof PERMISSIONS)[number]);

const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  SUPER_ADMIN: PERMISSIONS,
  // Ordinary ADMIN is broad for operational work but cannot manage the
  // Master Admin boundary, roles, or platform settings. Those stay Master-only.
  ADMIN: PERMISSIONS.filter(
    (permission) =>
      !permission.startsWith('admins.') &&
      !permission.startsWith('roles.'),
  ),
  FINANCE: [
    'wallets.read',
    'wallets.manage',
    'deposits.read',
    'deposits.review',
    'withdrawals.read',
    'withdrawals.review',
    'withdrawals.complete',
    'transactions.read',
    'reports.read',
  ].filter(has),
  SUPPORT: [
    'support.read',
    'support.reply',
    'support.assign',
    'support.update',
    'users.read',
    'bets.read',
    'betting.read',
    'transactions.read',
  ].filter(has),
  COMPLIANCE: [
    'users.read',
    'audit_logs.read',
    'transactions.read',
    'reports.read',
  ].filter(has),
  CONTENT_MANAGER: [
    'sports.read',
    'sports.manage',
    'casino.read',
    'casino.manage',
    'partner_providers.read',
    'partner_providers.update',
    'partner_providers.sync',
  ].filter(has),
  ANALYST: [
    'users.read',
    'betting.read',
    'bets.read',
    'wallets.read',
    'transactions.read',
    'reports.read',
  ].filter(has),
  USER: [],
};

async function main(): Promise<void> {
  for (const permissionName of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { name: permissionName },
      update: {},
      create: { name: permissionName },
    });
  }

  for (const [roleName, permissionNames] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });

    for (const permissionName of permissionNames) {
      const permission = await prisma.permission.findUnique({ where: { name: permissionName } });
      if (permission) {
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
          update: {},
          create: { roleId: role.id, permissionId: permission.id },
        });
      }
    }
  }

  console.log('Seed complete: roles and permissions provisioned.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
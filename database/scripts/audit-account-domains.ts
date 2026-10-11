/**
 * READ-ONLY account-domain audit — run BEFORE the accountType migration (or
 * any time afterwards to verify the separation held).
 *
 * It reports, without writing a single row:
 *   * total accounts;
 *   * CUSTOMER vs STAFF (the authoritative User.accountType classification);
 *   * how many accounts hold a non-USER role but are still classified CUSTOMER
 *     (i.e. rows the migration will reclassify);
 *   * the two Master Admin addresses (present / missing, SUPER_ADMIN / yes-no);
 *   * accounts with the hybrid role sets USER + ADMIN and USER + SUPER_ADMIN
 *     (the architecture this fix removes);
 *   * wallets: total, per account-domain, and — the important one — STAFF
 *     accounts that still own a customer wallet;
 *   * financial + gameplay history totals (bets, deposits, withdrawals,
 *     ledger entries, sessions, audit logs) so the operator can confirm that
 *     the migration is classification-only.
 *
 * Usage (from apps/api):
 *   npx ts-node ../../database/scripts/audit-account-domains.ts
 *
 * Requires only SELECT privileges. The script never issues INSERT/UPDATE/
 * DELETE/DDL — it is safe to run against production at any time.
 *
 * Note: the generated Prisma client is imported via its explicit /index.js —
 * required for Node ≥22.18 where native type-stripping loads this script as
 * ESM (directory imports are unsupported there), while still working under
 * ts-node's CommonJS compilation. TS5097 is suppressed inline for the same
 * reason as the other scripts in this directory.
 */
import { PrismaClient } from '../../apps/api/src/generated/prisma/index.js';
// @ts-expect-error TS5097 - Node's native ESM loader requires the explicit .ts extension.
import { getMasterAdminEmails } from '../../apps/api/src/config/master-admins.ts';

/** The customer domain role name — the ONLY role a real customer account holds. */
const CUSTOMER_ROLE = 'USER';

export interface AccountDomainAudit {
  totalAccounts: number;
  customers: number;
  staff: number;
  /** Accounts holding a non-USER role but still classified CUSTOMER. */
  hybridRoleButCustomer: number;
  /** USER + ADMIN — the hybrid role set this architecture removes. */
  userPlusAdmin: number;
  /** USER + SUPER_ADMIN — the hybrid role set this architecture removes. */
  userPlusSuperAdmin: number;
  masterAdmins: {
    email: string;
    exists: boolean;
    hasSuperAdmin: boolean;
    accountType: string | null;
    hasCustomerRole: boolean;
  }[];
  wallets: {
    total: number;
    customerOwned: number;
    staffOwned: number;
  };
  /** STAFF accounts that own at least one wallet row (must stay 0 going forward). */
  staffAccountsWithWallets: number;
  history: {
    bets: number;
    deposits: number;
    withdrawals: number;
    ledgerEntries: number;
    walletTransactions: number;
    sessions: number;
    auditLogs: number;
    supportMessages: number;
  };
}

/** Read-only history totals — proves the migration touches no financial data. */
async function readHistoryCounts(
  prisma: PrismaClient,
): Promise<AccountDomainAudit['history']> {
  const [
    bets,
    deposits,
    withdrawals,
    ledgerEntries,
    walletTransactions,
    sessions,
    auditLogs,
    supportMessages,
  ] = await Promise.all([
    prisma.bet.count(),
    prisma.manualDepositRequest.count(),
    prisma.withdrawalRequest.count(),
    prisma.ledgerEntry.count(),
    prisma.walletTransaction.count(),
    prisma.session.count(),
    prisma.auditLog.count(),
    prisma.supportMessage.count(),
  ]);
  return {
    bets,
    deposits,
    withdrawals,
    ledgerEntries,
    walletTransactions,
    sessions,
    auditLogs,
    supportMessages,
  };
}

/**
 * Collects every metric with read-only queries. Exported so the test suite can
 * assert the report shape without a database.
 */
export async function collectAccountDomainAudit(
  prisma: PrismaClient,
): Promise<AccountDomainAudit> {
  const accountTypeGroups = await prisma.user.groupBy({
    by: ['accountType'],
    _count: { _all: true },
  });

  // Role-name counts are derived from selected rows (never a raw join) so the
  // script stays portable across Prisma versions.
  const roleRows = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      accountType: true,
      userRoles: { select: { role: { select: { name: true } } } },
    },
  });

  let hybridCustomerRows = 0;
  let userPlusAdmin = 0;
  let userPlusSuperAdmin = 0;
  for (const row of roleRows) {
    const names = row.userRoles.map((ur) => ur.role.name);
    const hasCustomerRole = names.includes(CUSTOMER_ROLE);
    const staffRoles = names.filter((name) => name !== CUSTOMER_ROLE);
    if (row.accountType === 'CUSTOMER' && staffRoles.length > 0) hybridCustomerRows += 1;
    if (hasCustomerRole && names.includes('ADMIN')) userPlusAdmin += 1;
    if (hasCustomerRole && names.includes('SUPER_ADMIN')) userPlusSuperAdmin += 1;
  }

  const masters: AccountDomainAudit['masterAdmins'] = [];
  // Prefer the configured allowlist; when MASTER_ADMIN_EMAILS is not exported
  // to this shell (common for local runs), derive the same set from the rows
  // currently holding SUPER_ADMIN — read-only, never guesses beyond that.
  const configuredEmails = getMasterAdminEmails();
  const masterEmails =
    configuredEmails.length > 0
      ? configuredEmails
      : roleRows
          .filter((row) => row.userRoles.some((ur) => ur.role.name === 'SUPER_ADMIN'))
          .map((row) => row.email)
          .filter((email): email is string => email !== null);
  for (const email of masterEmails) {
    const row = await prisma.user.findUnique({
      where: { email },
      select: {
        accountType: true,
        userRoles: { select: { role: { select: { name: true } } } },
      },
    });
    const names = row?.userRoles.map((ur) => ur.role.name) ?? [];
    masters.push({
      email,
      exists: Boolean(row),
      hasSuperAdmin: names.includes('SUPER_ADMIN'),
      accountType: row?.accountType ?? null,
      hasCustomerRole: names.includes(CUSTOMER_ROLE),
    });
  }

  const walletGroups = await prisma.wallet.groupBy({
    by: ['userId'],
    _count: { _all: true },
  });
  // Resolve each wallet owner's account domain in one pass.
  const walletOwners = await prisma.user.findMany({
    where: { wallets: { some: {} } },
    select: { id: true, accountType: true },
  });
  const walletOwnerType = new Map(walletOwners.map((u) => [u.id, u.accountType]));
  const perType: { accountType: string; count: number }[] = [];
  let staffAccountsWithWallets = 0;
  for (const group of walletGroups) {
    const type = walletOwnerType.get(group.userId) ?? 'UNKNOWN';
    const bucket = perType.find((entry) => entry.accountType === type);
    if (bucket) bucket.count += group._count._all;
    else perType.push({ accountType: type, count: group._count._all });
    if (type === 'STAFF') staffAccountsWithWallets += 1;
  }

  const countFor = (accountType: string): number =>
    accountTypeGroups.find((g) => g.accountType === accountType)?._count._all ?? 0;

  return {
    totalAccounts: accountTypeGroups.reduce((sum, g) => sum + g._count._all, 0),
    customers: countFor('CUSTOMER'),
    staff: countFor('STAFF'),
    hybridRoleButCustomer: hybridCustomerRows,
    userPlusAdmin,
    userPlusSuperAdmin,
    masterAdmins: masters,
    wallets: {
      total: perType.reduce((sum, g) => sum + g.count, 0),
      customerOwned: perType.find((g) => g.accountType === 'CUSTOMER')?.count ?? 0,
      staffOwned: perType.find((g) => g.accountType === 'STAFF')?.count ?? 0,
    },
    staffAccountsWithWallets,
    history: await readHistoryCounts(prisma),
  };
}

/** Renders the audit as an operator-readable report (never mutates anything). */
export function formatAccountDomainAudit(audit: AccountDomainAudit): string {
  const lines = [
    'TANVION ROYALE — account-domain audit (read-only, no writes)',
    '',
    `total accounts ........................ ${audit.totalAccounts}`,
    `  CUSTOMER ............................ ${audit.customers}`,
    `  STAFF ............................... ${audit.staff}`,
    '',
    `staff-role account still CUSTOMER ...... ${audit.hybridRoleButCustomer}`,
    `USER + ADMIN ........................... ${audit.userPlusAdmin}`,
    `USER + SUPER_ADMIN ..................... ${audit.userPlusSuperAdmin}`,
    '',
    'master admins:',
    ...audit.masterAdmins.map(
      (m) =>
        `  ${m.email} — exists=${m.exists} superAdmin=${m.hasSuperAdmin} ` +
        `accountType=${m.accountType ?? 'n/a'} customerRole=${m.hasCustomerRole}`,
    ),
    '',
    `wallets ............................... ${audit.wallets.total}`,
    `  customer-owned ...................... ${audit.wallets.customerOwned}`,
    `  staff-owned ......................... ${audit.wallets.staffOwned}`,
    `STAFF accounts owning wallets .......... ${audit.staffAccountsWithWallets}`,
    '',
    'history (must be unchanged by the migration):',
    `  bets ................................ ${audit.history.bets}`,
    `  deposits ............................ ${audit.history.deposits}`,
    `  withdrawals ......................... ${audit.history.withdrawals}`,
    `  ledger entries ...................... ${audit.history.ledgerEntries}`,
    `  wallet transactions ................. ${audit.history.walletTransactions}`,
    `  sessions ............................ ${audit.history.sessions}`,
    `  audit logs .......................... ${audit.history.auditLogs}`,
    `  support messages .................... ${audit.history.supportMessages}`,
  ];
  return lines.join('\n');
}

async function main(): Promise<void> {
  // Created here (not at import time) so importing this module never opens a
  // database connection — the test suite imports it freely.
  const prisma = new PrismaClient();
  try {
    console.log(formatAccountDomainAudit(await collectAccountDomainAudit(prisma)));
  } finally {
    await prisma.$disconnect();
  }
}

/** True only when this file is the process entry point (never when imported). */
function isCliEntryPoint(fileName: string): boolean {
  return (process.argv[1] ?? '').endsWith(fileName);
}

if (isCliEntryPoint('audit-account-domains.ts') || isCliEntryPoint('audit-account-domains.js')) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

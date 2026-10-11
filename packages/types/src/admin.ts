/**
 * Canonical staff capability names.
 *
 * These are database permission names, not UI labels. Keep the list aligned
 * with the actual Admin controllers and use RequirePermissions on every
 * protected admin route. The old names (reports.read, transactions.read,
 * bets.read, ...) remain valid compatibility entries while deployments migrate.
 */
export const ADMIN_PERMISSIONS = {
  DASHBOARD_READ: 'dashboard.read',

  USERS_READ: 'users.read',
  USERS_UPDATE: 'users.update',
  USERS_SUSPEND: 'users.suspend',
  USERS_BAN: 'users.ban',
  USERS_UNBAN: 'users.unban',
  USERS_RESET_PASSWORD: 'users.reset_password',
  USERS_DELETE: 'users.delete',

  ADMINS_READ: 'admins.read',
  ADMINS_CREATE: 'admins.create',
  ADMINS_UPDATE: 'admins.update',
  ADMINS_DEACTIVATE: 'admins.deactivate',
  ADMINS_RESET_PASSWORD: 'admins.reset_password',
  ADMINS_ROLES_MANAGE: 'admins.roles.manage',

  ROLES_READ: 'roles.read',
  ROLES_CREATE: 'roles.create',
  ROLES_UPDATE: 'roles.update',
  ROLES_DELETE: 'roles.delete',
  ROLES_ASSIGN: 'roles.assign',

  SUPPORT_READ: 'support.read',
  SUPPORT_REPLY: 'support.reply',
  SUPPORT_ASSIGN: 'support.assign',
  SUPPORT_UPDATE: 'support.update',

  NOTIFICATIONS_READ: 'notifications.read',
  NOTIFICATIONS_SEND: 'notifications.send',

  BETTING_READ: 'betting.read',
  BETTING_SETTLE: 'betting.settle',

  WALLETS_READ: 'wallets.read',
  WALLETS_MANAGE: 'wallets.manage',

  DEPOSITS_READ: 'deposits.read',
  DEPOSITS_REVIEW: 'deposits.review',

  WITHDRAWALS_READ: 'withdrawals.read',
  WITHDRAWALS_REVIEW: 'withdrawals.review',
  WITHDRAWALS_COMPLETE: 'withdrawals.complete',

  PAYMENT_METHODS_READ: 'payment_methods.read',
  PAYMENT_METHODS_CREATE: 'payment_methods.create',
  PAYMENT_METHODS_UPDATE: 'payment_methods.update',
  PAYMENT_METHODS_ARCHIVE: 'payment_methods.archive',

  PAYMENT_GATEWAYS_READ: 'payment_gateways.read',
  PAYMENT_GATEWAYS_CREATE: 'payment_gateways.create',
  PAYMENT_GATEWAYS_UPDATE: 'payment_gateways.update',
  PAYMENT_GATEWAYS_DELETE: 'payment_gateways.delete',
  PAYMENT_GATEWAYS_TEST: 'payment_gateways.test',

  SPORTS_READ: 'sports.read',
  SPORTS_MANAGE: 'sports.manage',

  CASINO_READ: 'casino.read',
  CASINO_MANAGE: 'casino.manage',

  CRASH_READ: 'crash.read',
  CRASH_MANAGE: 'crash.manage',

  // Royale Play (internally developed Plinko + Mines). Separate capabilities
  // from crash so reading Royale settlements/config never implies the ability
  // to change it, and vice versa. Provisioned by the
  // 20261009000000_add_royale_plinko_mines migration and seed-roles.ts.
  ROYALE_READ: 'royale.read',
  ROYALE_MANAGE: 'royale.manage',

  PARTNER_PROVIDERS_READ: 'partner_providers.read',
  PARTNER_PROVIDERS_CREATE: 'partner_providers.create',
  PARTNER_PROVIDERS_UPDATE: 'partner_providers.update',
  PARTNER_PROVIDERS_DELETE: 'partner_providers.delete',
  PARTNER_PROVIDERS_SYNC: 'partner_providers.sync',

  TRADING_READ: 'trading.read',
  TRADING_MANAGE: 'trading.manage',

  WINHOUSE_READ: 'winhouse.read',
  WINHOUSE_TEST: 'winhouse.test',

  AUDIT_LOGS_READ: 'audit_logs.read',
  SETTINGS_READ: 'settings.read',
  // Writing platform configuration (e.g. the SMS provider selection) is a
  // separate capability from reading it, so an operator can audit the
  // configuration without being able to change how OTP messages are sent.
  SETTINGS_WRITE: 'settings.write',

  // Existing catalog names retained for already-provisioned roles.
  BETS_READ: 'bets.read',
  TRANSACTIONS_READ: 'transactions.read',
  REPORTS_READ: 'reports.read',
} as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[keyof typeof ADMIN_PERMISSIONS];

export const ADMIN_PERMISSION_NAMES: readonly AdminPermission[] = Object.values(
  ADMIN_PERMISSIONS,
);

/** Grouped metadata used by the permission editor; the names remain canonical. */
export const ADMIN_PERMISSION_GROUPS: ReadonlyArray<{
  module: string;
  permissions: ReadonlyArray<{ name: AdminPermission; label: string }>;
}> = [
  { module: 'Dashboard', permissions: [{ name: ADMIN_PERMISSIONS.DASHBOARD_READ, label: 'Read' }] },
  {
    module: 'Users',
    permissions: [
      { name: ADMIN_PERMISSIONS.USERS_READ, label: 'Read' },
      { name: ADMIN_PERMISSIONS.USERS_UPDATE, label: 'Update' },
      { name: ADMIN_PERMISSIONS.USERS_SUSPEND, label: 'Suspend' },
      { name: ADMIN_PERMISSIONS.USERS_BAN, label: 'Ban' },
      { name: ADMIN_PERMISSIONS.USERS_UNBAN, label: 'Unban' },
      { name: ADMIN_PERMISSIONS.USERS_RESET_PASSWORD, label: 'Reset password' },
      { name: ADMIN_PERMISSIONS.USERS_DELETE, label: 'Delete' },
    ],
  },
  {
    module: 'Admins',
    permissions: [
      { name: ADMIN_PERMISSIONS.ADMINS_READ, label: 'Read' },
      { name: ADMIN_PERMISSIONS.ADMINS_CREATE, label: 'Create' },
      { name: ADMIN_PERMISSIONS.ADMINS_UPDATE, label: 'Update' },
      { name: ADMIN_PERMISSIONS.ADMINS_DEACTIVATE, label: 'Deactivate' },
      { name: ADMIN_PERMISSIONS.ADMINS_RESET_PASSWORD, label: 'Reset password' },
      { name: ADMIN_PERMISSIONS.ADMINS_ROLES_MANAGE, label: 'Manage roles' },
    ],
  },
  {
    module: 'Roles',
    permissions: [
      { name: ADMIN_PERMISSIONS.ROLES_READ, label: 'Read' },
      { name: ADMIN_PERMISSIONS.ROLES_CREATE, label: 'Create' },
      { name: ADMIN_PERMISSIONS.ROLES_UPDATE, label: 'Edit' },
      { name: ADMIN_PERMISSIONS.ROLES_DELETE, label: 'Delete' },
      { name: ADMIN_PERMISSIONS.ROLES_ASSIGN, label: 'Assign' },
    ],
  },
  {
    module: 'Support',
    permissions: [
      { name: ADMIN_PERMISSIONS.SUPPORT_READ, label: 'Read' },
      { name: ADMIN_PERMISSIONS.SUPPORT_REPLY, label: 'Reply' },
      { name: ADMIN_PERMISSIONS.SUPPORT_ASSIGN, label: 'Assign' },
      { name: ADMIN_PERMISSIONS.SUPPORT_UPDATE, label: 'Update status' },
    ],
  },
  {
    module: 'Notifications',
    permissions: [
      { name: ADMIN_PERMISSIONS.NOTIFICATIONS_READ, label: 'Read' },
      { name: ADMIN_PERMISSIONS.NOTIFICATIONS_SEND, label: 'Send' },
    ],
  },
  {
    module: 'Betting',
    permissions: [
      { name: ADMIN_PERMISSIONS.BETTING_READ, label: 'Read' },
      { name: ADMIN_PERMISSIONS.BETTING_SETTLE, label: 'Settle' },
    ],
  },
  {
    module: 'Wallets',
    permissions: [
      { name: ADMIN_PERMISSIONS.WALLETS_READ, label: 'Read' },
      { name: ADMIN_PERMISSIONS.WALLETS_MANAGE, label: 'Manage / adjust' },
    ],
  },
  {
    module: 'Deposits',
    permissions: [
      { name: ADMIN_PERMISSIONS.DEPOSITS_READ, label: 'Read' },
      { name: ADMIN_PERMISSIONS.DEPOSITS_REVIEW, label: 'Review' },
    ],
  },
  {
    module: 'Withdrawals',
    permissions: [
      { name: ADMIN_PERMISSIONS.WITHDRAWALS_READ, label: 'Read' },
      { name: ADMIN_PERMISSIONS.WITHDRAWALS_REVIEW, label: 'Review' },
      { name: ADMIN_PERMISSIONS.WITHDRAWALS_COMPLETE, label: 'Complete' },
    ],
  },
  {
    module: 'Payment methods',
    permissions: [
      { name: ADMIN_PERMISSIONS.PAYMENT_METHODS_READ, label: 'Read' },
      { name: ADMIN_PERMISSIONS.PAYMENT_METHODS_CREATE, label: 'Create' },
      { name: ADMIN_PERMISSIONS.PAYMENT_METHODS_UPDATE, label: 'Update' },
      { name: ADMIN_PERMISSIONS.PAYMENT_METHODS_ARCHIVE, label: 'Archive' },
    ],
  },
  {
    module: 'Payment gateways',
    permissions: [
      { name: ADMIN_PERMISSIONS.PAYMENT_GATEWAYS_READ, label: 'Read' },
      { name: ADMIN_PERMISSIONS.PAYMENT_GATEWAYS_CREATE, label: 'Create' },
      { name: ADMIN_PERMISSIONS.PAYMENT_GATEWAYS_UPDATE, label: 'Update' },
      { name: ADMIN_PERMISSIONS.PAYMENT_GATEWAYS_DELETE, label: 'Delete / archive' },
      { name: ADMIN_PERMISSIONS.PAYMENT_GATEWAYS_TEST, label: 'Test' },
    ],
  },
  {
    module: 'Sports',
    permissions: [
      { name: ADMIN_PERMISSIONS.SPORTS_READ, label: 'Read' },
      { name: ADMIN_PERMISSIONS.SPORTS_MANAGE, label: 'Manage catalog' },
    ],
  },
  {
    module: 'Casino',
    permissions: [
      { name: ADMIN_PERMISSIONS.CASINO_READ, label: 'Read' },
      { name: ADMIN_PERMISSIONS.CASINO_MANAGE, label: 'Manage / sync' },
    ],
  },
  {
    module: 'Crash',
    permissions: [
      { name: ADMIN_PERMISSIONS.CRASH_READ, label: 'Read' },
      { name: ADMIN_PERMISSIONS.CRASH_MANAGE, label: 'Manage sequence' },
    ],
  },
  {
    module: 'Royale Play',
    permissions: [
      { name: ADMIN_PERMISSIONS.ROYALE_READ, label: 'Read status / settlements' },
      { name: ADMIN_PERMISSIONS.ROYALE_MANAGE, label: 'Manage configuration' },
    ],
  },
  {
    module: 'Partner providers',
    permissions: [
      { name: ADMIN_PERMISSIONS.PARTNER_PROVIDERS_READ, label: 'Read' },
      { name: ADMIN_PERMISSIONS.PARTNER_PROVIDERS_CREATE, label: 'Create' },
      { name: ADMIN_PERMISSIONS.PARTNER_PROVIDERS_UPDATE, label: 'Update' },
      { name: ADMIN_PERMISSIONS.PARTNER_PROVIDERS_DELETE, label: 'Delete' },
      { name: ADMIN_PERMISSIONS.PARTNER_PROVIDERS_SYNC, label: 'Sync' },
    ],
  },
  {
    module: 'Trading',
    permissions: [
      { name: ADMIN_PERMISSIONS.TRADING_READ, label: 'Read' },
      { name: ADMIN_PERMISSIONS.TRADING_MANAGE, label: 'Manage instruments' },
    ],
  },
  {
    module: 'WinHouse',
    permissions: [
      { name: ADMIN_PERMISSIONS.WINHOUSE_READ, label: 'Read status' },
      { name: ADMIN_PERMISSIONS.WINHOUSE_TEST, label: 'Run self-test' },
    ],
  },
  {
    module: 'Settings',
    permissions: [
      { name: ADMIN_PERMISSIONS.SETTINGS_READ, label: 'Read configuration' },
      { name: ADMIN_PERMISSIONS.SETTINGS_WRITE, label: 'Change configuration' },
    ],
  },
  {
    module: 'Audit / compliance',
    permissions: [
      { name: ADMIN_PERMISSIONS.AUDIT_LOGS_READ, label: 'Read audit logs' },
    ],
  },
];


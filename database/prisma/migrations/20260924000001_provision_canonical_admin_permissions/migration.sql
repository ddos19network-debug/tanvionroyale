-- Canonical staff permission catalog and safe default role mappings.
--
-- This migration is additive and idempotent by unique name/key. It provisions
-- only permission/role metadata; it never creates a user, grants SUPER_ADMIN,
-- or changes wallets, bets, payments, sessions, KYC rows, or audit history.
-- The two configured Master Admin identities remain governed by MASTER_ADMIN_EMAILS.

-- 1. Canonical capability names. Compatibility names remain in the catalog
--    because existing roles may still use them during the transition.
INSERT INTO "Permission" ("id", "name")
SELECT md5('tanvion-admin-permission:' || catalog.name), catalog.name
FROM (
  VALUES
    ('dashboard.read'),
    ('users.read'), ('users.update'), ('users.suspend'), ('users.ban'),
    ('users.unban'), ('users.reset_password'), ('users.delete'),
    ('admins.read'), ('admins.create'), ('admins.update'), ('admins.deactivate'),
    ('admins.reset_password'), ('admins.roles.manage'),
    ('roles.read'), ('roles.create'), ('roles.update'), ('roles.delete'), ('roles.assign'),
    ('support.read'), ('support.reply'), ('support.assign'), ('support.update'),
    ('notifications.read'), ('notifications.send'),
    ('betting.read'), ('betting.settle'),
    ('wallets.read'), ('wallets.manage'),
    ('deposits.read'), ('deposits.review'),
    ('withdrawals.read'), ('withdrawals.review'), ('withdrawals.complete'),
    ('payment_methods.read'), ('payment_methods.create'), ('payment_methods.update'), ('payment_methods.archive'),
    ('payment_gateways.read'), ('payment_gateways.create'), ('payment_gateways.update'),
    ('payment_gateways.delete'), ('payment_gateways.test'),
    ('sports.read'), ('sports.manage'),
    ('casino.read'), ('casino.manage'),
    ('crash.read'), ('crash.manage'),
    ('partner_providers.read'), ('partner_providers.create'), ('partner_providers.update'),
    ('partner_providers.delete'), ('partner_providers.sync'),
    ('trading.read'), ('trading.manage'),
    ('winhouse.read'), ('winhouse.test'),
    ('audit_logs.read'), ('settings.read'),
    ('bets.read'), ('transactions.read'), ('reports.read')
) AS catalog(name)
ON CONFLICT ("name") DO NOTHING;

-- 2. Ensure the established default roles exist. No role grants authority to a
--    user by itself; UserRole remains the only user-to-role assignment table.
INSERT INTO "Role" ("id", "name", "description", "createdAt", "updatedAt")
SELECT
  md5('tanvion-admin-role:' || catalog.name),
  catalog.name,
  catalog.description,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  VALUES
    ('SUPER_ADMIN', 'Protected Master Admin role'),
    ('ADMIN', 'Operational staff administrator'),
    ('FINANCE', 'Finance operations role'),
    ('SUPPORT', 'Customer support role'),
    ('COMPLIANCE', 'Compliance and audit role'),
    ('CONTENT_MANAGER', 'Catalog content operations role'),
    ('ANALYST', 'Reporting and analysis role'),
    ('USER', 'Customer account role')
) AS catalog(name, description)
ON CONFLICT ("name") DO NOTHING;

-- 3. Master/ordinary defaults. Existing role grants are preserved; this only
--    adds missing links, and ordinary ADMIN never receives admin/role management.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role_row.id, permission_row.id
FROM "Role" role_row
CROSS JOIN "Permission" permission_row
WHERE role_row.name = 'SUPER_ADMIN'
  AND permission_row.name NOT LIKE 'kyc.%'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- 4. Ordinary ADMIN defaults. Existing role grants are preserved; this only
--    adds missing links, and ordinary ADMIN never receives admin/role management.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role_row.id, permission_row.id
FROM "Role" role_row
CROSS JOIN "Permission" permission_row
WHERE role_row.name = 'ADMIN'
  AND permission_row.name NOT LIKE 'admins.%'
  AND permission_row.name NOT LIKE 'roles.%'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- 5. Named operational role defaults. These are additive links only; a role
--    can be edited later through the Master Admin role editor.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role_row.id, permission_row.id
FROM "Role" role_row
CROSS JOIN "Permission" permission_row
WHERE (role_row.name, permission_row.name) IN (
  ('FINANCE', 'wallets.read'), ('FINANCE', 'wallets.manage'),
  ('FINANCE', 'deposits.read'), ('FINANCE', 'deposits.review'),
  ('FINANCE', 'withdrawals.read'), ('FINANCE', 'withdrawals.review'),
  ('FINANCE', 'withdrawals.complete'),
  ('SUPPORT', 'support.read'), ('SUPPORT', 'support.reply'),
  ('SUPPORT', 'support.assign'), ('SUPPORT', 'support.update'),
  ('SUPPORT', 'users.read'), ('SUPPORT', 'betting.read'),
  ('COMPLIANCE', 'users.read'), ('COMPLIANCE', 'audit_logs.read'),
  ('CONTENT_MANAGER', 'sports.read'), ('CONTENT_MANAGER', 'sports.manage'),
  ('CONTENT_MANAGER', 'casino.read'), ('CONTENT_MANAGER', 'casino.manage'),
  ('CONTENT_MANAGER', 'partner_providers.read'),
  ('CONTENT_MANAGER', 'partner_providers.update'),
  ('CONTENT_MANAGER', 'partner_providers.sync'),
  ('ANALYST', 'users.read'), ('ANALYST', 'betting.read'),
  ('ANALYST', 'wallets.read')
)
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

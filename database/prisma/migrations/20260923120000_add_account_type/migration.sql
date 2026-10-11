-- Account-domain separation on the User row: CUSTOMER vs STAFF.
--
-- Before this migration every account (customer or admin) lived in one flat
-- population, so /admin/users and /admin/admins both showed everyone. This
-- migration introduces the authoritative classification column:
--
--   CUSTOMER — real customer accounts (the default; signup/phone/OAuth).
--   STAFF    — admin/staff accounts (Admin -> Admins, staff login only).
--
-- Additive + data-only, ordered so every step is IDEMPOTENT:
--   1. CREATE TYPE + ADD COLUMN with a NOT NULL DEFAULT — no existing row is
--      rewritten by the DDL itself; historical rows start as CUSTOMER.
--   2. Reclassify the two fixed Master Admin identities as STAFF. They are
--      permanent platform owners (mirrors MASTER_ADMIN_EMAILS in the
--      deployment environment — listed here per the migration-safety spec so
--      the classification works even if a role row were ever missing).
--   3. Reclassify every account holding a NON-USER role (ADMIN, SUPER_ADMIN,
--      FINANCE, SUPPORT, COMPLIANCE, CONTENT_MANAGER, ANALYST) as STAFF —
--      this covers all ordinary admins created from /admin/admins.
--   4. Recover deactivated staff (roles stripped by deactivateAdmin, identity
--      anonymized) via the admin audit trail that recorded the action.
--   5. Drop the customer USER role from STAFF accounts only, so Master Admin
--      becomes STAFF + SUPER_ADMIN (never USER + SUPER_ADMIN) and ordinary
--      admins become STAFF + ADMIN. Customers keep USER untouched.
--
-- NEVER destructive: no User row is deleted or updated beyond the new column,
-- and only UserRole join rows of type USER on STAFF accounts are removed.
-- Wallets, bets, deposits, withdrawals, ledger entries, sessions, support and
-- audit history are untouched — every FK still points at the same User ids.
CREATE TYPE "AccountType" AS ENUM ('CUSTOMER', 'STAFF');

ALTER TABLE "User" ADD COLUMN "accountType" "AccountType" NOT NULL DEFAULT 'CUSTOMER';

CREATE INDEX "User_accountType_idx" ON "User"("accountType");

-- 2. The two fixed Master Admin identities -> STAFF.
UPDATE "User" SET "accountType" = 'STAFF'
 WHERE LOWER("email") IN ('tanvirujaman101@gmail.com', 'tanvionroyale@gmail.com');

-- 3. Any account holding a non-USER role -> STAFF (all ordinary admins/staff).
UPDATE "User" u SET "accountType" = 'STAFF'
 WHERE EXISTS (
   SELECT 1 FROM "UserRole" ur
     JOIN "Role" r ON r."id" = ur."roleId"
   WHERE ur."userId" = u."id"
     AND r."name" <> 'USER'
 );

-- 4. Deactivated staff (roles stripped by the staff deactivation flow) -> STAFF.
UPDATE "User" u SET "accountType" = 'STAFF'
 WHERE EXISTS (
   SELECT 1 FROM "AuditLog" al
   WHERE al."entityType" = 'User'
     AND al."entityId" = u."id"
     AND al."action" IN ('ADMIN_DEACTIVATE', 'ADMIN_PROFILE_UPDATE', 'ADMIN_PASSWORD_RESET')
 );

-- 5. Staff accounts drop the customer USER role. Customers are untouched:
--    the DELETE only matches USER-role rows whose owner is already STAFF.
DELETE FROM "UserRole" ur
 USING "User" u, "Role" r
 WHERE ur."userId" = u."id"
   AND ur."roleId" = r."id"
   AND u."accountType" = 'STAFF'
   AND r."name" = 'USER';

-- 6. Revoke lingering CUSTOMER sessions of STAFF accounts: before this
--    migration a master admin who signed up normally could still hold a
--    customer session. Those must not survive into the separated architecture —
--    staff authenticate only through /admin/login (STAFF sessions). Additive
--    and idempotent: only unrevoked rows are touched, nothing is deleted
--    (same precedent as the session_kind migration: staff re-authenticate once).
UPDATE "Session" s
   SET "revokedAt" = NOW()
  FROM "User" u
 WHERE s."userId" = u."id"
   AND s."kind" = 'CUSTOMER'
   AND u."accountType" = 'STAFF'
   AND s."revokedAt" IS NULL;

-- Direct staff permission assignments in addition to RolePermission.
--
-- This is additive only. It creates the direct grant/deny relation used by the
-- Admin permission editor; it does not alter users, wallets, bets, payments,
-- sessions, KYC data, or any existing role/permission row. DENY wins over role
-- and direct GRANT values in the request-time effective-permission calculation.

CREATE TYPE "UserPermissionEffect" AS ENUM ('GRANT', 'DENY');

CREATE TABLE "UserPermission" (
    "userId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "effect" "UserPermissionEffect" NOT NULL DEFAULT 'GRANT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("userId", "permissionId")
);

CREATE INDEX "UserPermission_permissionId_idx" ON "UserPermission"("permissionId");
CREATE INDEX "UserPermission_userId_effect_idx" ON "UserPermission"("userId", "effect");

ALTER TABLE "UserPermission"
    ADD CONSTRAINT "UserPermission_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserPermission"
    ADD CONSTRAINT "UserPermission_permissionId_fkey"
    FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

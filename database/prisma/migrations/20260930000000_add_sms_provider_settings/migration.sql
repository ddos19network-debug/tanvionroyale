-- ===========================================================================
-- TANVION ROYALE - SMS DELIVERY PROVIDER SELECTION (admin-controlled)
--
-- ADDITIVE ONLY. Two new enums, one new single-row table and one new
-- permission. It never drops or rewrites an existing table, never deletes a
-- row, and never touches a user, a wallet, a ledger entry, a bet, a session or
-- an OTP record. The existing Twilio SMS delivery path keeps working exactly
-- as before, with or without this migration applied.
--
-- DO NOT ADD A UTF-8 BOM TO THIS FILE. That is exactly what broke production on
-- 2026-09-26: the first commit of that migration (4342381) began with the
-- three BOM bytes EF BB BF, and the first statement in every migration here is
-- a `--` comment. PostgreSQL does not treat U+FEFF as whitespace, so `--` was
-- not at the start of a token and the whole batched script failed to parse
-- BEFORE statement 0 ran. Prisma recorded the failure in _prisma_migrations
-- and every later deploy then died with P3009 even after the BOM was removed.
-- This file is pure ASCII; a regression test
-- (apps/api/test/migration-encoding.spec.ts) fails the build if a BOM is ever
-- reintroduced into any migration.sql.
-- ===========================================================================

-- 1. Enums -------------------------------------------------------------------
-- SmsProviderName is the concrete provider set; SmsProviderMode adds AUTO on
-- top of it for the primary -> fallback chain.
CREATE TYPE "SmsProviderName" AS ENUM ('TWILIO', 'VONAGE');
CREATE TYPE "SmsProviderMode" AS ENUM ('TWILIO', 'VONAGE', 'AUTO');

-- 2. Singleton settings row --------------------------------------------------
-- The table stores the provider SELECTION only. There is deliberately no
-- column for an API key, an API secret, an Account SID, an Auth Token or a
-- sender number: provider credentials stay in the server/Render environment
-- variables, so this table can never leak a secret through the admin API, a
-- backup or a log line. The defaults reproduce today's behavior exactly
-- (Twilio delivers, Vonage is the failover target).
CREATE TABLE "SmsProviderSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "smsProvider" "SmsProviderMode" NOT NULL DEFAULT 'TWILIO',
    "primarySmsProvider" "SmsProviderName" NOT NULL DEFAULT 'TWILIO',
    "fallbackSmsProvider" "SmsProviderName" NOT NULL DEFAULT 'VONAGE',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "SmsProviderSettings_pkey" PRIMARY KEY ("id")
);

-- 3. The single row ----------------------------------------------------------
-- id = 1 is the singleton. Seeding it here (rather than waiting for a lazy
-- create on first read) keeps the admin panel's "current provider" identical
-- before and after the migration, and makes the "no row exists" branch a
-- defensive fallback instead of the normal path.
INSERT INTO "SmsProviderSettings" ("id", "smsProvider", "primarySmsProvider", "fallbackSmsProvider", "updatedAt")
VALUES (1, 'TWILIO', 'TWILIO', 'VONAGE', CURRENT_TIMESTAMP);

-- 4. Index -------------------------------------------------------------------
CREATE INDEX "SmsProviderSettings_smsProvider_idx" ON "SmsProviderSettings"("smsProvider");

-- 5. Staff capability for changing the provider selection --------------------
-- Read-only staff keep `settings.read`; writing the SMS provider selection is a
-- separate capability so viewing configuration and changing how OTP messages
-- leave the platform are never the same grant. The permission row is inserted
-- with the same md5() id convention the canonical-permission migration uses, so
-- it is idempotent and re-runnable.
INSERT INTO "Permission" ("id", "name")
VALUES (md5('tanvion-admin-permission:settings.write'), 'settings.write')
ON CONFLICT ("name") DO NOTHING;

-- Every role that already holds `settings.read` (SUPER_ADMIN and ADMIN by
-- default) additionally receives `settings.write`, so enabling the capability
-- never silently strips an existing admin of access to the SMS provider panel.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT reader."roleId", write_perm."id"
FROM "RolePermission" reader
JOIN "Permission" read_perm
  ON read_perm."id" = reader."permissionId"
 AND read_perm."name" = 'settings.read'
JOIN "Permission" write_perm
  ON write_perm."name" = 'settings.write'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

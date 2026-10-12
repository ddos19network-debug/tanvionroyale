-- TANVION ROYALE - PART A: central jurisdiction & currency control.
--
-- ADDITIVE ONLY. Creates two new enums and three new tables. It never drops,
-- alters, truncates, updates or deletes any existing table or row: users,
-- wallets, ledger entries, bets, royale rounds and payments are all untouched.
-- These tables hold NO balance of any kind - they only record the per-country
-- rules, the append-only change history and the real-money kill switches that
-- the Royale REAL_MONEY eligibility gate enforces BEFORE any wallet
-- reservation.
--
-- File is pure ASCII with NO UTF-8 BOM (see migration-encoding.spec.ts and the
-- 2026-09-26 production failure). Do not add a BOM.
-- ============================================================================

-- 1. Enums -------------------------------------------------------------------
CREATE TYPE "JurisdictionStatus" AS ENUM ('ALLOWED', 'BLOCKED');

-- 2. Tables ------------------------------------------------------------------
-- One rule per country (ISO 3166-1 alpha-2, upper-case). A country with NO row
-- is BLOCKED at read time (fail closed); a rule whose effectiveFrom is in the
-- future is BLOCKED too.
CREATE TABLE "JurisdictionRule" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "status" "JurisdictionStatus" NOT NULL,
    "allowedCurrencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "licenceRef" TEXT,
    "reason" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JurisdictionRule_pkey" PRIMARY KEY ("id")
);

-- Append-only history: who, when, country, old -> new, reason. Rows are only
-- ever inserted; the API exposes no update or delete path.
CREATE TABLE "JurisdictionAuditLog" (
    "id" TEXT NOT NULL,
    "actorAdminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "oldStatus" TEXT,
    "newStatus" TEXT,
    "oldCurrencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "newCurrencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "oldLicenceRef" TEXT,
    "newLicenceRef" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JurisdictionAuditLog_pkey" PRIMARY KEY ("id")
);

-- Real-money kill switches. key = REAL_MONEY_ALL | GAME:<slug>.
-- Absence of a row means "no kill switch engaged".
CREATE TABLE "GlobalGameSwitch" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalGameSwitch_pkey" PRIMARY KEY ("id")
);

-- 3. Indexes -----------------------------------------------------------------
CREATE UNIQUE INDEX "JurisdictionRule_countryCode_key" ON "JurisdictionRule"("countryCode");
CREATE INDEX "JurisdictionRule_status_idx" ON "JurisdictionRule"("status");
CREATE INDEX "JurisdictionAuditLog_countryCode_createdAt_idx" ON "JurisdictionAuditLog"("countryCode", "createdAt");
CREATE INDEX "JurisdictionAuditLog_createdAt_idx" ON "JurisdictionAuditLog"("createdAt");
CREATE UNIQUE INDEX "GlobalGameSwitch_key_key" ON "GlobalGameSwitch"("key");
CREATE INDEX "GlobalGameSwitch_enabled_idx" ON "GlobalGameSwitch"("enabled");

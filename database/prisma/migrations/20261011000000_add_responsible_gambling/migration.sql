-- TANVION ROYALE - Responsible gambling controls (Task 2 / audit F3).
--
-- ADDITIVE ONLY. Creates two new protection tables and three new enums. It
-- never drops, alters, truncates, updates or deletes any existing table or row:
-- users, wallets, ledger entries, bets, royale rounds and payments are all
-- untouched. These tables hold NO balance of any kind - they only record the
-- self-exclusions and play limits that the Royale REAL_MONEY eligibility gate
-- enforces BEFORE any wallet reservation.
--
-- File is pure ASCII with NO UTF-8 BOM (see migration-encoding.spec.ts and the
-- 2026-09-26 production failure). Do not add a BOM.
-- ============================================================================

-- 1. Enums -------------------------------------------------------------------
CREATE TYPE "SelfExclusionType" AS ENUM ('COOLING_OFF', 'TEMPORARY', 'PERMANENT');
CREATE TYPE "PlayLimitKind" AS ENUM ('DEPOSIT', 'LOSS', 'STAKE_PER_BET');
CREATE TYPE "PlayLimitPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- 2. Tables ------------------------------------------------------------------
-- One self-exclusion / cooling-off window. ACTIVE while startsAt <= now AND
-- (endsAt IS NULL OR endsAt > now) AND (revokedAt IS NULL OR revokedAt > now).
-- A FUTURE revokedAt is a scheduled end still inside the cooling-off delay.
CREATE TABLE "SelfExclusion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "SelfExclusionType" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "reason" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfExclusion_pkey" PRIMARY KEY ("id")
);

-- One limit line per (user, kind, period). amount = current effective cap;
-- a RAISE is parked in pendingAmount/pendingEffectiveAt (cooling-off honoured
-- at read time) while a LOWER clears the pending fields and applies now.
CREATE TABLE "PlayLimit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "PlayLimitKind" NOT NULL,
    "period" "PlayLimitPeriod" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pendingAmount" INTEGER,
    "pendingEffectiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayLimit_pkey" PRIMARY KEY ("id")
);

-- 3. Indexes -----------------------------------------------------------------
CREATE INDEX "SelfExclusion_userId_idx" ON "SelfExclusion"("userId");
CREATE INDEX "SelfExclusion_userId_revokedAt_idx" ON "SelfExclusion"("userId", "revokedAt");
CREATE UNIQUE INDEX "PlayLimit_userId_kind_period_key" ON "PlayLimit"("userId", "kind", "period");
CREATE INDEX "PlayLimit_userId_idx" ON "PlayLimit"("userId");

-- 4. Foreign keys to User (cascade, same posture as RoyalePlinkoRound) --------
ALTER TABLE "SelfExclusion" ADD CONSTRAINT "SelfExclusion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayLimit" ADD CONSTRAINT "PlayLimit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

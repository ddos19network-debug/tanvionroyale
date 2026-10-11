-- ===========================================================================
-- TANVION ROYALE - AFFILIATE ACTIVATION (opt-in program membership)
--
-- ADDITIVE ONLY. One new enum, one new table and one index/FK set. It never
-- drops, truncates or rewrites an existing table, never deletes a row and
-- never touches money. Existing users, wallets, ledger entries, referrals,
-- referral rewards, affiliate clicks and affiliate content blocks are
-- untouched.
--
-- WHY A SEPARATE MODEL
--   Every registered user already owns a stable `User.referralCode` and may
--   use the normal referral program. That code must NOT imply affiliate
--   membership, so affiliation needs its OWN opt-in switch. This table is
--   written ONLY by an explicit affiliate activation, is UNIQUE per user (so
--   activating twice can never create a second profile), and lets an admin
--   deactivate/reactivate an affiliate without touching a single referral,
--   reward, wallet or ledger row.
--
-- `User.referralCode` is deliberately NOT altered. The referral system keeps
-- working exactly as before for a user who never activated the program, and
-- for one whose profile was deactivated.
--
-- DO NOT ADD A UTF-8 BOM TO THIS FILE. PostgreSQL does not treat U+FEFF as
-- whitespace, so a BOM before the first `--` comment makes the whole batched
-- script fail to parse before statement 0 runs (see the 2026-09-26 production
-- outage note in 20260926000000_add_user_referral_program). This file is pure
-- ASCII; the regression test apps/api/test/migration-encoding.spec.ts fails the
-- build if a BOM is ever reintroduced.
-- ===========================================================================

-- 1. Enum ---------------------------------------------------------------------
-- Affiliate membership is NOT derived from `User.referralCode`.
CREATE TYPE "AffiliateStatus" AS ENUM (
  'ACTIVE',
  'INACTIVE'
);

-- 2. Table --------------------------------------------------------------------
-- UNIQUE ("userId") is the idempotency guarantee: a second activation returns
-- the same row instead of creating a second profile.
CREATE TABLE "AffiliateProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "AffiliateStatus" NOT NULL DEFAULT 'ACTIVE',
  "promotionMethod" TEXT,
  "promotionUrl" TEXT,
  "description" TEXT,
  "termsAcceptedAt" TIMESTAMP(3) NOT NULL,
  "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deactivatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AffiliateProfile_pkey" PRIMARY KEY ("id")
);

-- 3. Indexes ------------------------------------------------------------------
-- Mirrors @@unique([userId]) / @@index([status]) / @@index([status, activatedAt])
-- in database/prisma/schema.prisma. The composite index is what the ACTIVE-only
-- admin affiliate list and the ACTIVE-gated click check read.
CREATE UNIQUE INDEX "AffiliateProfile_userId_key" ON "AffiliateProfile"("userId");

CREATE INDEX "AffiliateProfile_status_idx" ON "AffiliateProfile"("status");

CREATE INDEX "AffiliateProfile_status_activatedAt_idx"
  ON "AffiliateProfile"("status", "activatedAt");

-- 4. Foreign key ---------------------------------------------------------------
-- ON DELETE CASCADE, identical to AffiliateMonthlyTarget / AffiliateClick:
-- removing a user removes only their own affiliate profile. It can never
-- cascade into a Referral, a ReferralReward or a wallet row.
ALTER TABLE "AffiliateProfile"
  ADD CONSTRAINT "AffiliateProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

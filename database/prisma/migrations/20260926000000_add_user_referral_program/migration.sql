-- ===========================================================================
-- TANVION ROYALE - USER REFERRAL PROGRAM
--
-- ADDITIVE ONLY. This migration creates new types/tables/columns and adds
-- enum values. It never drops or rewrites an existing table, never deletes a
-- row and never touches money. Existing users, wallets, ledger entries, games,
-- providers and sessions are untouched.
--
-- Applied by the normal chain:
--   prisma:generate -> prisma:migrate:deploy:strict -> nest build
--
-- IF `prisma migrate status` reports this migration as pending, inspect the real
-- database state read-only first (node scripts/check-migration-state.cjs) and
-- follow the verdict. NEVER run `prisma migrate reset`.
--
-- ---------------------------------------------------------------------------
-- DO NOT ADD A UTF-8 BOM TO THIS FILE. That is exactly what broke production on
-- 2026-09-26: the first commit of this migration (4342381) began with the three
-- BOM bytes EF BB BF, and the first statement here is a `--` comment.
-- PostgreSQL does not treat U+FEFF as whitespace, so `--` is not at the start
-- of a token and the whole batched script failed to parse BEFORE statement 0
-- ran. Prisma recorded the failure in _prisma_migrations, and every later
-- deploy then died with P3009 even after the BOM was removed, because the
-- failed row still had to be resolved by hand. This file is pure ASCII; a
-- regression test (apps/api/test/migration-encoding.spec.ts) fails the build if
-- a BOM is ever reintroduced into any migration.sql.
-- ============================================================================
-- ===========================================================================

-- 1. Enums -------------------------------------------------------------------
-- ADD VALUE IF NOT EXISTS keeps this migration re-runnable.
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'REFERRAL_BONUS';

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REFERRAL_JOINED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REFERRAL_QUALIFIED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REFERRAL_BONUS_CREDITED';

CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'QUALIFIED', 'REJECTED', 'CANCELLED');
CREATE TYPE "ReferralRewardRecipient" AS ENUM ('REFERRER', 'REFERRED');
CREATE TYPE "ReferralBonusType" AS ENUM ('FIXED_AMOUNT', 'PERCENTAGE');
CREATE TYPE "ReferralQualificationRule" AS ENUM (
  'REGISTRATION',
  'VERIFIED_ACCOUNT',
  'MIN_DEPOSIT',
  'MIN_WAGER',
  'DEPOSIT_AND_WAGER'
);
CREATE TYPE "ReferralRewardStatus" AS ENUM (
  'PENDING',
  'QUALIFIED',
  'PAID',
  'REJECTED',
  'CANCELLED'
);

-- 2. User.referralCode ------------------------------------------------------
-- Nullable so the existing accounts can be backfilled below without rewriting
-- the table or changing the registration flow.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;

-- 3. Referral (immutable attribution) ---------------------------------------
CREATE TABLE "Referral" (
  "id" TEXT NOT NULL,
  "referrerUserId" TEXT NOT NULL,
  "referredUserId" TEXT NOT NULL,
  "referralCode" TEXT NOT NULL,
  "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
  "statusReason" TEXT,
  "qualifiedAt" TIMESTAMP(3),
  "qualifiedDepositAmount" INTEGER NOT NULL DEFAULT 0,
  "qualifiedWagerAmount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- A user can have exactly ONE referrer, forever. This unique constraint is the
-- structural guarantee that the relationship is immutable: there is physically
-- no second row that could point at a different referrer, and the application
-- has no "change my referrer" path at all.
CREATE UNIQUE INDEX IF NOT EXISTS "Referral_referredUserId_key" ON "Referral"("referredUserId");
CREATE INDEX IF NOT EXISTS "Referral_referrerUserId_createdAt_idx" ON "Referral"("referrerUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "Referral_status_createdAt_idx" ON "Referral"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Referral_referralCode_idx" ON "Referral"("referralCode");

-- 4. ReferralEvent (append-only qualifying-signal log) ----------------------
CREATE TABLE "ReferralEvent" (
  "id" TEXT NOT NULL,
  "referralId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  -- UNIQUE => the same wallet transaction can never be counted twice.
  "eventKey" TEXT NOT NULL,
  "amount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReferralEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReferralEvent_eventKey_key" ON "ReferralEvent"("eventKey");
CREATE INDEX IF NOT EXISTS "ReferralEvent_referralId_kind_idx" ON "ReferralEvent"("referralId", "kind");

-- 5. ReferralReward (one auditable money movement per beneficiary) -----------
CREATE TABLE "ReferralReward" (
  "id" TEXT NOT NULL,
  "referralId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "recipient" "ReferralRewardRecipient" NOT NULL,
  "status" "ReferralRewardStatus" NOT NULL DEFAULT 'PENDING',
  "amount" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'BDT',
  -- UNIQUE => exactly-once payout, even if a webhook or settlement replays.
  "eventKey" TEXT NOT NULL,
  "basis" JSONB,
  "walletTransactionId" TEXT,
  "statusReason" TEXT,
  "adjustedByUserId" TEXT,
  "adjustedAt" TIMESTAMP(3),
  "adjustmentReason" TEXT,
  "beforeBalance" INTEGER,
  "afterBalance" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ReferralReward_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReferralReward_eventKey_key" ON "ReferralReward"("eventKey");
CREATE INDEX IF NOT EXISTS "ReferralReward_userId_status_createdAt_idx" ON "ReferralReward"("userId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ReferralReward_referralId_idx" ON "ReferralReward"("referralId");

-- 6. ReferralProgramSettings (singleton admin configuration) -----------------
CREATE TABLE "ReferralProgramSettings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "isEnabled" BOOLEAN NOT NULL DEFAULT false,
  "currency" TEXT NOT NULL DEFAULT 'BDT',
  "signupPath" TEXT NOT NULL DEFAULT '/register',
  "referrerBonusType" "ReferralBonusType" NOT NULL DEFAULT 'FIXED_AMOUNT',
  "referrerBonusAmount" INTEGER NOT NULL DEFAULT 0,
  "referrerBonusPercent" INTEGER NOT NULL DEFAULT 0,
  "referredBonusType" "ReferralBonusType" NOT NULL DEFAULT 'FIXED_AMOUNT',
  "referredBonusAmount" INTEGER NOT NULL DEFAULT 0,
  "referredBonusPercent" INTEGER NOT NULL DEFAULT 0,
  "qualificationRule" "ReferralQualificationRule" NOT NULL DEFAULT 'REGISTRATION',
  "minDepositAmount" INTEGER NOT NULL DEFAULT 0,
  "minWagerAmount" INTEGER NOT NULL DEFAULT 0,
  "maxRewardPerReferral" INTEGER NOT NULL DEFAULT 0,
  "maxTotalRewardPerUser" INTEGER,
  "qualificationExpiresInDays" INTEGER,
  "requireVerifiedAccount" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,

  CONSTRAINT "ReferralProgramSettings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ReferralProgramSettings_isEnabled_idx" ON "ReferralProgramSettings"("isEnabled");

-- The program ships DISABLED with every reward at 0. Nothing is ever paid until
-- an admin explicitly configures and enables it.
INSERT INTO "ReferralProgramSettings" ("id", "isEnabled", "updatedAt")
VALUES (1, false, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- 7. Backfill a referral code for EVERY existing user
--
-- Requirements this statement must satisfy, in order of importance:
--   1. EVERY existing account gets a code, so it can share a link at once.
--   2. The codes are UNIQUE, so step 8 can build the unique index.
--   3. A code that already exists is NEVER overwritten.
--   4. Re-running never changes a code that was already handed out.
--
-- ALPHABET. All 12 characters come from the SAME 30-symbol alphabet the
-- service uses (CODE_ALPHABET in
-- apps/api/src/modules/referral/referral-code.ts). This is not cosmetic: the
-- service rejects any code whose shape it does not recognise, so a code built
-- from a different alphabet silently resolves to NOBODY. An earlier revision
-- of this migration emitted hex characters, but the service alphabet
-- deliberately excludes "0" and "1", so roughly 80% of the codes it produced
-- failed isValidReferralCodeShape and those users referral links did not
-- work at all. 30^12 = 5.3e17 distinct codes (~58.9 bits).
--
-- DETERMINISTIC. The code derives from the immutable user id, so it is stable
-- forever and a re-run reproduces it exactly. The 12 characters are the 12
-- leading bytes of md5(id || "#" || round) mapped into the alphabet. Mapping a
-- byte with % 30 carries a small modulo bias (16 of the 30 symbols are about
-- 14% more likely than the other 14), irrelevant for a non-secret public id.
--
-- COLLISION-SAFE. A hash can collide, so uniqueness is not ASSUMED, it is
-- ENFORCED. Each round assigns codes to the users that still lack one and
-- then counts duplicates. If any remain, ONLY the codes this migration
-- generated that are still duplicated are released and re-derived with an
-- incremented salt; codes that already existed are never touched. The loop
-- is bounded - if duplicates somehow survived 16 rounds the migration RAISEs,
-- aborting the transaction with production untouched, instead of letting step
-- 8 die on a confusing unique-index error.
DO $backfill$
DECLARE
  v_round integer := 0;
  v_dupes  bigint;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _referral_backfill (
    "userId" text PRIMARY KEY,
    "code"   text
  ) ON COMMIT DROP;

  LOOP
    -- Assign a deterministic code to every user that still has none.
    WITH generated AS (
      SELECT u."id" AS "userId",
             'TANV' || (
               SELECT string_agg(
                        substr('23456789ABCDEFGHJKMNPQRSTVWXYZ',
                               (get_byte(decode(md5(u."id"::text || '#' || v_round), 'hex'), g.i) % 30) + 1,
                               1),
                       '' ORDER BY g.i)
               FROM generate_series(0, 11) AS g(i)
             ) AS code
      FROM "User" u
      WHERE u."referralCode" IS NULL
    ),
    applied AS (
      UPDATE "User" u
      SET "referralCode" = g.code
      FROM generated g
      WHERE u."id" = g."userId" AND u."referralCode" IS NULL
      RETURNING u."id", u."referralCode"
    )
    INSERT INTO _referral_backfill ("userId", "code")
    SELECT "id", "referralCode" FROM applied
    ON CONFLICT ("userId") DO UPDATE SET "code" = EXCLUDED."code";

    -- How many codes are currently held by more than one user?
    SELECT count(*) INTO v_dupes
    FROM (
      SELECT "referralCode" FROM "User"
      WHERE "referralCode" IS NOT NULL
      GROUP BY "referralCode" HAVING count(*) > 1
    ) d;

    EXIT WHEN v_dupes = 0;

    IF v_round >= 16 THEN
      RAISE EXCEPTION
        'referral backfill: % duplicate code(s) remain after 16 deterministic rounds',
        v_dupes;
    END IF;
    v_round := v_round + 1;

    -- Release ONLY codes this migration generated that are still duplicated,
    -- so the next round re-derives them with a new salt. A code that existed
    -- before the migration is never cleared.
    UPDATE "User" u
    SET "referralCode" = NULL
    FROM _referral_backfill b
    WHERE u."id" = b."userId"
      AND u."referralCode" = b."code"
      AND b."code" IN (
        SELECT "referralCode" FROM "User"
        WHERE "referralCode" IS NOT NULL
        GROUP BY "referralCode" HAVING count(*) > 1
      );
  END LOOP;

  DROP TABLE IF EXISTS _referral_backfill;
END
$backfill$;

-- 8. Unique index on User.referralCode --------------------------------------
-- Created AFTER the backfill so the deterministic codes are validated by the
-- very same constraint that new registrations rely on.
CREATE UNIQUE INDEX IF NOT EXISTS "User_referralCode_key" ON "User"("referralCode");

-- 9. Foreign keys ------------------------------------------------------------
ALTER TABLE "Referral"
  ADD CONSTRAINT "Referral_referrerUserId_fkey"
  FOREIGN KEY ("referrerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Referral"
  ADD CONSTRAINT "Referral_referredUserId_fkey"
  FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReferralEvent"
  ADD CONSTRAINT "ReferralEvent_referralId_fkey"
  FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReferralReward"
  ADD CONSTRAINT "ReferralReward_referralId_fkey"
  FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReferralReward"
  ADD CONSTRAINT "ReferralReward_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

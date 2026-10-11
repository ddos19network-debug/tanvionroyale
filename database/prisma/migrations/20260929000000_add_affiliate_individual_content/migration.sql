-- ===========================================================================
-- TANVION ROYALE - AFFILIATE INDIVIDUAL PAGE CONTENT (per-affiliate scope)
--
-- ADDITIVE ONLY. One nullable column, two indexes and one foreign key. It
-- never drops, truncates or rewrites an existing table, never deletes a
-- content row, and never touches a Referral, a ReferralReward, a Wallet or a
-- Ledger row. The referral program, the affiliate activation system, the
-- affiliate profile, the monthly targets and the global content editor all
-- keep working exactly as before.
--
-- WHAT THIS ADDS
--   `AffiliateContentBlock` is ONE model with TWO scopes, not two models. The
--   scope is the new nullable `affiliateUserId`:
--
--     affiliateUserId IS NULL  -> GLOBAL content. Shown on every ACTIVE
--                                 affiliate's /affiliate page.
--     affiliateUserId = <id>   -> INDIVIDUAL content. Shown ONLY on that one
--                                 ACTIVE affiliate's /affiliate page.
--
-- WHY NULLABLE (existing data safety)
--   The column is added with NO DEFAULT, so every pre-existing
--   AffiliateContentBlock row reads back as NULL and therefore REMAINS GLOBAL.
--   No backfill is required and none is performed: there is deliberately no
--   UPDATE that could assign old content to an arbitrary affiliate, and no
--   statement here can delete or reassign an existing row. The global content
--   an admin already published is untouched by this migration.
--
-- WHY `User.id` AND NOT THE REFERRAL CODE
--   The relationship key is the stable user id, which is also
--   `AffiliateProfile.userId`. `User.referralCode` belongs to the REFERRAL
--   program and is not an identity, so it is deliberately not used here. That
--   keeps the referral/affiliate separation the existing system already has.
--
-- ORDERING
--   `sortOrder` stays independent PER SCOPE. Both new indexes are prefixed by
--   `affiliateUserId`, so reordering one affiliate's blocks can never renumber
--   the global order or another affiliate's order.
--
-- DEACTIVATION
--   Nothing here is triggered by an affiliate becoming INACTIVE. Deactivating an
--   affiliate flips a status flag and touches no row in this table, so the
--   individual's content and target history are still stored and come back
--   unchanged on reactivation.
--
-- ON DELETE CASCADE
--   Identical to AffiliateProfile / AffiliateMonthlyTarget / AffiliateClick:
--   deleting a USER removes only that user's own individual content. It can
--   never cascade into a Referral, a ReferralReward or a wallet row, because
--   this foreign key does not point at any of those tables.
--
-- DO NOT ADD A UTF-8 BOM TO THIS FILE. PostgreSQL does not treat U+FEFF as
-- whitespace, so a BOM before the first `--` comment makes the whole batched
-- script fail to parse before statement 0 runs (see the 2026-09-26 production
-- outage note in 20260926000000_add_user_referral_program). This file is pure
-- ASCII; the regression test apps/api/test/migration-encoding.spec.ts fails the
-- build if a BOM is ever reintroduced.
-- ===========================================================================

-- 1. Column ------------------------------------------------------------------
-- Nullable TEXT. NULL = GLOBAL, a user id = INDIVIDUAL. The existing rows keep
-- the implicit NULL, which is exactly the GLOBAL scope they already had.
ALTER TABLE "AffiliateContentBlock"
  ADD COLUMN "affiliateUserId" TEXT;

-- 2. Indexes -----------------------------------------------------------------
-- Mirrors @@index([affiliateUserId, isEnabled, sortOrder]) and
-- @@index([affiliateUserId, sortOrder]) in database/prisma/schema.prisma.
-- Both are prefixed by the scope key so an individual read or reorder is a
-- tight range scan that can never interleave with another scope's ordering.
CREATE INDEX "AffiliateContentBlock_affiliateUserId_isEnabled_sortOrder_idx"
  ON "AffiliateContentBlock"("affiliateUserId", "isEnabled", "sortOrder");

CREATE INDEX "AffiliateContentBlock_affiliateUserId_sortOrder_idx"
  ON "AffiliateContentBlock"("affiliateUserId", "sortOrder");

-- 3. Foreign key -------------------------------------------------------------
-- ON DELETE CASCADE, identical to the other affiliate-owned tables. A global
-- block has a NULL key and is therefore never touched by this constraint.
ALTER TABLE "AffiliateContentBlock"
  ADD CONSTRAINT "AffiliateContentBlock_affiliateUserId_fkey"
  FOREIGN KEY ("affiliateUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

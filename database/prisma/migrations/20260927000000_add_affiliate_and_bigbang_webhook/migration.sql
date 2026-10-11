-- ===========================================================================
-- TANVION ROYALE - AFFILIATE PROGRAM + PROVIDER WEBHOOK EVENTS
--
-- ADDITIVE ONLY. This migration creates new tables and adds one nullable
-- column. It never drops, truncates or rewrites an existing table, never
-- deletes a row and never touches money. Existing users, wallets, ledger
-- entries, games, providers, referrals and referral rewards are untouched.
--
-- Applied by the normal chain:
--   prisma:generate -> prisma:migrate:deploy:strict -> nest build
--
-- IF `prisma migrate status` reports this migration as pending, inspect the real
-- database state read-only first and follow the verdict. NEVER run
-- `prisma migrate reset`.
--
-- ---------------------------------------------------------------------------
-- DO NOT ADD A UTF-8 BOM TO THIS FILE. That is exactly what broke production on
-- 2026-09-26 (see database/prisma/migrations/20260926000000_.../migration.sql):
-- PostgreSQL does not treat U+FEFF as whitespace, so a BOM before the first
-- `--` comment makes the whole batched script fail to parse BEFORE statement 0
-- runs. This file is pure ASCII; a regression test
-- (apps/api/test/migration-encoding.spec.ts) fails the build if a BOM is ever
-- reintroduced into any migration.sql.
--
-- REPAIR HISTORY (2026-09-27) - this file was repaired IN PLACE, not regenerated
-- and not superseded by a second migration, because it had never applied
-- successfully anywhere. A stray ORPHANED tail of the
-- `CREATE TABLE "AffiliateMonthlyTarget"` body (starting at
-- `"targetValue" INTEGER NOT NULL,` and ending at the duplicate
-- `CONSTRAINT "AffiliateMonthlyTarget_pkey" ... );`) had been appended to the
-- END of this file, AFTER the section 9 seed INSERTs. That left a bare column
-- list in top-level statement position, which PostgreSQL rejected with 42601
-- `syntax error at or near ""targetValue""` (surfaced by Prisma as P3018).
-- The real `AffiliateMonthlyTarget` definition is section 4 above and already
-- declares `"targetValue" INTEGER NOT NULL`; the appended copy was a duplicate
-- and has been deleted. Nothing else in this file changed: no column was moved
-- between tables, no table was dropped, and the schema still matches
-- database/prisma/schema.prisma exactly.
-- ===========================================================================

-- 1. Enum ---------------------------------------------------------------------
CREATE TYPE "AffiliateTargetType" AS ENUM (
  'QUALIFIED_REFERRALS',
  'SIGNUPS'
);

-- 2. PartnerProvider.webhookSecretEnc -----------------------------------------
-- NULLABLE and additive: an existing BigBang row simply reads NULL until an
-- admin generates a secret, and the webhook route then answers "not
-- configured" instead of failing. This is a DIFFERENT credential from
-- apiKeyEnc (the seamless-callback API key) and from walletApiKeyEnc: the
-- wallet API key is never used to authenticate a webhook, and the webhook
-- secret never authenticates /bigbang/callbacks/*.
ALTER TABLE "PartnerProvider" ADD COLUMN IF NOT EXISTS "webhookSecretEnc" TEXT;

-- 3. ProviderWebhookEvent ------------------------------------------------------
-- Shared, provider-agnostic event log. @@unique([provider, eventId]) is the
-- idempotency index that makes a retried delivery a DUPLICATE instead of a
-- second processing.
CREATE TABLE "ProviderWebhookEvent" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerId" TEXT,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "requestId" TEXT,
  "payloadHash" TEXT NOT NULL,
  "payload" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProviderWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- 4. AffiliateMonthlyTarget ----------------------------------------------------
-- @@unique([affiliateUserId, year, month, targetType]) is what makes historical
-- monthly targets addressable: an admin editing October can never silently
-- overwrite September, and a "current target" cannot drift from history.
CREATE TABLE "AffiliateMonthlyTarget" (
  "id" TEXT NOT NULL,
  "affiliateUserId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "targetType" "AffiliateTargetType" NOT NULL,
  "targetValue" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,

  CONSTRAINT "AffiliateMonthlyTarget_pkey" PRIMARY KEY ("id")
);

-- 5. AffiliateContentBlock -----------------------------------------------------
-- DATA ONLY. There is deliberately no column that can hold JavaScript, an event
-- handler, raw HTML or a style block, so a stored block can never execute.
CREATE TABLE "AffiliateContentBlock" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT,
  "subtitle" TEXT,
  "body" TEXT,
  "items" TEXT,
  "imageUrl" TEXT,
  "ctaText" TEXT,
  "ctaUrl" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,

  CONSTRAINT "AffiliateContentBlock_pkey" PRIMARY KEY ("id")
);

-- 6. AffiliateClick ------------------------------------------------------------
-- @@unique([dedupeKey]) is a server-side HASH of a coarse daily visitor
-- fingerprint. No IP, user agent, cookie or fingerprint is stored, and the
-- unique index is what stops a page refresh counting as a new click.
CREATE TABLE "AffiliateClick" (
  "id" TEXT NOT NULL,
  "affiliateUserId" TEXT NOT NULL,
  "referralCode" TEXT NOT NULL,
  "landingPath" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AffiliateClick_pkey" PRIMARY KEY ("id")
);

-- 7. Indexes -------------------------------------------------------------------
-- Every index below backs a query the application actually issues, so no admin
-- search or dashboard aggregation degrades into a sequential scan. The three
-- UNIQUE ones double as the idempotency / per-visitor de-duplication keys.

CREATE UNIQUE INDEX IF NOT EXISTS "ProviderWebhookEvent_provider_eventId_key"
  ON "ProviderWebhookEvent"("provider", "eventId");

CREATE INDEX IF NOT EXISTS "ProviderWebhookEvent_provider_status_receivedAt_idx"
  ON "ProviderWebhookEvent"("provider", "status", "receivedAt");

CREATE INDEX IF NOT EXISTS "ProviderWebhookEvent_providerId_receivedAt_idx"
  ON "ProviderWebhookEvent"("providerId", "receivedAt");

CREATE INDEX IF NOT EXISTS "ProviderWebhookEvent_eventType_receivedAt_idx"
  ON "ProviderWebhookEvent"("eventType", "receivedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "AffiliateMonthlyTarget_affiliateUserId_year_month_targetType_key"
  ON "AffiliateMonthlyTarget"("affiliateUserId", "year", "month", "targetType");

CREATE INDEX IF NOT EXISTS "AffiliateMonthlyTarget_affiliateUserId_year_month_idx"
  ON "AffiliateMonthlyTarget"("affiliateUserId", "year", "month");

CREATE INDEX IF NOT EXISTS "AffiliateMonthlyTarget_year_month_idx"
  ON "AffiliateMonthlyTarget"("year", "month");

CREATE INDEX IF NOT EXISTS "AffiliateContentBlock_isEnabled_sortOrder_idx"
  ON "AffiliateContentBlock"("isEnabled", "sortOrder");

CREATE UNIQUE INDEX IF NOT EXISTS "AffiliateClick_dedupeKey_key"
  ON "AffiliateClick"("dedupeKey");

CREATE INDEX IF NOT EXISTS "AffiliateClick_affiliateUserId_createdAt_idx"
  ON "AffiliateClick"("affiliateUserId", "createdAt");

CREATE INDEX IF NOT EXISTS "AffiliateClick_createdAt_idx"
  ON "AffiliateClick"("createdAt");

-- 8. Foreign keys --------------------------------------------------------------
-- ON DELETE CASCADE for the two affiliate-owned tables: removing a user removes
-- only their targets and clicks, never a referral or a reward.
-- ON DELETE SET NULL for the webhook event: the audit record must outlive the
-- provider row.
ALTER TABLE "ProviderWebhookEvent"
  ADD CONSTRAINT "ProviderWebhookEvent_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "PartnerProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AffiliateMonthlyTarget"
  ADD CONSTRAINT "AffiliateMonthlyTarget_affiliateUserId_fkey"
  FOREIGN KEY ("affiliateUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AffiliateClick"
  ADD CONSTRAINT "AffiliateClick_affiliateUserId_fkey"
  FOREIGN KEY ("affiliateUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 9. Default affiliate page content -------------------------------------------
-- Seeds the standard section set ONCE, idempotently, so /affiliate is never
-- blank on a fresh deployment. Every insert is guarded on the block `key`, so
-- re-running this migration can neither duplicate a block nor overwrite an
-- admin's later edits. The wording below is deliberately conservative: the
-- EXACT reward is never promised here, because the real amount is decided by
-- ReferralProgramSettings and shown in the dashboard from the database.
INSERT INTO "AffiliateContentBlock" ("id", "key", "type", "title", "subtitle", "ctaText", "ctaUrl", "sortOrder", "isEnabled", "createdAt", "updatedAt")
SELECT
  'blk_hero', 'hero', 'BANNER',
  'Affiliate With Us',
  'Share TANVIONROYALE with your friends and earn on every referral you bring.',
  'Create your free account', '/signup',
  0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "AffiliateContentBlock" WHERE "key" = 'hero');

INSERT INTO "AffiliateContentBlock" ("id", "key", "type", "title", "subtitle", "items", "sortOrder", "isEnabled", "createdAt", "updatedAt")
SELECT
  'blk_how', 'how-it-works', 'HOW_IT_WORKS',
  'How it works',
  'Four simple steps.',
  E'Share your link\nGet your unique referral link and code from the panel above.\nThey sign up\nYour friend opens your link and creates an account.\nThey get qualified\nThe referral qualifies once the configured qualification rule is met.\nYou get paid\nYour reward is credited to your TANVIONROYALE wallet automatically.',
  10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "AffiliateContentBlock" WHERE "key" = 'how-it-works');

INSERT INTO "AffiliateContentBlock" ("id", "key", "type", "title", "items", "sortOrder", "isEnabled", "createdAt", "updatedAt")
SELECT
  'blk_faq', 'faq', 'FAQ',
  'Frequently asked questions',
  E'What is a referral code?|A unique code that identifies you as the person who introduced a new player.\nWhen do I earn?|Your reward qualifies when the configured qualification rule is met. The current rule is shown in your dashboard.\nWhere is my reward paid?|Into your TANVIONROYALE wallet, on the same account as your rewards panel.\nCan I change my referrer?|No. A referral is recorded once, at registration, and is permanent.',
  20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "AffiliateContentBlock" WHERE "key" = 'faq');


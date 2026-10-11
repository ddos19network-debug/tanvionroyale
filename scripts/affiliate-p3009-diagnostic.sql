-- ===========================================================================
-- TANVION ROYALE - P3009 PRODUCTION DIAGNOSTIC (READ-ONLY)
-- migration: 20260927000000_add_affiliate_and_bigbang_webhook
-- ===========================================================================
--
-- WHY THIS FILE EXISTS
-- --------------------
-- Render's build fails with:
--     Error: P3009
--     migrate found failed migrations in the target database
--     The `20260927000000_add_affiliate_and_bigbang_webhook` migration started at
--     2026-09-27 00:19:07.153156 UTC failed.
--
-- P3009 is only the SYMPTOM. It means "_prisma_migrations contains a row that
-- never finished". It does NOT tell you whether the migration's DDL ran. The
-- ORIGINAL error is in that row's `logs` column, and the live catalogue tells
-- you whether any object was created. Those two facts decide the repair:
--
--   objects NONE  -> `prisma migrate resolve --rolled-back`, then `migrate deploy`
--   objects ALL   -> verify every statement, then only THEN consider --applied
--   objects SOME  -> STOP. Do not re-run, do not mark applied, do not reset.
--
-- Run this BEFORE any `migrate resolve`. It never writes anything.
--
-- PREFER the full report (verdict + the exact next command):
--     node scripts/diagnose-affiliate-migration.cjs
-- Paste THIS file into the Neon SQL Editor and read section 9 for the verdict.
--
-- ATOMICITY
-- ---------
-- Prisma sends a migration file to PostgreSQL as one batched simple query, and
-- PostgreSQL runs every statement of a simple-query message in ONE implicit
-- transaction. PostgreSQL DDL is transactional, so any failing statement - and
-- a parse error, which fails the batch before statement 0 runs - rolls the
-- WHOLE file back. CASE A is therefore the expected shape, but the sections
-- below VERIFY it against the catalogue instead of assuming it.
--
-- SAFETY
-- ------
--   * SELECT / RAISE NOTICE only. No INSERT, UPDATE, DELETE, DDL, TRUNCATE.
--   * Every query reads the CATALOGUE (information_schema / pg_catalog), so
--     nothing here can error with `relation "..." does not exist` - which is
--     itself one of the answers we are looking for.
--   * The only table data read is guarded by to_regclass().
-- ===========================================================================


-- 1. THE FAILED MIGRATION'S ROW ------------------------------------------------
--    logs holds the ORIGINAL error. It is printed here verbatim and must NOT be
--    overwritten, cleared or edited by anyone.
SELECT migration_name,
       started_at,
       finished_at,
       rolled_back_at,
       applied_steps_count,
       checksum,
       logs                                    -- ORIGINAL ERROR, never hidden
  FROM "_prisma_migrations"
 WHERE migration_name = '20260927000000_add_affiliate_and_bigbang_webhook'
 ORDER BY started_at DESC;

-- 1b. Machine-readable pass/fail shape.
--     finished_at IS NULL AND rolled_back_at IS NULL  => STILL FAILED (P3009).
SELECT migration_name,
       (finished_at IS NULL AND rolled_back_at IS NULL) AS is_failed,
       applied_steps_count,
       (applied_steps_count = 0)                      AS zero_statements_applied
  FROM "_prisma_migrations"
 WHERE migration_name = '20260927000000_add_affiliate_and_bigbang_webhook';

-- 1c. EVERY unresolved migration - P3009 is raised by ANY of them, not just this
--     one. If this returns more than one row, all of them need reconciling.
SELECT migration_name, started_at, finished_at, rolled_back_at
  FROM "_prisma_migrations"
 WHERE finished_at IS NULL
   AND rolled_back_at IS NULL
 ORDER BY started_at;


-- 1d. Tail of the migration history, for context.
SELECT migration_name,
       CASE WHEN finished_at IS NOT NULL THEN 'APPLIED'
            WHEN rolled_back_at IS NOT NULL THEN 'ROLLED_BACK'
            ELSE '*** FAILED ***' END      AS state,
       applied_steps_count,
       started_at,
       finished_at
  FROM "_prisma_migrations"
 ORDER BY started_at DESC
 LIMIT 8;

-- 2. TABLES THIS MIGRATION CREATES --------------------------------------------
--    ZERO ROWS = the tables were never created.
SELECT table_name
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('ProviderWebhookEvent','AffiliateMonthlyTarget',
                      'AffiliateContentBlock','AffiliateClick')
 ORDER BY table_name;

-- 2b. Exactly the six quick checks from the incident checklist, as one row each.
SELECT to_regclass('public."AffiliateMonthlyTarget"') AS affiliate_monthly_target,
       to_regclass('public."AffiliateContentBlock"')   AS affiliate_content_block,
       to_regclass('public."AffiliateClick"')          AS affiliate_click,
       to_regclass('public."ProviderWebhookEvent"')    AS provider_webhook_event;

-- 3. THE ENUM -------------------------------------------------------------------
SELECT EXISTS (
  SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE t.typname = 'AffiliateTargetType' AND n.nspname = 'public'
) AS affiliate_target_type_exists;

-- 3b. Enum VALUES - the migration must define exactly QUALIFIED_REFERRALS, SIGNUPS.
SELECT e.enumlabel, e.enumsortorder
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  JOIN pg_enum e ON e.enumtypid = t.oid
 WHERE t.typname = 'AffiliateTargetType' AND n.nspname = 'public'
 ORDER BY e.enumsortorder;

-- 4. PartnerProvider.webhookSecretEnc (nullable, additive) -----------------------
SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'PartnerProvider'
     AND column_name = 'webhookSecretEnc'
) AS webhook_secret_enc_exists;

-- 4b. Full column list of every table this migration creates. Compare against
--     migration.sql sections 3-6 and against schema.prisma.
SELECT table_name, ordinal_position, column_name, data_type, udt_name,
       is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('ProviderWebhookEvent','AffiliateMonthlyTarget',
                      'AffiliateContentBlock','AffiliateClick')
 ORDER BY table_name, ordinal_position;

-- 5. INDEXES --------------------------------------------------------------------
--    The migration creates 3 UNIQUE + 8 plain = 11. The three UNIQUE ones are
--    the idempotency / per-visitor de-duplication keys and are the reason a
--    duplicate BigBang delivery cannot be processed twice.
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND tablename IN ('ProviderWebhookEvent','AffiliateMonthlyTarget',
                     'AffiliateContentBlock','AffiliateClick')
 ORDER BY indexname;

-- 5b. Named-index checklist straight from migration.sql section 7.
SELECT name, to_regclass('public."' || name || '"') IS NOT NULL AS exists
  FROM (VALUES
    ('ProviderWebhookEvent_provider_eventId_key'),
    ('ProviderWebhookEvent_provider_status_receivedAt_idx'),
    ('ProviderWebhookEvent_providerId_receivedAt_idx'),
    ('ProviderWebhookEvent_eventType_receivedAt_idx'),
    ('AffiliateMonthlyTarget_affiliateUserId_year_month_targetType_key'),
    ('AffiliateMonthlyTarget_affiliateUserId_year_month_idx'),
    ('AffiliateMonthlyTarget_year_month_idx'),
    ('AffiliateContentBlock_isEnabled_sortOrder_idx'),
    ('AffiliateClick_dedupeKey_key'),
    ('AffiliateClick_affiliateUserId_createdAt_idx'),
    ('AffiliateClick_createdAt_idx')
  ) AS expected(name)
 ORDER BY name;

-- 6. PRIMARY KEYS ---------------------------------------------------------------
SELECT conname, conrelid::regclass::text AS tbl, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
 WHERE conname IN ('ProviderWebhookEvent_pkey','AffiliateMonthlyTarget_pkey',
                   'AffiliateContentBlock_pkey','AffiliateClick_pkey')
 ORDER BY conname;

-- 7. FOREIGN KEYS ---------------------------------------------------------------
--    The exact three from migration.sql section 8. Confirm the referential
--    actions: SET NULL for the webhook event (audit must outlive the provider),
--    CASCADE for the two affiliate-owned tables.
SELECT conname, conrelid::regclass::text AS tbl, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
 WHERE conname IN ('ProviderWebhookEvent_providerId_fkey',
                   'AffiliateMonthlyTarget_affiliateUserId_fkey',
                   'AffiliateClick_affiliateUserId_fkey')
 ORDER BY conname;

-- 8. SEED ROWS (only readable once "AffiliateContentBlock" exists) -------------
--    The migration seeds three blocks, each guarded by
--    WHERE NOT EXISTS (... "key" = '<key>'), so re-running can neither duplicate
--    a block nor overwrite an admin's later edit.
DO $seed$
DECLARE
  v_table regclass := to_regclass('public."AffiliateContentBlock"');
  v_total bigint;
  v_keys  text;
BEGIN
  IF v_table IS NULL THEN
    RAISE NOTICE 'AffiliateContentBlock: ABSENT - the seed never ran';
  ELSE
    EXECUTE 'SELECT count(*) FROM "AffiliateContentBlock"' INTO v_total;
    EXECUTE 'SELECT string_agg("key" || '' ('' || "isEnabled" || '')'', '', '' ORDER BY "sortOrder")
               FROM "AffiliateContentBlock"' INTO v_keys;
    RAISE NOTICE 'AffiliateContentBlock rows: %', v_total;
    RAISE NOTICE '  keys: %', coalesce(v_keys, '(none)');
  END IF;
END
$seed$;

-- 8b. Full seed listing (uncomment ONLY once section 2 shows the table exists).
-- SELECT id, "key", type, title, "sortOrder", "isEnabled", "createdAt"
--   FROM "AffiliateContentBlock" ORDER BY "sortOrder";

-- 9. BUSINESS-DATA SAFETY COUNTERS (read-only) ----------------------------------
--    Record these BEFORE any repair so a before/after comparison proves that no
--    user, wallet, deposit, withdrawal, bet, payout, casino or sports row was
--    touched. This migration is additive: four new tables and one NULLABLE
--    column. It must never change any of these numbers.
SELECT 'User'                  AS object, count(*) AS rows FROM "User"
UNION ALL SELECT 'PartnerProvider',   count(*) FROM "PartnerProvider"
UNION ALL SELECT 'Wallet',            count(*) FROM "Wallet"
UNION ALL SELECT 'WalletTransaction', count(*) FROM "WalletTransaction"
UNION ALL SELECT 'ManualDepositRequest', count(*) FROM "ManualDepositRequest"
UNION ALL SELECT 'WithdrawalRequest', count(*) FROM "WithdrawalRequest"
UNION ALL SELECT 'Bet',               count(*) FROM "Bet"
UNION ALL SELECT 'CasinoTransaction', count(*) FROM "CasinoTransaction"
UNION ALL SELECT 'BigBangTransaction',count(*) FROM "BigBangTransaction"
UNION ALL SELECT 'Referral',          count(*) FROM "Referral"
UNION ALL SELECT 'ReferralReward',    count(*) FROM "ReferralReward"
ORDER BY object;

-- 10. MACHINE-READABLE VERDICT ---------------------------------------------------
--    Run this AFTER sections 2-8 and read the NOTICE lines it emits.
DO $probe$
DECLARE
  v_failed bigint;  v_target bigint;  v_step0 bigint;
  v_tables bigint;  v_idx bigint;     v_fk bigint;  v_pk bigint;
  v_enum   boolean; v_col   boolean;  v_others text;
BEGIN
  SELECT count(*) INTO v_failed
    FROM "_prisma_migrations"
   WHERE finished_at IS NULL AND rolled_back_at IS NULL;

  SELECT count(*) INTO v_target
    FROM "_prisma_migrations"
   WHERE migration_name = '20260927000000_add_affiliate_and_bigbang_webhook'
     AND finished_at IS NULL AND rolled_back_at IS NULL;

  SELECT applied_steps_count INTO v_step0
    FROM "_prisma_migrations"
   WHERE migration_name = '20260927000000_add_affiliate_and_bigbang_webhook'
   ORDER BY started_at DESC LIMIT 1;

  SELECT count(*) INTO v_tables
    FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_name IN ('ProviderWebhookEvent','AffiliateMonthlyTarget',
                        'AffiliateContentBlock','AffiliateClick');

  SELECT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'AffiliateTargetType' AND n.nspname = 'public')
    INTO v_enum;

  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'PartnerProvider'
                    AND column_name = 'webhookSecretEnc')
    INTO v_col;

  SELECT count(*) INTO v_idx
    FROM pg_indexes WHERE schemaname = 'public'
     AND indexname IN (
       'ProviderWebhookEvent_provider_eventId_key',
       'ProviderWebhookEvent_provider_status_receivedAt_idx',
       'ProviderWebhookEvent_providerId_receivedAt_idx',
       'ProviderWebhookEvent_eventType_receivedAt_idx',
       'AffiliateMonthlyTarget_affiliateUserId_year_month_targetType_key',
       'AffiliateMonthlyTarget_affiliateUserId_year_month_idx',
       'AffiliateMonthlyTarget_year_month_idx',
       'AffiliateContentBlock_isEnabled_sortOrder_idx',
       'AffiliateClick_dedupeKey_key',
       'AffiliateClick_affiliateUserId_createdAt_idx',
       'AffiliateClick_createdAt_idx');

  SELECT count(*) INTO v_fk
    FROM pg_constraint WHERE conname IN (
      'ProviderWebhookEvent_providerId_fkey',
      'AffiliateMonthlyTarget_affiliateUserId_fkey',
      'AffiliateClick_affiliateUserId_fkey');

  SELECT count(*) INTO v_pk
    FROM pg_constraint WHERE conname IN (
      'ProviderWebhookEvent_pkey','AffiliateMonthlyTarget_pkey',
      'AffiliateContentBlock_pkey','AffiliateClick_pkey');

  SELECT string_agg(migration_name, ', ') INTO v_others
    FROM "_prisma_migrations"
   WHERE finished_at IS NULL AND rolled_back_at IS NULL
     AND migration_name <> '20260927000000_add_affiliate_and_bigbang_webhook';

  RAISE NOTICE '--------------------------------------------------------------';
  RAISE NOTICE 'P3009 DIAGNOSTIC - 20260927000000_add_affiliate_and_bigbang_webhook';
  RAISE NOTICE '--------------------------------------------------------------';
  RAISE NOTICE ' unresolved migrations total        : %', v_failed;
  RAISE NOTICE ' THIS migration still failed        : %', v_target > 0;
  RAISE NOTICE ' THIS migration applied_steps_count : %', coalesce(v_step0, -1);
  RAISE NOTICE ' tables present                    : % of 4', v_tables;
  RAISE NOTICE ' enum AffiliateTargetType present  : %', v_enum;
  RAISE NOTICE ' PartnerProvider.webhookSecretEnc  : %', v_col;
  RAISE NOTICE ' indexes present                   : % of 11', v_idx;
  RAISE NOTICE ' foreign keys present              : % of 3', v_fk;
  RAISE NOTICE ' primary keys present              : % of 4', v_pk;

  IF v_others IS NOT NULL THEN
    RAISE NOTICE ' OTHER unresolved migrations      : %', v_others;
    RAISE NOTICE '   ^ these must be reconciled TOO, not just this one.';
  END IF;

  IF v_failed = 0 THEN
    RAISE NOTICE 'VERDICT: NOTHING_FAILED';
    RAISE NOTICE '  No unresolved migration remains. P3009 is not the current state.';
  ELSIF v_target = 0 THEN
    RAISE NOTICE 'VERDICT: A_DIFFERENT_MIGRATION_FAILED';
    RAISE NOTICE '  This migration is fine. Reconcile the OTHER unresolved migration(s) above.';
  ELSIF v_tables = 0 AND NOT v_enum AND NOT v_col AND v_idx = 0 AND v_fk = 0 AND v_pk = 0 THEN
    RAISE NOTICE 'VERDICT: CASE_A_FAILED_NOTHING_APPLIED';
    RAISE NOTICE '  Zero objects. PostgreSQL rolled the whole file back (or it never';
    RAISE NOTICE '  parsed). Production is still in the pre-affiliate schema state. Safe to:';
    RAISE NOTICE '    pnpm --filter @tanvion-royale/api exec prisma migrate resolve --rolled-back 20260927000000_add_affiliate_and_bigbang_webhook --schema ../../database/prisma/schema.prisma';
    RAISE NOTICE '    pnpm --filter @tanvion-royale/api prisma:migrate:deploy:strict';
    RAISE NOTICE '  NEVER use --applied here: it would mark the migration done while its';
    RAISE NOTICE '  tables, enum, indexes and seed rows do not exist. NEVER run migrate reset.';
  ELSIF v_tables = 4 AND v_enum AND v_col AND v_idx = 11 AND v_fk = 3 AND v_pk = 4 THEN
    RAISE NOTICE 'VERDICT: CASE_C_BUT_COMPLETE';
    RAISE NOTICE '  Every object exists. Verify the seed rows (section 8) and';
    RAISE NOTICE '  webhookSecretEnc (section 4) before considering --applied.';
  ELSE
    RAISE NOTICE 'VERDICT: CASE_B_PARTIAL_STATE - STOP';
    RAISE NOTICE '  SOME objects exist (tables %/4, indexes %/11, fks %/3, pks %/4).',
      v_tables, v_idx, v_fk, v_pk;
    RAISE NOTICE '  Do NOT re-run the migration and do NOT mark it applied: CREATE TYPE and';
    RAISE NOTICE '  the CREATE TABLE statements have no IF NOT EXISTS guard, so a re-run';
    RAISE NOTICE '  aborts on the first object that already exists. Reconcile by hand.';
  END IF;
  RAISE NOTICE '--------------------------------------------------------------';
  RAISE NOTICE 'NEVER: migrate reset | DROP DATABASE | TRUNCATE |';
  RAISE NOTICE '        DELETE/UPDATE on "_prisma_migrations" | --applied unless CASE_C';
  RAISE NOTICE '--------------------------------------------------------------';
END
$probe$;



-- ===========================================================================
-- TANVION ROYALE - P3009 PRODUCTION DIAGNOSTIC (READ-ONLY)
-- ===========================================================================
--
-- WHY THIS FILE EXISTS
-- --------------------
-- Render's build fails with:
--     Error: P3009
--     migrate found failed migrations in the target database
--     The `20260926000000_add_user_referral_program` migration ... failed.
--
-- P3009 is only the SYMPTOM. It means "_prisma_migrations contains a row that
-- never finished". It does NOT tell you whether the migration's DDL ran. The
-- ORIGINAL error is in that row's `logs` column, and the live catalogue tells
-- you whether any object was created. Those two facts decide the repair:
--
--   objects NONE  -> `prisma migrate resolve --rolled-back`  (safe, no DDL)
--   objects ALL   -> verify the backfill, then `--applied`
--   objects SOME  -> STOP. Do not re-run, do not mark applied, do not reset.
--
-- Run this BEFORE any `migrate resolve`. It never writes anything.
--
-- HOW TO RUN
-- ----------
--   Preferred (full report + verdict + the exact next command):
--       node scripts/diagnose-referral-migration.cjs
--
--   Or paste this whole file into the Neon SQL Editor and read section 8.
--
-- SAFETY
-- ------
--   * SELECT / RAISE NOTICE only. No INSERT, UPDATE, DELETE, DDL, TRUNCATE.
--   * Every query reads the CATALOGUE (information_schema / pg_catalog), never a
--     referral table directly, so nothing here can error with
--     `relation "Referral" does not exist` - which is the expected answer.
--   * The only data read is a guarded probe that skips itself when
--     "User"."referralCode" is absent.
-- ===========================================================================


-- 1. FAILED MIGRATION METADATA ----------------------------------------------
SELECT migration_name,
       started_at,
       finished_at,
       rolled_back_at,
       applied_steps_count,
       checksum,
       logs                                    -- ORIGINAL ERROR, never hidden
  FROM "_prisma_migrations"
 WHERE migration_name = '20260926000000_add_user_referral_program'
 ORDER BY started_at;

-- 1b. Machine-readable: the pass/fail shape you need for the repair decision.
--     finished_at IS NULL AND rolled_back_at IS NULL  => still FAILED.
SELECT migration_name,
       (finished_at IS NULL AND rolled_back_at IS NULL) AS is_failed,
       applied_steps_count,
       (applied_steps_count = 0)                       AS zero_statements_applied
  FROM "_prisma_migrations"
 WHERE migration_name = '20260926000000_add_user_referral_program';


-- 2. ORIGINAL MIGRATION LOG (verbatim, unchanged) -----------------------------
--    Expect a syntax error naming the U+FEFF character, e.g.
--      Error: syntax error at or near "<U+FEFF>--"
--    That invisible char is U+FEFF. PostgreSQL does not treat it as whitespace,
--    so the leading `--` comment was not at the start of a token and the batched
--    script failed to PARSE, before statement 0 ever ran.
SELECT logs AS original_migration_log
  FROM "_prisma_migrations"
 WHERE migration_name = '20260926000000_add_user_referral_program';


-- 3. EXISTENCE OF REFERRAL TABLES --------------------------------------------
SELECT table_name
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('Referral', 'ReferralEvent', 'ReferralReward', 'ReferralProgramSettings')
 ORDER BY table_name;
-- ZERO ROWS = none of this migration's tables exist.


-- 4. EXISTENCE OF "User"."referralCode" --------------------------------------
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'User'
   AND column_name = 'referralCode';
-- ZERO ROWS = the column was never added and the backfill never ran.


-- 5. EXISTENCE OF REFERRAL ENUMS (plus the 4 values ADDed to old enums) -------
SELECT t.typname AS enum_name,
       e.enumlabel AS enum_value,
       e.enumsortorder AS sort_order
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  JOIN pg_enum e ON e.enumtypid = t.oid
 WHERE n.nspname = 'public'
   AND t.typname IN (
         'ReferralStatus', 'ReferralRewardRecipient', 'ReferralBonusType',
         'ReferralQualificationRule', 'ReferralRewardStatus',
         'WalletTransactionType', 'NotificationType')
   AND (t.typname LIKE 'Referral%'
        OR e.enumlabel IN ('REFERRAL_BONUS', 'REFERRAL_JOINED',
                            'REFERRAL_QUALIFIED', 'REFERRAL_BONUS_CREDITED'))
 ORDER BY t.typname, e.enumsortorder;


-- 6. REFERRAL INDEXES ---------------------------------------------------------
SELECT schemaname, tablename, indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND (tablename ILIKE 'Referral%'
        OR indexname ILIKE '%Referral%'
        OR indexname ILIKE '%referralCode%')
 ORDER BY indexname;

-- 6b. The five foreign keys the migration adds.
SELECT con.conname,
       t.relname  AS table_name,
       rt.relname AS references_table
  FROM pg_constraint con
  JOIN pg_class t  ON t.oid  = con.conrelid
  JOIN pg_class rt ON rt.oid = con.confrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
 WHERE con.contype = 'f'
   AND n.nspname = 'public'
   AND con.conname LIKE 'Referral%'
 ORDER BY con.conname;


-- 7. FULL MIGRATION HISTORY (ordered) ----------------------------------------
SELECT migration_name,
       started_at,
       finished_at,
       rolled_back_at,
       applied_steps_count,
       CASE
         WHEN rolled_back_at IS NOT NULL THEN 'ROLLED_BACK'
         WHEN finished_at   IS NOT NULL THEN 'applied'
         ELSE 'FAILED'
       END AS state
  FROM "_prisma_migrations"
 ORDER BY started_at;

-- 7b. One-line answer to "are there any failed migrations left?".
SELECT count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS failed_migrations,
       count(*)                                                             AS total_rows
  FROM "_prisma_migrations";


-- 8. GUARDED BACKFILL PROBE + FINAL VERDICT ----------------------------------
--    The only statement that reads table data. It SKIPS ITSELF when
--    "User"."referralCode" does not exist, so it can never error.
DO $probe$
DECLARE
  v_col      boolean;
  v_settings regclass;
  v_null     bigint;
  v_dupes    bigint;
  v_objects  bigint;
  v_failed   bigint;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'User'
                    AND column_name = 'referralCode') INTO v_col;

  v_settings := to_regclass('public."ReferralProgramSettings"');

  SELECT count(*) INTO v_objects
    FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_name IN ('Referral','ReferralEvent','ReferralReward',
                        'ReferralProgramSettings');

  SELECT count(*) INTO v_failed
    FROM "_prisma_migrations"
   WHERE finished_at IS NULL AND rolled_back_at IS NULL;

  RAISE NOTICE '--------------------------------------------------------------';
  RAISE NOTICE 'P3009 DIAGNOSTIC RESULT';
  RAISE NOTICE '--------------------------------------------------------------';
  RAISE NOTICE '  failed migrations in _prisma_migrations : %', v_failed;
  RAISE NOTICE '  referral tables present                : % of 4', v_objects;
  RAISE NOTICE '  "User"."referralCode" present          : %', v_col;
  RAISE NOTICE '  "ReferralProgramSettings" present     : %',
    coalesce(v_settings::text, 'ABSENT');

  IF NOT v_col THEN
    RAISE NOTICE '  users with NULL referralCode          : N/A (column absent)';
    RAISE NOTICE '  duplicate referral codes              : N/A (column absent)';
    RAISE NOTICE '';
    IF v_objects = 0 THEN
      RAISE NOTICE 'VERDICT: FAILED_NOTHING_APPLIED';
      RAISE NOTICE '  The migration applied ZERO statements and created NOTHING.';
      RAISE NOTICE '  Production is still in the pre-referral schema state. Safe to:';
      RAISE NOTICE '    pnpm --filter @tanvion-royale/api exec prisma migrate resolve --rolled-back 20260926000000_add_user_referral_program --schema database/prisma/schema.prisma';
      RAISE NOTICE '    pnpm --filter @tanvion-royale/api prisma:migrate:deploy:strict';
      RAISE NOTICE '  NEVER use --applied here: it would mark the migration done while';
      RAISE NOTICE '  its tables and its backfill do not exist. NEVER run migrate reset.';
    ELSE
      RAISE NOTICE 'VERDICT: FAILED_PARTIAL';
      RAISE NOTICE '  SOME objects exist. STOP. Do not re-run the migration and do not';
      RAISE NOTICE '  mark it applied. Every object in this migration is ADDITIVE, so';
      RAISE NOTICE '  nothing needs a data rollback - reconcile what is missing by hand.';
    END IF;
  ELSE
    EXECUTE 'SELECT count(*) FROM "User" WHERE "referralCode" IS NULL'
      INTO v_null;
    EXECUTE 'SELECT count(*) FROM (SELECT "referralCode" FROM "User"
              WHERE "referralCode" IS NOT NULL
              GROUP BY "referralCode" HAVING count(*) > 1) d'
      INTO v_dupes;
    RAISE NOTICE '  users with NULL referralCode          : %', v_null;
    RAISE NOTICE '  duplicate referral codes              : %', v_dupes;
    RAISE NOTICE '';
    IF v_objects = 4 AND v_null = 0 AND v_dupes = 0 THEN
      RAISE NOTICE 'VERDICT: FAILED_BUT_COMPLETE';
      RAISE NOTICE '  Every object exists and the backfill is clean, so the DDL ran';
      RAISE NOTICE '  even though the row is marked failed. Only THEN is --applied correct.';
    ELSE
      RAISE NOTICE 'VERDICT: FAILED_PARTIAL - STOP and reconcile by hand.';
    END IF;
  END IF;
  RAISE NOTICE '--------------------------------------------------------------';
END
$probe$;



-- ============================================================================
-- Drift repair (additive only): payment + trading domain ENUMS.
--
-- The current schema (database/prisma/schema.prisma) declares several models
-- and enums that were NEVER created by any earlier migration (verified by
-- scripts/audit-drift.cjs). On a database built from the migration history
-- those objects do not exist, so every Prisma query touching them fails with
-- P2021 ("table does not exist") / P2022-style errors and surfaces as an
-- HTTP 500 — the exact cause of the production "Internal server error" on
-- GET /admin/payment-methods.
--
-- This migration creates the missing ENUM types (tables follow in the next
-- migration, in its own transaction, so an ALTER TYPE ... ADD VALUE can never
-- be used inside the same transaction that uses the new value).
--
-- Every statement is guarded so this migration is IDEMPOTENT and safe to run
-- against ANY database state (fresh, partially migrated, or fully db-push
-- synced) without ever failing or destroying data. Nothing is dropped, no
-- existing rows are touched.
-- ============================================================================

-- --- PaymentMethodType (referenced by migration 20260910000002 which adds
-- --- 'GATEWAY'; the base enum must exist before that ALTER TYPE runs).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentMethodType') THEN
    CREATE TYPE "PaymentMethodType" AS ENUM ('MANUAL', 'GATEWAY');
  END IF;
END $$;
ALTER TYPE "PaymentMethodType" ADD VALUE IF NOT EXISTS 'MANUAL';
ALTER TYPE "PaymentMethodType" ADD VALUE IF NOT EXISTS 'GATEWAY';

-- --- PaymentMethodStatus (ACTIVE | INACTIVE | ARCHIVED) ---
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentMethodStatus') THEN
    CREATE TYPE "PaymentMethodStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');
  END IF;
END $$;

-- --- ManualDepositStatus ---
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ManualDepositStatus') THEN
    CREATE TYPE "ManualDepositStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED');
  END IF;
END $$;

-- --- OtpPurpose: PHONE_RECOVERY value was added to the schema but never
-- --- migrated; phone-recovery OTP creation fails (invalid enum input) without
-- --- it. OtpPurpose itself is created by 20260901000000_phase11.
ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'PHONE_RECOVERY';

-- --- Trading domain enums (paper-trading simulator — virtual money only) ---
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TradingInstrumentType') THEN
    CREATE TYPE "TradingInstrumentType" AS ENUM ('STOCK', 'CRYPTO', 'FOREX', 'COMMODITY');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TradingDataSource') THEN
    CREATE TYPE "TradingDataSource" AS ENUM ('LIVE', 'DELAYED', 'DEMO');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TradingOrderSide') THEN
    CREATE TYPE "TradingOrderSide" AS ENUM ('BUY', 'SELL');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TradingOrderStatus') THEN
    CREATE TYPE "TradingOrderStatus" AS ENUM ('FILLED', 'REJECTED', 'CANCELLED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TradingPositionStatus') THEN
    CREATE TYPE "TradingPositionStatus" AS ENUM ('OPEN', 'CLOSED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TradingTransactionType') THEN
    CREATE TYPE "TradingTransactionType" AS ENUM ('ACCOUNT_CREDIT', 'BUY', 'SELL', 'CLOSE_PROFIT', 'CLOSE_LOSS');
  END IF;
END $$;

-- ============================================================================
-- Drift repair (additive only): PaymentMethod, ManualDepositRequest and the
-- paper-trading tables. Runs AFTER 20260912000000_add_payment_and_trading_enums
-- so every enum value used here was committed in its own transaction.
--
-- Mirrors database/prisma/schema.prisma exactly:
--   PaymentMethod            (admin-managed manual/gateway payment methods)
--   ManualDepositRequest     (user-submitted manual deposits + admin review)
--   TradingAccount           (one virtual paper account per user)
--   TradingInstrument        (virtual tradable instruments)
--   TradingOrder             (filled/rejected/cancelled virtual orders)
--   TradingPosition          (open/closed virtual positions)
--   TradingTransaction       (append-only virtual cash ledger)
--
-- Every CREATE is guarded (idempotent) so this migration is safe against any
-- database state. Additive only: no table is dropped, no column altered,
-- no existing row modified.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- PaymentMethod
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'PaymentMethod') THEN
    CREATE TABLE "PaymentMethod" (
        "id" TEXT NOT NULL,
        "code" TEXT NOT NULL,
        "displayName" TEXT NOT NULL,
        "type" "PaymentMethodType" NOT NULL DEFAULT 'MANUAL',
        "status" "PaymentMethodStatus" NOT NULL DEFAULT 'ACTIVE',
        "supportedCurrencies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        "depositEnabled" BOOLEAN NOT NULL DEFAULT true,
        "withdrawalEnabled" BOOLEAN NOT NULL DEFAULT false,
        "accountNumber" TEXT,
        "accountName" TEXT,
        "bankName" TEXT,
        "branch" TEXT,
        "routingNumber" TEXT,
        "instructions" TEXT,
        "minDeposit" INTEGER NOT NULL DEFAULT 0,
        "maxDeposit" INTEGER NOT NULL DEFAULT 0,
        "minWithdrawal" INTEGER NOT NULL DEFAULT 0,
        "maxWithdrawal" INTEGER NOT NULL DEFAULT 0,
        "requireTransactionId" BOOLEAN NOT NULL DEFAULT true,
        "requireProof" BOOLEAN NOT NULL DEFAULT false,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentMethod_code_key" ON "PaymentMethod"("code");
CREATE INDEX IF NOT EXISTS "PaymentMethod_status_sortOrder_idx" ON "PaymentMethod"("status", "sortOrder");

-- ---------------------------------------------------------------------------
-- ManualDepositRequest
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'ManualDepositRequest') THEN
    CREATE TABLE "ManualDepositRequest" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "methodId" TEXT NOT NULL,
        "amount" INTEGER NOT NULL,
        "currency" TEXT NOT NULL,
        "referenceId" TEXT,
        "proofPath" TEXT,
        "status" "ManualDepositStatus" NOT NULL DEFAULT 'PENDING',
        "rejectionReason" TEXT,
        "reviewedBy" TEXT,
        "reviewedAt" TIMESTAMP(3),
        "transactionId" TEXT,
        "idempotencyKey" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "ManualDepositRequest_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ManualDepositRequest_transactionId_key" ON "ManualDepositRequest"("transactionId");
CREATE UNIQUE INDEX IF NOT EXISTS "ManualDepositRequest_idempotencyKey_key" ON "ManualDepositRequest"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "ManualDepositRequest_userId_createdAt_idx" ON "ManualDepositRequest"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "ManualDepositRequest_status_createdAt_idx" ON "ManualDepositRequest"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "ManualDepositRequest_methodId_idx" ON "ManualDepositRequest"("methodId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ManualDepositRequest_userId_fkey') THEN
    ALTER TABLE "ManualDepositRequest" ADD CONSTRAINT "ManualDepositRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ManualDepositRequest_methodId_fkey') THEN
    ALTER TABLE "ManualDepositRequest" ADD CONSTRAINT "ManualDepositRequest_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- TradingAccount (virtual paper account — NEVER the real wallet)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'TradingAccount') THEN
    CREATE TABLE "TradingAccount" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "currency" TEXT NOT NULL DEFAULT 'USD',
        "virtualBalance" INTEGER NOT NULL DEFAULT 10000000,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "TradingAccount_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "TradingAccount_userId_key" ON "TradingAccount"("userId");
CREATE INDEX IF NOT EXISTS "TradingAccount_userId_idx" ON "TradingAccount"("userId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TradingAccount_userId_fkey') THEN
    ALTER TABLE "TradingAccount" ADD CONSTRAINT "TradingAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- TradingInstrument
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'TradingInstrument') THEN
    CREATE TABLE "TradingInstrument" (
        "id" TEXT NOT NULL,
        "symbol" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "type" "TradingInstrumentType" NOT NULL,
        "basePrice" INTEGER NOT NULL,
        "dataSource" "TradingDataSource" NOT NULL DEFAULT 'DEMO',
        "isEnabled" BOOLEAN NOT NULL DEFAULT true,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "TradingInstrument_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "TradingInstrument_symbol_key" ON "TradingInstrument"("symbol");
CREATE INDEX IF NOT EXISTS "TradingInstrument_type_idx" ON "TradingInstrument"("type");
CREATE INDEX IF NOT EXISTS "TradingInstrument_isEnabled_idx" ON "TradingInstrument"("isEnabled");

-- ---------------------------------------------------------------------------
-- TradingOrder
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'TradingOrder') THEN
    CREATE TABLE "TradingOrder" (
        "id" TEXT NOT NULL,
        "accountId" TEXT NOT NULL,
        "instrumentId" TEXT NOT NULL,
        "side" "TradingOrderSide" NOT NULL,
        "status" "TradingOrderStatus" NOT NULL,
        "priceFilled" INTEGER,
        "quantity" INTEGER NOT NULL,
        "notional" INTEGER NOT NULL,
        "failureReason" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "TradingOrder_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "TradingOrder_accountId_createdAt_idx" ON "TradingOrder"("accountId", "createdAt");
CREATE INDEX IF NOT EXISTS "TradingOrder_instrumentId_idx" ON "TradingOrder"("instrumentId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TradingOrder_accountId_fkey') THEN
    ALTER TABLE "TradingOrder" ADD CONSTRAINT "TradingOrder_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TradingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TradingOrder_instrumentId_fkey') THEN
    ALTER TABLE "TradingOrder" ADD CONSTRAINT "TradingOrder_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "TradingInstrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
-- ---------------------------------------------------------------------------
-- TradingPosition
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'TradingPosition') THEN
    CREATE TABLE "TradingPosition" (
        "id" TEXT NOT NULL,
        "accountId" TEXT NOT NULL,
        "instrumentId" TEXT NOT NULL,
        "side" "TradingOrderSide" NOT NULL,
        "quantity" INTEGER NOT NULL,
        "avgEntryPrice" INTEGER NOT NULL,
        "status" "TradingPositionStatus" NOT NULL DEFAULT 'OPEN',
        "realizedPnl" INTEGER NOT NULL DEFAULT 0,
        "closedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "TradingPosition_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "TradingPosition_accountId_status_idx" ON "TradingPosition"("accountId", "status");
CREATE INDEX IF NOT EXISTS "TradingPosition_instrumentId_idx" ON "TradingPosition"("instrumentId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TradingPosition_accountId_fkey') THEN
    ALTER TABLE "TradingPosition" ADD CONSTRAINT "TradingPosition_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TradingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TradingPosition_instrumentId_fkey') THEN
    ALTER TABLE "TradingPosition" ADD CONSTRAINT "TradingPosition_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "TradingInstrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- TradingTransaction (append-only virtual ledger)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'TradingTransaction') THEN
    CREATE TABLE "TradingTransaction" (
        "id" TEXT NOT NULL,
        "accountId" TEXT NOT NULL,
        "type" "TradingTransactionType" NOT NULL,
        "amount" INTEGER NOT NULL,
        "reason" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "TradingTransaction_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "TradingTransaction_accountId_createdAt_idx" ON "TradingTransaction"("accountId", "createdAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TradingTransaction_accountId_fkey') THEN
    ALTER TABLE "TradingTransaction" ADD CONSTRAINT "TradingTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TradingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

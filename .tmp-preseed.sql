DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentMethodType') THEN
    CREATE TYPE "PaymentMethodType" AS ENUM ('MANUAL');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentMethodStatus') THEN
    CREATE TYPE "PaymentMethodStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'PaymentMethod') THEN
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

-- Wallet/payment phase 6 fix — additive only.
-- 1) Default wallet currency: GBP -> BDT (BDT is the platform default).
--    Existing GBP wallets keep their currency value; only the default changes.
-- 2) PaymentMethodType gains GATEWAY so a payment method can be run in
--    MANUAL or GATEWAY mode.
-- 3) New WithdrawalRequest table (manual/gateway withdrawals) with a
--    ManualWithdrawalStatus enum.
-- 4) New PaymentWebhookEvent table for provider-callback idempotency.

-- AlterTable (default only)
ALTER TABLE "Wallet" ALTER COLUMN "currency" SET DEFAULT 'BDT';

-- AlterEnum
-- GUARDED: "PaymentMethodType" was historically never created by any earlier
-- migration (drift — see 20260912000000), so the original unguarded
-- ALTER TYPE ... ADD VALUE failed with "type does not exist" and ABORTED
-- prisma migrate deploy. Creating the base enum here (if missing, with the
-- schema default 'MANUAL') makes the chain deployable against any database
-- state; the value addition is also IF NOT EXISTS so re-running is safe.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentMethodType') THEN
    CREATE TYPE "PaymentMethodType" AS ENUM ('MANUAL');
  END IF;
END $$;
ALTER TYPE "PaymentMethodType" ADD VALUE IF NOT EXISTS 'GATEWAY';

-- CreateEnum
CREATE TYPE "ManualWithdrawalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "WithdrawalRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "destinationAccount" TEXT,
    "destinationName" TEXT,
    "bankName" TEXT,
    "branch" TEXT,
    "routingNumber" TEXT,
    "status" "ManualWithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "walletTransactionId" TEXT,
    "providerReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WithdrawalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawalRequest_walletTransactionId_key" ON "WithdrawalRequest"("walletTransactionId");
CREATE UNIQUE INDEX "WithdrawalRequest_idempotencyKey_key" ON "WithdrawalRequest"("idempotencyKey");
CREATE INDEX "WithdrawalRequest_userId_createdAt_idx" ON "WithdrawalRequest"("userId", "createdAt");
CREATE INDEX "WithdrawalRequest_status_createdAt_idx" ON "WithdrawalRequest"("status", "createdAt");
CREATE INDEX "WithdrawalRequest_methodId_idx" ON "WithdrawalRequest"("methodId");

CREATE UNIQUE INDEX "PaymentWebhookEvent_provider_eventId_key" ON "PaymentWebhookEvent"("provider", "eventId");
CREATE INDEX "PaymentWebhookEvent_processedAt_idx" ON "PaymentWebhookEvent"("processedAt");

-- AddForeignKey
ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "WithdrawalRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "WithdrawalRequest_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
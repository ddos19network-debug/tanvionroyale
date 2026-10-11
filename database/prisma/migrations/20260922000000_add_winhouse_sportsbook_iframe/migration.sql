-- ============================================================================
-- TANVION ROYALE — EMBEDDED SPORTSBOOK (SPORTS_IFRAME / WinHouse, Model B)
--
-- ADDITIVE ONLY. Nothing is dropped, renamed or reset:
--   * 3 new enums + 2 new tables for the embedded sportsbook: the launch
--     session (which is also the provider-player → TANVION-user mapping) and
--     the provider wallet-movement → TANVION-ledger mapping.
--   * 6 nullable/defaulted columns added to "PartnerProvider" so ONE provider
--     registry serves server sports APIs, embedded sportsbooks and casino
--     destinations (integration type, public embed key/base URL, encrypted
--     wallet credentials, optional JSON config).
--
-- The 2 new tables hold NO balance of any kind: money only ever moves through
-- "Wallet" / "WalletTransaction" / "LedgerEntry". "PartnerProvider" rows are
-- untouched by this migration — every pre-existing row keeps integrationType
-- NULL, which the application treats as the pre-existing SPORTS_API behaviour.
--
-- Reversible in reasoning: dropping the 2 new tables + the 3 enum types and
-- the 6 additive columns restores the previous schema with NO data loss in any
-- pre-existing table.
--
-- NOT APPLIED automatically: this repository deploys migrations deliberately
-- (prisma migrate deploy in the release step), never by an editing agent.
-- ============================================================================

-- CreateEnum
CREATE TYPE "PartnerIntegrationType" AS ENUM ('SPORTS_API', 'SPORTS_IFRAME', 'CASINO_API', 'LIVE_CASINO_API');

-- CreateEnum
CREATE TYPE "WinHouseSessionStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "WinHouseTransactionStatus" AS ENUM ('APPLIED', 'REVERSED');

-- AlterTable (all columns nullable/defaulted — safe for existing rows)
ALTER TABLE "PartnerProvider"
ADD COLUMN "integrationType" "PartnerIntegrationType",
ADD COLUMN "embedKey" TEXT,
ADD COLUMN "embedBaseUrl" TEXT,
ADD COLUMN "walletApiKeyEnc" TEXT,
ADD COLUMN "callbackTokenEnc" TEXT,
ADD COLUMN "config" JSONB;

-- CreateTable
CREATE TABLE "WinHouseSession" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerPlayerId" TEXT NOT NULL,
    "platformSessionId" TEXT,
    "currency" TEXT NOT NULL,
    "environment" TEXT,
    "status" "WinHouseSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "launchExpiresAt" TIMESTAMP(3),
    "launchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WinHouseSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WinHouseTransaction" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ticketId" TEXT,
    "sessionId" TEXT,
    "winhouseSessionId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "amountWire" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "status" "WinHouseTransactionStatus" NOT NULL DEFAULT 'APPLIED',
    "payloadHash" TEXT NOT NULL,
    "walletTransactionId" TEXT,
    "environment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WinHouseTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WinHouseSession_userId_status_idx" ON "WinHouseSession"("userId", "status");

-- CreateIndex
CREATE INDEX "WinHouseSession_providerId_providerPlayerId_idx" ON "WinHouseSession"("providerId", "providerPlayerId");

-- CreateIndex
CREATE INDEX "WinHouseSession_providerId_platformSessionId_idx" ON "WinHouseSession"("providerId", "platformSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "WinHouseTransaction_providerId_transactionId_key" ON "WinHouseTransaction"("providerId", "transactionId");

-- CreateIndex
CREATE INDEX "WinHouseTransaction_userId_createdAt_idx" ON "WinHouseTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WinHouseTransaction_winhouseSessionId_idx" ON "WinHouseTransaction"("winhouseSessionId");

-- CreateIndex
CREATE INDEX "WinHouseTransaction_action_status_idx" ON "WinHouseTransaction"("action", "status");

-- AddForeignKey
ALTER TABLE "WinHouseSession" ADD CONSTRAINT "WinHouseSession_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "PartnerProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WinHouseSession" ADD CONSTRAINT "WinHouseSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WinHouseTransaction" ADD CONSTRAINT "WinHouseTransaction_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "PartnerProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WinHouseTransaction" ADD CONSTRAINT "WinHouseTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WinHouseTransaction" ADD CONSTRAINT "WinHouseTransaction_winhouseSessionId_fkey" FOREIGN KEY ("winhouseSessionId") REFERENCES "WinHouseSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WinHouseTransaction" ADD CONSTRAINT "WinHouseTransaction_walletTransactionId_fkey" FOREIGN KEY ("walletTransactionId") REFERENCES "WalletTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

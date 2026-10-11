-- ===========================================================================
-- TANVION ROYALE — PARTNER CASINO (BIG CASINO / BIG LIVE CASINO)
--
-- ADDITIVE ONLY. Nothing is dropped, renamed or reset:
--   * 5 new enums + 4 new tables for the partner casino catalog, player
--     session mapping and wallet-transaction mapping.
--   * 2 nullable/defaulted columns added to "PartnerProvider" so one provider
--     registry serves sports AND casino destinations (sandbox vs production
--     environment + product types).
--
-- Reversible in reasoning: dropping the 4 new tables + the 2 additive columns
-- and the 5 new enum types restores the previous schema with NO data loss in
-- any pre-existing table (the added column has a default and is not used by
-- any legacy query).
-- ===========================================================================

-- CreateEnum
CREATE TYPE "CasinoProductType" AS ENUM ('CASINO', 'LIVE_CASINO');

-- CreateEnum
CREATE TYPE "CasinoGameStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CasinoSessionStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "CasinoTransactionKind" AS ENUM ('BET', 'WIN', 'REFUND', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "CasinoTransactionStatus" AS ENUM ('APPLIED', 'REVERSED');

-- AlterTable (additive, safe for existing rows)
ALTER TABLE "PartnerProvider" ADD COLUMN "environment" TEXT;

-- AlterTable (additive, safe for existing rows)
ALTER TABLE "PartnerProvider" ADD COLUMN "productTypes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "CasinoCategory" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "productType" "CasinoProductType" NOT NULL DEFAULT 'CASINO',
    "gameCount" INTEGER NOT NULL DEFAULT 0,
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CasinoCategory_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "CasinoGame" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "thumbnail" TEXT,
    "banner" TEXT,
    "categoryId" TEXT,
    "categoryName" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "productType" "CasinoProductType" NOT NULL DEFAULT 'CASINO',
    "status" "CasinoGameStatus" NOT NULL DEFAULT 'ACTIVE',
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "launchAvailable" BOOLEAN NOT NULL DEFAULT true,
    "demoAvailable" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "raw" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CasinoGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CasinoSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "casinoGameId" TEXT NOT NULL,
    "externalGameId" TEXT NOT NULL,
    "providerPlayerId" TEXT NOT NULL,
    "providerSessionId" TEXT,
    "providerRoundId" TEXT,
    "currency" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "demo" BOOLEAN NOT NULL DEFAULT false,
    "status" "CasinoSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "launchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CasinoSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CasinoTransaction" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "externalTransactionId" TEXT NOT NULL,
    "kind" "CasinoTransactionKind" NOT NULL,
    "status" "CasinoTransactionStatus" NOT NULL DEFAULT 'APPLIED',

    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "externalRoundId" TEXT,
    "nonce" TEXT,
    "walletTransactionId" TEXT,
    "referenceTransactionId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CasinoTransaction_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE UNIQUE INDEX "CasinoCategory_providerId_externalId_key" ON "CasinoCategory"("providerId", "externalId");

-- CreateIndex
CREATE INDEX "CasinoCategory_providerId_productType_idx" ON "CasinoCategory"("providerId", "productType");

-- CreateIndex
CREATE INDEX "CasinoCategory_status_idx" ON "CasinoCategory"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CasinoGame_providerId_externalId_key" ON "CasinoGame"("providerId", "externalId");

-- CreateIndex
CREATE INDEX "CasinoGame_providerId_productType_status_idx" ON "CasinoGame"("providerId", "productType", "status");

-- CreateIndex
CREATE INDEX "CasinoGame_slug_idx" ON "CasinoGame"("slug");

-- CreateIndex
CREATE INDEX "CasinoGame_productType_isFeatured_idx" ON "CasinoGame"("productType", "isFeatured");

-- CreateIndex
CREATE INDEX "CasinoSession_userId_casinoGameId_idx" ON "CasinoSession"("userId", "casinoGameId");

-- CreateIndex
CREATE INDEX "CasinoSession_userId_status_idx" ON "CasinoSession"("userId", "status");

-- CreateIndex
CREATE INDEX "CasinoSession_providerId_providerPlayerId_idx" ON "CasinoSession"("providerId", "providerPlayerId");

-- CreateIndex
CREATE INDEX "CasinoSession_providerId_providerSessionId_idx" ON "CasinoSession"("providerId", "providerSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "CasinoTransaction_providerId_externalTransactionId_kind_key" ON "CasinoTransaction"("providerId", "externalTransactionId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "CasinoTransaction_providerId_nonce_key" ON "CasinoTransaction"("providerId", "nonce");

-- CreateIndex
CREATE INDEX "CasinoTransaction_userId_createdAt_idx" ON "CasinoTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CasinoTransaction_sessionId_idx" ON "CasinoTransaction"("sessionId");

-- CreateIndex
CREATE INDEX "CasinoTransaction_kind_status_idx" ON "CasinoTransaction"("kind", "status");

-- AddForeignKey
ALTER TABLE "CasinoCategory" ADD CONSTRAINT "CasinoCategory_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "PartnerProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinoGame" ADD CONSTRAINT "CasinoGame_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "PartnerProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinoGame" ADD CONSTRAINT "CasinoGame_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CasinoCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinoSession" ADD CONSTRAINT "CasinoSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinoSession" ADD CONSTRAINT "CasinoSession_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "PartnerProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinoSession" ADD CONSTRAINT "CasinoSession_casinoGameId_fkey" FOREIGN KEY ("casinoGameId") REFERENCES "CasinoGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinoTransaction" ADD CONSTRAINT "CasinoTransaction_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "PartnerProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinoTransaction" ADD CONSTRAINT "CasinoTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinoTransaction" ADD CONSTRAINT "CasinoTransaction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CasinoSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinoTransaction" ADD CONSTRAINT "CasinoTransaction_walletTransactionId_fkey" FOREIGN KEY ("walletTransactionId") REFERENCES "WalletTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;


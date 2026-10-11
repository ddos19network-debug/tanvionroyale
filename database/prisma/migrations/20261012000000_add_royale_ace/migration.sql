-- TANVION ROYALE - Royale Ace (royale-ace): original 5x4 / 1024-ways cascading card slot.
--
-- ADDITIVE ONLY. Creates three new tables and two new enums for the Royale Ace
-- slot. It never drops, alters, truncates, updates or deletes any existing
-- table or row: users, wallets, ledger entries, bets, royale rounds, payments
-- and responsible-gambling records are all untouched. Money still moves ONLY
-- through the ONE existing wallet ledger (WalletService) in REAL_MONEY or the
-- free-play points ledger in FREE_PLAY; these tables are GAME RECORDS plus the
-- versioned game config and its stored simulation reports.
--
-- File is pure ASCII with NO UTF-8 BOM (see migration-encoding.spec.ts and the
-- 2026-09-26 production failure). Do not add a BOM.
-- ============================================================================

-- CreateEnum
CREATE TYPE "RoyaleAceRoundStatus" AS ENUM ('ACTIVE', 'SETTLED', 'VOIDED');

-- CreateEnum
CREATE TYPE "RoyaleAceConfigStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateTable
CREATE TABLE "RoyaleAceRound" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" "RoyaleGameMode" NOT NULL DEFAULT 'FREE_PLAY',
    "status" "RoyaleAceRoundStatus" NOT NULL DEFAULT 'ACTIVE',
    "stake" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "payout" INTEGER,
    "maxMultiplierBp" INTEGER NOT NULL DEFAULT 10000,
    "capped" BOOLEAN NOT NULL DEFAULT false,
    "serverSeedHash" TEXT NOT NULL,
    "serverSeedEnc" TEXT NOT NULL,
    "serverSeed" TEXT,
    "clientSeed" TEXT NOT NULL,
    "nonce" INTEGER NOT NULL,
    "configVersion" INTEGER NOT NULL,
    "resultJson" JSONB NOT NULL,
    "transactionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "RoyaleAceRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoyaleAceConfigVersion" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "status" "RoyaleAceConfigStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "configJson" JSONB NOT NULL,
    "validationErrors" JSONB,
    "changeReason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "activatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoyaleAceConfigVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoyaleAceSimulationReport" (
    "id" TEXT NOT NULL,
    "configVersion" INTEGER NOT NULL,
    "spins" INTEGER NOT NULL,
    "rtpBp" INTEGER NOT NULL,
    "rtpCiLowBp" INTEGER NOT NULL,
    "rtpCiHighBp" INTEGER NOT NULL,
    "targetRtpBp" INTEGER NOT NULL,
    "toleranceBp" INTEGER NOT NULL,
    "hitFrequencyBp" INTEGER NOT NULL,
    "triggerRateBp" INTEGER NOT NULL,
    "retriggerRateBp" INTEGER NOT NULL,
    "baseGameRtpBp" INTEGER NOT NULL,
    "cascadeRtpBp" INTEGER NOT NULL,
    "freeSpinRtpBp" INTEGER NOT NULL,
    "volatilityBp" INTEGER NOT NULL,
    "maxWinObservedBp" INTEGER NOT NULL,
    "maxWinCapBp" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoyaleAceSimulationReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoyaleAceRound_userId_idempotencyKey_key" ON "RoyaleAceRound"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "RoyaleAceRound_userId_createdAt_idx" ON "RoyaleAceRound"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RoyaleAceRound_status_createdAt_idx" ON "RoyaleAceRound"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RoyaleAceConfigVersion_version_key" ON "RoyaleAceConfigVersion"("version");

-- CreateIndex
CREATE INDEX "RoyaleAceConfigVersion_status_idx" ON "RoyaleAceConfigVersion"("status");

-- CreateIndex
CREATE INDEX "RoyaleAceSimulationReport_configVersion_createdAt_idx" ON "RoyaleAceSimulationReport"("configVersion", "createdAt");

-- AddForeignKey
ALTER TABLE "RoyaleAceRound" ADD CONSTRAINT "RoyaleAceRound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoyaleAceConfigVersion" ADD CONSTRAINT "RoyaleAceConfigVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoyaleAceConfigVersion" ADD CONSTRAINT "RoyaleAceConfigVersion_activatedById_fkey" FOREIGN KEY ("activatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoyaleAceSimulationReport" ADD CONSTRAINT "RoyaleAceSimulationReport_configVersion_fkey" FOREIGN KEY ("configVersion") REFERENCES "RoyaleAceConfigVersion"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoyaleAceSimulationReport" ADD CONSTRAINT "RoyaleAceSimulationReport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Royale Ace settles through the shared RoyaleSettlement record with its own
-- result value. Adding an enum value to an existing type is additive and safe.
ALTER TYPE "RoyaleSettlementResult" ADD VALUE IF NOT EXISTS 'ACE_SPIN';

-- ============================================================================
-- TANVION ROYALE — Crash game engine (participant crash rounds) + free-play
-- points ledger.
-- Additive migration. Adds the CrashRound / CrashBet / CrashSettlement /
-- CrashFreePlayWallet / CrashFreePlayTransaction / GameAuditLog tables and
-- their enums, used by the server-authoritative Sky Rocket crash engine.
--
-- SAFETY: the free-play points ledger is a SEPARATE wallet domain — it can
-- never be exchanged or mistaken for real money. PostgreSQL dialect.
-- ============================================================================

-- CreateEnum
CREATE TYPE "CrashGameMode" AS ENUM ('FREE_PLAY', 'REAL_MONEY');

-- CreateEnum
CREATE TYPE "CrashRoundStatus" AS ENUM ('CREATED', 'BETTING_OPEN', 'RUNNING', 'CRASHED', 'SETTLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CrashBetStatus" AS ENUM ('ACTIVE', 'CASHED_OUT', 'LOST', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CrashSettlementResult" AS ENUM ('CASHED_OUT', 'LOST', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CrashFreePlayTxType" AS ENUM ('SIGNUP_CREDIT', 'BET_STAKE', 'BET_PAYOUT', 'BET_REFUND', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "CrashRound" (
    "id" TEXT NOT NULL,
    "gameSlug" TEXT NOT NULL DEFAULT 'sky-rocket',
    "mode" "CrashGameMode" NOT NULL DEFAULT 'FREE_PLAY',
    "status" "CrashRoundStatus" NOT NULL DEFAULT 'CREATED',
    "roundNumber" INTEGER NOT NULL,
    "serverSeedHash" TEXT NOT NULL DEFAULT '',
    "serverSeed" TEXT,
    "clientSeed" TEXT NOT NULL,
    "nonce" INTEGER NOT NULL DEFAULT 1,
    "algorithmVersion" TEXT NOT NULL DEFAULT 'v1',
    "startAt" TIMESTAMP(3) NOT NULL,
    "bettingCloseAt" TIMESTAMP(3) NOT NULL,
    "crashAt" TIMESTAMP(3),
    "crashMultiplier" DOUBLE PRECISION,
    "crashedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "bettingClosedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrashRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrashBet" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" "CrashGameMode" NOT NULL DEFAULT 'FREE_PLAY',
    "stake" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'FREEPLAY',
    "status" "CrashBetStatus" NOT NULL DEFAULT 'ACTIVE',
    "cashoutMultiplier" DOUBLE PRECISION,
    "payout" INTEGER,
    "transactionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cashoutAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrashBet_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "CrashSettlement" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "betId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "result" "CrashSettlementResult" NOT NULL,
    "stake" INTEGER NOT NULL,
    "cashoutMultiplier" DOUBLE PRECISION,
    "payout" INTEGER NOT NULL,
    "transactionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrashSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrashFreePlayWallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 100000,
    "currency" TEXT NOT NULL DEFAULT 'FREEPLAY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrashFreePlayWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrashFreePlayTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "CrashFreePlayTxType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrashFreePlayTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameAuditLog" (
    "id" TEXT NOT NULL,
    "gameSlug" TEXT NOT NULL DEFAULT 'sky-rocket',
    "roundId" TEXT,
    "betId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameAuditLog_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "CrashRound_gameSlug_roundNumber_key" ON "CrashRound"("gameSlug", "roundNumber");
CREATE INDEX "CrashRound_status_idx" ON "CrashRound"("status");
CREATE INDEX "CrashRound_mode_idx" ON "CrashRound"("mode");
CREATE INDEX "CrashRound_startAt_idx" ON "CrashRound"("startAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrashBet_userId_idempotencyKey_key" ON "CrashBet"("userId", "idempotencyKey");
CREATE INDEX "CrashBet_roundId_idx" ON "CrashBet"("roundId");
CREATE INDEX "CrashBet_roundId_status_idx" ON "CrashBet"("roundId", "status");
CREATE INDEX "CrashBet_userId_idx" ON "CrashBet"("userId");
CREATE INDEX "CrashBet_userId_createdAt_idx" ON "CrashBet"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrashSettlement_betId_key" ON "CrashSettlement"("betId");
CREATE INDEX "CrashSettlement_roundId_idx" ON "CrashSettlement"("roundId");
CREATE INDEX "CrashSettlement_userId_idx" ON "CrashSettlement"("userId");
CREATE INDEX "CrashSettlement_userId_createdAt_idx" ON "CrashSettlement"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrashFreePlayWallet_userId_key" ON "CrashFreePlayWallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CrashFreePlayTransaction_userId_idempotencyKey_key" ON "CrashFreePlayTransaction"("userId", "idempotencyKey");
CREATE INDEX "CrashFreePlayTransaction_walletId_idx" ON "CrashFreePlayTransaction"("walletId");
CREATE INDEX "CrashFreePlayTransaction_referenceType_referenceId_idx" ON "CrashFreePlayTransaction"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "GameAuditLog_gameSlug_roundId_idx" ON "GameAuditLog"("gameSlug", "roundId");
CREATE INDEX "GameAuditLog_userId_idx" ON "GameAuditLog"("userId");
CREATE INDEX "GameAuditLog_action_idx" ON "GameAuditLog"("action");

-- AddForeignKey
ALTER TABLE "CrashBet" ADD CONSTRAINT "CrashBet_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "CrashRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrashBet" ADD CONSTRAINT "CrashBet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrashSettlement" ADD CONSTRAINT "CrashSettlement_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "CrashRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrashSettlement" ADD CONSTRAINT "CrashSettlement_betId_fkey" FOREIGN KEY ("betId") REFERENCES "CrashBet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrashFreePlayWallet" ADD CONSTRAINT "CrashFreePlayWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrashFreePlayTransaction" ADD CONSTRAINT "CrashFreePlayTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "CrashFreePlayWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- ============================================================================
-- TANVION ROYALE — Free-play game sessions & results.
-- Additive migration. Adds the GameSession/GameResult tables (and the
-- GameSessionStatus enum) used by the internally developed free-play game
-- engine. These store free-play points ONLY — never money. PostgreSQL dialect.
-- ============================================================================

-- CreateEnum
CREATE TYPE "GameSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED');

-- CreateTable
CREATE TABLE "GameSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameSlug" TEXT NOT NULL,
    "status" "GameSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "state" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameResult" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameSlug" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GameSession_userId_gameSlug_idx" ON "GameSession"("userId", "gameSlug");
CREATE INDEX "GameSession_userId_status_idx" ON "GameSession"("userId", "status");
CREATE INDEX "GameSession_gameSlug_status_idx" ON "GameSession"("gameSlug", "status");
CREATE INDEX "GameResult_userId_gameSlug_idx" ON "GameResult"("userId", "gameSlug");
CREATE INDEX "GameResult_gameSlug_createdAt_idx" ON "GameResult"("gameSlug", "createdAt");

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameResult" ADD CONSTRAINT "GameResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
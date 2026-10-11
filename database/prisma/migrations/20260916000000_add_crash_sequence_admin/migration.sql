-- ============================================================================
-- TANVION ROYALE — Sky Rocket operator-configured crash-point sequence.
-- Additive migration. Adds:
--   * CrashPointSource / CrashSequenceMode enums
--   * CrashRound.crashSource, .sequenceMode, .sequenceIndex,
--     .crashPointConfigured (predetermined multiplier, server-only)
--   * CrashSequenceState singleton table (persisted sequence position so it
--     survives restarts / deployments / reconnects)
-- No existing rows or columns are modified or removed.
-- ============================================================================

-- CreateEnum
CREATE TYPE "CrashPointSource" AS ENUM ('PROVABLY_FAIR', 'CONFIGURED');

-- CreateEnum
CREATE TYPE "CrashSequenceMode" AS ENUM ('PROVABLY_FAIR', 'ORIGINAL', 'REPEAT', 'REPEAT_EXTENDED', 'NEW_SEQUENCE');

-- AlterTable: operator-configured sequence fields on CrashRound (all nullable
-- or defaulted — existing provably-fair rounds stay exactly as they are).
ALTER TABLE "CrashRound" ADD COLUMN "crashSource" "CrashPointSource" NOT NULL DEFAULT 'PROVABLY_FAIR';
ALTER TABLE "CrashRound" ADD COLUMN "sequenceMode" "CrashSequenceMode";
ALTER TABLE "CrashRound" ADD COLUMN "sequenceIndex" INTEGER;
ALTER TABLE "CrashRound" ADD COLUMN "crashPointConfigured" DOUBLE PRECISION;

-- CreateTable: singleton sequence state per game (unique gameSlug).
CREATE TABLE "CrashSequenceState" (
    "id" TEXT NOT NULL,
    "gameSlug" TEXT NOT NULL DEFAULT 'sky-rocket',
    "mode" "CrashSequenceMode" NOT NULL DEFAULT 'PROVABLY_FAIR',
    "originalPoints" JSONB NOT NULL,
    "nextPoints" JSONB,
    "originalConsumed" INTEGER NOT NULL DEFAULT 0,
    "repeatPosition" INTEGER NOT NULL DEFAULT 0,
    "repeatEnd" INTEGER NOT NULL DEFAULT 0,
    "newConsumed" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrashSequenceState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrashSequenceState_gameSlug_key" ON "CrashSequenceState"("gameSlug");

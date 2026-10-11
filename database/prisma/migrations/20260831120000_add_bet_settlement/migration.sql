-- Phase 7 — Bet settlement & lifecycle engine (additive only).
-- Adds settlement outcome fields; no existing table is dropped or altered in
-- a destructive way, and no data is deleted.

-- CreateEnum
CREATE TYPE "SelectionResult" AS ENUM ('WIN', 'LOSS', 'VOID', 'PUSH');

-- AlterTable (additive)
ALTER TABLE "BetSelection"
    ADD COLUMN "result" "SelectionResult",
    ADD COLUMN "settledAt" TIMESTAMP(3);

ALTER TABLE "Bet"
    ADD COLUMN "result" "SelectionResult",
    ADD COLUMN "settledAt" TIMESTAMP(3),
    ADD COLUMN "payout" INTEGER;

-- CreateIndex
CREATE INDEX "Bet_result_idx" ON "Bet"("result");
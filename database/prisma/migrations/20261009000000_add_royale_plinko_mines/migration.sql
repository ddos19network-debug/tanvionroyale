-- TANVION ROYALE - Royale Play: Plinko + Mines (server-authoritative games).
--
-- ADDITIVE ONLY. Creates three new game-record tables and three new enums.
-- It never drops, alters, truncates, updates or deletes any existing table or
-- row: wallets, ledger entries, bets, sessions, users, OTPs, crash records and
-- payments are all untouched. Money still moves ONLY through the existing
-- Wallet/WalletTransaction/LedgerEntry ledger (REAL_MONEY) or the existing
-- CrashFreePlayWallet points ledger (FREE_PLAY) - this migration creates NO
-- balance column of any kind.
--
-- File is pure ASCII with NO UTF-8 BOM (see migration-encoding.spec.ts and the
-- 2026-09-26 production failure). Do not add a BOM.
-- ============================================================================

-- 1. Enums -------------------------------------------------------------------
CREATE TYPE "RoyaleGameMode" AS ENUM ('FREE_PLAY', 'REAL_MONEY');
CREATE TYPE "RoyaleMinesStatus" AS ENUM ('ACTIVE', 'CASHED_OUT', 'BUSTED', 'VOIDED');
CREATE TYPE "RoyaleSettlementResult" AS ENUM ('PLINKO_PAYOUT', 'MINES_CASHOUT', 'MINES_BUST', 'VOIDED');

-- 2. Tables ------------------------------------------------------------------
-- One Plinko drop: settled atomically at creation (path + payout frozen).
CREATE TABLE "RoyalePlinkoRound" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" "RoyaleGameMode" NOT NULL DEFAULT 'FREE_PLAY',
    "rows" INTEGER NOT NULL,
    "risk" TEXT NOT NULL,
    "stake" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "serverSeedHash" TEXT NOT NULL,
    "serverSeed" TEXT NOT NULL,
    "clientSeed" TEXT NOT NULL,
    "nonce" INTEGER NOT NULL,
    "path" INTEGER[] NOT NULL,
    "binIndex" INTEGER NOT NULL,
    "multiplierBp" INTEGER NOT NULL,
    "payout" INTEGER NOT NULL,
    "transactionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoyalePlinkoRound_pkey" PRIMARY KEY ("id")
);

-- One Mines round: hidden mine seed kept encrypted until settlement.
CREATE TABLE "RoyaleMinesRound" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" "RoyaleGameMode" NOT NULL DEFAULT 'FREE_PLAY',
    "status" "RoyaleMinesStatus" NOT NULL DEFAULT 'ACTIVE',
    "gridSize" INTEGER NOT NULL DEFAULT 25,
    "minesCount" INTEGER NOT NULL,
    "stake" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "serverSeedHash" TEXT NOT NULL,
    "serverSeedEnc" TEXT NOT NULL,
    "serverSeed" TEXT,
    "clientSeed" TEXT NOT NULL,
    "nonce" INTEGER NOT NULL,
    "minesRevealed" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "revealed" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "currentMultiplierBp" INTEGER NOT NULL DEFAULT 10000,
    "payout" INTEGER,
    "transactionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "RoyaleMinesRound_pkey" PRIMARY KEY ("id")
);

-- Terminal settlement record for a settled Royale round (reconciliation anchor).
CREATE TABLE "RoyaleSettlement" (
    "id" TEXT NOT NULL,
    "gameSlug" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "result" "RoyaleSettlementResult" NOT NULL,
    "stake" INTEGER NOT NULL,
    "payout" INTEGER NOT NULL,
    "multiplierBp" INTEGER,
    "transactionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoyaleSettlement_pkey" PRIMARY KEY ("id")
);

-- 3. Indexes -----------------------------------------------------------------
-- Idempotency: the unique key is the exactly-once guard for drops/start/cashout.
CREATE UNIQUE INDEX "RoyalePlinkoRound_userId_idempotencyKey_key" ON "RoyalePlinkoRound"("userId", "idempotencyKey");
CREATE INDEX "RoyalePlinkoRound_userId_idx" ON "RoyalePlinkoRound"("userId");
CREATE INDEX "RoyalePlinkoRound_userId_createdAt_idx" ON "RoyalePlinkoRound"("userId", "createdAt");

CREATE UNIQUE INDEX "RoyaleMinesRound_userId_idempotencyKey_key" ON "RoyaleMinesRound"("userId", "idempotencyKey");
CREATE INDEX "RoyaleMinesRound_userId_idx" ON "RoyaleMinesRound"("userId");
CREATE INDEX "RoyaleMinesRound_userId_status_idx" ON "RoyaleMinesRound"("userId", "status");
CREATE INDEX "RoyaleMinesRound_userId_createdAt_idx" ON "RoyaleMinesRound"("userId", "createdAt");

CREATE UNIQUE INDEX "RoyaleSettlement_userId_idempotencyKey_key" ON "RoyaleSettlement"("userId", "idempotencyKey");
CREATE INDEX "RoyaleSettlement_gameSlug_createdAt_idx" ON "RoyaleSettlement"("gameSlug", "createdAt");
CREATE INDEX "RoyaleSettlement_userId_createdAt_idx" ON "RoyaleSettlement"("userId", "createdAt");
CREATE INDEX "RoyaleSettlement_roundId_idx" ON "RoyaleSettlement"("roundId");

-- 4. Foreign keys to User (cascade, same posture as CrashBet/GameSession) ----
ALTER TABLE "RoyalePlinkoRound" ADD CONSTRAINT "RoyalePlinkoRound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoyaleMinesRound" ADD CONSTRAINT "RoyaleMinesRound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoyaleSettlement" ADD CONSTRAINT "RoyaleSettlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Admin permissions (additive + idempotent, same pattern as
--    20260924000001_provision_canonical_admin_permissions).
INSERT INTO "Permission" ("id", "name")
SELECT md5('tanvion-admin-permission:' || catalog.name), catalog.name
FROM (
  VALUES
    ('royale.read'),
    ('royale.manage')
) AS catalog(name)
ON CONFLICT ("name") DO NOTHING;

-- SUPER_ADMIN receives every non-kyc capability (same rule as canonical seed).
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role_row."id", permission_row."id"
FROM "Role" role_row
CROSS JOIN "Permission" permission_row
WHERE role_row."name" = 'SUPER_ADMIN'
  AND permission_row."name" IN ('royale.read', 'royale.manage')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- Ordinary ADMIN receives operational capabilities (never admins./roles.).
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role_row."id", permission_row."id"
FROM "Role" role_row
CROSS JOIN "Permission" permission_row
WHERE role_row."name" = 'ADMIN'
  AND permission_row."name" IN ('royale.read', 'royale.manage')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;


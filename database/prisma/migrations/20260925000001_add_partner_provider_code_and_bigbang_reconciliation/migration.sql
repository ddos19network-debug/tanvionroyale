-- ============================================================================
-- TANVION ROYALE — ADD PARTNER PROVIDER CODE AND BIGBANG RECONCILIATION
--
-- ADDITIVE ONLY. Existing provider rows remain valid with a NULL providerCode.
-- BigBangTransaction stores provider audit/idempotency metadata only; the
-- canonical Wallet/WalletTransaction/LedgerEntry remains the sole balance.
-- ============================================================================

ALTER TABLE "PartnerProvider" ADD COLUMN "providerCode" TEXT;

CREATE INDEX "PartnerProvider_providerCode_environment_idx"
  ON "PartnerProvider"("providerCode", "environment");

CREATE TABLE "BigBangTransaction" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "transactionId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "amountWire" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "gameCategory" TEXT NOT NULL,
    "roundId" TEXT,
    "roundType" TEXT,
    "roundEnd" BOOLEAN,
    "payloadHash" TEXT NOT NULL,
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "walletTransactionId" TEXT,
    "environment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BigBangTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BigBangTransaction_providerId_transactionId_key"
    ON "BigBangTransaction"("providerId", "transactionId");
CREATE INDEX "BigBangTransaction_userId_createdAt_idx"
    ON "BigBangTransaction"("userId", "createdAt");
CREATE INDEX "BigBangTransaction_sessionId_idx"
    ON "BigBangTransaction"("sessionId");
CREATE INDEX "BigBangTransaction_roundId_idx"
    ON "BigBangTransaction"("roundId");

ALTER TABLE "BigBangTransaction"
    ADD CONSTRAINT "BigBangTransaction_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "PartnerProvider"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BigBangTransaction"
    ADD CONSTRAINT "BigBangTransaction_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BigBangTransaction"
    ADD CONSTRAINT "BigBangTransaction_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "CasinoSession"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BigBangTransaction"
    ADD CONSTRAINT "BigBangTransaction_walletTransactionId_fkey"
    FOREIGN KEY ("walletTransactionId") REFERENCES "WalletTransaction"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- TANVION ROYALE — Phase 16b: Partner provider admin configuration.
-- Additive migration. Adds admin-managed provider config columns (encrypted
-- secrets at rest, auth/API version, sync status/history) to PartnerProvider.
-- Does not alter any existing table or enum. PostgreSQL dialect.
-- ============================================================================

-- AlterTable
ALTER TABLE "PartnerProvider" ADD COLUMN "apiKeyEnc" TEXT,
ADD COLUMN "apiSecretEnc" TEXT,
ADD COLUMN "authMode" TEXT,
ADD COLUMN "apiVersion" TEXT,
ADD COLUMN "syncStatus" TEXT,
ADD COLUMN "lastSyncAt" TIMESTAMP(3),
ADD COLUMN "lastSyncError" TEXT;

-- CreateIndex
CREATE INDEX "PartnerProvider_syncStatus_idx" ON "PartnerProvider"("syncStatus");
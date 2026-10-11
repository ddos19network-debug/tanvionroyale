-- ============================================================================
-- TANVION ROYALE — Phase 16: Sports Hub + Live/Upcoming Events + Partner Gambling
-- Routing.
--
-- Additive migration. Adds:
--   - BettingMode enum (NATIVE | PARTNER)
--   - Competition model (sport -> competition -> events)
--   - PartnerProvider model (allowlisted partner deep-link configuration)
--   - Event columns: competitionId, homeName, awayName, live, bettingMode,
--     externalEventId, partnerProviderId
--
-- Does not alter any existing table or enum. PostgreSQL dialect.
-- ============================================================================

-- CreateEnum
CREATE TYPE "BettingMode" AS ENUM ('NATIVE', 'PARTNER');

-- CreateTable
CREATE TABLE "Competition" (
    "id" TEXT NOT NULL,
    "sportId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "country" TEXT,
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "deepLinkTemplate" TEXT NOT NULL,
    "status" "ProviderMappingStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerProvider_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "competitionId" TEXT,
ADD COLUMN "homeName" TEXT,
ADD COLUMN "awayName" TEXT,
ADD COLUMN "live" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "bettingMode" "BettingMode" NOT NULL DEFAULT 'NATIVE',
ADD COLUMN "externalEventId" TEXT,
ADD COLUMN "partnerProviderId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Competition_sportId_slug_key" ON "Competition"("sportId", "slug");

-- CreateIndex
CREATE INDEX "Competition_sportId_idx" ON "Competition"("sportId");

-- CreateIndex
CREATE INDEX "Competition_status_idx" ON "Competition"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerProvider_name_key" ON "PartnerProvider"("name");

-- CreateIndex
CREATE INDEX "PartnerProvider_status_idx" ON "PartnerProvider"("status");

-- CreateIndex
CREATE INDEX "Event_competitionId_idx" ON "Event"("competitionId");

-- CreateIndex
CREATE INDEX "Event_bettingMode_idx" ON "Event"("bettingMode");

-- CreateIndex
CREATE INDEX "Event_partnerProviderId_idx" ON "Event"("partnerProviderId");

-- AddForeignKey
ALTER TABLE "Competition" ADD CONSTRAINT "Competition_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_partnerProviderId_fkey" FOREIGN KEY ("partnerProviderId") REFERENCES "PartnerProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
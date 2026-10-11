-- Additive migration: "Report a Problem" support cases.
--
-- Adds ONE enum plus nullable/defaulted columns and ONE index. No ALTER of an
-- existing column, no DROP, no data deletion — every existing SupportTicket /
-- SupportMessage row stays valid (source defaults to 'LIVE_CHAT').

-- CreateEnum
CREATE TYPE "SupportTicketSource" AS ENUM ('LIVE_CHAT', 'PROBLEM_REPORT');

-- AlterTable: how the case was opened + the contact details captured by the
-- /support/report form (null for Live Chat conversations).
ALTER TABLE "SupportTicket" ADD COLUMN "source" "SupportTicketSource" NOT NULL DEFAULT 'LIVE_CHAT';
ALTER TABLE "SupportTicket" ADD COLUMN "contactName" TEXT;
ALTER TABLE "SupportTicket" ADD COLUMN "contactEmail" TEXT;
ALTER TABLE "SupportTicket" ADD COLUMN "contactPhone" TEXT;

-- AlterTable: optional screenshot on a message (base64 image data URL, same
-- rule as the wallet payment-proof upload).
ALTER TABLE "SupportMessage" ADD COLUMN "attachmentDataUrl" TEXT;

-- CreateIndex: "my problem reports" listing (user + source).
CREATE INDEX "SupportTicket_userId_source_idx" ON "SupportTicket"("userId", "source");

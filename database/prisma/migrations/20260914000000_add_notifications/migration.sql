-- TANVION ROYALE - additive notification system (in-app + FCM push).
-- SAFE BY DESIGN: creates NEW tables/enums/indexes only. No existing table,
-- column, or row is dropped, altered destructively, or reset.

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM (
  'DEPOSIT_APPROVED',
  'DEPOSIT_REJECTED',
  'WITHDRAWAL_APPROVED',
  'WITHDRAWAL_REJECTED',
  'WITHDRAWAL_COMPLETED',
  'BET_WON',
  'BET_LOST',
  'NEW_DEPOSIT_REQUEST',
  'NEW_WITHDRAWAL_REQUEST',
  'NEW_USER_REGISTRATION',
  'SECURITY_ALERT',
  'SYSTEM_ANNOUNCEMENT',
  'PROMOTION',
  'GENERAL'
);

-- CreateEnum
CREATE TYPE "NotificationAudience" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED', 'INVALID_TOKEN');

-- CreateTable
CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "recipientUserId" TEXT NOT NULL,
  "audience" "NotificationAudience" NOT NULL DEFAULT 'USER',
  "type" "NotificationType" NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "data" JSONB,
  "actionUrl" TEXT,
  "dedupeKey" TEXT,
  "isRead" BOOLEAN NOT NULL DEFAULT false,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDevice" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'fcm',
  "token" TEXT NOT NULL,
  "platform" TEXT,
  "browser" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
  "id" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_recipientUserId_key" ON "Notification"("dedupeKey", "recipientUserId");

-- CreateIndex
CREATE INDEX "Notification_recipientUserId_isRead_idx" ON "Notification"("recipientUserId", "isRead");

-- CreateIndex
CREATE INDEX "Notification_recipientUserId_audience_createdAt_idx" ON "Notification"("recipientUserId", "audience", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_type_createdAt_idx" ON "Notification"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDevice_provider_token_key" ON "NotificationDevice"("provider", "token");

-- CreateIndex
CREATE INDEX "NotificationDevice_userId_isActive_idx" ON "NotificationDevice"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_notificationId_deviceId_key" ON "NotificationDelivery"("notificationId", "deviceId");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_idx" ON "NotificationDelivery"("status");

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "NotificationDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

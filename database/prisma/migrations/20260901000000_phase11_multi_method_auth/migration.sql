-- Phase 11: multi-method authentication + verification center.
-- Additive only: existing sports/betting/wallet/settlement models untouched.

-- User: email becomes optional (phone-only accounts), new verification timestamps.
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);

-- Linked authentication identities (PHONE / GOOGLE / FACEBOOK).
CREATE TYPE "AuthIdentityProvider" AS ENUM ('PHONE', 'GOOGLE', 'FACEBOOK');

CREATE TABLE "AuthIdentity" (
    "id" TEXT NOT NULL,
    "provider" "AuthIdentityProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthIdentity_provider_providerAccountId_key" ON "AuthIdentity"("provider", "providerAccountId");
CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity"("userId");

ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One-time codes (OTP + OAuth exchange). Hashes only.
CREATE TYPE "OtpPurpose" AS ENUM ('PHONE_SIGNUP', 'PHONE_VERIFY', 'EMAIL_VERIFY', 'OAUTH_EXCHANGE');

CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OtpCode_identifier_purpose_idx" ON "OtpCode"("identifier", "purpose");
CREATE INDEX "OtpCode_expiresAt_idx" ON "OtpCode"("expiresAt");

-- Verification center state.
CREATE TYPE "VerificationType" AS ENUM ('PHONE', 'EMAIL', 'FACE');
CREATE TYPE "VerificationStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED');

CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "VerificationType" NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "verifiedAt" TIMESTAMP(3),
    "providerRef" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Verification_userId_type_key" ON "Verification"("userId", "type");
CREATE INDEX "Verification_userId_idx" ON "Verification"("userId");

ALTER TABLE "Verification" ADD CONSTRAINT "Verification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill verification timestamps for already-verified accounts.
UPDATE "User" SET "emailVerifiedAt" = NOW() WHERE "emailVerified" = true AND "emailVerifiedAt" IS NULL;
UPDATE "User" SET "phoneVerifiedAt" = NOW() WHERE "phoneVerified" = true AND "phoneVerifiedAt" IS NULL;
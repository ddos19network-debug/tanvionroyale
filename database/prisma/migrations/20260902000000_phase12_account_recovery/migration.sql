-- Phase 12: account recovery + password login hardening.
-- Additive only: existing models untouched.

-- New OTP purpose for phone-based password recovery.
ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'PHONE_RECOVERY';

-- Track when a user first possesses a functioning password. OAuth-only
-- accounts keep this NULL until they opt into password login.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordSetAt" TIMESTAMP(3);
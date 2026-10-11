-- Phase 11.4 — verification state accuracy.
-- Distinguishes "phone verified automatically during phone signup" from
-- "phone verified manually later" — autoVerifiedDuringSignup is derived from
-- this field only. Existing users keep NULL (never claim auto-verification
-- without proof), which is the safe/conservative backfill.
ALTER TABLE "User" ADD COLUMN "phoneVerifiedDuringSignupAt" TIMESTAMP(3);

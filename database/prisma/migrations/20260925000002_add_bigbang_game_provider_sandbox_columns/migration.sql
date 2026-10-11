-- ============================================================================
-- TANVION ROYALE — BIGBANG TRANSACTION COLUMNS ADDED BY THE WALLET CONTRACT
--
-- ADDITIVE ONLY. Nothing is dropped, renamed or reset.
-- The BigBang seamless-wallet callbacks carry the provider's game id, the
-- provider's own game slug and a sandbox flag; they are persisted on
-- BigBangTransaction as reconciliation metadata (informational only — the
-- idempotency key remains (providerId, transactionId)).
-- ============================================================================

ALTER TABLE "BigBangTransaction" ADD COLUMN IF NOT EXISTS "gameId" TEXT;
ALTER TABLE "BigBangTransaction" ADD COLUMN IF NOT EXISTS "providerExternalId" TEXT;
ALTER TABLE "BigBangTransaction" ADD COLUMN IF NOT EXISTS "sandbox" BOOLEAN NOT NULL DEFAULT false;

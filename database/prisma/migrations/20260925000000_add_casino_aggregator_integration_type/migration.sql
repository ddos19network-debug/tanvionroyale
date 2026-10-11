-- ============================================================================
-- TANVION ROYALE — ADD CASINO_AGGREGATOR TO PartnerIntegrationType
--
-- ADDITIVE ONLY. Nothing is dropped, renamed or reset.
-- Extends PartnerIntegrationType enum with CASINO_AGGREGATOR to support
-- external B2B casino aggregators (BigBang and future aggregators)
-- without breaking existing SPORTS_API, SPORTS_IFRAME, CASINO_API, or LIVE_CASINO_API.
-- ============================================================================

ALTER TYPE "PartnerIntegrationType" ADD VALUE IF NOT EXISTS 'CASINO_AGGREGATOR';

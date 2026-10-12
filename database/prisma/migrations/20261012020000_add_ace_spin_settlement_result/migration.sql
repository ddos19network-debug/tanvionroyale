-- Royale Ace: ACE_SPIN settlement result. Idempotent (a no-op when it already exists).
ALTER TYPE "RoyaleSettlementResult" ADD VALUE IF NOT EXISTS 'ACE_SPIN';

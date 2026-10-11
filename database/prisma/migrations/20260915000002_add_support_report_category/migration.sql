-- Additive migration: problem-report category (+ contact/display fields).
--
-- Adds ONE nullable TEXT column. No ALTER of an existing column, no DROP, no
-- data deletion — every existing SupportTicket row stays valid (category is
-- null on Live Chat conversations and on reports filed before categories).
ALTER TABLE "SupportTicket" ADD COLUMN "category" TEXT;

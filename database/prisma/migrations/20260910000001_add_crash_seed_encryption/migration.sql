-- Additive: encrypted-at-rest server seed for crash rounds so a restarted
-- server can resume the pre-determined provably-fair crash point.
ALTER TABLE "CrashRound" ADD COLUMN "crashPointSeedEnc" TEXT;

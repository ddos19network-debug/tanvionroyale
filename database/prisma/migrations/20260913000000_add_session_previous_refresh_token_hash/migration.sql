-- Race-safe refresh-token rotation for multi-tab sessions.
--
-- The Session table keeps the hash of the refresh token that was current
-- BEFORE the latest rotation. /auth/refresh accepts it for exactly one more
-- rotation, so two tabs of the same browser firing /auth/refresh with the same
-- token at the same moment both succeed and converge on the newest pair —
-- instead of the second tab receiving 401 and clearing the whole device
-- session. A token matching neither slot is a genuine replay and is rejected.
ALTER TABLE "Session" ADD COLUMN "previousRefreshTokenHash" TEXT;

CREATE INDEX "Session_previousRefreshTokenHash_idx" ON "Session"("previousRefreshTokenHash");

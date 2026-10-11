-- Account separation: staff/admin sessions vs customer sessions.
--
-- Session.kind records WHICH authentication context created the session:
--   CUSTOMER — email/phone/OAuth customer login, signup flows (the default, so
--              every pre-existing session migrates as a customer session);
--   STAFF    — created only by POST /auth/admin-login after the staff-only
--              role/status/credential checks.
--
-- RolesGuard refuses ADMIN/SUPER_ADMIN routes for non-STAFF sessions, closing
-- the gap where a customer session (promoted to ADMIN mid-session and rotated
-- through /auth/refresh) silently gained admin access without ever passing
-- through the dedicated staff login.
--
-- Additive only: CREATE TYPE + ADD COLUMN with a NOT NULL DEFAULT — no table
-- is altered beyond one new column, no row's existing values are rewritten,
-- and historical sessions keep working as CUSTOMER sessions (fail-closed for
-- staff: they re-authenticate once at /admin/login after this deploys).
CREATE TYPE "SessionKind" AS ENUM ('CUSTOMER', 'STAFF');

ALTER TABLE "Session" ADD COLUMN "kind" "SessionKind" NOT NULL DEFAULT 'CUSTOMER';
# Live Chat (Support) migration — production runbook

**Migration:** `20260914010000_add_support_chat`
**File:** `database/prisma/migrations/20260914010000_add_support_chat/migration.sql`
**Creates:** `SupportTicket`, `SupportMessage`, `SupportTicketStatus`,
`SupportMessageAuthorRole`, `NotificationType.SUPPORT_MESSAGE` / `SUPPORT_REPLY`,
6 indexes (incl. the unique idempotency index `SupportMessage_ticketId_clientRef_key`)
and 4 foreign keys. **Additive only** — no `ALTER` of existing columns, no data loss.

## 1. Why a Render build fails with "Pending migration(s) detected"

`scripts/verify-migrations.cjs` runs `prisma migrate status`, parses it and aborts the
build whenever any migration is still unapplied. It fails **only** when the production
database is genuinely behind the code — it is a correct, load-bearing guard. Never
delete the step, never weaken it, never "resolve" a migration you have not applied.

Build chain (render.yaml, order matters):

```
corepack enable
  -> pnpm install --frozen-lockfile --prod=false
  -> pnpm --filter @tanvion-royale/api prisma:generate
  -> pnpm --filter @tanvion-royale/api prisma:migrate:deploy:strict   (deploy + verify)
  -> node scripts/verify-migrations.cjs                              (fail-closed gate)
  -> pnpm --filter @tanvion-royale/api... run build
  -> test -f apps/api/dist/main.js
```

The Render **dashboard build command must equal the `buildCommand` in `render.yaml`**
(a service created from the dashboard ignores the blueprint file). `DIRECT_URL` (Neon
unpooled endpoint) must be set: `prisma migrate deploy` needs a session-persistent
connection for its advisory lock, otherwise it can time out with P1002.

## 2. Diagnose BEFORE touching anything (read-only)

```bash
# from the repo root, with DATABASE_URL or DIRECT_URL in the environment
node scripts/check-migration-state.cjs
```

It prints the migration checksum, whether `SupportTicket` / `SupportMessage` exist,
every column/index/FK, the enum values, the `_prisma_migrations` state, and one verdict:

| Verdict | Meaning | Safe action |
| --- | --- | --- |
| `A_UNAPPLIED` | nothing exists, no history row | `pnpm --filter @tanvion-royale/api prisma:migrate:deploy` |
| `B_HISTORY_MISSING_SCHEMA_MATCHES` | every object exists, history row missing | `node scripts/check-migration-state.cjs --repair` (history only, no DDL) |
| `C_PARTIAL` | some objects exist, some do not | `--print-repair-sql` → review → `prisma db execute --file` → then `--repair` |
| `D_ENUMS_ONLY` | enums/`NotificationType` values exist, tables do not | same as C (never a second `ALTER TYPE ... ADD VALUE`) |
| `IN_SYNC` | schema + checksum + history agree | nothing to do |
| `HISTORY_FAILED` / `_ROLLED_BACK` / `_CHECKSUM_MISMATCH` / `_APPLIED_SCHEMA_INCONSISTENT` | history says something the schema does not | follow the printed NEXT ACTION; `migrate resolve --rolled-back` before re-applying a failed attempt |

`--repair` **refuses** unless the live schema has been proven to contain every object
the migration creates, and then calls Prisma's own
`prisma migrate resolve --applied 20260914010000_add_support_chat` (which computes and
stores the checksum itself) — no hand-written `INSERT` into `_prisma_migrations`.

## 3. Never do this

* `prisma migrate reset`, `DROP`, `TRUNCATE`, `DELETE` on production.
* Re-running the migration's DDL after the objects exist (it is not idempotent:
  `CREATE TYPE` / `CREATE TABLE` would fail **after** partially applying, recording a
  FAILED migration ⇒ P3009).
* Editing an applied migration file (changes its checksum) — add a new forward migration.
* Marking a migration applied "to make the build green" without proving the schema matches.

## 4. Verify after the repair

```bash
pnpm --filter @tanvion-royale/api prisma:migrate:status      # expect "up to date"
node scripts/verify-migrations.cjs                           # expect exit 0
```

Then redeploy on Render (the chain now passes legitimately) and smoke-test:

```
GET  /api/v1/support/chat                     (user JWT)  -> conversation + messages
POST /api/v1/support/chat/messages            (user JWT)  -> persists, refresh keeps it
POST /api/v1/support/chat/messages  (same clientRef)      -> created:false, no duplicate
POST /api/v1/support/chat/read                (user JWT)
GET  /api/v1/admin/support/tickets            (ADMIN/SUPER_ADMIN JWT)
GET  /api/v1/admin/support/unread-count       (ADMIN)
GET  /api/v1/admin/support/tickets/:id        (ADMIN)
POST /api/v1/admin/support/tickets/:id/reply  (ADMIN)     -> user notification SUPPORT_REPLY
POST /api/v1/admin/support/tickets/:id/read   (ADMIN)
PATCH /api/v1/admin/support/tickets/:id/status (ADMIN)
POST /api/v1/admin/support/tickets/:id/assign (ADMIN)
```

`GET /api/v1/health` must report `checks.schema: "up"` — the sentinel probes both chat
tables, so it is the fastest proof that the migration actually landed.

## 5. Architecture is fixed: REST + polling

Vercel frontend → authenticated REST API → Render NestJS → Prisma → Neon PostgreSQL.
The chat endpoints poll every 5s (`apps/web/app/support/chat/page.tsx`). Do not move
Live Chat onto WebSocket/Socket.IO/SSE/Firebase Chat/Pusher/Ably/Supabase.
# Partner Casino (provider catalog) migration — production runbook

**Migration:** `20260917000000_add_casino_provider_catalog`
**File:** `database/prisma/migrations/20260917000000_add_casino_provider_catalog/migration.sql`
**Failure it is written for:** `P3018` → PostgreSQL `42601 syntax error at or near ""amount""`
**Creates:** 5 enums (`CasinoProductType`, `CasinoGameStatus`, `CasinoSessionStatus`,
`CasinoTransactionKind`, `CasinoTransactionStatus`), 4 tables (`CasinoCategory`,
`CasinoGame`, `CasinoSession`, `CasinoTransaction` — 64 columns), 16 indexes (4 unique),
10 foreign keys, and 2 additive nullable/defaulted columns on `PartnerProvider`
(`environment`, `productTypes`). **Additive only** — no `DROP`, no `RENAME`, no data
migration, no second wallet, no new wallet transaction table.

## 1. Root cause (exact)

The committed `migration.sql` carried a **duplicated tail of the `CREATE TABLE
"CasinoTransaction"` body appended after the last `ALTER TABLE` statement** — 14 lines
starting with `    "amount" INTEGER NOT NULL,` and ending with `CONSTRAINT
"CasinoTransaction_pkey" PRIMARY KEY ("id")`, `);`, `);`.

`"amount"` was **also** declared correctly *inside* the `CREATE TABLE` (line 115), so the
trailing copy was a leftover top-level fragment. PostgreSQL therefore parsed it as the
start of a **new statement**, whose first token is a quoted identifier:

```
ERROR:  syntax error at or near ""amount""
SQLSTATE: 42601
```

Prisma then recorded the attempt in `_prisma_migrations` with `finished_at = NULL`, and
every later `migrate deploy` aborts with P3009 (`failed migrations found`) until that
failed attempt is resolved. `schema.prisma` was correct and was **not** changed; no other
migration was touched; Prisma stays at **5.22.0**.

## 2. Diagnose before touching anything (read-only)

```bash
# from the repo root, with DATABASE_URL (pooled) or DIRECT_URL (unpooled) set
node scripts/check-casino-migration-state.cjs           # human report
node scripts/check-casino-migration-state.cjs --json    # machine readable
```

It parses the migration file into the exact objects it should create, lints it (an
orphaned fragment is reported and forces exit 1), probes the live database with `SELECT`s
only, and prints **one verdict + the next command**. It never writes: no DDL, no DML, no
`_prisma_migrations` write, no `migrate resolve`.

| Verdict | Meaning | Safe action |
| --- | --- | --- |
| `A_FAILED_FULLY_ROLLED_BACK` | failed history row, **nothing** committed (the expected outcome of a syntax error) | `migrate resolve --rolled-back <migration>` → `prisma:migrate:deploy:strict` |
| `A_FAILED_SCHEMA_COMPLETE` | failed history row, but **every** object the migration creates already exists | `migrate resolve --applied <migration>` (history only — the DDL must **not** run again). **Never `--rolled-back`** |
| `C_PARTIAL_FAILED` | failed row and only SOME objects exist | HUMAN JUDGEMENT: create only the missing objects (listed), re-run until complete, then `--applied` |
| `B_HISTORY_MISSING_SCHEMA_MATCHES` | schema complete, no history row | `migrate resolve --applied <migration>` |
| `ROLLED_BACK_READY_TO_RETRY` | already recorded as rolled back, nothing committed | `prisma:migrate:deploy:strict` |
| `IN_SYNC` | applied, complete, checksum matches | nothing to do |
| `HISTORY_CHECKSUM_MISMATCH` / `HISTORY_APPLIED_SCHEMA_INCONSISTENT` / `*_OBJECTS_EXIST` / `C_PARTIAL_NO_HISTORY` | history says something the schema does not | stop; complete the delta or add a NEW forward migration |

The JSON output carries the decision in one field, so the resolve step is never guessed:

```bash
node scripts/check-casino-migration-state.cjs --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.verdict.code);console.log(j.verdict.resolveCommand??'(none justified)')})"
```

## 3. Production recovery (exact command order)

`pnpm --filter <pkg> exec` runs **inside `apps/api`**, so every `--schema` below is
`../../database/prisma/schema.prisma` (verified: the root-relative form fails with
`Could not load --schema from provided path`).

```bash
# 0) DATABASE_URL + DIRECT_URL must point at the production database
#    (DIRECT_URL = Neon unpooled endpoint; the migrate CLI needs it for its advisory lock)
node scripts/check-casino-migration-state.cjs --json

# --- ONLY when the verdict is A_FAILED_FULLY_ROLLED_BACK -------------------
# 1) history marker only — no DDL, no data change
pnpm --filter @tanvion-royale/api exec prisma migrate resolve --rolled-back \
  20260917000000_add_casino_provider_catalog --schema ../../database/prisma/schema.prisma
# 2) apply the repaired migration (then the fail-closed gate)
pnpm --filter @tanvion-royale/api prisma:migrate:deploy:strict
node scripts/verify-migrations.cjs

# --- ONLY when the verdict is A_FAILED_SCHEMA_COMPLETE ---------------------
# 1) history only: every object is already proven present, so the DDL must not run again
pnpm --filter @tanvion-royale/api exec prisma migrate resolve --applied \
  20260917000000_add_casino_provider_catalog --schema ../../database/prisma/schema.prisma
# 2) same verification chain
pnpm --filter @tanvion-royale/api prisma:migrate:deploy:strict
node scripts/verify-migrations.cjs

# --- ANY partial / mismatch verdict: STOP. Resolve nothing. ---------------
#   Report the missing/different enum types, values, tables, columns, primary
#   keys, indexes, FKs and additive columns that the diagnostic prints.
```

Then commit + push the repaired `migration.sql` and let Render redeploy; its chain is
`prisma:generate` → `prisma:migrate:deploy:strict` → `verify-migrations.cjs` → build.

The migration file is **checksummed** by Prisma. Because it was never applied
successfully, repairing it is the correct fix (no new "fix-up" migration on top of a broken
one, and no checksum "repair" for an applied migration).

## 4. Why `--rolled-back` here — and never `--applied`

* Prisma applies each migration to PostgreSQL inside a transaction, and this failure was a
  **parse error in the final fragment of the file**, so the expected outcome is that nothing
  from this migration committed. That is exactly what
  `node scripts/check-casino-migration-state.cjs` **proves** before you act: while it reports
  `A_FAILED_FULLY_ROLLED_BACK`, `--rolled-back` is the correct — and only — history write,
  and it then lets Prisma re-run the **repaired** file. Nothing is assumed from the error
  message alone.
* `--applied` would record the migration as done while the tables and enum types are
  missing: every casino route would then fail with P2021/P2022 while
  `prisma migrate status` and the Render build looked green. That is exactly the failure
  mode this repository has been burned by before.
* If the verifier reports `C_PARTIAL_*` (objects exist), the file must **not** be re-run:
  `CREATE TYPE` / `CREATE TABLE` are not idempotent and would fail again. Create only the
  missing objects, re-run the verifier until everything is present, then `--applied`.

## 5. "Following migrations have been modified since they were applied"

If a **dev/test** database had already applied the pre-repair checksum, `migrate deploy`
prints that warning. It is a warning, not an error: do **not** re-run the DDL and do **not**
reset anything. The production database never applied this migration, so it never shows
this warning.

Two rows for the same migration in `_prisma_migrations` after a recovery are also normal:
the failed attempt keeps its row (`rolled_back_at` set) and Prisma inserts a fresh row when
it applies the repaired file. The diagnostic prints every row count and the target row so
this is never mistaken for corruption — **never** delete the old row by hand.

## 6. Never do this for this incident

* `prisma migrate reset`, `DROP`, `TRUNCATE`, `DELETE` on production.
* `prisma db push` against production.
* Deleting rows from `_prisma_migrations` by hand.
* `prisma migrate resolve --applied` without the verifier proving every object exists.
* `--rolled-back` when the objects already exist (it would re-run DDL that cannot run twice).
* Upgrading Prisma (the log's `5.22.0 -> 8.0.0-rc.15` notice is informational only — the
  failure was malformed SQL, not an outdated client).
* Editing any migration that has already been applied.

## 7. Verify after the deploy

```bash
pnpm --filter @tanvion-royale/api prisma:migrate:status   # expect "Database schema is up to date!"
node scripts/verify-migrations.cjs                        # expect exit 0
node scripts/check-casino-migration-state.cjs             # expect IN_SYNC
```

`GET /api/v1/health` must report `checks.schema: "up"` (the `isSchemaUpToDate()` drift
sentinel compiled into the API) — the fastest proof the migration really landed.

Smoke tests (authenticated, no business logic was changed by this fix):

```
GET   /api/v1/casino/status                        -> integration/catalog readiness
GET   /api/v1/casino/catalog                      -> synced catalogue (may be empty until a sync)
GET   /api/v1/casino/catalog/featured|categories|providers|recent
GET   /api/v1/casino/games/:gameId
POST  /api/v1/casino/launch                       -> creates CasinoSession (+ wallet gating)
POST  /api/v1/casino/sessions/:sessionId/close
GET   /api/v1/admin/casino/status|games|sessions|transactions   (ADMIN)
POST  /api/v1/admin/casino/sync                   (ADMIN)  -> catalog sync writes CasinoGame rows
POST  /api/v1/admin/casino/providers/:id/config   (ADMIN)  -> provider environment/productTypes
POST  /api/v1/casino/callbacks/{balance,bet,win,refund,rollback}  (provider-signed)
```

Untouched by this repair (regression checklist): authentication/OAuth, wallet,
deposits, withdrawals, `WalletTransaction` ledger, sports catalog/betting/settlement,
Royale Play internal games, Sky Rocket (crash), Lightning Dice, notifications, support chat.

## 8. Local diagnostics used to prove this fix

```bash
node .tmp-migration-harness/run-lint.cjs            # structural lint, all 24 migrations
node .tmp-migration-harness/compare-casino-ddl.cjs  # migration DDL vs Prisma-generated DDL from schema.prisma
node .tmp-migration-harness/casino-state-test.cjs   # fake-database tests for the verifier (all verdicts)
node scripts/check-casino-migration-state.cjs       # read-only live diagnosis (needs DATABASE_URL)
```

`run-lint.cjs` is the guard for this defect class: a top-level statement that begins with a
quoted identifier. Promote it into the Render build chain (before `migrate deploy`) if the
team wants malformed SQL to fail the build instead of the database — that decision was left
out of this repair to keep the existing
`prisma migrate deploy && node ../../scripts/verify-migrations.cjs` chain unchanged.

Full-history replay still requires a disposable PostgreSQL (Docker is not installed on the
primary dev machine):

```bash
# disposable DB only — never production
prisma migrate diff --from-migrations database/prisma/migrations \
  --to-schema-datamodel database/prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DB" --exit-code     # expect exit 0 (no drift)
```


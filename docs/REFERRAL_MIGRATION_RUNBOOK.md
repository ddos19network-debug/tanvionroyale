# User Referral Program migration — production recovery runbook

**Migration:** `20260926000000_add_user_referral_program`
**File:** `database/prisma/migrations/20260926000000_add_user_referral_program/migration.sql`
**Creates:** `Referral`, `ReferralEvent`, `ReferralReward`, `ReferralProgramSettings`,
5 enum types (`ReferralStatus`, `ReferralRewardRecipient`, `ReferralBonusType`,
`ReferralQualificationRule`, `ReferralRewardStatus`), 4 values ADDed to existing
enums (`WalletTransactionType.REFERRAL_BONUS`, `NotificationType.REFERRAL_JOINED`,
`.REFERRAL_QUALIFIED`, `.REFERRAL_BONUS_CREDITED`), the `User.referralCode`
column + `User_referralCode_key` unique index, 11 indexes total, 4 primary keys
and 5 foreign keys. **Additive only** — no DROP, no TRUNCATE, no DELETE, no
rewriting of an existing table, no wallet/ledger change.

> Do **not** use `scripts/check-migration-state.cjs` here. That script targets a
> different migration (`20260914010000_add_support_chat`). The referral-specific
> diagnostic is `scripts/diagnose-referral-migration.cjs`.

## 1. Root cause (2026-09-26 P3009)

The first commit of this migration wrote `migration.sql` **starting with a UTF-8
BOM** (`EF BB BF`). The file's first statement is a `--` comment, and PostgreSQL
does **not** treat U+FEFF as whitespace, so `--` was not at the start of a token
and the whole batched script failed to parse **before statement 0 ran**.

Consequences, both confirmed by the diagnostic:

* Prisma recorded a **FAILED** row in `_prisma_migrations` for this migration.
* **None** of the tables/enums/columns/indexes/foreign keys were created.

Removing the BOM from the file is necessary but **not** sufficient: Prisma keeps
refusing to deploy while a FAILED row exists, so the row must be resolved by hand.
**That resolution must be a deliberate operator action, never part of the build.**

The BOM is gone from the file today (byte 0 is `0x2D`, `-`), and
`apps/api/test/migration-encoding.spec.ts` fails the build if a BOM is ever
reintroduced into **any** `migration.sql`.

## 2. Diagnose BEFORE touching anything (read-only)

```bash
# from the repo root, with production DATABASE_URL / DIRECT_URL in the env
node scripts/diagnose-referral-migration.cjs
node scripts/diagnose-referral-migration.cjs --json   # machine-readable
```

The diagnostic is **SELECT-only**: it never runs DDL/DML, never writes a file,
never calls `migrate resolve`/`deploy`/`reset`, and prints the database **host
only** — never credentials. It prints:

1. host and the exact bytes/checksum/BOM status of the file on disk,
2. the `_prisma_migrations` row **including the original `logs` error verbatim**,
3. the full applied-migration history,
4. a per-object report: tables, **every column**, enums, enum values, indexes,
   unique constraints, primary keys and foreign keys (present / MISSING),
5. user-data checks: total users, how many have/have not been backfilled,
   duplicate codes, settings singleton row,
6. a minimal, **additive-only** repair plan for whatever is missing (printed for
   review — it is never executed),
7. one verdict with explicit next steps.

The expected object list is **derived from `migration.sql` and cross-checked
against `schema.prisma` at runtime**, so it cannot silently drift out of date.
If that derivation fails, the verdict is `UNVERIFIED_EXPECTATIONS` and the tool
fails closed rather than guessing.


## 3. The verdicts and the safe action for each

| Verdict | Meaning | Safe action |
| --- | --- | --- |
| `FAILED_NOTHING_APPLIED` | FAILED row, **zero** objects exist (this is the expected production state) | `migrate resolve --rolled-back`, then deploy |
| `FAILED_PARTIAL` | FAILED row, only **some** objects exist | **fail closed**; reconcile the missing objects by hand using the printed plan |
| `FAILED_BUT_COMPLETE` | FAILED row, every object **and** every data check passes | `migrate resolve --applied` (history only) |
| `FAILED_BUT_DATA_INCOMPLETE` | every object exists but the backfill/settings row is incomplete | **fail closed**; finish the data first, never `--applied` |
| `NO_ROW_BUT_OBJECTS_EXIST` | no history row, yet objects exist (schema drift) | **fail closed**; manual review |
| `ROLLED_BACK_BUT_OBJECTS_EXIST` | rolled back, yet objects exist | **fail closed**; manual review |
| `APPLIED_BUT_INCONSISTENT` | history says applied, schema says otherwise | **fail closed**; manual review |
| `APPLIED_CHECKSUM_MISMATCH` | applied, but the file changed on disk afterwards | review the diff (it should be the BOM removal) first |
| `ROLLED_BACK` | rolled back and nothing exists | deploy |
| `APPLIED` | applied and verified | nothing to do |

## 4. The recovery for THIS incident (Render shell, one-off)

Only run this **after** the diagnostic printed `FAILED_NOTHING_APPLIED` with
`objects present  NONE` and `starts with BOM  no`.

```bash
# 1. mark the failed row as rolled back — history only, NO DDL, NO data change
pnpm --filter @tanvion-royale/api exec prisma migrate resolve \
  --rolled-back 20260926000000_add_user_referral_program \
  --schema database/prisma/schema.prisma

# 2. re-check: the verdict must now be ROLLED_BACK
node scripts/diagnose-referral-migration.cjs

# 3. deploy the corrected migration (applies it exactly once)
pnpm --filter @tanvion-royale/api prisma:migrate:deploy:strict

# 4. confirm the history and the schema agree
node scripts/diagnose-referral-migration.cjs     # expect APPLIED
node scripts/verify-migrations.cjs                # expect "up to date"
```

### Is `--rolled-back` safe here?

**Yes, and only in the `FAILED_NOTHING_APPLIED` state.** `migrate resolve
--rolled-back` only sets `rolled_back_at` on the existing row. It executes no DDL,
issues no DML and touches no table, so it cannot destroy production data. It then
lets `migrate deploy` apply the corrected migration normally — which is the whole
point. Using it when objects *do* exist would be wrong (a re-deploy could collide
on `CREATE TYPE`/`CREATE TABLE`); the diagnostic refuses to recommend it in that
state and you should follow `FAILED_PARTIAL` instead.

### Is `--applied` safe here?

**Only in the `FAILED_BUT_COMPLETE` state**, i.e. every table, column, enum,
enum value, index, unique constraint, primary key and foreign key exists, the
backfill is complete (`without referralCode = 0`), there are **no** duplicate
codes, and the settings singleton row exists. It then records the migration as
applied without running any DDL. It is **wrong and unsafe** whenever objects or
data are missing, because it would mark a half-applied migration as done and hide
the gap forever — the diagnostic refuses to recommend it there.


## 5. Never do this

* `prisma migrate reset` — drops the database. This is the one mistake that
  actually destroys production data, and it is never necessary here.
* `DROP`, `TRUNCATE`, or `DELETE` on any production table.
* `migrate resolve --applied` without the full `FAILED_BUT_COMPLETE` verification.
* Editing `migration.sql` to "make it deploy" — the file is correct; only the
  `_prisma_migrations` row is wrong.
* Adding the resolve step to `render.yaml`, the build command, or any CI job.
  Recovery is a one-off human action in a Render shell; the normal deploy path
  stays `prisma:generate -> prisma:migrate:deploy:strict -> verify-migrations -> build`.
* Renaming or duplicating this migration — the name and checksum are load-bearing
  for every database that already recorded it.

## 6. After recovery

The normal Render deploy sequence is unchanged and needs no edit:

```
prisma:generate -> prisma:migrate:deploy:strict -> node scripts/verify-migrations.cjs -> build
```

`verify-migrations.cjs` remains the fail-closed gate that aborts a build while any
migration is unapplied. It is a correct, load-bearing guard: never remove or
weaken it to make a build green. All BigBang / WinHouse migrations and code are
untouched by this recovery.


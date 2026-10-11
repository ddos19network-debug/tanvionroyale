#!/usr/bin/env node
/**
 * check-migration-state.cjs
 *
 * READ-ONLY production diagnosis for ONE migration + a guarded history repair.
 *
 * Why this exists
 * ---------------
 * Render's build chain runs `prisma migrate deploy` and then refuses to build
 * while `prisma migrate status` still reports a pending migration. The failure
 * message alone ("Following migration have not yet been applied") does NOT say
 * whether the production database is:
 *
 *   A) completely unapplied                      -> just run migrate deploy
 *   B) schema objects already exist (db push /  -> NEVER re-run the DDL;
 *      manual DDL / earlier drift repair) but      reconcile history only
 *      _prisma_migrations has no row
 *   C) partially applied (some statements       -> apply ONLY the missing
 *      succeeded, some did not)                    statements, then B
 *   D) enum values/types exist but tables do    -> add the missing objects
 *      not                                        (never ALTER TYPE twice)
 *
 * Guessing between these is how the "reset the database" disaster happens.
 * This script answers the question from the database itself.
 *
 * Usage (run from the repo root)
 * ------------------------------
 *   node scripts/check-migration-state.cjs                    # read-only report
 *   node scripts/check-migration-state.cjs --json             # machine readable
 *   node scripts/check-migration-state.cjs --print-repair-sql # CASE C/D DDL only
 *   node scripts/check-migration-state.cjs --repair           # CASE B only
 *
 * Safety guarantees
 * -----------------
 *   * Default mode issues SELECTs only. No DDL, no DML, no history writes.
 *   * `--repair` refuses unless the live schema has been PROVEN to contain
 *     every object the migration creates, and then runs Prisma's own
 *     `prisma migrate resolve --applied <name>` (which computes the checksum
 *     itself) instead of hand-written INSERTs into _prisma_migrations.
 *   * `--print-repair-sql` only PRINTS SQL (never executes it) so a human
 *     reviews the smallest possible delta before it touches production.
 *   * It never runs `migrate reset`, never DROPs, never DELETEs, never edits
 *     the migration file. The file checksum is compared against what the
 *     database recorded, and a mismatch is reported loudly.
 *   * DATABASE_URL/DIRECT_URL are never printed (host only) — same policy as
 *     scripts/verify-migrations.cjs.
 *
 * Env: DATABASE_URL (pooled, used for reads) or DIRECT_URL (unpooled).
 *      A local `.env` / `apps/api/.env` is loaded if present; values are never logged.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const schemaPath = path.join(root, 'database', 'prisma', 'schema.prisma');

const MIGRATION = '20260914010000_add_support_chat';
const migrationSqlPath = path.join(
  root,
  'database',
  'prisma',
  'migrations',
  MIGRATION,
  'migration.sql',
);

const args = process.argv.slice(2);
const wantJson = args.includes('--json');
const wantRepairSql = args.includes('--print-repair-sql');
const wantRepair = args.includes('--repair');

// ---------------------------------------------------------------------------
// env loading (mirrors audit-db.cjs — values are never echoed)
// ---------------------------------------------------------------------------
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnvFile(path.join(root, '.env'));
loadEnvFile(path.join(root, 'apps', 'api', '.env'));

function hostOnly(urlStr) {
  try {
    const u = new URL(urlStr);
    return `${u.host}${u.pathname}`;
  } catch {
    return '(unparseable URL)';
  }
}

const directUrl = process.env.DIRECT_URL;
const dbUrl = process.env.DATABASE_URL || directUrl;
if (!dbUrl) {
  console.error(
    '\n[check-migration-state] ERROR: neither DATABASE_URL nor DIRECT_URL is set.\n' +
      'Set one in the environment (or a local .env) and re-run. Nothing was read or written.\n',
  );
  process.exit(1);
}
// The Prisma Client reads DATABASE_URL from env; fall back to DIRECT_URL when
// only the unpooled endpoint is configured (both point at the same database).
if (!process.env.DATABASE_URL && directUrl) process.env.DATABASE_URL = directUrl;

// ---------------------------------------------------------------------------
// what migration.sql is expected to create (exact, hand-checked spec)
// ---------------------------------------------------------------------------
const EXPECTED_ENUMS = {
  SupportTicketStatus: ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'],
  SupportMessageAuthorRole: ['USER', 'ADMIN'],
};
/** Values added to the pre-existing NotificationType enum (20260914000000). */
const EXPECTED_NOTIFICATION_VALUES = ['SUPPORT_MESSAGE', 'SUPPORT_REPLY'];

/** column: [name, udt_type, nullable, defaultClass] */
const EXPECTED_TABLES = {
  SupportTicket: {
    pk: ['id'],
    columns: [
      ['id', 'text', false, 'none'],
      ['userId', 'text', false, 'none'],
      ['status', 'SupportTicketStatus', false, 'literal'],
      ['assignedAdminId', 'text', true, 'none'],
      ['adminUnreadCount', 'int4', false, 'literal'],
      ['userUnreadCount', 'int4', false, 'literal'],
      ['lastMessageAt', 'timestamp', false, 'now'],
      ['createdAt', 'timestamp', false, 'now'],
      ['updatedAt', 'timestamp', false, 'none'],
    ],
  },
  SupportMessage: {
    pk: ['id'],
    columns: [
      ['id', 'text', false, 'none'],
      ['ticketId', 'text', false, 'none'],
      ['authorUserId', 'text', false, 'none'],
      ['authorRole', 'SupportMessageAuthorRole', false, 'none'],
      ['body', 'text', false, 'none'],
      ['clientRef', 'text', true, 'none'],
      ['createdAt', 'timestamp', false, 'now'],
    ],
  },
};

/** index name -> { table, unique, columns } */
const EXPECTED_INDEXES = {
  SupportTicket_userId_updatedAt_idx: {
    table: 'SupportTicket',
    unique: false,
    columns: ['userId', 'updatedAt'],
  },
  SupportTicket_status_lastMessageAt_idx: {
    table: 'SupportTicket',
    unique: false,
    columns: ['status', 'lastMessageAt'],
  },
  SupportTicket_assignedAdminId_idx: {
    table: 'SupportTicket',
    unique: false,
    columns: ['assignedAdminId'],
  },
  SupportMessage_ticketId_createdAt_idx: {
    table: 'SupportMessage',
    unique: false,
    columns: ['ticketId', 'createdAt'],
  },
  SupportMessage_authorUserId_idx: {
    table: 'SupportMessage',
    unique: false,
    columns: ['authorUserId'],
  },
  SupportMessage_ticketId_clientRef_key: {
    table: 'SupportMessage',
    unique: true,
    columns: ['ticketId', 'clientRef'],
  },
};

/** FK name -> { table, refTable, onDelete } — pg_constraint confdeltype codes. */
const EXPECTED_FKS = {
  SupportTicket_userId_fkey: { table: 'SupportTicket', refTable: 'User', onDelete: 'c' },
  SupportTicket_assignedAdminId_fkey: { table: 'SupportTicket', refTable: 'User', onDelete: 'n' },
  SupportMessage_ticketId_fkey: { table: 'SupportMessage', refTable: 'SupportTicket', onDelete: 'c' },
  SupportMessage_authorUserId_fkey: { table: 'SupportMessage', refTable: 'User', onDelete: 'r' },
};

const DELETION_LABEL = { c: 'CASCADE', n: 'SET NULL', r: 'RESTRICT', a: 'NO ACTION', d: 'SET DEFAULT' };

// exact CREATE TABLE text from migration.sql (used by --print-repair-sql)
const CREATE_TABLE_SQL = {
  SupportTicket: `CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "assignedAdminId" TEXT,
    "adminUnreadCount" INTEGER NOT NULL DEFAULT 0,
    "userUnreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);`,
  SupportMessage: `CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorRole" "SupportMessageAuthorRole" NOT NULL,
    "body" TEXT NOT NULL,
    "clientRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);`,
};

const CREATE_ENUM_SQL = {
  SupportTicketStatus:
    `CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED');`,
  SupportMessageAuthorRole: `CREATE TYPE "SupportMessageAuthorRole" AS ENUM ('USER', 'ADMIN');`,
};

const CREATE_INDEX_SQL = {
  SupportTicket_userId_updatedAt_idx:
    'CREATE INDEX "SupportTicket_userId_updatedAt_idx" ON "SupportTicket"("userId", "updatedAt");',
  SupportTicket_status_lastMessageAt_idx:
    'CREATE INDEX "SupportTicket_status_lastMessageAt_idx" ON "SupportTicket"("status", "lastMessageAt");',
  SupportTicket_assignedAdminId_idx:
    'CREATE INDEX "SupportTicket_assignedAdminId_idx" ON "SupportTicket"("assignedAdminId");',
  SupportMessage_ticketId_createdAt_idx:
    'CREATE INDEX "SupportMessage_ticketId_createdAt_idx" ON "SupportMessage"("ticketId", "createdAt");',
  SupportMessage_authorUserId_idx:
    'CREATE INDEX "SupportMessage_authorUserId_idx" ON "SupportMessage"("authorUserId");',
  SupportMessage_ticketId_clientRef_key:
    'CREATE UNIQUE INDEX "SupportMessage_ticketId_clientRef_key" ON "SupportMessage"("ticketId", "clientRef");',
};

// ---------------------------------------------------------------------------
// checksum — Prisma records the sha256 hex digest of migration.sql's bytes
// ---------------------------------------------------------------------------
const fileChecksum = crypto
  .createHash('sha256')
  .update(fs.readFileSync(migrationSqlPath))
  .digest('hex');

// ---------------------------------------------------------------------------
// read-only database access (Prisma Client generated from database/prisma/schema.prisma)
// ---------------------------------------------------------------------------
// eslint-disable-next-line import/no-dynamic-require
const { PrismaClient } = require(path.join(root, 'apps', 'api', 'src', 'generated', 'prisma'));
const prisma = new PrismaClient();
const q = (sql, ...params) => prisma.$queryRawUnsafe(sql, ...params);

/** Normalise a column_default into a class so we compare meaning, not spacing. */
function defaultClass(def) {
  if (def === null || def === undefined) return 'none';
  const d = String(def).replace(/\s+/g, ' ').trim();
  if (/^CURRENT_TIMESTAMP/i.test(d)) return 'now';
  if (/^nextval\(/i.test(d)) return 'sequence';
  if (/^-?\d+$/.test(d)) return 'literal';
  if (/^'[^']*'(::[a-zA-Z_" ]+)?$/.test(d)) return 'literal';
  return `other(${d})`;
}

async function probe() {
  const tables = await q(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('SupportTicket', 'SupportMessage')`,
  );
  const tableNames = tables.map((r) => r.table_name).sort();

  const columns = tableNames.length
    ? await q(
        `SELECT table_name, column_name, udt_name, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name IN ('SupportTicket', 'SupportMessage')
          ORDER BY table_name, ordinal_position`,
      )
    : [];

  const attributes = tableNames.length
    ? await q(
        `SELECT c.relname AS table_name, a.attnum, a.attname
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname IN ('SupportTicket', 'SupportMessage')
            AND a.attnum > 0 AND NOT a.attisdropped`,
      )
    : [];
  const attName = new Map(attributes.map((a) => [`${a.table_name}:${a.attnum}`, a.attname]));

  const indexRows = tableNames.length
    ? await q(
        `SELECT c.relname AS index_name, t.relname AS table_name,
                i.indisunique AS is_unique, i.indisprimary AS is_primary, i.indkey::text AS indkey
           FROM pg_index i
           JOIN pg_class c ON c.oid = i.indexrelid
           JOIN pg_class t ON t.oid = i.indrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = 'public' AND t.relname IN ('SupportTicket', 'SupportMessage')`,
      )
    : [];
  const indexes = indexRows.map((r) => ({
    index_name: r.index_name,
    table_name: r.table_name,
    is_unique: r.is_unique === true,
    is_primary: r.is_primary === true,
    columns: String(r.indkey)
      .split(/\s+/)
      .filter(Boolean)
      .map((n) => attName.get(`${r.table_name}:${n}`) ?? `attnum:${n}`),
  }));

  const fks = tableNames.length
    ? await q(
        `SELECT con.conname, t.relname AS table_name, rt.relname AS ref_table, con.confdeltype
           FROM pg_constraint con
           JOIN pg_class t ON t.oid = con.conrelid
           JOIN pg_class rt ON rt.oid = con.confrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE con.contype = 'f' AND n.nspname = 'public'
            AND t.relname IN ('SupportTicket', 'SupportMessage')`,
      )
    : [];

  const enumRows = await q(
    `SELECT t.typname, e.enumlabel, e.enumsortorder
       FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname IN ('SupportTicketStatus', 'SupportMessageAuthorRole', 'NotificationType')
      ORDER BY t.typname, e.enumsortorder`,
  );
  const enums = {};
  for (const r of enumRows) {
    (enums[r.typname] ||= []).push({ label: r.enumlabel, order: Number(r.enumsortorder) });
  }
  const enumTypeExists = await q(
    `SELECT typname FROM pg_type
      WHERE typname IN ('SupportTicketStatus', 'SupportMessageAuthorRole')`,
  );

  const rowCounts = {};
  for (const t of tableNames) {
    const rows = await q(`SELECT COUNT(*)::int AS n FROM "${t}"`);
    rowCounts[t] = rows[0].n;
  }

  let migrations = null;
  let migrationsError = null;
  try {
    migrations = await q(
      `SELECT id, checksum, migration_name, started_at, finished_at, rolled_back_at, applied_steps_count
         FROM "_prisma_migrations" ORDER BY started_at ASC`,
    );
  } catch (error) {
    migrationsError = error instanceof Error ? error.message : String(error);
  }

  return {
    tableNames,
    columns,
    indexes,
    fks,
    enums,
    enumTypesPresent: enumTypeExists.map((r) => r.typname),
    rowCounts,
    migrations,
    migrationsError,
  };
}

// ---------------------------------------------------------------------------
// compare the live schema with the objects the migration creates
// ---------------------------------------------------------------------------
function compare(state) {
  const missing = {
    enumTypes: [],
    enumValues: [],
    notificationValues: [],
    tables: [],
    columns: [],
    primaryKeys: [],
    indexes: [],
    foreignKeys: [],
  };
  const problems = []; // structural differences (block a history repair)
  const warnings = []; // non-blocking observations (still reported loudly)

  // --- enum types ---------------------------------------------------------
  for (const [name, expectedValues] of Object.entries(EXPECTED_ENUMS)) {
    const actual = state.enums[name];
    if (!actual) {
      missing.enumTypes.push(name);
      continue;
    }
    const labels = actual.map((v) => v.label);
    const absent = expectedValues.filter((v) => !labels.includes(v));
    if (absent.length) missing.enumValues.push(`${name} -> ${absent.join(', ')}`);
    const extra = labels.filter((v) => !expectedValues.includes(v));
    if (extra.length) {
      warnings.push(`enum ${name} has extra values not in the migration: ${extra.join(', ')}`);
    }
  }

  // --- NotificationType values -------------------------------------------
  const notificationLabels = (state.enums.NotificationType ?? []).map((v) => v.label);
  for (const value of EXPECTED_NOTIFICATION_VALUES) {
    if (!notificationLabels.includes(value)) missing.notificationValues.push(value);
  }

  // --- tables / columns / pk / indexes / fks ------------------------------
  const hasTable = (t) => state.tableNames.includes(t);

  for (const [table, spec] of Object.entries(EXPECTED_TABLES)) {
    if (!hasTable(table)) {
      missing.tables.push(table);
      continue;
    }

    for (const [column, udt, nullable, defaultKind] of spec.columns) {
      const actual = state.columns.find((c) => c.table_name === table && c.column_name === column);
      if (!actual) {
        missing.columns.push(`${table}.${column}`);
        continue;
      }
      if (actual.udt_name !== udt) {
        problems.push(`${table}.${column} type is ${actual.udt_name}, expected ${udt}`);
      }
      const actualNullable = actual.is_nullable === 'YES';
      if (actualNullable !== nullable) {
        problems.push(
          `${table}.${column} is ${actualNullable ? 'nullable' : 'NOT NULL'}, expected ${
            nullable ? 'nullable' : 'NOT NULL'
          }`,
        );
      }
      if (defaultClass(actual.column_default) !== defaultKind) {
        problems.push(
          `${table}.${column} default is ${defaultClass(actual.column_default)}, expected ${defaultKind}`,
        );
      }
    }

    const pk = state.indexes.find((i) => i.table_name === table && i.is_primary);
    if (!pk || pk.columns.join(',') !== spec.pk.join(',')) {
      missing.primaryKeys.push(`${table}_pkey (${spec.pk.join(', ')})`);
    }
  }

  for (const [name, spec] of Object.entries(EXPECTED_INDEXES)) {
    // A missing table reports its own indexes as missing too — the repair SQL
    // then emits the CREATE TABLE followed by these CREATE INDEX statements.
    const actual = state.indexes.find((i) => i.index_name === name) ?? null;
    if (!actual) {
      missing.indexes.push(name);
      continue;
    }
    if (actual.is_unique !== spec.unique) {
      problems.push(`index ${name} unique=${actual.is_unique}, expected ${spec.unique}`);
    }
    if (actual.columns.join(',') !== spec.columns.join(',')) {
      problems.push(`index ${name} on (${actual.columns.join(', ')}), expected (${spec.columns.join(', ')})`);
    }
  }

  for (const [name, spec] of Object.entries(EXPECTED_FKS)) {
    const actual = state.fks.find((f) => f.conname === name) ?? null;
    if (!actual) {
      missing.foreignKeys.push(name);
      continue;
    }
    if (actual.ref_table !== spec.refTable) {
      problems.push(`FK ${name} references ${actual.ref_table}, expected ${spec.refTable}`);
    }
    if (actual.confdeltype !== spec.onDelete) {
      problems.push(
        `FK ${name} ON DELETE ${DELETION_LABEL[actual.confdeltype] ?? actual.confdeltype}, expected ${
          DELETION_LABEL[spec.onDelete]
        }`,
      );
    }
  }

  const missingCount = Object.values(missing).reduce((n, list) => n + list.length, 0);
  return { schemaComplete: missingCount === 0 && problems.length === 0, missing, problems, warnings };
}

// ---------------------------------------------------------------------------
// CASE A / B / C / D classification (derived from the database, never guessed)
// ---------------------------------------------------------------------------
function classify(state, cmp) {
  const rows = state.migrations;
  const miRow = rows ? rows.find((m) => m.migration_name === MIGRATION) ?? null : null;

  const notificationLabels = (state.enums.NotificationType ?? []).map((v) => v.label);
  const notificationPresent = EXPECTED_NOTIFICATION_VALUES.filter((v) => notificationLabels.includes(v));
  const anyNewObject =
    state.tableNames.length > 0 || state.enumTypesPresent.length > 0 || notificationPresent.length > 0;

  if (miRow) {
    if (miRow.rolled_back_at) {
      return {
        code: 'HISTORY_ROLLED_BACK',
        title: 'History records the migration as ROLLED BACK — it is genuinely unapplied',
        remedy: ['Apply it with Prisma:', '  pnpm --filter @tanvion-royale/api prisma:migrate:deploy'],
      };
    }
    if (!miRow.finished_at || Number(miRow.applied_steps_count) === 0) {
      return {
        code: 'HISTORY_FAILED',
        title: 'A FAILED / incomplete migration attempt is recorded (P3009 territory)',
        remedy: [
          '1. Inspect exactly which statements ran (see the missing/different lists above).',
          '2. Record the failed attempt as rolled back, then re-apply:',
          `   pnpm --filter @tanvion-royale/api exec prisma migrate resolve --rolled-back ${MIGRATION} --schema database/prisma/schema.prisma`,
          '   pnpm --filter @tanvion-royale/api prisma:migrate:deploy',
          'If objects were PARTLY created before the failure, apply ONLY the missing',
          'statements first (--print-repair-sql), then re-run this script and use --repair.',
        ],
      };
    }
    if (!cmp.schemaComplete) {
      return {
        code: 'HISTORY_APPLIED_SCHEMA_INCONSISTENT',
        title: 'History says APPLIED but the schema does not match the migration DDL (CASE D)',
        remedy: [
          'Do NOT run migrate deploy — it would execute the DDL again and fail.',
          'Apply ONLY the objects listed as missing/different with a reviewed SQL file',
          '(`--print-repair-sql` prints the minimal delta), then re-run this script.',
          'Never edit an already-applied migration file: its checksum is recorded.',
        ],
      };
    }
    if (String(miRow.checksum ?? '').toLowerCase() !== fileChecksum) {
      return {
        code: 'HISTORY_CHECKSUM_MISMATCH',
        title: 'Schema matches, but the recorded checksum differs from migration.sql',
        remedy: [
          'The migration file changed after it was applied. Do not hand-edit history:',
          'add a NEW forward migration for the change instead.',
        ],
      };
    }
    return {
      code: 'IN_SYNC',
      title: 'Applied and in sync — schema, checksum and history all agree',
      remedy: ['Nothing to do: `prisma migrate deploy` has nothing pending for this migration.'],
    };
  }

  // No history row for this migration.
  if (cmp.schemaComplete) {
    return {
      code: 'B_HISTORY_MISSING_SCHEMA_MATCHES',
      title: 'CASE B — every object exists but _prisma_migrations has no row (history-only drift)',
      remedy: [
        'The DDL must NOT be executed again. Reconcile history only:',
        '  node scripts/check-migration-state.cjs --repair',
      ],
    };
  }
  if (!anyNewObject) {
    return {
      code: 'A_UNAPPLIED',
      title: 'CASE A — completely unapplied (no tables, no enum types, no notification values)',
      remedy: [
        'Apply the migration with Prisma (no manual SQL at all):',
        '  pnpm --filter @tanvion-royale/api prisma:migrate:deploy',
      ],
    };
  }
  if (state.tableNames.length === 0) {
    return {
      code: 'D_ENUMS_ONLY',
      title: 'CASE D — enum type(s)/notification value(s) exist, tables do not',
      remedy: [
        '1. Print the minimal delta SQL (tables/indexes/FKs only — never a second ALTER TYPE):',
        '   node scripts/check-migration-state.cjs --print-repair-sql > support-chat-repair.sql',
        '2. REVIEW it, then apply it once:',
        '   pnpm --filter @tanvion-royale/api exec prisma db execute --file support-chat-repair.sql --schema database/prisma/schema.prisma',
        '3. Re-run this script (it must now report CASE B), then reconcile history:',
        '   node scripts/check-migration-state.cjs --repair',
      ],
    };
  }
  return {
    code: 'C_PARTIAL',
    title: 'CASE C — partially applied (some objects exist, some do not)',
    remedy: [
      '1. Print the minimal delta SQL for exactly the missing objects:',
      '   node scripts/check-migration-state.cjs --print-repair-sql > support-chat-repair.sql',
      '2. REVIEW it, then apply it once (smallest safe repair):',
      '   pnpm --filter @tanvion-royale/api exec prisma db execute --file support-chat-repair.sql --schema database/prisma/schema.prisma',
      '3. Re-run this script until it reports CASE B, then reconcile history:',
      '   node scripts/check-migration-state.cjs --repair',
    ],
  };
}

// ---------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------
const MIGRATIONS_DIR = path.join(root, 'database', 'prisma', 'migrations');
const onDiskMigrations = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((d) => fs.existsSync(path.join(MIGRATIONS_DIR, d, 'migration.sql')))
  .sort();

function line(label, value) {
  console.log(`  ${label.padEnd(26)} ${value}`);
}

function printReport(state, cmp, verdict) {
  const rows = state.migrations ?? [];
  const applied = rows.filter((r) => r.finished_at && !r.rolled_back_at);
  const failed = rows.filter((r) => !r.finished_at);
  const rolledBack = rows.filter((r) => r.rolled_back_at);
  const miRow = rows.find((r) => r.migration_name === MIGRATION) ?? null;
  const historyNames = new Set(rows.map((r) => r.migration_name));
  const notInHistory = onDiskMigrations.filter((m) => !historyNames.has(m));
  const noFile = rows.filter((r) => !onDiskMigrations.includes(r.migration_name)).map((r) => r.migration_name);

  console.log('');
  console.log('=== 1. MIGRATION UNDER INSPECTION =========================================');
  line('migration', MIGRATION);
  line('file', path.relative(root, migrationSqlPath).replace(/\\/g, '/'));
  line('sha256 (file)', fileChecksum);
  line('operations', '2 ALTER TYPE ADD VALUE, 2 CREATE TYPE, 2 CREATE TABLE, 6 CREATE INDEX, 4 FOREIGN KEY');

  console.log('');
  console.log('=== 2. PRODUCTION OBJECTS CREATED BY IT ===================================');
  for (const table of Object.keys(EXPECTED_TABLES)) {
    const present = state.tableNames.includes(table);
    line(table, present ? `PRESENT (rows: ${state.rowCounts[table]})` : 'ABSENT');
  }
  const presentTables = Object.keys(EXPECTED_TABLES).filter((t) => state.tableNames.includes(t));
  if (presentTables.length) {
    for (const table of presentTables) {
      const cols = state.columns.filter((c) => c.table_name === table).map((c) => c.column_name);
      line(`${table} columns`, `${cols.length} [${cols.join(', ')}]`);
      const idx = state.indexes
        .filter((i) => i.table_name === table && !i.is_primary)
        .map((i) => `${i.index_name}${i.is_unique ? ' (unique)' : ''}`);
      line(`${table} indexes`, idx.length ? idx.join(', ') : '(none)');
      const fk = state.fks.filter((f) => f.table_name === table).map((f) => f.conname);
      line(`${table} fkeys`, fk.length ? fk.join(', ') : '(none)');
    }
  }

  console.log('');
  console.log('=== 3. ENUMS ==============================================================');
  for (const name of Object.keys(EXPECTED_ENUMS)) {
    const labels = (state.enums[name] ?? []).map((v) => v.label);
    line(name, labels.length ? `PRESENT [${labels.join(', ')}]` : 'MISSING');
  }
  const notificationLabels = (state.enums.NotificationType ?? []).map((v) => v.label);
  for (const value of EXPECTED_NOTIFICATION_VALUES) {
    line(`NotificationType.${value}`, notificationLabels.includes(value) ? 'PRESENT' : 'MISSING');
  }

  console.log('');
  console.log('=== 4. _prisma_migrations =================================================');
  if (state.migrationsError) {
    line('error', state.migrationsError);
  } else {
    line('rows total', `${rows.length} (applied: ${applied.length}, failed: ${failed.length}, rolled back: ${rolledBack.length})`);
    line('row for migration', miRow ? 'PRESENT' : 'NONE');
    if (miRow) {
      line('id', miRow.id);
      line('checksum (recorded)', miRow.checksum);
      line('checksum matches file', String(miRow.checksum).toLowerCase() === fileChecksum ? 'YES' : 'NO');
      line('finished_at', miRow.finished_at ? new Date(miRow.finished_at).toISOString() : 'NULL');
      line('rolled_back_at', miRow.rolled_back_at ? new Date(miRow.rolled_back_at).toISOString() : 'NULL');
      line('applied_steps_count', String(miRow.applied_steps_count));
    }
    line('on disk, not in history', notInHistory.length ? notInHistory.join(', ') : '(none)');
    line('in history, no file', noFile.length ? noFile.join(', ') : '(none)');
  }

  console.log('');
  console.log('=== 5. COMPARISON =========================================================');
  const m = cmp.missing;
  line('schema complete', cmp.schemaComplete ? 'YES — matches migration.sql' : 'NO');
  for (const [key, label] of [
    ['enumTypes', 'missing enum types'],
    ['enumValues', 'missing enum values'],
    ['notificationValues', 'missing notification values'],
    ['tables', 'missing tables'],
    ['columns', 'missing columns'],
    ['primaryKeys', 'missing primary keys'],
    ['indexes', 'missing indexes'],
    ['foreignKeys', 'missing foreign keys'],
  ]) {
    if (m[key].length) line(label, m[key].join('; '));
  }
  for (const p of cmp.problems) line('DIFFERENT', p);
  for (const w of cmp.warnings) line('note', w);
  if (cmp.schemaComplete) line('differences', '(none)');

  console.log('');
  console.log('=== 6. VERDICT ============================================================');
  console.log(`  ${verdict.code}`);
  console.log(`  ${verdict.title}`);

  console.log('');
  console.log('=== 7. NEXT ACTION ========================================================');
  for (const r of verdict.remedy) console.log(`  ${r}`);
  console.log('');
  console.log(
    '  Nothing was modified by this script (read-only). NEVER run `prisma migrate reset`,',
  );
  console.log(
    '  never DELETE/DROP production data, and never hand-INSERT history rows: `--repair`',
  );
  console.log('  only reconciles history after proving the schema already matches.');
  console.log('');
  console.log('  exit codes: 0 = applied and in sync | 2 = drift/repair needed (printed above)');
  console.log('              1 = could not inspect (connection/env/schema error)');
  console.log('');
}

// ---------------------------------------------------------------------------
// minimal repair SQL for CASE C / D — printed only, never executed here
// ---------------------------------------------------------------------------
/** exact column DDL from migration.sql, keyed by table.column */
const COLUMN_SQL = {
  'SupportTicket.id': 'TEXT NOT NULL',
  'SupportTicket.userId': 'TEXT NOT NULL',
  'SupportTicket.status': '"SupportTicketStatus" NOT NULL DEFAULT \'OPEN\'',
  'SupportTicket.assignedAdminId': 'TEXT',
  'SupportTicket.adminUnreadCount': 'INTEGER NOT NULL DEFAULT 0',
  'SupportTicket.userUnreadCount': 'INTEGER NOT NULL DEFAULT 0',
  'SupportTicket.lastMessageAt': 'TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
  'SupportTicket.createdAt': 'TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
  'SupportTicket.updatedAt': 'TIMESTAMP(3) NOT NULL',
  'SupportMessage.id': 'TEXT NOT NULL',
  'SupportMessage.ticketId': 'TEXT NOT NULL',
  'SupportMessage.authorUserId': 'TEXT NOT NULL',
  'SupportMessage.authorRole': '"SupportMessageAuthorRole" NOT NULL',
  'SupportMessage.body': 'TEXT NOT NULL',
  'SupportMessage.clientRef': 'TEXT',
  'SupportMessage.createdAt': 'TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
};

/** exact foreign keys from migration.sql, keyed by constraint name */
const FK_SQL = {
  SupportTicket_userId_fkey:
    'ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
  SupportTicket_assignedAdminId_fkey:
    'ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;',
  SupportMessage_ticketId_fkey:
    'ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
  SupportMessage_authorUserId_fkey:
    'ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;',
};

/**
 * The SMALLEST safe delta: only objects that are genuinely absent, each one
 * guarded so a re-run can never double-create anything. Existing objects and
 * existing rows are never touched — no DROP, no DELETE, no TRUNCATE.
 */
function buildRepairSql(state, cmp) {
  const out = [];
  for (const name of cmp.missing.enumTypes) out.push(CREATE_ENUM_SQL[name]);
  for (const value of cmp.missing.notificationValues) {
    out.push(`ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS '${value}';`);
  }
  for (const table of cmp.missing.tables) out.push(CREATE_TABLE_SQL[table]);

  for (const key of cmp.missing.columns) {
    const [table, column] = key.split('.');
    const ddl = COLUMN_SQL[key];
    const rowCount = state.rowCounts[table] ?? 0;
    if (rowCount > 0 && /NOT NULL$/.test(ddl)) {
      out.push(`-- WARNING: "${table}" already holds ${rowCount} row(s) and "${column}" has no DEFAULT.`);
      out.push('-- Backfill the column for the existing rows FIRST, then run:');
      out.push(`--   ALTER TABLE "${table}" ALTER COLUMN "${column}" SET NOT NULL;`);
      out.push(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" ${ddl.replace(/\s+NOT NULL$/, '')};`);
    } else {
      out.push(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" ${ddl};`);
    }
  }

  for (const key of cmp.missing.primaryKeys) {
    const table = key.split(' ')[0].replace(/_pkey$/, '');
    const cols = EXPECTED_TABLES[table].pk.map((c) => `"${c}"`).join(', ');
    out.push(
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${table}_pkey') ` +
        `THEN ALTER TABLE "${table}" ADD CONSTRAINT "${table}_pkey" PRIMARY KEY (${cols}); END IF; END $$;`,
    );
  }

  for (const name of cmp.missing.indexes) {
    out.push(
      CREATE_INDEX_SQL[name]
        .replace('CREATE INDEX "', 'CREATE INDEX IF NOT EXISTS "')
        .replace('CREATE UNIQUE INDEX "', 'CREATE UNIQUE INDEX IF NOT EXISTS "'),
    );
  }

  for (const name of cmp.missing.foreignKeys) {
    out.push(
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}') ` +
        `THEN ${FK_SQL[name]} END IF; END $$;`,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// guarded history reconciliation (CASE B only — never a blind "mark applied")
// ---------------------------------------------------------------------------
async function runHistoryRepair(verdict, cmp) {
  if (verdict.code !== 'B_HISTORY_MISSING_SCHEMA_MATCHES' || !cmp.schemaComplete) {
    console.error('');
    console.error(`[check-migration-state] REFUSING to touch _prisma_migrations: verdict is ${verdict.code}.`);
    console.error('  History is only reconciled when the live schema has been PROVEN to contain');
    console.error('  every object the migration creates. Follow the NEXT ACTION steps above.');
    return 1;
  }

  console.log('');
  console.log('[check-migration-state] Schema proven identical to migration.sql — recording the');
  console.log('migration as applied through Prisma itself (history only: NO DDL, no data change).');
  console.log('');
  execSync(`npx prisma migrate resolve --applied ${MIGRATION} --schema "${schemaPath}"`, {
    stdio: 'inherit',
    env: process.env,
  });

  const rows = await q(
    `SELECT id, checksum, finished_at, applied_steps_count
       FROM "_prisma_migrations" WHERE migration_name = $1`,
    MIGRATION,
  );
  const row = rows[0];
  if (!row || !row.finished_at) {
    console.error('\n[check-migration-state] ERROR: the history row was not recorded as applied.');
    return 1;
  }

  console.log('');
  console.log('[check-migration-state] history row written:');
  line('id', row.id);
  line('checksum (recorded)', row.checksum);
  line('checksum matches file', String(row.checksum).toLowerCase() === fileChecksum ? 'YES' : 'NO');
  line('finished_at', new Date(row.finished_at).toISOString());
  line('applied_steps_count', String(row.applied_steps_count));

  if (String(row.checksum).toLowerCase() !== fileChecksum) {
    console.error(
      '\n[check-migration-state] ERROR: the recorded checksum differs from migration.sql — stop and review.',
    );
    return 1;
  }

  console.log('');
  console.log('[check-migration-state] OK — migration history now genuinely matches the code and the schema.');
  console.log('Re-run `prisma migrate status` (or scripts/verify-migrations.cjs) to confirm before deploying.');
  return 0;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const REPAIR_SQL_CASES = ['C_PARTIAL', 'D_ENUMS_ONLY', 'HISTORY_APPLIED_SCHEMA_INCONSISTENT'];

async function main() {
  if (!fs.existsSync(migrationSqlPath)) {
    console.error(`[check-migration-state] ERROR: migration file not found: ${migrationSqlPath}`);
    return 1;
  }

  console.log(`[check-migration-state] read-only inspection against ${hostOnly(dbUrl)} ...`);
  const state = await probe();
  const cmp = compare(state);
  const verdict = classify(state, cmp);

  if (wantJson) {
    const payload = {
      migration: MIGRATION,
      fileChecksum,
      verdict: { code: verdict.code, title: verdict.title },
      schemaComplete: cmp.schemaComplete,
      missing: cmp.missing,
      problems: cmp.problems,
      warnings: cmp.warnings,
      tables: {
        present: state.tableNames,
        rowCounts: state.rowCounts,
        columns: state.columns,
        indexes: state.indexes,
        foreignKeys: state.fks,
      },
      enums: state.enums,
      migrations: state.migrations,
      migrationsError: state.migrationsError,
    };
    if (wantRepairSql) payload.repairSql = buildRepairSql(state, cmp);
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printReport(state, cmp, verdict);
  }

  if (wantRepairSql && !wantJson) {
    if (!REPAIR_SQL_CASES.includes(verdict.code)) {
      console.error(`[check-migration-state] --print-repair-sql is not applicable for ${verdict.code}:`);
      console.error(
        verdict.code === 'A_UNAPPLIED'
          ? '  CASE A needs no hand-written SQL — run `pnpm --filter @tanvion-royale/api prisma:migrate:deploy`.'
          : '  Nothing is missing here / history must be reconciled instead (see NEXT ACTION).',
      );
    } else {
      const sql = buildRepairSql(state, cmp);
      console.log('-- Support Chat migration repair — minimal delta generated by');
      console.log(`-- scripts/check-migration-state.cjs against ${hostOnly(dbUrl)}`);
      console.log('-- Objects that already exist are NOT re-created. Review, then apply:');
      console.log('--   pnpm --filter @tanvion-royale/api exec prisma db execute --file support-chat-repair.sql --schema database/prisma/schema.prisma');
      console.log('-- This file does NOT record migration history. Afterwards:');
      console.log('--   node scripts/check-migration-state.cjs --repair');
      console.log('');
      console.log(sql.length ? sql.join('\n\n') : '-- (nothing missing)');
      console.log('');
    }
  }

  if (wantRepair) return runHistoryRepair(verdict, cmp);
  return verdict.code === 'IN_SYNC' ? 0 : 2;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`\n[check-migration-state] ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
    console.error('Could not complete the inspection — nothing was modified.');
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {
      /* nothing to do */
    }
  });
#!/usr/bin/env node
/**
 * diagnose-referral-migration.cjs
 *
 * READ-ONLY diagnosis of the 2026-09-26 Prisma P3009 incident involving
 * migration `20260926000000_add_user_referral_program`.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Neon production database records that migration as FAILED. P3009 is only
 * the symptom: it means "_prisma_migrations contains a row that never
 * finished". The ORIGINAL error is in that row's `logs` column, and the row
 * also tells us whether ANY of the DDL actually ran. Those two facts decide
 * the repair, and guessing between them is how people reach for
 * `migrate reset`.
 *
 * This script answers them from the database itself. It is deliberately
 * read-only: it issues SELECTs only, writes nothing, runs no DDL/DML, and
 * never runs `migrate resolve`, `migrate reset` or `migrate deploy`. It prints
 * the exact command to run next and stops.
 *
 * USAGE
 * -----
 *   node scripts/diagnose-referral-migration.cjs
 *   node scripts/diagnose-referral-migration.cjs --json
 *
 * NOTE: scripts/check-migration-state.cjs targets a DIFFERENT migration
 * (20260914010000_add_support_chat). Do NOT use it for referral recovery —
 * this script is the referral-specific migration-state diagnostic.
 *
 * The default mode is READ-ONLY. There is deliberately no --repair/--apply
 * flag: recovery is always a deliberate manual step printed under NEXT STEPS.
 *
 * Run it from a machine that has production access (Render shell, or a laptop
 * with DATABASE_URL/DIRECT_URL exported). A local `.env` is loaded if present.
 *
 * SAFETY GUARANTEES
 * -----------------
 *   * SELECT-only. No INSERT/UPDATE/DELETE/DDL is ever issued.
 *   * Never prints DATABASE_URL / DIRECT_URL - only the host, for identification.
 *   * Never hides the original error: the `logs` column is printed in full.
 *   * Exits 0 on success so it can be piped; the verdict is in the output.
 *
 * Env: DATABASE_URL (pooled, used for reads) or DIRECT_URL (unpooled).
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const MIGRATION = '20260926000000_add_user_referral_program';
const migrationSqlPath = path.join(root, 'database', 'prisma', 'migrations', MIGRATION, 'migration.sql');

const wantJson = process.argv.includes('--json');

// ---------------------------------------------------------------- env loading
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
    // Hostname ONLY — never credentials, never path, never query.
    return u.hostname;
  } catch {
    return '(unparseable URL)';
  }
}

const directUrl = process.env.DIRECT_URL;
const dbUrl = process.env.DATABASE_URL || directUrl;
if (!dbUrl) {
  console.error(
    '\n[diagnose-referral] ERROR: neither DATABASE_URL nor DIRECT_URL is set.\n' +
      'This script needs a connection to the PRODUCTION database. Run it from a\n' +
      'shell that has the production URL exported (e.g. the Render shell).\n',
  );
  process.exit(1);
}
if (!process.env.DATABASE_URL && directUrl) process.env.DATABASE_URL = directUrl;

// The Prisma Client reads DATABASE_URL from env.
const { PrismaClient } = require(path.join(root, 'apps', 'api', 'src', 'generated', 'prisma'));
const prisma = new PrismaClient();
const q = (sql) => prisma.$queryRawUnsafe(sql);

// ---------------------------------------------------------- expected artefacts
// DERIVED FROM migration.sql AT RUNTIME — never an incomplete hard-coded list —
// and cross-checked against schema.prisma. If the parser or the files drift,
// DERIVATION_WARNINGS is non-empty and every verdict fails closed (CASE D).
const schemaPath = path.join(root, 'database', 'prisma', 'schema.prisma');

/** Split a migration script into statements. Aware of -- comments, '...' */
function splitSqlStatements(sql) {
  const out = [];
  let cur = '';
  let i = 0;
  let dollar = null;
  let inSingle = false;
  while (i < sql.length) {
    const ch = sql[i];
    if (dollar) {
      if (sql.startsWith(dollar, i)) {
        cur += dollar;
        i += dollar.length;
        dollar = null;
      } else {
        cur += ch;
        i += 1;
      }
      continue;
    }
    if (inSingle) {
      cur += ch;
      if (ch === "'" && sql[i + 1] === "'") {
        cur += "'";
        i += 2;
        continue;
      }
      if (ch === "'") inSingle = false;
      i += 1;
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      const end = nl === -1 ? sql.length : nl + 1;
      cur += sql.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      cur += ch;
      i += 1;
      continue;
    }
    const dm = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (dm) {
      dollar = dm[0];
      cur += dm[0];
      i += dm[0].length;
      continue;
    }
    if (ch === ';') {
      out.push(cur);
      cur = '';
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
/** Derive every expected object (tables/columns/enums/values/indexes/FKs/PKs). */
/** Strip the comment block that precedes a statement (headers, section marks). */
function stripLeadingComments(text) {
  let out = text.trimStart();
  while (out.startsWith('--')) {
    const nl = out.indexOf('\n');
    if (nl === -1) return '';
    out = out.slice(nl + 1).replace(/^\s*/, '');
  }
  return out.trim();
}

function deriveExpected(sql) {
  const e = {
    tables: [],
    columns: {},
    enums: {},
    addedValues: [],
    indexes: [],
    uniqueIndexes: [],
    fks: [],
    pks: [],
    statements: [],
    warnings: [],
  };
  for (const raw of splitSqlStatements(sql)) {
    const text = stripLeadingComments(raw);
    if (!text) continue;
    const keys = [];
    let m;
    if ((m = /^CREATE TYPE "([^"]+)" AS ENUM\s*\(([\s\S]*?)\)/i.exec(text))) {
      const values = (m[2].match(/'([^']+)'/g) || []).map((v) => v.slice(1, -1));
      e.enums[m[1]] = values;
      keys.push({ kind: 'enum', name: m[1] });
    } else if ((m = /^ALTER TYPE "([^"]+)" ADD VALUE (?:IF NOT EXISTS )?'([^']+)'/i.exec(text))) {
      e.addedValues.push({ type: m[1], value: m[2] });
      keys.push({ kind: 'enumValue', name: `${m[1]}.${m[2]}` });
    } else if ((m = /^CREATE TABLE "([^"]+)"\s*\(([\s\S]*)\)\s*$/i.exec(text))) {
      const table = m[1];
      if (!e.tables.includes(table)) e.tables.push(table);
      const cols = [];
      for (const line of m[2].split('\n')) {
        const s = line.trim();
        if (!s || /^CONSTRAINT/i.test(s)) continue;
        const c = /^"([^"]+)"/.exec(s);
        if (c) cols.push(c[1]);
      }
      e.columns[table] = cols;
      keys.push({ kind: 'table', name: table });
      const pk = /CONSTRAINT "([^"]+)" PRIMARY KEY/i.exec(m[2]);
      if (pk) {
        e.pks.push(pk[1]);
        keys.push({ kind: 'pk', name: pk[1] });
      }
    } else if ((m = /^ALTER TABLE "([^"]+)" ADD COLUMN (?:IF NOT EXISTS )?"([^"]+)"/i.exec(text))) {
      (e.columns[m[1]] = e.columns[m[1]] || []).push(m[2]);
      keys.push({ kind: 'column', name: `${m[1]}.${m[2]}` });
    } else if ((m = /^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF NOT EXISTS\s+)?"([^"]+)"\s+ON\s+"([^"]+)"/i.exec(text))) {
      e.indexes.push(m[2]);
      if (m[1]) e.uniqueIndexes.push(m[2]);
      keys.push({ kind: 'index', name: m[2] });
    } else if ((m = /^ALTER TABLE "([^"]+)"\s+ADD CONSTRAINT "([^"]+)"\s+FOREIGN KEY/i.exec(text))) {
      e.fks.push(m[2]);
      keys.push({ kind: 'fk', name: m[2] });
    } else if (/^INSERT INTO "/i.test(text)) {
      keys.push({ kind: 'data', name: 'settings-row' });
    } else if (/^DO\s+\$/i.test(text)) {
      keys.push({ kind: 'data', name: 'user-backfill' });
    }
    e.statements.push({ text, keys });
  }
  if (e.tables.length === 0) e.warnings.push('derived ZERO tables from migration.sql — parser or file broken');
  if (Object.keys(e.enums).length === 0) e.warnings.push('derived ZERO enums from migration.sql — parser or file broken');
  if (e.indexes.length === 0) e.warnings.push('derived ZERO indexes from migration.sql — parser or file broken');
  if (e.fks.length === 0) e.warnings.push('derived ZERO foreign keys from migration.sql — parser or file broken');
  if (Object.keys(e.columns).length === 0) e.warnings.push('derived ZERO columns from migration.sql — parser or file broken');
  return e;
}


/** Every object the migration creates must also exist in schema.prisma. */
function crossCheckSchema(expected, schemaText) {
  const warnings = [];
  const enumNames = new Set();
  for (const m of schemaText.matchAll(/^\s*enum\s+(\w+)\s*\{/gm)) enumNames.add(m[1]);
  const models = new Map();
  for (const m of schemaText.matchAll(/^\s*model\s+(\w+)\s*\{([\s\S]*?)\n\}/gm)) models.set(m[1], m[2]);
  for (const name of Object.keys(expected.enums)) {
    if (!enumNames.has(name)) warnings.push(`enum ${name} exists in migration.sql but NOT in schema.prisma`);
  }
  for (const t of expected.tables) {
    if (!models.has(t)) warnings.push(`table ${t} exists in migration.sql but NOT in schema.prisma`);
  }
  const userFields = models.get('User') || '';
  if (!/^\s*referralCode\s/m.test(userFields)) {
    warnings.push('schema.prisma User model has no referralCode field (migration adds it)');
  }
  for (const [table, cols] of Object.entries(expected.columns)) {
    const body = models.get(table);
    if (body == null) continue;
    for (const col of cols) {
      if (!new RegExp(`^\\s*${col}\\s+`, 'm').test(body)) {
        warnings.push(`${table}.${col} exists in migration.sql but NOT in the ${table} model`);
      }
    }
  }
  return warnings;
}

const schemaPrismaPath = path.join(root, 'database', 'prisma', 'schema.prisma');
const MIGRATION_SQL_TEXT = fs.readFileSync(migrationSqlPath, 'utf8');
const EXPECTED = deriveExpected(MIGRATION_SQL_TEXT);
let SCHEMA_TEXT = '';
try {
  SCHEMA_TEXT = fs.readFileSync(schemaPrismaPath, 'utf8');
} catch (readErr) {
  EXPECTED.warnings.push(`could not read schema.prisma: ${readErr.message}`);
}
const DERIVATION_WARNINGS = [...EXPECTED.warnings, ...crossCheckSchema(EXPECTED, SCHEMA_TEXT)];

const EXPECTED_TABLES = EXPECTED.tables;
const EXPECTED_ENUMS = EXPECTED.enums;
const EXPECTED_ADDED_VALUES = EXPECTED.addedValues;
const EXPECTED_INDEXES = EXPECTED.indexes;
const EXPECTED_FKS = EXPECTED.fks;
const EXPECTED_PKS = EXPECTED.pks;
const EXPECTED_COLUMNS = EXPECTED.columns;
const EXPECTED_STATEMENTS = EXPECTED.statements;


function fileFacts() {
  const bytes = fs.readFileSync(migrationSqlPath);
  return {
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    hasBom: bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
    firstBytes: bytes.subarray(0, 6).toString('hex').toUpperCase(),
  };
}

// ------------------------------------------------------------------- probing
async function probe() {
  const migrationRows = await q(
    `SELECT migration_name, started_at, finished_at, rolled_back_at,
            applied_steps_count, logs, checksum
       FROM "_prisma_migrations"
      WHERE migration_name = '${MIGRATION}'
      ORDER BY started_at`,
  );

  const history = await q(
    `SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count
       FROM "_prisma_migrations"
      ORDER BY started_at`,
  );

  const tableInList = EXPECTED_TABLES.map((t) => `'${t}'`).join(',');
  const tables = await q(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (${tableInList})
      ORDER BY table_name`,
  );

  // Every column of every table this migration creates (derived from the
  // CREATE TABLE / ALTER TABLE ADD COLUMN statements, not hard-coded).
  const columns = await q(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN (${tableInList})
      ORDER BY table_name, ordinal_position`,
  );

  const enumTypeNames = [
    ...Object.keys(EXPECTED_ENUMS),
    ...new Set(EXPECTED_ADDED_VALUES.map((v) => v.type)),
  ];
  const enumTypes = await q(
    `SELECT t.typname, e.enumlabel
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname IN (${enumTypeNames.map((n) => `'${n}'`).join(',')})
      ORDER BY t.typname, e.enumsortorder`,
  );

  const indexes = await q(
    `SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND indexname IN (${EXPECTED_INDEXES.map((i) => `'${i}'`).join(',')})
      ORDER BY indexname`,
  );

  const fks = await q(
    `SELECT conname FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace AND contype = 'f'
        AND conname IN (${EXPECTED_FKS.map((f) => `'${f}'`).join(',')})
      ORDER BY conname`,
  );

  // Primary keys of the tables this migration creates (derived from the
  // CONSTRAINT ... PRIMARY KEY clauses inside their CREATE TABLE statements).
  const pks = EXPECTED_PKS.length
    ? await q(
        `SELECT conname FROM pg_constraint
          WHERE connamespace = 'public'::regnamespace AND contype = 'p'
            AND conname IN (${EXPECTED_PKS.map((p) => `'${p}'`).join(',')})
          ORDER BY conname`,
      )
    : [];

  // The User.referralCode column + its data, read-only.
  const hasColumn = await q(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'referralCode'`,
  );

  // Both the column and the referral tables are CREATED BY THIS MIGRATION, so in
  // the state this script exists to diagnose - failed BEFORE statement 0 - they
  // do not exist and PostgreSQL raises 42703/42P01. Querying them unconditionally
  // used to abort the whole run with a bare "column does not exist" error and
  // DESTROY the evidence (logs, history, catalog) that must be read first, which
  // is precisely backwards: the missing objects are the proof, not the failure.
  const presentTables = new Set(tables.map((t) => t.table_name));
  const columnExists = hasColumn.length > 0;

  let userStats = { total: 0, with_code: 0, without_code: 0, columnExists: false };
  let dupes = [];
  if (columnExists) {
    userStats = {
      ...(await q(
        `SELECT count(*)::int AS total,
                count("referralCode")::int AS with_code,
                count(*) FILTER (WHERE "referralCode" IS NULL)::int AS without_code
           FROM "User"`,
      ))[0],
      columnExists: true,
    };
    dupes = await q(
      `SELECT "referralCode", count(*)::int AS n
         FROM "User"
        WHERE "referralCode" IS NOT NULL
        GROUP BY "referralCode" HAVING count(*) > 1
        ORDER BY n DESC LIMIT 20`,
    );
  }

  let settingsRow = [];
  if (presentTables.has('ReferralProgramSettings')) {
    settingsRow = await q(
      `SELECT id, "isEnabled" FROM "ReferralProgramSettings" WHERE id = 1`,
    );
  }

  return {
    migrationRows,
    history,
    tables,
    columns,
    pks,
    enumTypes,
    indexes,
    fks,
    hasColumn: columnExists,
    settingsTableExists: presentTables.has('ReferralProgramSettings'),
    userStats,
    dupes,
    settingsRow,
  };
}

// -------------------------------------------------------------------- verdict
/**
 * Compare the live catalog against the objects derived from migration.sql.
 *
 * anyPresent counts ONLY objects THIS migration creates. It must never count
 * pre-existing enum types (WalletTransactionType / NotificationType always
 * exist) — doing so misclassified the real incident (failed before statement 0)
 * as FAILED_PARTIAL and would have blocked the safe --rolled-back recovery.
 */
function computePresence(state) {
  const present = {
    tables: (state.tables ?? []).map((t) => t.table_name),
    enumTypes: new Set((state.enumTypes ?? []).map((e) => e.typname)),
    enumValues: new Set((state.enumTypes ?? []).map((e) => `${e.typname}.${e.enumlabel}`)),
    indexes: (state.indexes ?? []).map((i) => i.indexname),
    fks: (state.fks ?? []).map((f) => f.conname),
    pks: (state.pks ?? []).map((p) => p.conname),
    columns: new Set((state.columns ?? []).map((c) => `${c.table_name}.${c.column_name}`)),
  };
  if (state.hasColumn) present.columns.add('User.referralCode');

  const missing = { tables: [], columns: [], enums: [], enumValues: [], indexes: [], pks: [], fks: [] };
  for (const t of EXPECTED_TABLES) {
    if (!present.tables.includes(t)) missing.tables.push(t);
  }
  for (const [name, values] of Object.entries(EXPECTED_ENUMS)) {
    if (!present.enumTypes.has(name)) missing.enums.push(name);
    for (const v of values) {
      if (!present.enumValues.has(`${name}.${v}`)) missing.enumValues.push(`${name}.${v}`);
    }
  }
  for (const { type, value } of EXPECTED_ADDED_VALUES) {
    if (!present.enumValues.has(`${type}.${value}`)) missing.enumValues.push(`${type}.${value}`);
  }
  for (const t of EXPECTED_TABLES) {
    if (!present.tables.includes(t)) continue; // its columns are reported with the table
    for (const col of EXPECTED_COLUMNS[t] ?? []) {
      if (!present.columns.has(`${t}.${col}`)) missing.columns.push(`${t}.${col}`);
    }
  }
  if (!state.hasColumn) missing.columns.push('User.referralCode');
  for (const i of EXPECTED_INDEXES) {
    if (!present.indexes.includes(i)) missing.indexes.push(i);
  }
  for (const p of EXPECTED_PKS) {
    if (!present.pks.includes(p)) missing.pks.push(p);
  }
  for (const f of EXPECTED_FKS) {
    if (!present.fks.includes(f)) missing.fks.push(f);
  }

  const anyPresent =
    state.hasColumn ||
    present.tables.length > 0 ||
    present.indexes.length > 0 ||
    present.fks.length > 0 ||
    present.pks.length > 0 ||
    Object.keys(EXPECTED_ENUMS).some((n) => present.enumTypes.has(n)) ||
    EXPECTED_ADDED_VALUES.some(({ type, value }) => present.enumValues.has(`${type}.${value}`));

  const missingCount = Object.values(missing).reduce((n, arr) => n + arr.length, 0);
  return { present, missing, allPresent: missingCount === 0, anyPresent, missingCount };
}

/** Data-side prerequisites for ever using `migrate resolve --applied`. */
function dataIntegrityIssues(state) {
  const issues = [];
  if (!state.hasColumn) {
    issues.push('User.referralCode column does not exist');
  } else {
    if (state.userStats.without_code > 0) {
      issues.push(`${state.userStats.without_code} user(s) have no referralCode — backfill incomplete`);
    }
    if (state.dupes.length > 0) {
      issues.push(`${state.dupes.length} duplicate referralCode group(s) — unique index would be violated`);
    }
  }
  if (!state.settingsTableExists) issues.push('ReferralProgramSettings table missing');
  else if (!state.settingsRow.length) issues.push('ReferralProgramSettings row id=1 missing');
  return issues;
}

/** Minimal, ADDITIVE-only repair plan for missing objects. PRINTED, never run. */
function buildRepairPlan(missing) {
  const needed = (kind, name) => {
    switch (kind) {
      case 'enum':
        return missing.enums.includes(name);
      case 'enumValue':
        return missing.enumValues.includes(name);
      case 'table':
        return missing.tables.includes(name);
      case 'column':
        return missing.columns.includes(name);
      case 'index':
        return missing.indexes.includes(name);
      case 'pk':
        return missing.pks.includes(name);
      case 'fk':
        return missing.fks.includes(name);
      default:
        return false;
    }
  };
  // File order is preserved, so CREATE TABLE always precedes its indexes/FKs.
  return EXPECTED_STATEMENTS.filter(
    (stmt) => stmt.keys.length > 0 && stmt.keys.some((k) => needed(k.kind, k.name)),
  ).map((stmt) => stmt.text.trim());
}

/** Human notes for the DATA steps the plan deliberately does not emit as SQL. */
function buildDataNotes(missing, dataIssues) {
  const notes = [];
  if (missing.columns.includes('User.referralCode')) {
    notes.push('After adding User.referralCode: run the backfill in migration.sql section 7');
    notes.push('BEFORE creating User_referralCode_key, or the unique index will fail.');
  } else if (dataIssues.some((i) => i.includes('backfill incomplete'))) {
    notes.push('Backfill (migration.sql section 7) is incomplete — re-run it before');
    notes.push('creating User_referralCode_key (section 8).');
  }
  if (
    missing.tables.includes('ReferralProgramSettings') ||
    dataIssues.includes('ReferralProgramSettings row id=1 missing')
  ) {
    notes.push('Insert the settings singleton (migration.sql section 6): the statement is');
    notes.push('INSERT ... ON CONFLICT (id) DO NOTHING — additive, never overwrites.');
  }
  notes.push('Review every statement in database/prisma/migrations/20260926000000_add_user_referral_program/migration.sql');
  notes.push('before applying anything. This tool PRINTS the plan; it never executes it.');
  return notes;
}

function buildVerdict(state, facts) {
  const row = state.migrationRows.find((r) => r.migration_name === MIGRATION) ?? null;
  const { missing, allPresent, anyPresent, missingCount } = computePresence(state);
  const dataIssues = dataIntegrityIssues(state);

  const missingSummary = [
    missing.tables.length ? `tables(${missing.tables.length})` : '',
    missing.columns.length ? `columns(${missing.columns.length})` : '',
    missing.enums.length ? `enums(${missing.enums.length})` : '',
    missing.enumValues.length ? `enumValues(${missing.enumValues.length})` : '',
    missing.indexes.length ? `indexes(${missing.indexes.length})` : '',
    missing.pks.length ? `pks(${missing.pks.length})` : '',
    missing.fks.length ? `fks(${missing.fks.length})` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const objectsPresent = allPresent ? 'ALL' : anyPresent ? 'SOME' : 'NONE';

  // CASE D gate: if we cannot PROVE what this migration should create, no
  // verdict is trustworthy. Fail closed before anything else.
  if (DERIVATION_WARNINGS.length > 0) {
    return {
      state: 'UNVERIFIED_EXPECTATIONS',
      severity: 'critical',
      summary:
        'The expected-object list could not be derived/verified from migration.sql + schema.prisma. ' +
        'Refusing to classify the database state.',
      objectsPresent: 'UNKNOWN',
      missing,
      dataIssues,
      remedy: [
        'DERIVATION WARNINGS (fix these first):',
        ...DERIVATION_WARNINGS.map((w) => `  - ${w}`),
        '',
        'Do NOT run resolve/deploy/reset based on this run. Re-run after the files',
        'parse cleanly. The database was NOT modified (this tool is read-only).',
      ],
    };
  }

  if (!row) {
    if (!anyPresent) {
      return {
        state: 'NO_ROW',
        severity: 'info',
        summary: `_prisma_migrations has NO row for ${MIGRATION} and NO object from it exists.`,
        objectsPresent,
        missing,
        dataIssues,
        remedy: [
          'Nothing to resolve. Let Prisma apply it:',
          '  pnpm --filter @tanvion-royale/api prisma:migrate:deploy:strict',
        ],
      };
    }
    // CASE D: history says "never attempted" but objects exist — drift.
    return {
      state: 'NO_ROW_BUT_OBJECTS_EXIST',
      severity: 'critical',
      summary:
        'DRIFT: no history row exists, yet objects this migration creates DO exist. ' +
        'The database was modified outside of `prisma migrate deploy`.',
      objectsPresent,
      missing,
      dataIssues,
      repairPlan: allPresent ? [] : buildRepairPlan(missing),
      remedy: [
        `Missing vs expected: ${missingSummary || '(none)'}`,
        'FAIL CLOSED. Do NOT run deploy (CREATE TYPE/CREATE TABLE would collide),',
        'do NOT run resolve, do NOT reset.',
        'Manual review required: compare the per-object report above against',
        'migration.sql, then decide with an operator whether history can be',
        'reconciled via `prisma migrate resolve --applied` (only when EVERY object',
        'and ALL data checks above are proven complete) or whether the objects',
        'must be reconciled by hand first.',
      ],
    };
  }

  if (!row.finished_at && !row.rolled_back_at) {
    // The migration row says FAILED.
    if (!anyPresent) {
      return {
        state: 'FAILED_NOTHING_APPLIED',
        severity: 'critical',
        summary:
          'The migration is recorded as FAILED and NO schema object from it exists. ' +
          'This is consistent with a parse error before statement 0 (the UTF-8 BOM), ' +
          'which PostgreSQL rejects before running anything.',
        objectsPresent: 'NONE',
        missing,
        dataIssues,
        remedy: [
          '1. Read the ORIGINAL error printed above (the `logs` column). Do not skip this.',
          '2. Confirm the migration file on disk is BOM-free ("starts with BOM" must be no):',
          '     node scripts/diagnose-referral-migration.cjs --json',
          '3. Mark it rolled back. This applies NO DDL and touches NO data:',
          `     pnpm --filter @tanvion-royale/api exec prisma migrate resolve --rolled-back ${MIGRATION} --schema database/prisma/schema.prisma`,
          '4. Deploy the corrected migration:',
          '     pnpm --filter @tanvion-royale/api prisma:migrate:deploy:strict',
          '',
          'NEVER run `migrate reset`. NEVER use `--applied` here: it would mark the',
          'migration as done while its tables and the backfill do not exist.',
        ],
      };
    }
    if (allPresent && dataIssues.length === 0) {
      // CASE C: every object AND every data check passes — only now mention --applied.
      return {
        state: 'FAILED_BUT_COMPLETE',
        severity: 'warning',
        summary:
          'The migration is recorded as FAILED but EVERY expected object AND every data ' +
          'check passes. `--applied` is safe once you have eyeballed the report.',
        objectsPresent: 'ALL',
        missing,
        dataIssues,
        remedy: [
          'Verification performed automatically (all must pass to reach this verdict):',
          '  [x] every enum type and enum value exists (incl. ADD VALUE entries)',
          '  [x] every table, column, primary key, index/unique constraint, foreign key exists',
          '  [x] User.referralCode backfill complete, zero duplicate codes',
          '  [x] ReferralProgramSettings singleton row id=1 present',
          '  [x] no DROP/TRUNCATE/DELETE required - this migration is additive only',
          '',
          'Reconcile HISTORY only (no DDL, no data change):',
          `     pnpm --filter @tanvion-royale/api exec prisma migrate resolve --applied ${MIGRATION} --schema database/prisma/schema.prisma`,
          'Then verify: node scripts/verify-migrations.cjs',
        ],
      };
    }
    if (allPresent) {
      // Objects complete but data checks fail — --applied would hide that forever.
      return {
        state: 'FAILED_BUT_DATA_INCOMPLETE',
        severity: 'critical',
        summary:
          'Schema objects are ALL present, but data-side checks FAIL - `--applied` would ' +
          'hide an incomplete backfill forever. FAIL CLOSED.',
        objectsPresent: 'ALL',
        missing,
        dataIssues,
        remedy: [
          'Data problems found:',
          ...dataIssues.map((i) => `  - ${i}`),
          '',
          'Do NOT run `--applied` until every problem above is fixed, and do NOT',
          'run `migrate reset`. Repair the data (backfill/settings insert are',
          'additive statements from migration.sql sections 6-7), then re-run this',
          'diagnostic.',
        ],
      };
    }
    // CASE B: partial objects — fail closed + print the minimal repair plan.
    return {
      state: 'FAILED_PARTIAL',
      severity: 'critical',
      summary:
        'The migration is recorded as FAILED and only SOME objects exist. ' +
        'Do NOT re-run it and do NOT mark it applied. FAIL CLOSED.',
      objectsPresent: 'SOME',
      missing,
      dataIssues,
      repairPlan: buildRepairPlan(missing),
      dataNotes: buildDataNotes(missing, dataIssues),
      remedy: [
        `Missing vs expected (${missingCount}): ${missingSummary || '(none)'}`,
        'Present/MISSING per object: see section 5 above. Minimal repair plan:',
        'see section 7 below (ADDITIVE statements only, printed for review).',
        '',
        'FAIL CLOSED: no resolve, no deploy, no reset until an operator has',
        'reconciled every missing object against the live schema. Every object in',
        'this migration is ADDITIVE, so nothing here can require a data rollback;',
        'existing users/wallets/ledger rows are untouched either way.',
      ],
    };
  }

  if (row.rolled_back_at) {
    if (!anyPresent) {
      return {
        state: 'ROLLED_BACK',
        severity: 'info',
        summary: 'The migration is recorded as ROLLED BACK and no object from it exists.',
        objectsPresent: 'NONE',
        missing,
        dataIssues,
        remedy: [
          'Safe to deploy (this is the case-A recovery path):',
          '  pnpm --filter @tanvion-royale/api prisma:migrate:deploy:strict',
        ],
      };
    }
    // CASE D: rolled back, yet objects exist — a re-deploy would collide.
    return {
      state: 'ROLLED_BACK_BUT_OBJECTS_EXIST',
      severity: 'critical',
      summary:
        'DRIFT: the migration is recorded as ROLLED BACK, yet objects from it exist. ' +
        'Re-running deploy would fail on CREATE TYPE/CREATE TABLE. FAIL CLOSED.',
      objectsPresent,
      missing,
      dataIssues,
      repairPlan: allPresent ? [] : buildRepairPlan(missing),
      remedy: [
        `Missing vs expected: ${missingSummary || '(none)'}`,
        'Manual review required. Do NOT deploy, do NOT resolve, do NOT reset.',
        'If every object and data check is proven complete, the only safe history',
        'action is `prisma migrate resolve --applied` after operator sign-off;',
        'otherwise reconcile the missing objects first (see section 7 plan).',
      ],
    };
  }

  // row.finished_at — recorded as APPLIED.
  if (allPresent && dataIssues.length === 0) {
    const checksumOk =
      String(row.checksum ?? '').toLowerCase() === String(facts.sha256).toLowerCase();
    if (!checksumOk) {
      return {
        state: 'APPLIED_CHECKSUM_MISMATCH',
        severity: 'warning',
        summary:
          'Migration is APPLIED and the schema is complete, but the recorded checksum ' +
          'differs from migration.sql on disk (file edited after it was applied).',
        objectsPresent: 'ALL',
        missing,
        dataIssues,
        remedy: [
          'FAIL CLOSED until reviewed: diff the file against the applied version',
          '(git history) to confirm the edit was the intentional BOM removal and',
          'not a silent SQL change. Do NOT reset. Re-run scripts/verify-migrations.cjs.',
        ],
      };
    }
    return {
      state: 'APPLIED',
      severity: 'ok',
      summary: 'The migration is recorded as APPLIED and schema + data checks all pass.',
      objectsPresent: 'ALL',
      missing,
      dataIssues,
      remedy: [
        'Nothing to resolve. Run scripts/verify-migrations.cjs to confirm the schema is current.',
      ],
    };
  }
  // CASE D: history says applied, but objects or data checks disagree.
  return {
    state: 'APPLIED_BUT_INCONSISTENT',
    severity: 'critical',
    summary:
      'History says APPLIED, but expected objects and/or data checks are missing. ' +
      'The schema drifted from the migration history. FAIL CLOSED.',
    objectsPresent,
    missing,
    dataIssues,
    repairPlan: buildRepairPlan(missing),
    remedy: [
      `Missing vs expected: ${missingSummary || '(none)'}`,
      ...dataIssues.map((i) => `Data: ${i}`),
      '',
      'Do NOT reset, do NOT re-run deploy blindly. Manual review required: the',
      'live schema and _prisma_migrations disagree, which is exactly the state',
      'that must never be "fixed" by guessing.',
    ],
  };
}

// ------------------------------------------------------------------ reporting
function line(label, value) {
  console.log(`  ${String(label).padEnd(28)} ${value}`);
}

function printReport(state, facts, verdict) {
  const row = state.migrationRows.find((r) => r.migration_name === MIGRATION) ?? null;

  console.log('');
  console.log('=== 1. CONNECTION ======================================================');
  line('host', hostOnly(dbUrl));

  console.log('');
  console.log('=== 2. MIGRATION FILE ON DISK ==========================================');
  line('migration', MIGRATION);
  line('bytes', facts.bytes);
  line('first bytes (hex)', facts.firstBytes);
  line('starts with BOM', facts.hasBom ? 'YES  <-- parse-breaking' : 'no');
  line('sha256 (file)', facts.sha256);

  console.log('');
  console.log('=== 3. _prisma_migrations ROW FOR THIS MIGRATION ======================');
  if (!row) {
    console.log('  (no row)');
  } else {
    line('started_at', row.started_at);
    line('finished_at', row.finished_at ?? '(null)');
    line('rolled_back_at', row.rolled_back_at ?? '(null)');
    line('applied_steps_count', row.applied_steps_count);
    line('checksum (db)', row.checksum);
    line('checksum matches file', row.checksum === facts.sha256 ? 'yes' : 'NO - file changed since the attempt');
    console.log('');
    console.log('  --- ORIGINAL ERROR (logs column, verbatim, never hidden) ---');
    console.log(
      String(row.logs ?? '(logs is null)')
        .split('\n')
        .map((l) => `  | ${l}`)
        .join('\n'),
    );
    console.log('  --- end of logs ---');
  }

  console.log('');
  console.log('=== 4. FULL MIGRATION HISTORY (ordered) ===============================');
  for (const r of state.history) {
    const status = r.rolled_back_at ? 'ROLLED_BACK' : r.finished_at ? 'applied' : 'FAILED';
    console.log(
      `  ${r.migration_name}  [${status}]  started=${r.started_at}  steps=${r.applied_steps_count}`,
    );
  }

  console.log('');
  console.log('=== 5. OBJECTS THIS MIGRATION CREATES (read from the live catalog) ====');
  const presentTables = new Set(state.tables.map((t) => t.table_name));
  const presentCols = new Set((state.columns ?? []).map((c) => `${c.table_name}.${c.column_name}`));
  if (state.hasColumn) presentCols.add('User.referralCode');
  for (const t of EXPECTED_TABLES) {
    line(`table ${t}`, presentTables.has(t) ? 'present' : 'MISSING');
    if (presentTables.has(t)) {
      for (const col of EXPECTED_COLUMNS[t] ?? []) {
        line(`  column ${t}.${col}`, presentCols.has(`${t}.${col}`) ? 'present' : 'MISSING');
      }
    }
  }
  line('column User.referralCode', state.hasColumn ? 'present' : 'MISSING');

  const enumValues = new Set(state.enumTypes.map((e) => `${e.typname}.${e.enumlabel}`));
  for (const [name, values] of Object.entries(EXPECTED_ENUMS)) {
    const missing = values.filter((v) => !enumValues.has(`${name}.${v}`));
    line(`enum ${name}`, missing.length ? `MISSING (${missing.join(', ')})` : 'complete');
  }
  for (const { type, value } of EXPECTED_ADDED_VALUES) {
    line(`enum value ${type}.${value}`, enumValues.has(`${type}.${value}`) ? 'present' : 'MISSING');
  }

  const presentIdx = new Set(state.indexes.map((i) => i.indexname));
  for (const i of EXPECTED_INDEXES) {
    line(`index ${i}`, presentIdx.has(i) ? 'present' : 'MISSING');
  }
  const presentPks = new Set((state.pks ?? []).map((p) => p.conname));
  for (const p of EXPECTED_PKS) {
    line(`primary key ${p}`, presentPks.has(p) ? 'present' : 'MISSING');
  }
  const presentFks = new Set(state.fks.map((f) => f.conname));
  for (const f of EXPECTED_FKS) {
    line(`fk ${f}`, presentFks.has(f) ? 'present' : 'MISSING');
  }

  console.log('');
  console.log('=== 6. USER DATA (read-only) ===========================================');
  const s = state.userStats;
  if (!s.columnExists) {
    // Expected whenever the migration never applied. Reported, not fatal: the
    // backfill demonstrably did not run either.
    line('users total', 'N/A - "User"."referralCode" does not exist');
    line('with referralCode', 'N/A - column absent (backfill did not run)');
    line('duplicate codes', 'N/A - column absent');
    line('settings row id=1', state.settingsTableExists ? 'MISSING' : 'N/A - table absent');
  } else {
    line('users total', s.total);
    line('with referralCode', s.with_code);
    line('without referralCode', s.without_code);
    line('duplicate codes', state.dupes.length === 0 ? 'none' : `${state.dupes.length} group(s) - NOT SAFE`);
    for (const d of state.dupes) line('  duplicate', `${d.referralCode} x${d.n}`);
    line('settings row id=1', state.settingsRow.length ? 'present' : 'MISSING');
  }
  if (state.settingsRow.length) {
    line('  program isEnabled', String(state.settingsRow[0].isEnabled));
  }

  console.log('');
  console.log('=== 7. MINIMAL REPAIR PLAN (PRINTED FOR REVIEW - NEVER EXECUTED) =======');
  if (verdict.repairPlan && verdict.repairPlan.length) {
    console.log('  Additive statements ONLY, in file order, for the objects marked MISSING.');
    console.log('  Nothing below has been run against any database.');
    console.log('');
    for (const stmt of verdict.repairPlan) {
      for (const l of stmt.split('\n')) console.log(`  | ${l}`);
      console.log('  |');
    }
    if (verdict.dataNotes && verdict.dataNotes.length) {
      console.log('  DATA STEPS (run manually after the DDL above, in this order):');
      for (const n of verdict.dataNotes) console.log(`    * ${n}`);
    }
  } else {
    console.log('  (not applicable - no missing DDL objects for this verdict)');
  }

  console.log('');
  console.log('=== 8. VERDICT ========================================================');
  line('state', verdict.state);
  line('objects present', verdict.objectsPresent);
  if (verdict.dataIssues && verdict.dataIssues.length) {
    for (const issue of verdict.dataIssues) line('data issue', issue);
  }
  console.log('');
  console.log(`  ${verdict.summary}`);
  console.log('');
  console.log('  NEXT STEPS:');
  for (const step of verdict.remedy) console.log(`    ${step}`);
  console.log('');
}

(async () => {
  try {
    const state = await probe();
    const facts = fileFacts();
    const verdict = buildVerdict(state, facts);
    if (wantJson) {
      console.log(
        JSON.stringify(
          {
            file: facts,
            migrationRow: state.migrationRows,
            verdict,
            derivationWarnings: DERIVATION_WARNINGS,
            expectedCounts: {
              tables: EXPECTED_TABLES.length,
              columns: Object.values(EXPECTED_COLUMNS).reduce((n, a) => n + a.length, 0),
              enums: Object.keys(EXPECTED_ENUMS).length,
              enumValues:
                Object.values(EXPECTED_ENUMS).reduce((n, a) => n + a.length, 0) +
                EXPECTED_ADDED_VALUES.length,
              indexes: EXPECTED_INDEXES.length,
              pks: EXPECTED_PKS.length,
              fks: EXPECTED_FKS.length,
            },
            userStats: state.userStats,
            dupes: state.dupes,
          },
          null,
          2,
        ),
      );
    } else {
      printReport(state, facts, verdict);
    }
  } catch (error) {
    // Never let a driver error leak the connection string (it can embed
    // user:password). Same host-only policy as scripts/verify-migrations.cjs.
    const raw = String(error && error.message ? error.message : error);
    const safe = dbUrl ? raw.split(dbUrl).join(hostOnly(dbUrl)) : raw;
    console.error(`\n[diagnose-referral] ERROR: ${safe.slice(0, 400)}\n`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
})();

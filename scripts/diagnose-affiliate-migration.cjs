#!/usr/bin/env node
/**
 * diagnose-affiliate-migration.cjs
 *
 * READ-ONLY diagnosis of the Render P3009 deployment failure for migration
 * `20260927000000_add_affiliate_and_bigbang_webhook` (affiliate program +
 * BigBang provider webhooks).
 *
 * WHY THIS EXISTS
 * ---------------
 * Render's build aborts with:
 *     Error: P3009
 *     migrate found failed migrations in the target database
 *     The `20260927000000_add_affiliate_and_bigbang_webhook` migration
 *     started at 2026-09-27 00:19:07 UTC failed.
 *
 * P3009 is only the SYMPTOM. It means "_prisma_migrations contains a row that
 * never finished". It does NOT tell you:
 *   (a) the ORIGINAL PostgreSQL error   -> that is in the row's `logs` column;
 *   (b) whether ANY of the migration's DDL actually landed -> the live catalogue.
 * Those two facts, and only those two facts, decide the repair.
 *
 * ATOMICITY (so (b) can be reasoned about, not guessed)
 * ----------------------------------------------------
 * Prisma does not emit explicit BEGIN/COMMIT, but it sends a migration file to
 * PostgreSQL as a single batched simple query, and PostgreSQL executes every
 * statement of one simple-query message inside ONE implicit transaction. (That
 * is exactly why `DROP INDEX CONCURRENTLY` fails with SQLSTATE 25001 inside a
 * Prisma migration.) PostgreSQL DDL is transactional, so ANY failing statement
 * - including a parse error, which fails the whole batch before statement 0
 * runs - rolls back the ENTIRE file. That makes CASE A the expected outcome,
 * but this script VERIFIES it against the catalogue rather than assuming it.
 *
 * USAGE
 * -----
 *   node scripts/diagnose-affiliate-migration.cjs
 *   node scripts/diagnose-affiliate-migration.cjs --json
 *
 *   node scripts/diagnose-affiliate-migration.cjs --offline
 *     Static self-test: file facts, statement inventory, derived expected
 *     objects and derivation warnings. NO DATABASE IS CONTACTED and NO CASE
 *     IS DECIDED - this mode exists so the migration file can be validated
 *     (BOM, statement structure, object derivation) with no credentials.
 *
 * Run it from a machine with production access (Render shell, or a laptop with
 * DATABASE_URL / DIRECT_URL exported). A local `.env` is loaded if present.
 *
 * SAFETY GUARANTEES
 * -----------------
 *   * SELECT-only. It never issues INSERT/UPDATE/DELETE/DDL/TRUNCATE.
 *   * Never runs `migrate resolve`, `migrate deploy` or `migrate reset`.
 *     There is deliberately NO --repair/--apply flag: the repair is always a
 *     deliberate manual step, printed under "NEXT STEPS".
 *   * Prints DATABASE_URL/DIRECT_URL host only, never credentials.
 *   * Prints the original `logs` value in full, unmodified.
 *
 * Env: DATABASE_URL (preferred) or DIRECT_URL.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const MIGRATION = '20260927000000_add_affiliate_and_bigbang_webhook';
const migrationDir = path.join(root, 'database', 'prisma', 'migrations', MIGRATION);
const migrationSqlPath = path.join(migrationDir, 'migration.sql');
const schemaPrismaPath = path.join(root, 'database', 'prisma', 'schema.prisma');

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
    return new URL(urlStr).hostname; // hostname ONLY - no user, no password, no path
  } catch {
    return '(unparseable URL)';
  }
}

const offline = process.argv.includes('--offline') || process.argv.includes('--self-test');
const directUrl = process.env.DIRECT_URL;
const dbUrl = process.env.DATABASE_URL || directUrl;
if (!offline && !dbUrl) {
  console.error(
    '\n[diagnose-affiliate] ERROR: neither DATABASE_URL nor DIRECT_URL is set.\n' +
      'This script needs a connection to the PRODUCTION database. Run it from a\n' +
      'shell that has the production URL exported (Render shell), or put the\n' +
      'values in the repo .env. Nothing below has been executed.\n',
  );
  process.exit(1);
}
if (!process.env.DATABASE_URL && directUrl) process.env.DATABASE_URL = directUrl;

// The Prisma Client is loaded lazily so `--offline` works with no credentials
// and constructs no connection pool.
let prisma = null;
let q = null;
function connect() {
  if (prisma) return;
  const { PrismaClient } = require(path.join(root, 'apps', 'api', 'src', 'generated', 'prisma'));
  prisma = new PrismaClient();
  q = (sql) => prisma.$queryRawUnsafe(sql);
}


// =========================================================================
// Expected-object derivation, read from migration.sql AT RUNTIME.
// Never a hand-kept list: if the migration changes, this follows it.
// =========================================================================

/** Split a SQL script on top-level `;`, aware of -- comments, 'literals', $$..$$ */
function splitSqlStatements(sql) {
  const out = [];
  let cur = '';
  let i = 0;
  let dollar = null;
  let inSingle = false;
  while (i < sql.length) {
    const ch = sql[i];
    if (dollar) {
      if (sql.startsWith(dollar, i)) { cur += dollar; i += dollar.length; dollar = null; }
      else { cur += ch; i += 1; }
      continue;
    }
    if (inSingle) {
      cur += ch;
      if (ch === "'" && sql[i + 1] === "'") { cur += "'"; i += 2; continue; }
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
    if (ch === "'") { inSingle = true; cur += ch; i += 1; continue; }
    const dm = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (dm) { dollar = dm[0]; cur += dm[0]; i += dm[0].length; continue; }
    if (ch === ';') { out.push(cur); cur = ''; i += 1; continue; }
    cur += ch;
    i += 1;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Remove the `--` header/section comments that precede a statement. */
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
    tables: [], columns: {}, enums: {}, indexes: [], uniqueIndexes: [],
    fks: [], pks: [], addedColumns: [], seedInserts: [], statements: [],
    warnings: [],
  };
  for (const raw of splitSqlStatements(sql)) {
    const text = stripLeadingComments(raw);
    if (!text) continue;
    const head = text.split('\n')[0].trim();
    e.statements.push(head);
    let m;

    if ((m = /^CREATE TYPE "([^"]+)" AS ENUM\s*\(([\s\S]*?)\)/i.exec(text))) {
      e.enums[m[1]] = (m[2].match(/'([^']+)'/g) || []).map((v) => v.slice(1, -1));
    } else if ((m = /^ALTER TYPE "([^"]+)" ADD VALUE (?:IF NOT EXISTS )?'([^']+)'/i.exec(text))) {
      e.addedValues = e.addedValues || [];
      e.addedValues.push({ type: m[1], value: m[2] });
    } else if ((m = /^CREATE TABLE "([^"]+)"\s*\(([\s\S]*)\)\s*$/i.exec(text))) {
      const table = m[1];
      const body = m[2];
      e.tables.push(table);
      const cols = [];
      for (const line of body.split('\n')) {
        // The type token may contain quotes (enum refs, DEFAULT 'lit'), parens
        // (TIMESTAMP(3)) and a trailing comma. The statement terminator is the
        // `)` that closes CREATE TABLE, handled by the outer regex.
        const cm = /^\s*"([A-Za-z_]\w*)"\s+([A-Za-z0-9_()"'. ]+?)(,|\s*$)/i.exec(line);
        if (cm) cols.push({ name: cm[1], type: cm[2].replace(/\s+/g, ' ').trim() });
      }
      e.columns[table] = cols;
      const pk = /CONSTRAINT\s+"([^"]+)"\s+PRIMARY KEY\s*\("([^"]+)"\)/i.exec(body);
      if (pk) e.pks.push({ table, name: pk[1], column: pk[2] });
    } else if ((m = /^CREATE UNIQUE INDEX (?:IF NOT EXISTS )?"([^"]+)"\s+ON\s+"([^"]+)"\s*\(([^)]*)\)/i.exec(text))) {
      e.uniqueIndexes.push({ name: m[1], table: m[2], cols: m[3] });
    } else if ((m = /^CREATE INDEX (?:IF NOT EXISTS )?"([^"]+)"\s+ON\s+"([^"]+)"\s*\(([^)]*)\)/i.exec(text))) {
      e.indexes.push({ name: m[1], table: m[2], cols: m[3] });
    } else if ((m = /^ALTER TABLE "([^"]+)"\s+ADD COLUMN (?:IF NOT EXISTS )?"([^"]+)"\s+([A-Za-z0-9_()]+)/i.exec(text))) {
      e.addedColumns.push({ table: m[1], column: m[2], type: m[3] });
    } else if ((m = /^ALTER TABLE "([^"]+)"\s+ADD CONSTRAINT "([^"]+)"\s+FOREIGN KEY \("([^"]+)"\)\s+REFERENCES "([^"]+)"\("([^"]+)"\)([\s\S]*)$/i.exec(text))) {
      e.fks.push({
        table: m[1], name: m[2], column: m[3], refTable: m[4], refColumn: m[5],
        actions: (m[6] || '').replace(/\s+/g, ' ').trim(),
      });
    } else if ((m = /^INSERT INTO "([^"]+)"\s*\(([^)]*)\)/i.exec(text))) {
      e.seedInserts.push({ table: m[1], columns: m[2].split(',').map((s) => s.trim().replace(/"/g, '')) });
    } else if (/^(BEGIN|COMMIT|ROLLBACK|SET|CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|COMMENT|ANALYZE|VACUUM|DO)\b/i.test(text)) {
      // recognised top-level DDL/DML - fine
    } else {
      e.warnings.push(
        'UNRECOGNISED top-level statement (PostgreSQL would reject this with SQLSTATE 42601 ' +
        `if it reached the server): ${head.slice(0, 120)}`,
      );
    }
  }
  if (e.tables.length === 0) e.warnings.push('derived ZERO tables from migration.sql - parser or file broken');
  if (e.statements.length === 0) e.warnings.push('derived ZERO statements from migration.sql - parser or file broken');
  return e;
}


/** Every object the migration creates must also exist in schema.prisma. */
function crossCheckSchema(expected, schemaText) {
  const warnings = [];
  const enums = new Set();
  for (const m of schemaText.matchAll(/^\s*enum\s+(\w+)\s*\{/gm)) enums.add(m[1]);
  const models = new Map();
  for (const m of schemaText.matchAll(/^\s*model\s+(\w+)\s*\{([\s\S]*?)\n\}/gm)) models.set(m[1], m[2]);
  for (const name of Object.keys(expected.enums)) {
    if (!enums.has(name)) warnings.push(`enum ${name} is in migration.sql but NOT in schema.prisma`);
  }
  for (const t of expected.tables) {
    if (!models.has(t)) warnings.push(`table ${t} is in migration.sql but NOT in schema.prisma`);
  }
  for (const [table, cols] of Object.entries(expected.columns)) {
    const body = models.get(table);
    if (body == null) continue;
    for (const c of cols) {
      if (!new RegExp(`^\\s*${c.name}\\s+`, 'm').test(body)) {
        warnings.push(`${table}.${c.name} is in migration.sql but NOT in the ${table} model`);
      }
    }
  }
  for (const a of expected.addedColumns) {
    const body = models.get(a.table) || '';
    if (body && !new RegExp(`^\\s*${a.column}\\s+`, 'm').test(body)) {
      warnings.push(`${a.table}.${a.column} is added by the migration but NOT in the ${a.table} model`);
    }
  }
  for (const f of expected.fks) {
    const body = models.get(f.table) || '';
    if (body && !new RegExp(`^\\s*${f.column}\\s+`, 'm').test(body)) {
      warnings.push(`${f.table}.${f.column} is a FK in the migration but NOT in the ${f.table} model`);
    }
  }
  return warnings;
}

const MIGRATION_SQL_TEXT = fs.readFileSync(migrationSqlPath, 'utf8');
const EXPECTED = deriveExpected(MIGRATION_SQL_TEXT);
let SCHEMA_TEXT = '';
try {
  SCHEMA_TEXT = fs.readFileSync(schemaPrismaPath, 'utf8');
} catch (err) {
  EXPECTED.warnings.push(`could not read schema.prisma: ${err.message}`);
}
const DERIVATION_WARNINGS = [...EXPECTED.warnings, ...crossCheckSchema(EXPECTED, SCHEMA_TEXT)];

const EXPECTED_TABLES = EXPECTED.tables;
const EXPECTED_COLUMNS = EXPECTED.columns;
const EXPECTED_ENUMS = EXPECTED.enums;
const EXPECTED_INDEXES = EXPECTED.indexes;
const EXPECTED_UNIQUE_INDEXES = EXPECTED.uniqueIndexes;
const EXPECTED_FKS = EXPECTED.fks;
const EXPECTED_PKS = EXPECTED.pks;
const EXPECTED_ADDED_COLUMNS = EXPECTED.addedColumns;
const EXPECTED_SEED_INSERTS = EXPECTED.seedInserts;
const EXPECTED_STATEMENTS = EXPECTED.statements;

function fileFacts() {
  const bytes = fs.readFileSync(migrationSqlPath);
  return {
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    hasBom: bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
    firstBytesHex: bytes.subarray(0, 6).toString('hex').toUpperCase(),
    statementCount: EXPECTED_STATEMENTS.length,
  };
}


// =========================================================================
// Probing - every statement below is a SELECT.
// =========================================================================
const inList = (arr) => (arr.length ? arr.map((v) => `'${v}'`).join(',') : `''`);

async function probe() {
  connect();
  const migrationRows = await q(
    `SELECT migration_name, started_at, finished_at, rolled_back_at,
            applied_steps_count, logs, checksum
       FROM "_prisma_migrations"
      WHERE migration_name = '${MIGRATION}'
      ORDER BY started_at`,
  );

  const unresolved = await q(
    `SELECT migration_name, started_at, finished_at, rolled_back_at
       FROM "_prisma_migrations"
      WHERE finished_at IS NULL
        AND rolled_back_at IS NULL
      ORDER BY started_at`,
  );

  const history = await q(
    `SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count
       FROM "_prisma_migrations"
      ORDER BY started_at`,
  );

  const tables = await q(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN (${inList(EXPECTED_TABLES)})
      ORDER BY table_name`,
  );

  const allCols = [];
  for (const t of EXPECTED_TABLES) {
    const rows = await q(
      `SELECT column_name, data_type, udt_name, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '${t}'
        ORDER BY column_name`,
    );
    for (const r of rows) allCols.push({ table: t, ...r });
  }

  const enumTypes = await q(
    `SELECT t.typname, e.enumlabel, e.enumsortorder
       FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
       LEFT JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE n.nspname = 'public' AND t.typname IN (${inList(Object.keys(EXPECTED_ENUMS))})
      ORDER BY t.typname, e.enumsortorder`,
  );

  const addedCols = [];
  for (const a of EXPECTED_ADDED_COLUMNS) {
    const rows = await q(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '${a.table}' AND column_name = '${a.column}'`,
    );
    addedCols.push({ ...a, present: rows.length > 0, actual: rows[0] || null });
  }

  const idxNames = [...EXPECTED_INDEXES, ...EXPECTED_UNIQUE_INDEXES].map((i) => i.name);
  const indexes = await q(
    `SELECT indexname AS name, indexdef AS def
       FROM pg_indexes
      WHERE schemaname = 'public' AND indexname IN (${inList(idxNames)})
      ORDER BY indexname`,
  );

  const fkNames = EXPECTED_FKS.map((f) => f.name);
  const fks = await q(
    `SELECT conname AS name, conrelid::regclass::text AS tbl, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
      WHERE conname IN (${inList(fkNames)})
      ORDER BY conname`,
  );

  const pkNames = EXPECTED_PKS.map((p) => p.name);
  const pks = await q(
    `SELECT conname AS name, conrelid::regclass::text AS tbl, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
      WHERE conname IN (${inList(pkNames)})
      ORDER BY conname`,
  );

  // Seed rows - only readable once the table exists.
  let seedRows = null;
  if (tables.some((t) => t.table_name === 'AffiliateContentBlock')) {
    seedRows = await q(
      `SELECT id, "key", type, title, "sortOrder", "isEnabled"
         FROM "AffiliateContentBlock" ORDER BY "sortOrder"`,
    );
  }

  // Business-data safety counters - read-only, never written.
  const users = await q(`SELECT count(*)::int AS n FROM "User"`);
  const providers = await q(`SELECT count(*)::int AS n FROM "PartnerProvider"`);

  return {
    migrationRows, unresolved, history, tables, allCols, enumTypes, addedCols,
    indexes, fks, pks, seedRows,
    business: {
      users: users && users[0] ? Number(users[0].n) : null,
      partnerProviders: providers && providers[0] ? Number(providers[0].n) : null,
      providerWebhookEventRows: await countIfExists('public."ProviderWebhookEvent"'),
      affiliateClicks: await countIfExists('public."AffiliateClick"'),
      affiliateMonthlyTargets: await countIfExists('public."AffiliateMonthlyTarget"'),
    },
  };

  // Guarded count: returns null when the relation does not exist, so this probe
  // can never error with `relation "..." does not exist`.
  async function countIfExists(reg) {
    const r = await q(
      `SELECT CASE WHEN to_regclass('${reg}') IS NULL THEN NULL
              ELSE (SELECT count(*) FROM ${reg})::int END AS n`,
    );
    return r && r[0] && r[0].n !== null ? Number(r[0].n) : null;
  }
}


// =========================================================================
// Verdict: CASE A / B / C (plus the fail-closed cases).
// =========================================================================
function buildVerdict(state, facts) {
  const rows = state.migrationRows || [];
  const latest = rows.length ? rows[rows.length - 1] : null;
  const isFailed = !!latest && !latest.finished_at && !latest.rolled_back_at;
  const isApplied = !!latest && !!latest.finished_at;

  const presentTables = new Set(state.tables.map((t) => t.table_name));
  const presentEnums = new Set(state.enumTypes.map((e) => e.typname));
  const presentIdx = new Set(state.indexes.map((i) => i.name));
  const presentFk = new Set(state.fks.map((f) => f.name));
  const presentPk = new Set(state.pks.map((p) => p.name));
  const presentColNames = new Set(state.allCols.map((c) => `${c.table}.${c.column_name}`));

  const missingTables = EXPECTED_TABLES.filter((t) => !presentTables.has(t));
  const missingEnums = Object.keys(EXPECTED_ENUMS).filter((e) => !presentEnums.has(e));
  const missingIdx = [...EXPECTED_INDEXES, ...EXPECTED_UNIQUE_INDEXES]
    .map((i) => i.name).filter((n) => !presentIdx.has(n));
  const missingFk = EXPECTED_FKS.map((f) => f.name).filter((n) => !presentFk.has(n));
  const missingPk = EXPECTED_PKS.map((p) => p.name).filter((n) => !presentPk.has(n));
  const missingAddedCols = state.addedCols.filter((c) => !c.present).map((c) => `${c.table}.${c.column}`);
  const missingCols = [];
  for (const [table, cols] of Object.entries(EXPECTED_COLUMNS)) {
    for (const c of cols) {
      if (!presentColNames.has(`${table}.${c.name}`)) missingCols.push(`${table}.${c.name}`);
    }
  }

  const totalExpected =
    EXPECTED_TABLES.length + Object.keys(EXPECTED_ENUMS).length +
    EXPECTED_INDEXES.length + EXPECTED_UNIQUE_INDEXES.length +
    EXPECTED_FKS.length + EXPECTED_PKS.length + EXPECTED_ADDED_COLUMNS.length;

  const presentCount =
    (EXPECTED_TABLES.length - missingTables.length) +
    (Object.keys(EXPECTED_ENUMS).length - missingEnums.length) +
    (EXPECTED_INDEXES.length + EXPECTED_UNIQUE_INDEXES.length - missingIdx.length) +
    (EXPECTED_FKS.length - missingFk.length) +
    (EXPECTED_PKS.length - missingPk.length) +
    (EXPECTED_ADDED_COLUMNS.length - missingAddedCols.length);

  // "Nothing left" == not one single object of this migration is in the catalogue.
  const nothingLeft =
    missingTables.length === EXPECTED_TABLES.length &&
    missingEnums.length === Object.keys(EXPECTED_ENUMS).length &&
    missingIdx.length === EXPECTED_INDEXES.length + EXPECTED_UNIQUE_INDEXES.length &&
    missingFk.length === EXPECTED_FKS.length &&
    missingPk.length === EXPECTED_PKS.length &&
    missingAddedCols.length === EXPECTED_ADDED_COLUMNS.length &&
    missingCols.length === 0;


  let caseName;
  let summary;
  const remedy = [];

  if (DERIVATION_WARNINGS.length) {
    caseName = 'CASE_D_UNVERIFIABLE';
    summary =
      'The expected-object list could not be derived reliably from migration.sql, so NO verdict is ' +
      'issued. Fix the derivation warnings above and re-run. Do NOT resolve anything on this output.';
  } else if (facts.hasBom) {
    caseName = 'CASE_D_UNVERIFIABLE';
    summary =
      'migration.sql STILL STARTS WITH A UTF-8 BOM (EF BB BF) - the 2026-09-26 root cause. Remove ' +
      'the BOM in source control BEFORE touching the database; re-applying would fail identically.';
  } else if (!latest) {
    caseName = 'CASE_NEVER_ATTEMPTED';
    summary =
      'There is NO row for this migration in _prisma_migrations, so it never ran here. P3009 is then ' +
      'coming from a DIFFERENT failed migration - check the unresolved list above.';
  } else if (isApplied) {
    caseName = 'CASE_C_ALREADY_APPLIED';
    summary =
      'The migration row is finished. There is nothing to repair for THIS migration; look for a ' +
      'different blocker (see the unresolved list).';
  } else if (isFailed && nothingLeft) {
    caseName = 'CASE_A_NO_LEFTOVER_OBJECTS';
    summary =
      'FAILED with ZERO leftover objects. Every object this migration creates is absent from the ' +
      'catalogue, so PostgreSQL rolled the whole file back (or it never parsed). The database is in ' +
      'the pre-affiliate state. This is the ONLY case where `migrate resolve --rolled-back` followed ' +
      'by `migrate deploy` is correct: the migration is then re-applied for real.';
    remedy.push(
      `pnpm --filter @tanvion-royale/api exec prisma migrate resolve --rolled-back ${MIGRATION} --schema ../../database/prisma/schema.prisma`,
      'pnpm --filter @tanvion-royale/api exec prisma migrate status --schema ../../database/prisma/schema.prisma',
      'pnpm --filter @tanvion-royale/api prisma:migrate:deploy:strict',
      'node scripts/verify-migrations.cjs',
      'pnpm --filter @tanvion-royale/api prisma:generate',
      'pnpm --filter @tanvion-royale/api... run build',
    );
  } else if (isFailed) {
    caseName = 'CASE_B_PARTIAL_STATE';
    summary =
      'FAILED WITH LEFTOVER OBJECTS. STOP. Do NOT run `migrate resolve` and do NOT re-run the ' +
      'migration: `CREATE TYPE "AffiliateTargetType"` and the four `CREATE TABLE` statements have no ' +
      'IF NOT EXISTS guard, so a re-run aborts on the first object that already exists. Reconcile by ' +
      'hand using the object lists above before doing anything else.';
  } else {
    caseName = 'CASE_E_ROLLED_BACK_ROW';
    summary =
      'The latest row already carries rolled_back_at. Re-running `prisma migrate deploy` re-applies ' +
      'the migration from scratch, which is the intended path; no resolve is needed.';
    remedy.push('pnpm --filter @tanvion-royale/api prisma:migrate:deploy:strict');
  }

  return {
    case: caseName,
    summary,
    remedy,
    objectsPresent: `${presentCount}/${totalExpected}`,
    missingTables, missingEnums, missingIdx, missingFk, missingPk,
    missingCols, missingAddedCols,
    unresolvedCount: state.unresolved.length,
    otherUnresolved: state.unresolved.map((r) => r.migration_name).filter((n) => n !== MIGRATION),
  };
}


// =========================================================================
// Report
// =========================================================================
function line(k, v) { console.log(`  ${String(k).padEnd(44)} ${v}`); }
const list = (arr) => (arr.length ? arr.join(', ') : '(none)');

function printReport(state, facts, verdict) {
  console.log('\n=========================================================================');
  console.log(' TANVION ROYALE - READ-ONLY P3009 DIAGNOSTIC');
  console.log(` migration : ${MIGRATION}`);
  console.log(` database  : ${hostOnly(dbUrl)}`);
  console.log('=========================================================================');

  console.log('\n=== 1. MIGRATION FILE ON DISK (source control) ========================');
  line('sha256', facts.sha256);
  line('bytes', facts.bytes);
  line('first 6 bytes', facts.firstBytesHex);
  line('starts with UTF-8 BOM (EF BB BF)?', facts.hasBom ? '*** YES - SEE CASE_D ***' : 'no');
  line('top-level statements', facts.statementCount);
  line('unrecognised statements', DERIVATION_WARNINGS.length ? `*** ${DERIVATION_WARNINGS.length} ***` : 'none');
  for (const w of DERIVATION_WARNINGS) console.log(`    - ${w}`);

  console.log('\n=== 2. _prisma_migrations ROWS FOR THIS MIGRATION ====================');
  if (!state.migrationRows.length) {
    console.log('  (none - this migration has never been attempted on this database)');
  }
  for (const r of state.migrationRows) {
    line('migration_name', r.migration_name);
    line('started_at', r.started_at);
    line('finished_at', r.finished_at === null ? 'NULL  -> STILL FAILED' : r.finished_at);
    line('rolled_back_at', r.rolled_back_at === null ? 'NULL' : r.rolled_back_at);
    line('applied_steps_count', r.applied_steps_count);
    line('checksum', r.checksum);
    console.log('\n  --- ORIGINAL logs (verbatim, never modified) ------------------------');
    if (r.logs === null || r.logs === undefined || r.logs === '') {
      console.log('  (logs is EMPTY)');
      console.log('  An empty logs column is normal for a failed migration - Prisma only fills it');
      console.log('  for errors it can serialise. The original PostgreSQL error is then only in the');
      console.log('  Render build log for 2026-09-27 00:19:07 UTC.');
    } else {
      for (const l of String(r.logs).split(/\r?\n/)) console.log(`  | ${l}`);
    }
    console.log('  ---------------------------------------------------------------------');
  }

  console.log('\n=== 3. ALL UNRESOLVED MIGRATIONS (P3009 blockers) ====================');
  if (!state.unresolved.length) console.log('  (none)');
  for (const r of state.unresolved) {
    console.log(`  ${r.migration_name}  started=${r.started_at} finished=${r.finished_at} rolled_back=${r.rolled_back_at}`);
  }
  line('total unresolved', state.unresolved.length);
  if (state.unresolved.length > 1) {
    console.log('  *** MORE THAN ONE unresolved migration. Every one of them must be');
    console.log('      reconciled, not just this one. ***');
  }

  console.log('\n=== 4. MIGRATION HISTORY (last 6 rows) ==============================');
  for (const r of state.history.slice(-6)) {
    const st = r.finished_at ? 'APPLIED' : r.rolled_back_at ? 'ROLLED_BACK' : '*** FAILED ***';
    console.log(`  ${st.padEnd(14)} ${r.migration_name}  steps=${r.applied_steps_count}`);
  }


  console.log('\n=== 5. OBJECTS THIS MIGRATION CREATES (derived from migration.sql) ===');
  line('enum', Object.entries(EXPECTED_ENUMS).map(([k, v]) => `${k}(${v.join('|')})`).join(', ') || '(none)');
  line('tables', list(EXPECTED_TABLES));
  for (const [t, cols] of Object.entries(EXPECTED_COLUMNS)) {
    console.log(`      ${t} (${cols.length}): ${cols.map((c) => `${c.name} ${c.type}`).join(', ')}`);
  }
  for (const a of EXPECTED_ADDED_COLUMNS) line('added column', `${a.table}.${a.column} ${a.type} (NULLABLE)`);
  line('primary keys', list(EXPECTED_PKS.map((p) => `${p.name} (${p.table}.${p.column})`)));
  line('unique indexes', list(EXPECTED_UNIQUE_INDEXES.map((i) => `${i.name} (${i.table})`)));
  line('indexes', list(EXPECTED_INDEXES.map((i) => i.name)));
  line('foreign keys', list(EXPECTED_FKS.map((f) => `${f.name} -> ${f.refTable}.${f.refColumn} ${f.actions}`)));
  line('seed inserts', `${EXPECTED_SEED_INSERTS.length} guarded INSERT(s)`);
  for (const s of EXPECTED_SEED_INSERTS) console.log(`      into ${s.table}: ${s.columns.join(', ')}`);

  console.log('\n=== 6. LIVE CATALOGUE - WHAT ACTUALLY EXISTS ========================');
  line('tables present', list(state.tables.map((t) => t.table_name)));
  line('tables MISSING', list(verdict.missingTables));
  for (const [name, values] of Object.entries(EXPECTED_ENUMS)) {
    const got = state.enumTypes.filter((e) => e.typname === name).map((e) => e.enumlabel).filter(Boolean);
    line(`enum ${name}`, got.length ? `${got.join('|')} (migration wants ${values.join('|')})` : '*** TYPE ABSENT ***');
  }
  line('indexes present', `${state.indexes.length}/${EXPECTED_INDEXES.length + EXPECTED_UNIQUE_INDEXES.length}`);
  for (const i of state.indexes) console.log(`      ${i.name}: ${i.def}`);
  line('indexes MISSING', list(verdict.missingIdx));
  line('primary keys present', list(state.pks.map((p) => p.name)));
  line('primary keys MISSING', list(verdict.missingPk));
  line('foreign keys present', list(state.fks.map((f) => f.name)));
  for (const f of state.fks) console.log(`      ${f.name}: ${f.def}`);
  line('foreign keys MISSING', list(verdict.missingFk));
  for (const a of state.addedCols) {
    line(`column ${a.table}.${a.column}`, a.present ? `PRESENT (${a.actual.data_type}, nullable=${a.actual.is_nullable})` : '*** ABSENT ***');
  }
  line('columns MISSING', list(verdict.missingCols));

  console.log('\n=== 7. SEED ROWS (AffiliateContentBlock) ==============================');
  if (state.seedRows === null) console.log('  table absent - the seed never ran');
  else if (!state.seedRows.length) console.log('  table present but EMPTY - the seed did not commit');
  else {
    for (const s of state.seedRows) {
      console.log(`  ${String(s.id).padEnd(10)} key=${String(s.key).padEnd(14)} type=${String(s.type).padEnd(14)} sortOrder=${s.sortOrder} enabled=${s.isEnabled}`);
    }
    line('seed row count', state.seedRows.length);
    const seeded = new Set(state.seedRows.map((r) => r.key));
    for (const k of ['hero', 'how-it-works', 'faq']) line(`  seed "${k}"`, seeded.has(k) ? 'present' : '*** MISSING ***');
  }

  console.log('\n=== 8. BUSINESS DATA (read-only counters, never modified) ============');
  line('users', state.business.users);
  line('partnerProviders', state.business.partnerProviders);
  line('ProviderWebhookEvent rows', state.business.providerWebhookEventRows);
  line('AffiliateClick rows', state.business.affiliateClicks);
  line('AffiliateMonthlyTarget rows', state.business.affiliateMonthlyTargets);


  console.log('\n=== 9. VERDICT =======================================================');
  line('CASE', verdict.case);
  line('objects present', verdict.objectsPresent);
  line('unresolved migrations', verdict.unresolvedCount);
  if (verdict.otherUnresolved.length) line('OTHER unresolved', verdict.otherUnresolved.join(', '));
  console.log('');
  console.log(`  ${verdict.summary}`);
  console.log('');
  if (verdict.remedy.length) {
    console.log('  NEXT STEPS (printed for review - nothing below has been run):');
    for (const s of verdict.remedy) console.log(`    ${s}`);
  } else {
    console.log('  NEXT STEPS: none. Do NOT run `migrate resolve` on the strength of this output alone.');
  }
  console.log('');
  console.log('  NEVER: prisma migrate reset | DROP DATABASE | TRUNCATE |');
  console.log('          DELETE/UPDATE on "_prisma_migrations" | --applied unless CASE_C');
  console.log('');
}

// =========================================================================
// Entry point
// =========================================================================

function printOfflineReport(facts) {
  console.log('\n=========================================================================');
  console.log(' TANVION ROYALE - MIGRATION FILE SELF-TEST (OFFLINE, NO DATABASE)');
  console.log(` migration : ${MIGRATION}`);
  console.log('=========================================================================');
  console.log('\n NO DATABASE WAS CONTACTED. NO CASE (A/B/C) IS DECIDED HERE.');
  console.log(' Run without --offline for the real verdict.\n');

  console.log('=== FILE FACTS ========================================================');
  line('sha256', facts.sha256);
  line('bytes', facts.bytes);
  line('first 6 bytes', facts.firstBytesHex);
  line('starts with UTF-8 BOM (EF BB BF)?', facts.hasBom ? '*** YES - MUST BE FIXED ***' : 'no');
  line('top-level statements', facts.statementCount);

  console.log('\n=== STATEMENT INVENTORY ===============================================');
  EXPECTED_STATEMENTS.forEach((s, i) => console.log(`  [${String(i).padStart(2)}] ${s.slice(0, 110)}`));

  console.log('\n=== DERIVED EXPECTED OBJECTS =========================================');
  line('enum', Object.entries(EXPECTED_ENUMS).map(([k, v]) => `${k}(${v.join('|')})`).join(', ') || '(none)');
  line('tables', list(EXPECTED_TABLES));
  for (const [t, cols] of Object.entries(EXPECTED_COLUMNS)) {
    console.log(`      ${t} (${cols.length}): ${cols.map((c) => `${c.name} ${c.type}`).join(', ')}`);
  }
  for (const a of EXPECTED_ADDED_COLUMNS) line('added column', `${a.table}.${a.column} ${a.type} (NULLABLE)`);
  line('primary keys', list(EXPECTED_PKS.map((p) => `${p.name} (${p.table}.${p.column})`)));
  line('unique indexes', list(EXPECTED_UNIQUE_INDEXES.map((i) => `${i.name} (${i.table})`)));
  line('indexes', list(EXPECTED_INDEXES.map((i) => i.name)));
  line('foreign keys', list(EXPECTED_FKS.map((f) => `${f.name} -> ${f.refTable}.${f.refColumn} ${f.actions}`)));
  line('seed inserts', `${EXPECTED_SEED_INSERTS.length} guarded INSERT(s)`);
  for (const s of EXPECTED_SEED_INSERTS) console.log(`      into ${s.table}: ${s.columns.join(', ')}`);

  console.log('\n=== DERIVATION / CROSS-CHECK WARNINGS =================================');
  if (!DERIVATION_WARNINGS.length) {
    console.log('  (none - every top-level statement parsed as a known DDL/DML form, and');
    console.log('   every object the migration creates also exists in schema.prisma)');
  } else {
    for (const w of DERIVATION_WARNINGS) console.log(`  *** ${w}`);
  }
  console.log('');
}

(async () => {
  try {
    if (offline) {
      const facts = fileFacts();
      if (wantJson) {
        console.log(JSON.stringify({ migration: MIGRATION, file: facts, expected: EXPECTED, warnings: DERIVATION_WARNINGS }, null, 2));
      } else {
        printOfflineReport(facts);
      }
      if (facts.hasBom || DERIVATION_WARNINGS.length) process.exitCode = 1;
      return;
    }
    const state = await probe();
    const facts = fileFacts();
    const verdict = buildVerdict(state, facts);
    if (wantJson) {
      console.log(JSON.stringify({
        migration: MIGRATION,
        databaseHost: hostOnly(dbUrl),
        file: facts,
        migrationRows: state.migrationRows,
        unresolved: state.unresolved,
        history: state.history,
        catalogue: {
          tables: state.tables, columns: state.allCols, enums: state.enumTypes,
          addedColumns: state.addedCols, indexes: state.indexes,
          foreignKeys: state.fks, primaryKeys: state.pks, seedRows: state.seedRows,
        },
        businessCounts: state.business,
        verdict,
        derivationWarnings: DERIVATION_WARNINGS,
        expected: {
          tables: EXPECTED_TABLES, columns: EXPECTED_COLUMNS, enums: EXPECTED_ENUMS,
          indexes: EXPECTED_INDEXES, uniqueIndexes: EXPECTED_UNIQUE_INDEXES,
          foreignKeys: EXPECTED_FKS, primaryKeys: EXPECTED_PKS,
          addedColumns: EXPECTED_ADDED_COLUMNS, statements: EXPECTED_STATEMENTS,
        },
      }, null, 2));
    } else {
      printReport(state, facts, verdict);
    }
  } catch (error) {
    // Never let a driver error leak the connection string (it embeds user:password).
    const raw = String(error && error.message ? error.message : error);
    const safe = dbUrl ? raw.split(dbUrl).join(hostOnly(dbUrl)) : raw;
    console.error(`\n[diagnose-affiliate] ERROR: ${safe.slice(0, 600)}\n`);
    process.exitCode = 1;
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => undefined);
  }
})();

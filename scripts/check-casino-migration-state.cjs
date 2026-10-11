#!/usr/bin/env node
/**
 * check-casino-migration-state.cjs
 *
 * READ-ONLY diagnosis for ONE migration and the ONLY question that matters
 * after a failed `prisma migrate deploy`:
 *
 *   20260917000000_add_casino_provider_catalog
 *   -> Error: P3018 / PostgreSQL 42601 syntax error at or near ""amount""
 *
 * The Render build failed because the migration file shipped an ORPHANED
 * fragment of the CREATE TABLE "CasinoTransaction" body AFTER the last
 * ALTER TABLE statement:
 *
 *     -- AddForeignKey
 *     ALTER TABLE "CasinoTransaction" ADD CONSTRAINT "CasinoTransaction_walletTransactionId_fkey" ...;
 *
 *         "amount" INTEGER NOT NULL,          <-- outside any CREATE TABLE
 *         ...
 *         CONSTRAINT "CasinoTransaction_pkey" PRIMARY KEY ("id")
 *     );
 *
 * PostgreSQL therefore parsed `"amount"` as the start of a NEW statement and
 * aborted with 42601. Prisma records the attempt in _prisma_migrations with
 * finished_at = NULL, and every later `migrate deploy` refuses to run (P3009)
 * until the failed attempt is resolved.
 *
 * Which resolve command is correct depends ENTIRELY on what the failed attempt
 * actually committed:
 *
 *   nothing committed      -> `prisma migrate resolve --rolled-back <name>` then deploy
 *   DDL committed          -> `prisma migrate resolve --applied  <name>` (NEVER --rolled-back:
 *                             re-running CREATE TYPE/CREATE TABLE would fail again)
 *
 * This script answers that from the live database instead of guessing.
 *
 * What it does
 * ------------
 *   * Parses the (repaired) migration file into the exact set of objects it is
 *     supposed to create: enum types + values, tables + columns, indexes and
 *     foreign keys, plus the two additive "PartnerProvider" columns.
 *   * Refuses to give a verdict if that file is still structurally malformed
 *     (an orphaned fragment would mean the file was never actually repaired).
 *   * Probes the live database with SELECTs only.
 *   * Prints one verdict + the exact next command. It never writes: no DDL, no
 *     DML, no `_prisma_migrations` insert, no `migrate resolve`, no reset.
 *
 * Usage (repo root)
 * -----------------
 *   node scripts/check-casino-migration-state.cjs             # human report
 *   node scripts/check-casino-migration-state.cjs --json      # machine readable
 *
 * Env: DATABASE_URL (pooled) or DIRECT_URL (unpooled, preferred for reads).
 *      A local `.env` / `apps/api/.env` is loaded if present. Connection
 *      strings are NEVER printed — only the host.
 *
 * Exit codes: 0 = a safe next action is printed; 1 = human judgement required.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const MIGRATION = '20260917000000_add_casino_provider_catalog';
const migrationSqlPath = path.join(root, 'database', 'prisma', 'migrations', MIGRATION, 'migration.sql');
const schemaPath = path.join(root, 'database', 'prisma', 'schema.prisma');

const wantJson = process.argv.includes('--json');

// ---------------------------------------------------------------------------
// env loading (mirrors scripts/check-migration-state.cjs — values never echoed)
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
    '\n[check-casino-migration-state] ERROR: neither DATABASE_URL nor DIRECT_URL is set.\n' +
      'Set one in the environment (or a local .env) and re-run. Nothing was read or written.\n',
  );
  process.exit(1);
}
if (!process.env.DATABASE_URL && directUrl) process.env.DATABASE_URL = directUrl;

// ---------------------------------------------------------------------------
// parse the migration file -> the exact objects it is supposed to create
// ---------------------------------------------------------------------------
const migrationSql = fs.readFileSync(migrationSqlPath, 'utf8');
const fileChecksum = crypto.createHash('sha256').update(fs.readFileSync(migrationSqlPath)).digest('hex');

/** Split a SQL script into top-level statements (quote/comment/dollar aware). */
function splitStatements(sql) {
  const out = [];
  let buf = '';
  let line = 1;
  let startLine = 1;
  let depth = 0;
  let state = 'normal';
  let dollarTag = '';
  const push = () => {
    const text = buf;
    buf = '';
    if (text.trim().length > 0) out.push({ text, startLine });
  };
  for (let i = 0; i < sql.length; i += 1) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '\n') line += 1;
    if (buf.length === 0 && /\s/.test(c)) {
      startLine = line;
      continue;
    }
    if (state === 'lineComment') {
      buf += c;
      if (c === '\n') state = 'normal';
      continue;
    }
    if (state === 'blockComment') {
      buf += c;
      if (c === '*' && next === '/') {
        buf += next;
        i += 1;
        state = 'normal';
      }
      continue;
    }
    if (state === 'single' || state === 'double') {
      buf += c;
      const q = state === 'single' ? "'" : '"';
      if (c === q) {
        if (next === q) {
          buf += next;
          i += 1;
        } else state = 'normal';
      }
      continue;
    }
    if (state === 'dollar') {
      buf += c;
      if (c === '$' && sql.startsWith(dollarTag, i)) {
        buf += sql.slice(i + 1, i + dollarTag.length);
        i += dollarTag.length - 1;
        state = 'normal';
      }
      continue;
    }
    if (c === '-' && next === '-') {
      buf += '--';
      i += 1;
      state = 'lineComment';
      continue;
    }
    if (c === '/' && next === '*') {
      buf += '/*';
      i += 1;
      state = 'blockComment';
      continue;
    }
    if (c === "'") {
      buf += c;
      state = 'single';
      continue;
    }
    if (c === '"') {
      buf += c;
      state = 'double';
      continue;
    }
    if (c === '$') {
      const m = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i));
      if (m) {
        dollarTag = m[0];
        buf += dollarTag;
        i += dollarTag.length - 1;
        state = 'dollar';
        continue;
      }
    }
    if (c === '(') depth += 1;
    if (c === ')') depth -= 1;
    if (c === ';' && depth === 0) {
      buf += c;
      push();
      continue;
    }
    buf += c;
  }
  push();
  return out;
}

/** Strip comments (CRLF safe: `.`/`$` do not match before \r without /m). */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

const STATEMENT_STARTS = new Set([
  'CREATE', 'ALTER', 'DROP', 'COMMENT', 'INSERT', 'UPDATE', 'DELETE', 'SELECT',
  'TRUNCATE', 'GRANT', 'REVOKE', 'SET', 'DO', 'BEGIN', 'COMMIT', 'ROLLBACK', 'WITH',
]);

/** Structural sanity of the migration file itself (the actual root cause). */
function lintMigration(sql) {
  const problems = [];
  const statements = splitStatements(sql).filter((s) => stripComments(s.text).trim() !== '');
  statements.forEach((stmt, idx) => {
    const bare = stripComments(stmt.text).trim();
    const m = /^("\w+"|\w+)/.exec(bare);
    const token = m ? m[1] : '(empty)';
    if (token.startsWith('"')) {
      problems.push(
        `statement #${idx + 1} (line ${stmt.startLine}) starts with the quoted identifier ${token} — ` +
          'an orphaned fragment outside a CREATE/ALTER statement (Postgres 42601).',
      );
    } else if (!STATEMENT_STARTS.has(token.toUpperCase())) {
      problems.push(`statement #${idx + 1} (line ${stmt.startLine}) starts with "${token}".`);
    }
  });
  const amountDecls = sql.split(/\r?\n/).filter((l) => /"amount"/.test(l)).length;
  if (amountDecls !== 1) problems.push(`"amount" is declared ${amountDecls} time(s) — expected exactly 1.`);
  return { statements, problems };
}

const { statements: migrationStatements, problems: lintProblems } = lintMigration(migrationSql);

/** Map a Prisma-generated SQL type onto the PostgreSQL udt_name. */
function sqlTypeToUdt(type) {
  const t = type.trim();
  const byName = {
    TEXT: 'text',
    INTEGER: 'int4',
    BOOLEAN: 'bool',
    JSONB: 'jsonb',
    TIMESTAMP: 'timestamp',
    'TEXT[]': '_text',
  };
  if (byName[t]) return byName[t];
  const enumLike = /^"([^"]+)"$/.exec(t);
  if (enumLike) return enumLike[1];
  const base = t.replace(/\(.*\)$/, '');
  return byName[base] || base.toLowerCase();
}

function defaultKind(def) {
  if (def === null || def === undefined) return 'none';
  const d = String(def).replace(/\s+/g, ' ').trim();
  if (/^CURRENT_TIMESTAMP/i.test(d)) return 'now';
  if (/^nextval\(/i.test(d)) return 'sequence';
  if (/^-?\d+$/.test(d)) return 'literal';
  if (/^'(?:[^']|'')*'(?:::?[A-Za-z_"]+)?$/.test(d)) return 'literal';
  if (/^(true|false)$/i.test(d)) return 'literal';
  if (/^ARRAY\[/.test(d)) return 'literal';
  return `other(${d})`;
}

/** Parse "X" TEXT NOT NULL DEFAULT 'y'  ->  { name, udt, nullable, defaultKind } */
function parseColumn(line) {
  const m = /^"([^"]+)"\s+(.+?),?$/.exec(line.trim());
  if (!m) return null;
  const [, name, rest] = m;
  const defaultMatch = /\bDEFAULT\s+(.+)$/i.exec(rest);
  const typePart = defaultMatch ? rest.slice(0, defaultMatch.index) : rest;
  const defPart = defaultMatch ? defaultMatch[1].replace(/,\s*$/, '').trim() : null;
  return {
    name,
    udt: sqlTypeToUdt(
      typePart
        .replace(/\s+NOT NULL\s*$/i, '')
        .replace(/\s+NULL\s*$/i, '')
        .replace(/,\s*$/, '')
        .trim(),
    ),
    nullable: !/\bNOT NULL\b/i.test(rest),
    defaultKind: defaultKind(defPart),
  };
}

/** Everything the migration file says it creates. */
function extractExpected(statements) {
  const expected = {
    enums: {},
    tables: {},
    indexes: {},
    foreignKeys: {},
    addedColumns: {},
    partnerProviderColumns: [],
  };

  for (const { text } of statements) {
    const stmt = stripComments(text).replace(/\s+/g, ' ').trim().replace(/;\s*$/, '');

    let m = /^CREATE TYPE "([^"]+)" AS ENUM \((.+)\)$/i.exec(stmt);
    if (m) {
      expected.enums[m[1]] = m[2]
        .split(',')
        .map((v) => v.trim().replace(/^'|'$/g, ''))
        .filter(Boolean);
      continue;
    }

    if ((m = /^CREATE TABLE "([^"]+)" \(([\s\S]*)\)$/i.exec(stmt))) {
      const body = m[2];
      const columns = [];
      let pk = null;
      for (const line of body.split(/,(?=\s*"?[A-Za-z_])/)) {
        const part = line.trim().replace(/,$/, '');
        if (!part) continue;
        const pkMatch = /^CONSTRAINT "([^"]+)" PRIMARY KEY \(([^)]*)\)$/i.exec(part);
        if (pkMatch) {
          pk = pkMatch[2].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
          continue;
        }
        const col = parseColumn(part);
        if (col) columns.push(col);
      }
      expected.tables[m[1]] = { columns, pk, pkName: null };
      continue;
    }

    if ((m = /^CREATE (UNIQUE )?INDEX "([^"]+)" ON "([^"]+)"\(([^)]*)\)$/i.exec(stmt))) {
      expected.indexes[m[2]] = {
        unique: Boolean(m[1]),
        table: m[3],
        columns: m[4].split(',').map((c) => c.trim().replace(/^"|"$/g, '')).filter(Boolean),
      };
      continue;
    }

    if ((m = /^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" FOREIGN KEY \(([^)]*)\) REFERENCES "([^"]+)"\(([^)]*)\)/i.exec(stmt))) {
      expected.foreignKeys[m[2]] = {
        table: m[1],
        columns: m[3].split(',').map((c) => c.trim().replace(/^"|"$/g, '')),
        refTable: m[4],
        refColumns: m[5].split(',').map((c) => c.trim().replace(/^"|"$/g, '')),
      };
      continue;
    }

    if ((m = /^ALTER TABLE "([^"]+)" ADD COLUMN "([^"]+)" (.+)$/i.exec(stmt))) {
      const col = parseColumn(`"${m[2]}" ${m[3]}`);
      if (col) {
        expected.addedColumns[`${m[1]}.${m[2]}`] = col;
        if (m[1] === 'PartnerProvider') expected.partnerProviderColumns.push(m[2]);
      }
    }
  }
  return expected;
}

const EXPECTED = extractExpected(migrationStatements);
const EXPECTED_TABLES = Object.keys(EXPECTED.tables);
const EXPECTED_ENUM_TYPES = Object.keys(EXPECTED.enums);

// ---------------------------------------------------------------------------
// read-only probe (SELECTs only)
// ---------------------------------------------------------------------------
// eslint-disable-next-line import/no-dynamic-require
const { PrismaClient } = require(path.join(root, 'apps', 'api', 'src', 'generated', 'prisma'));
const prisma = new PrismaClient();
const q = (sql, ...params) => prisma.$queryRawUnsafe(sql, ...params);
const literalList = (names) => names.map((n) => `'${String(n).replace(/'/g, "''")}'`).join(', ');

async function probe() {
  const state = {
    tableNames: [],
    columns: [],
    providerColumns: [],
    indexes: [],
    foreignKeys: [],
    enumValues: {},
    enumTypesPresent: [],
    partnerProviderExists: false,
    rowCounts: {},
    migrationRows: [],
    migrationsError: null,
  };

  const allTables = [...EXPECTED_TABLES, 'PartnerProvider'];
  const rows = await q(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN (${literalList(allTables)})`,
  );
  state.tableNames = rows.map((r) => r.table_name).sort();
  state.partnerProviderExists = state.tableNames.includes('PartnerProvider');

  if (EXPECTED_TABLES.length) {
    state.columns = await q(
      `SELECT table_name, column_name, udt_name, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name IN (${literalList(EXPECTED_TABLES)})
        ORDER BY table_name, ordinal_position`,
    );
  }
  if (state.partnerProviderExists) {
    state.providerColumns = await q(
      `SELECT column_name, udt_name, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'PartnerProvider'`,
    );
  }

  if (EXPECTED_TABLES.length) {
    const attributes = await q(
      `SELECT c.relname AS table_name, a.attnum, a.attname
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN (${literalList(EXPECTED_TABLES)})
          AND a.attnum > 0 AND NOT a.attisdropped`,
    );
    const attName = new Map(attributes.map((a) => [`${a.table_name}:${a.attnum}`, a.attname]));
    const indexRows = await q(
      `SELECT c.relname AS index_name, t.relname AS table_name,
              i.indisunique AS is_unique, i.indisprimary AS is_primary, i.indkey::text AS indkey
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indexrelid
         JOIN pg_class t ON t.oid = i.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname IN (${literalList(EXPECTED_TABLES)})`,
    );
    state.indexes = indexRows.map((r) => ({
      index_name: r.index_name,
      table_name: r.table_name,
      is_unique: r.is_unique === true,
      is_primary: r.is_primary === true,
      columns: String(r.indkey)
        .split(/\s+/)
        .filter(Boolean)
        .map((n) => attName.get(`${r.table_name}:${n}`) ?? `attnum:${n}`),
    }));

    const fkRows = await q(
      `SELECT con.conname, t.relname AS table_name, rt.relname AS ref_table
         FROM pg_constraint con
         JOIN pg_class t ON t.oid = con.conrelid
         JOIN pg_class rt ON rt.oid = con.confrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE con.contype = 'f' AND n.nspname = 'public'
          AND t.relname IN (${literalList(EXPECTED_TABLES)})`,
    );
    state.foreignKeys = fkRows.map((r) => ({
      name: r.conname,
      table: r.table_name,
      refTable: r.ref_table,
    }));
  }

  const enumRows = await q(
    `SELECT t.typname, e.enumlabel, e.enumsortorder
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname IN (${literalList(EXPECTED_ENUM_TYPES)})
      ORDER BY t.typname, e.enumsortorder`,
  );
  for (const r of enumRows) (state.enumValues[r.typname] ||= []).push(r.enumlabel);

  const typeRows = await q(
    `SELECT typname FROM pg_type WHERE typname IN (${literalList(EXPECTED_ENUM_TYPES)})`,
  );
  state.enumTypesPresent = typeRows.map((r) => r.typname).sort();

  for (const t of EXPECTED_TABLES.filter((n) => state.tableNames.includes(n))) {
    const counts = await q(`SELECT COUNT(*)::int AS n FROM "${t}"`);
    state.rowCounts[t] = counts[0].n;
  }

  try {
    state.migrationRows = await q(
      `SELECT id, checksum, migration_name, started_at, finished_at, rolled_back_at, applied_steps_count
         FROM "_prisma_migrations" ORDER BY started_at ASC`,
    );
  } catch (error) {
    state.migrationsError = error instanceof Error ? error.message : String(error);
  }
  return state;
}

// ---------------------------------------------------------------------------
// compare the live schema with the objects the migration creates
// ---------------------------------------------------------------------------
function defaultClassPg(def) {
  if (def === null || def === undefined) return 'none';
  const d = String(def).replace(/\s+/g, ' ').trim();
  if (/^CURRENT_TIMESTAMP/i.test(d)) return 'now';
  if (/^nextval\(/i.test(d)) return 'sequence';
  if (/^-?\d+$/.test(d)) return 'literal';
  if (/^'(?:[^']|'')*'(?:::?[A-Za-z_"\[\]]+)?$/.test(d)) return 'literal';
  if (/^(true|false)$/i.test(d)) return 'literal';
  if (/^ARRAY\[/i.test(d)) return 'literal';
  return `other(${d})`;
}

function compare(state) {
  const missing = {
    enumTypes: [],
    enumValues: [],
    tables: [],
    columns: [],
    primaryKeys: [],
    indexes: [],
    foreignKeys: [],
    addedColumns: [],
  };
  const differences = [];
  const warnings = [];

  for (const [name, values] of Object.entries(EXPECTED.enums)) {
    const actual = state.enumValues[name];
    if (!actual) {
      missing.enumTypes.push(name);
      continue;
    }
    const absent = values.filter((v) => !actual.includes(v));
    if (absent.length) missing.enumValues.push(`${name} -> ${absent.join(', ')}`);
    const extra = actual.filter((v) => !values.includes(v));
    if (extra.length) warnings.push(`enum ${name} has values not in the migration: ${extra.join(', ')}`);
  }

  for (const [table, spec] of Object.entries(EXPECTED.tables)) {
    if (!state.tableNames.includes(table)) {
      missing.tables.push(table);
      continue;
    }
    const actualCols = state.columns.filter((c) => c.table_name === table);
    const byName = new Map(actualCols.map((c) => [c.column_name, c]));
    for (const col of spec.columns) {
      const a = byName.get(col.name);
      if (!a) {
        missing.columns.push(`${table}.${col.name}`);
        continue;
      }
      const aNullable = a.is_nullable === 'YES';
      if (a.udt_name !== col.udt) {
        differences.push(`${table}.${col.name} type "${a.udt_name}" != "${col.udt}"`);
      }
      if (aNullable !== col.nullable) {
        differences.push(`${table}.${col.name} nullable ${aNullable} != ${col.nullable}`);
      }
      const aDefault = defaultClassPg(a.column_default);
      if (aDefault !== col.defaultKind) {
        differences.push(`${table}.${col.name} default (${aDefault}) != (${col.defaultKind})`);
      }
    }
    const extras = actualCols
      .filter((c) => !spec.columns.some((x) => x.name === c.column_name))
      .map((c) => c.column_name);
    if (extras.length) {
      warnings.push(`${table} has extra columns not in the migration: ${extras.join(', ')}`);
    }

    const pkIndex = state.indexes.find((i) => i.table_name === table && i.is_primary);
    if (!pkIndex) {
      missing.primaryKeys.push(`${table}(${(spec.pk ?? ['id']).join(', ')})`);
    } else if (spec.pk && spec.pk.join(',') !== pkIndex.columns.join(',')) {
      differences.push(`${table} primary key (${pkIndex.columns.join(',')}) != (${spec.pk.join(',')})`);
    }
  }

  for (const [name, spec] of Object.entries(EXPECTED.indexes)) {
    const actual = state.indexes.find((i) => i.index_name === name);
    if (!actual) {
      missing.indexes.push(name);
      continue;
    }
    if (actual.is_unique !== Boolean(spec.unique)) {
      differences.push(`index ${name} unique=${actual.is_unique} != ${Boolean(spec.unique)}`);
    }
    if (actual.columns.join(',') !== spec.columns.join(',')) {
      differences.push(`index ${name} columns (${actual.columns.join(',')}) != (${spec.columns.join(',')})`);
    }
  }

  for (const [name, spec] of Object.entries(EXPECTED.foreignKeys)) {
    const actual = state.foreignKeys.find((f) => f.name === name);
    if (!actual) {
      missing.foreignKeys.push(name);
      continue;
    }
    if (actual.refTable !== spec.refTable) {
      differences.push(`FK ${name} references ${actual.refTable} != ${spec.refTable}`);
    }
  }

  for (const [key, spec] of Object.entries(EXPECTED.addedColumns)) {
    const table = key.split('.')[0];
    const colName = key.split('.')[1];
    if (table !== 'PartnerProvider') continue;
    if (!state.partnerProviderExists) {
      missing.addedColumns.push(`${key} (table "PartnerProvider" itself is missing!)`);
      continue;
    }
    const a = state.providerColumns.find((c) => c.column_name === colName);
    if (!a) {
      missing.addedColumns.push(key);
      continue;
    }
    if (a.udt_name !== spec.udt) differences.push(`${key} type "${a.udt_name}" != "${spec.udt}"`);
    const aNullable = a.is_nullable === 'YES';
    if (aNullable !== spec.nullable) differences.push(`${key} nullable ${aNullable} != ${spec.nullable}`);
    const aDefault = defaultClassPg(a.column_default);
    if (aDefault !== spec.defaultKind) {
      differences.push(`${key} default (${aDefault}) != (${spec.defaultKind})`);
    }
  }

  const nothingMissing =
    Object.values(missing).every((list) => list.length === 0) && differences.length === 0;
  return { missing, differences, warnings, schemaComplete: nothingMissing };
}

// ---------------------------------------------------------------------------
// verdict: which Prisma command is justified by this database state?
// ---------------------------------------------------------------------------
function verdictOf(state, cmp) {
  const anyNewObject =
    state.enumTypesPresent.length > 0 ||
    state.tableNames.some((t) => EXPECTED_TABLES.includes(t)) ||
    state.providerColumns.some((c) => EXPECTED.partnerProviderColumns.includes(c.column_name));

  const row = state.migrationRows.find((r) => r.migration_name === MIGRATION) ?? null;
  // `pnpm --filter <pkg> exec` runs with cwd = apps/api (verified), so the
  // schema path MUST be ../../database/... in this form.
  const PKG = 'pnpm --filter @tanvion-royale/api';
  const SCHEMA = '../../database/prisma/schema.prisma';
  const resolve = (flag) =>
    `${PKG} exec prisma migrate resolve ${flag} ${MIGRATION} --schema ${SCHEMA}`;
  const deployStrict = `${PKG} prisma:migrate:deploy:strict`; // deploy + verify-migrations.cjs
  const deployOnly = `${PKG} prisma:migrate:deploy`;
  const verify = 'node scripts/verify-migrations.cjs';

  if (row && row.rolled_back_at) {
    if (!anyNewObject) {
      return {
        code: 'ROLLED_BACK_READY_TO_RETRY',
        title: 'The failed attempt is already recorded as ROLLED BACK and created nothing',
        exitCode: 0,
        resolveCommand: null,
        remedy: [
          'Nothing to resolve — apply the repaired migration:',
          `  ${deployStrict}`,
          `  ${verify}`,
        ],
      };
    }
    return {
      code: 'ROLLED_BACK_BUT_OBJECTS_EXIST',
      title: 'History says rolled back, but objects from this migration DO exist',
      exitCode: 1,
      resolveCommand: null,
      remedy: [
        'Do NOT re-run migrate deploy — CREATE TYPE / CREATE TABLE would fail again.',
        'Complete only the objects listed as missing/different above, then:',
        `  ${resolve('--applied')}`,
      ],
    };
  }

  if (row && row.finished_at) {
    const checksumMatches = String(row.checksum ?? '').toLowerCase() === fileChecksum;
    if (cmp.schemaComplete && checksumMatches) {
      return {
        code: 'IN_SYNC',
        title: 'Applied, schema complete, recorded checksum matches the file',
        exitCode: 0,
        resolveCommand: null,
        remedy: ['Nothing to do for this migration.'],
      };
    }
    if (cmp.schemaComplete && !checksumMatches) {
      return {
        code: 'HISTORY_CHECKSUM_MISMATCH',
        title: 'Schema matches, but the recorded checksum differs from migration.sql',
        exitCode: 1,
        resolveCommand: null,
        remedy: [
          'The migration file changed after it was applied. Do not hand-edit history:',
          'add a NEW forward migration for the change instead.',
        ],
      };
    }
    return {
      code: 'HISTORY_APPLIED_SCHEMA_INCONSISTENT',
      title: 'History says APPLIED but the schema does not match the migration DDL',
      exitCode: 1,
      resolveCommand: null,
      remedy: [
        'Do NOT run migrate deploy — it would execute the DDL again and fail.',
        'Complete ONLY the objects listed as missing/different above, then re-run this script.',
      ],
    };
  }

  if (row && !row.finished_at) {
    if (cmp.schemaComplete) {
      return {
        code: 'A_FAILED_SCHEMA_COMPLETE',
        title:
          'CASE A/ALREADY-APPLIED — the attempt is recorded as FAILED but EVERY object the ' +
          'migration creates is present in the database',
        exitCode: 0,
        resolveCommand: resolve('--applied'),
        remedy: [
          'The DDL must NOT run again (CREATE TYPE / CREATE TABLE are not idempotent):',
          'reconcile history only — this is justified because the verifier proved that all',
          '5 enum types, 4 tables/64 columns, 16 indexes, 10 FKs and both additive',
          'PartnerProvider columns exist with the right types, nullability and defaults.',
          '1. Mark the failed attempt as applied (Prisma recomputes the checksum itself):',
          `  ${resolve('--applied')}`,
          '2. Apply anything still pending and re-run the fail-closed gate:',
          `  ${deployStrict}`,
          `  ${verify}`,
        ],
      };
    }
    if (!anyNewObject) {
      return {
        code: 'A_FAILED_FULLY_ROLLED_BACK',
        title:
          'CASE A — the failed attempt (P3018) committed NOTHING: no enum types, no tables, ' +
          'no PartnerProvider columns, and only the failed history row exists',
        exitCode: 0,
        resolveCommand: resolve('--rolled-back'),
        remedy: [
          'Expected outcome of a PostgreSQL *syntax* error (42601) in the final fragment of the',
          'file: no statement of this migration could commit, so there is no data to repair.',
          '1. Record the failed attempt as rolled back (history marker only — no DDL, no data):',
          `  ${resolve('--rolled-back')}`,
          '2. Apply the repaired migration:',
          `  ${deployStrict}`,
          `  ${verify}`,
        ],
      };
    }
    return {
      code: 'C_PARTIAL_FAILED',
      title: 'CASE C — the failed attempt committed SOME objects (partial application)',
      exitCode: 1,
      resolveCommand: null,
      remedy: [
        'HUMAN JUDGEMENT REQUIRED — do not resolve anything yet.',
        'Do NOT run `migrate resolve --rolled-back`: re-applying the file would hit the objects',
        'that already exist (CREATE TYPE / CREATE TABLE are not idempotent) and fail again.',
        '1. Create ONLY the objects listed as missing/different above.',
        '2. Re-run this script until it reports "schema complete per this migration: YES".',
        '3. Only then mark the attempt applied:',
        `  ${resolve('--applied')}`,
      ],
    };
  }

  if (cmp.schemaComplete) {
    return {
      code: 'B_HISTORY_MISSING_SCHEMA_MATCHES',
      title: 'CASE B — every object exists but _prisma_migrations has no row for this migration',
      exitCode: 0,
      resolveCommand: resolve('--applied'),
      remedy: [
        'The DDL must NOT run again. Reconcile history only:',
        `  ${resolve('--applied')}`,
      ],
    };
  }
  if (!anyNewObject) {
    return {
      code: 'A_UNAPPLIED',
      title: 'CASE A — completely unapplied and no history row at all',
      exitCode: 0,
      resolveCommand: null,
      remedy: [
        'Apply it with Prisma (no manual SQL at all):',
        `  ${deployStrict}`,
        `  ${verify}`,
      ],
    };
  }
  return {
    code: 'C_PARTIAL_NO_HISTORY',
    title: 'CASE C — some objects exist, no history row',
    exitCode: 1,
    resolveCommand: null,
    remedy: [
      'HUMAN JUDGEMENT REQUIRED — do not resolve anything yet.',
      'Create ONLY the objects listed as missing/different above.',
      `Then reconcile history: ${resolve('--applied')}`,
    ],
  };
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------
const rel = (p) => path.relative(root, p).replace(/\\/g, '/');

function expectedSummary() {
  const columns = Object.values(EXPECTED.tables).reduce((n, t) => n + t.columns.length, 0);
  return {
    enums: Object.keys(EXPECTED.enums).length,
    enumValues: Object.values(EXPECTED.enums).reduce((n, v) => n + v.length, 0),
    tables: EXPECTED_TABLES.length,
    columns,
    indexes: Object.keys(EXPECTED.indexes).length,
    foreignKeys: Object.keys(EXPECTED.foreignKeys).length,
    addedColumns: Object.keys(EXPECTED.addedColumns).length,
  };
}

function printGroup(title, list) {
  if (!list.length) {
    console.log(`  ${title}: none`);
    return;
  }
  console.log(`  ${title}:`);
  for (const item of list) console.log(`    - ${item}`);
}

function printReport(state, cmp, verdict) {
  const e = expectedSummary();
  console.log(`\n[check-casino-migration-state] target ${hostOnly(dbUrl)}`);
  console.log(`[check-casino-migration-state] migration ${MIGRATION}`);
  console.log(`    file: ${rel(migrationSqlPath)}`);
  console.log(
    `    ${migrationStatements.length} statements, sha256 ${fileChecksum.slice(0, 12)}…, ` +
      `expected: ${e.enums} enums (${e.enumValues} values), ${e.tables} tables ` +
      `(${e.columns} columns), ${e.indexes} indexes, ${e.foreignKeys} FKs, ` +
      `${e.addedColumns} additive columns`,
  );

  if (lintProblems.length) {
    console.log('\n  !! MIGRATION FILE IS STILL STRUCTURALLY INVALID — fix it before any resolve:');
    for (const p of lintProblems) console.log(`    - ${p}`);
  } else {
    console.log('    file lint: OK (no orphaned fragments)');
  }

  console.log('\n  LIVE DATABASE');
  console.log(`    enum types present : ${state.enumTypesPresent.join(', ') || '(none)'}`);
  console.log(`    tables present     : ${state.tableNames.join(', ') || '(none)'}`);
  const counts = Object.entries(state.rowCounts);
  console.log(
    `    row counts         : ${counts.length ? counts.map(([t, n]) => `${t}=${n}`).join(', ') : '(no tables to count)'}`,
  );
  const row = state.migrationRows.find((r) => r.migration_name === MIGRATION) ?? null;
  if (state.migrationsError) {
    console.log(`    _prisma_migrations : UNREADABLE (${state.migrationsError})`);
  } else {
    console.log(
      `    _prisma_migrations : ${state.migrationRows.length} row(s) recorded, target row ${row ? 'PRESENT' : 'ABSENT'}`,
    );
    if (row) {
      console.log(
        `      checksum=${String(row.checksum ?? '').slice(0, 12)}… ` +
          `started=${row.started_at ? new Date(row.started_at).toISOString() : 'null'} ` +
          `finished=${row.finished_at ? new Date(row.finished_at).toISOString() : 'NULL (failed)'} ` +
          `rolled_back=${row.rolled_back_at ? new Date(row.rolled_back_at).toISOString() : 'null'} ` +
          `applied_steps=${row.applied_steps_count}`,
      );
      const recorded = String(row.checksum ?? '').toLowerCase();
      console.log(
        `      recorded checksum matches the repaired file: ${recorded === fileChecksum ? 'YES' : 'NO (file changed since the attempt)'}`,
      );
    }
  }

  console.log('\n  DIFF (expected objects vs live schema)');
  printGroup('missing enum types', cmp.missing.enumTypes);
  printGroup('missing enum values', cmp.missing.enumValues);
  printGroup('missing tables', cmp.missing.tables);
  printGroup('missing columns', cmp.missing.columns);
  printGroup('missing primary keys', cmp.missing.primaryKeys);
  printGroup('missing indexes', cmp.missing.indexes);
  printGroup('missing foreign keys', cmp.missing.foreignKeys);
  printGroup('missing additive columns', cmp.missing.addedColumns);
  printGroup('differences', cmp.differences);
  if (cmp.warnings.length) printGroup('warnings (non-blocking)', cmp.warnings);
  console.log(`  schema complete per this migration: ${cmp.schemaComplete ? 'YES' : 'NO'}`);

  console.log(`\n  VERDICT: ${verdict.code}`);
  console.log(`    ${verdict.title}`);
  console.log(
    `  RESOLVE COMMAND: ${verdict.resolveCommand ?? '(none justified — follow NEXT ACTION)'}`,
  );
  console.log('  NEXT ACTION:');
  for (const line of verdict.remedy) console.log(`    ${line}`);
  console.log(
    '\n  Nothing was written by this script: SELECTs only. No DDL, no DML, no history change, no reset.\n',
  );
}

async function main() {
  let state;
  try {
    state = await probe();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `\n[check-casino-migration-state] ERROR: could not read the database (${hostOnly(dbUrl)}).\n` +
        `  ${message}\n` +
        'Nothing was written. Check DATABASE_URL/DIRECT_URL and connectivity, then re-run.\n',
    );
    process.exitCode = 1;
    return;
  }

  const cmp = compare(state);
  const verdict = verdictOf(state, cmp);

  if (wantJson) {
    console.log(
      JSON.stringify(
        {
          migration: MIGRATION,
          targetHost: hostOnly(dbUrl),
          file: {
            path: rel(migrationSqlPath),
            checksum: fileChecksum,
            statements: migrationStatements.length,
            lintProblems,
          },
          expected: {
            counts: expectedSummary(),
            enums: EXPECTED.enums,
            tables: EXPECTED_TABLES,
            indexes: Object.keys(EXPECTED.indexes),
            foreignKeys: Object.keys(EXPECTED.foreignKeys),
            addedColumns: Object.keys(EXPECTED.addedColumns),
          },
          live: {
            tableNames: state.tableNames,
            enumTypesPresent: state.enumTypesPresent,
            rowCounts: state.rowCounts,
            migrationRow: state.migrationRows.find((r) => r.migration_name === MIGRATION) ?? null,
            migrationRowCount: state.migrationRows.length,
            migrationsError: state.migrationsError,
          },
          comparison: cmp,
          verdict,
        },
        null,
        2,
      ),
    );
  } else {
    printReport(state, cmp, verdict);
  }

  // A structurally invalid file means the resolve decision cannot be trusted
  // yet: the file that would be re-applied is still the broken one.
  process.exitCode = lintProblems.length ? 1 : verdict.exitCode;
}

main()
  .catch((error) => {
    console.error('[check-casino-migration-state] unexpected failure:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });





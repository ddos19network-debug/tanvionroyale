'use strict';
/**
 * Scratch harness (NOT part of the app, mirrors .tmp-auth-retry/):
 * drives scripts/check-casino-migration-state.cjs against FAKE pg catalogs so
 * every verdict (failed / rolled back / applied / partial / missing history),
 * the read-only guarantee and the migration-file parser are verified without
 * touching a real database.
 *
 * It also asserts that the migration file the verifier parses really contains
 * the objects the incident was about (5 enums, 4 tables / 64 columns,
 * 16 indexes, 10 foreign keys, 2 additive "PartnerProvider" columns).
 *
 * Run: node .tmp-migration-harness/casino-state-test.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const Module = require('node:module');
const crypto = require('node:crypto');

const repoRoot = path.join(__dirname, '..');
const scriptPath = path.join(repoRoot, 'scripts', 'check-casino-migration-state.cjs');
const MIGRATION = '20260917000000_add_casino_provider_catalog';
const migrationPath = path.join(
  repoRoot, 'database', 'prisma', 'migrations', MIGRATION, 'migration.sql',
);
const fileChecksum = crypto.createHash('sha256').update(fs.readFileSync(migrationPath)).digest('hex');
const migrationSql = fs.readFileSync(migrationPath, 'utf8');

// ---------------------------------------------------------------------------
// INDEPENDENT (line based) parser of the migration file -> fake DB fixture.
// Deliberately NOT the tokenizer used by the verifier, so the two agree only
// if both are correct.
// ---------------------------------------------------------------------------
function udtOf(type) {
  const t = type.trim();
  if (t === 'TEXT') return 'text';
  if (t === 'INTEGER') return 'int4';
  if (t === 'BOOLEAN') return 'bool';
  if (t === 'JSONB') return 'jsonb';
  if (/^TIMESTAMP/.test(t)) return 'timestamp';
  if (t === 'TEXT[]') return '_text';
  const q = /^"([^"]+)"$/.exec(t);
  return q ? q[1] : t.toLowerCase();
}

function pgDefault(sqlDefault, udt) {
  if (!sqlDefault) return null;
  const d = sqlDefault.trim();
  if (/^CURRENT_TIMESTAMP$/i.test(d)) return 'CURRENT_TIMESTAMP';
  if (/^ARRAY\[/.test(d)) return 'ARRAY[]::text[]';
  if (/^'/i.test(d)) return `${d}::"${udt}"`;
  return d;
}

function parseColLine(name, rest) {
  const defaultMatch = /\bDEFAULT\s+(.+)$/i.exec(rest);
  const typePart = (defaultMatch ? rest.slice(0, defaultMatch.index) : rest)
    .replace(/\s+NOT NULL\s*$/i, '')
    .replace(/,\s*$/, '')
    .trim();
  const udt = udtOf(typePart);
  return {
    name,
    udt,
    nullable: !/\bNOT NULL\b/i.test(rest),
    pgDefault: pgDefault(defaultMatch ? defaultMatch[1].replace(/,\s*$/, '') : null, udt),
  };
}

function parseMigrationLines(sql) {
  const lines = sql.split(/\r?\n/);
  const out = { enums: {}, tables: {}, indexes: {}, fks: {}, addedColumns: {} };
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    let m;
    if ((m = /^CREATE TYPE "([^"]+)" AS ENUM \((.*)\);\s*$/.exec(l))) {
      out.enums[m[1]] = m[2].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
      continue;
    }
    if ((m = /^CREATE TABLE "([^"]+)" \(\s*$/.exec(l))) {
      const columns = [];
      let pk = [];
      for (i += 1; i < lines.length; i += 1) {
        const b = lines[i];
        if (/^\);\s*$/.test(b)) break;
        const pkM = /^\s*CONSTRAINT "[^"]+" PRIMARY KEY \(([^)]*)\)\s*$/.exec(b);
        if (pkM) {
          pk = pkM[1].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
          continue;
        }
        const cM = /^\s*"([^"]+)"\s+(.+?),?\s*$/.exec(b);
        if (cM) columns.push(parseColLine(cM[1], cM[2]));
      }
      out.tables[m[1]] = { columns, pk };
      continue;
    }
    if ((m = /^CREATE (UNIQUE )?INDEX "([^"]+)" ON "([^"]+)"\((.*)\);\s*$/.exec(l))) {
      out.indexes[m[2]] = {
        unique: Boolean(m[1]),
        table: m[3],
        columns: m[4].split(',').map((c) => c.trim().replace(/^"|"$/g, '')),
      };
      continue;
    }
    if ((m = /^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" FOREIGN KEY \([^)]*\) REFERENCES "([^"]+)"/.exec(l))) {
      out.fks[m[2]] = { table: m[1], refTable: m[3] };
      continue;
    }
    if ((m = /^ALTER TABLE "(\w+)" ADD COLUMN "([^"]+)" (.+);\s*$/.exec(l))) {
      out.addedColumns[`${m[1]}.${m[2]}`] = parseColLine(m[2], m[3]);
    }
  }
  return out;
}

const PARSED = parseMigrationLines(migrationSql);

// ---------------------------------------------------------------------------
// fake database + dispatcher
// ---------------------------------------------------------------------------
function emptyDb() {
  return {
    enums: {},
    tables: {},
    providerColumns: [],
    indexes: [],
    fks: [],
    rowCounts: {},
    migrations: [],
    partnerProvider: true,
  };
}

function fullDb() {
  const db = emptyDb();
  db.enums = JSON.parse(JSON.stringify(PARSED.enums));
  for (const [name, spec] of Object.entries(PARSED.tables)) {
    db.tables[name] = { columns: JSON.parse(JSON.stringify(spec.columns)), pk: spec.pk.slice() };
    db.rowCounts[name] = 0;
  }
  db.indexes = Object.entries(PARSED.indexes).map(([name, spec]) => ({ name, ...spec }));
  db.fks = Object.entries(PARSED.fks).map(([name, spec]) => ({ name, ...spec }));
  db.providerColumns = [
    { name: 'id', udt: 'text', nullable: false, pgDefault: null },
    { name: 'name', udt: 'text', nullable: false, pgDefault: null },
    ...Object.entries(PARSED.addedColumns)
      .filter(([k]) => k.startsWith('PartnerProvider.'))
      .map(([, col]) => ({ ...col })),
  ];
  return db;
}

let currentDb = emptyDb();
let capturedSql = [];

function dispatch(sql) {
  capturedSql.push(sql);
  const db = currentDb;
  if (/FROM information_schema\.tables/.test(sql)) {
    const names = Object.keys(db.tables);
    if (db.partnerProvider) names.push('PartnerProvider');
    return names.map((table_name) => ({ table_name }));
  }
  if (/FROM information_schema\.columns/.test(sql) && /table_name = 'PartnerProvider'/.test(sql)) {
    return db.providerColumns.map((c) => ({
      column_name: c.name,
      udt_name: c.udt,
      is_nullable: c.nullable ? 'YES' : 'NO',
      column_default: c.pgDefault,
    }));
  }
  if (/FROM information_schema\.columns/.test(sql)) {
    const rows = [];
    for (const [table, spec] of Object.entries(db.tables)) {
      for (const c of spec.columns) {
        rows.push({
          table_name: table,
          column_name: c.name,
          udt_name: c.udt,
          is_nullable: c.nullable ? 'YES' : 'NO',
          column_default: c.pgDefault,
        });
      }
    }
    return rows;
  }
  if (/FROM pg_attribute/.test(sql)) {
    const rows = [];
    for (const [table, spec] of Object.entries(db.tables)) {
      spec.columns.forEach((c, idx) =>
        rows.push({ table_name: table, attnum: idx + 1, attname: c.name }),
      );
    }
    return rows;
  }
  if (/FROM pg_index/.test(sql)) {
    const rows = [];
    for (const [table, spec] of Object.entries(db.tables)) {
      const attnum = new Map(spec.columns.map((c, idx) => [c.name, idx + 1]));
      rows.push({
        index_name: `${table}_pkey`,
        table_name: table,
        is_unique: true,
        is_primary: true,
        indkey: spec.pk.map((c) => attnum.get(c) ?? 1).join(' '),
      });
    }
    for (const ix of db.indexes) {
      const spec = db.tables[ix.table];
      if (!spec) continue;
      const attnum = new Map(spec.columns.map((c, idx) => [c.name, idx + 1]));
      rows.push({
        index_name: ix.name,
        table_name: ix.table,
        is_unique: ix.unique,
        is_primary: false,
        indkey: ix.columns.map((c) => attnum.get(c) ?? 0).join(' '),
      });
    }
    return rows;
  }
  if (/FROM pg_constraint/.test(sql)) {
    return db.fks.map((f) => ({ conname: f.name, table_name: f.table, ref_table: f.refTable }));
  }
  if (/JOIN pg_enum/.test(sql)) {
    const rows = [];
    for (const [typname, labels] of Object.entries(db.enums)) {
      labels.forEach((enumlabel, i) => rows.push({ typname, enumlabel, enumsortorder: i + 1 }));
    }
    return rows;
  }
  if (/SELECT typname FROM pg_type/.test(sql)) {
    return Object.keys(db.enums).map((typname) => ({ typname }));
  }
  if (/SELECT COUNT\(\*\)::int AS n/.test(sql)) {
    const t = /FROM "([^"]+)"/.exec(sql)[1];
    return [{ n: db.rowCounts[t] ?? 0 }];
  }
  if (/FROM "_prisma_migrations"/.test(sql)) return db.migrations;
  throw new Error(`fake database does not understand this query: ${sql.slice(0, 90)}`);
}

// `process.exitCode` is a normal (non-configurable) property on modern Node, so
// scenarios simply reset it before running and read it afterwards.
async function runScript(db, args = []) {
  currentDb = db;
  capturedSql = [];
  process.exitCode = 0;
  const out = [];
  const err = [];
  const origLog = console.log;
  const origErr = console.error;
  const origLoad = Module._load;
  const origArgv = process.argv;
  const origEnv = { DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL };
  process.env.DATABASE_URL = 'postgresql://u:p@fake-host.neon.tech/neondb';
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.argv = [process.argv[0], scriptPath, ...args];
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));

  class FakePrismaClient {
    async $queryRawUnsafe(sql) {
      return dispatch(sql);
    }
    async $disconnect() {}
  }
  Module._load = function patched(request, parent, isMain) {
    if (String(request).replace(/\\/g, '/').endsWith('apps/api/src/generated/prisma')) {
      return { PrismaClient: FakePrismaClient };
    }
    return origLoad.call(this, request, parent, isMain);
  };

  delete require.cache[require.resolve(scriptPath)];
  let thrown = null;
  try {
    require(scriptPath);
  } catch (error) {
    thrown = error;
  }
  // main() is async: one macrotask boundary is enough to let the whole
  // await chain (fake queries + report printing) finish before we read state.
  await new Promise((resolve) => setImmediate(resolve));
  Module._load = origLoad;
  console.log = origLog;
  console.error = origErr;
  process.argv = origArgv;
  if (origEnv.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = origEnv.DATABASE_URL;
  if (origEnv.DIRECT_URL === undefined) delete process.env.DIRECT_URL;
  else process.env.DIRECT_URL = origEnv.DIRECT_URL;

  return {
    stdout: out.join('\n'),
    stderr: err.join('\n'),
    exitCode: process.exitCode,
    thrown,
    sql: capturedSql,
  };
}

function migrationRow(overrides = {}) {
  return {
    id: 'row-1',
    checksum: fileChecksum,
    migration_name: MIGRATION,
    started_at: new Date('2026-09-17T10:00:00Z'),
    finished_at: null,
    rolled_back_at: null,
    applied_steps_count: 0,
    ...overrides,
  };
}

function otherRow(name, startedAt) {
  return {
    id: `row-${name}`,
    checksum: 'x'.repeat(64),
    migration_name: name,
    started_at: new Date(startedAt),
    finished_at: new Date(startedAt),
    rolled_back_at: null,
    applied_steps_count: 1,
  };
}

// ---------------------------------------------------------------------------
// scenarios
// ---------------------------------------------------------------------------
const results = [];
let runnerExit = 0;
const tasks = [];
/** Scenarios run sequentially (they share the fake-database globals). */
const check = (label, fn) => {
  tasks.push({ label, fn });
};

check('migration file parses to 5 enums / 4 tables / 64 columns / 16 indexes / 10 FKs / 2 added columns', async () => {
  assert.strictEqual(Object.keys(PARSED.enums).length, 5, 'enum count');
  assert.strictEqual(Object.keys(PARSED.tables).length, 4, 'table count');
  const columns = Object.values(PARSED.tables).reduce((n, t) => n + t.columns.length, 0);
  assert.strictEqual(columns, 64, 'column count');
  assert.strictEqual(Object.keys(PARSED.indexes).length, 16, 'index count');
  assert.strictEqual(Object.keys(PARSED.fks).length, 10, 'fk count');
  assert.strictEqual(Object.keys(PARSED.addedColumns).length, 2, 'added column count');
});

check('CASE A (production expectation): failed row + nothing committed -> resolve --rolled-back, exit 0', async () => {
  const db = emptyDb();
  db.migrations = [otherRow('20260916000000_add_crash_sequence_admin', '2026-09-16T09:00:00Z'), migrationRow()];
  const r = await runScript(db);
  assert.strictEqual(r.thrown, null, `script threw: ${r.thrown}`);
  assert.match(r.stdout, /VERDICT: A_FAILED_FULLY_ROLLED_BACK/, 'verdict');
  assert.match(r.stdout, /resolve --rolled-back 20260917000000_add_casino_provider_catalog/, 'rolled-back advice');
  assert.match(r.stdout, /--schema \.\.\/\.\.\/database\/prisma\/schema\.prisma/, 'schema path is package-relative');
  assert.match(r.stdout, /file lint: OK/, 'lint OK on the repaired file');
  assert.strictEqual(r.exitCode, 0, 'exit code');
});

check('failed row but schema COMPLETE -> resolve --applied (never --rolled-back), exit 0', async () => {
  const db = fullDb();
  db.migrations = [migrationRow()]; // finished_at NULL = failed attempt, DDL did commit
  const r = await runScript(db, ['--json']);
  const parsed = JSON.parse(r.stdout);
  assert.strictEqual(parsed.verdict.code, 'A_FAILED_SCHEMA_COMPLETE', 'verdict');
  assert.match(parsed.verdict.resolveCommand, /migrate resolve --applied 20260917000000_add_casino_provider_catalog/, 'applied command');
  assert.match(parsed.verdict.resolveCommand, /--schema \.\.\/\.\.\/database\/prisma\/schema\.prisma/, 'schema path');
  assert.doesNotMatch(parsed.verdict.resolveCommand, /--rolled-back/, 'must not roll back a committed schema');
  assert.strictEqual(r.exitCode, 0, 'exit code');
});

check('--json exposes the exact resolve command for the CASE A production path', async () => {
  const db = emptyDb();
  db.migrations = [migrationRow()];
  const r = await runScript(db, ['--json']);
  const parsed = JSON.parse(r.stdout);
  assert.strictEqual(
    parsed.verdict.resolveCommand,
    'pnpm --filter @tanvion-royale/api exec prisma migrate resolve --rolled-back ' +
      '20260917000000_add_casino_provider_catalog --schema ../../database/prisma/schema.prisma',
    'exact resolve command',
  );
});

check('fully applied + checksum match -> IN_SYNC, exit 0', async () => {
  const db = fullDb();
  db.migrations = [migrationRow({ finished_at: new Date('2026-09-17T10:05:00Z'), applied_steps_count: 37 })];
  const r = await runScript(db);
  assert.strictEqual(r.thrown, null, `script threw: ${r.thrown}`);
  assert.match(r.stdout, /VERDICT: IN_SYNC/, 'verdict');
  assert.match(r.stdout, /schema complete per this migration: YES/, 'schema complete');
  assert.strictEqual(r.exitCode, 0, 'exit code');
});

check('partial application + failed row -> C_PARTIAL_FAILED, refuses --rolled-back, exit 1', async () => {
  const db = fullDb();
  const tx = db.tables.CasinoTransaction;
  tx.columns = tx.columns.filter((c) => c.name !== 'nonce');
  tx.columns.find((c) => c.name === 'amount').udt = 'text'; // deliberately wrong
  db.indexes = db.indexes.filter((i) => i.name !== 'CasinoGame_slug_idx');
  db.fks = db.fks.filter((f) => f.name !== 'CasinoTransaction_walletTransactionId_fkey');
  db.enums.CasinoTransactionStatus = ['APPLIED'];
  db.providerColumns = db.providerColumns.filter((c) => c.name !== 'productTypes');
  db.migrations = [migrationRow()];
  const r = await runScript(db);
  assert.strictEqual(r.thrown, null, `script threw: ${r.thrown}`);
  assert.match(r.stdout, /VERDICT: C_PARTIAL_FAILED/, 'verdict');
  assert.match(r.stdout, /- CasinoTransaction\.nonce/, 'missing column reported');
  assert.match(r.stdout, /CasinoGame_slug_idx/, 'missing index reported');
  assert.match(r.stdout, /CasinoTransaction_walletTransactionId_fkey/, 'missing FK reported');
  assert.match(r.stdout, /CasinoTransactionStatus -> REVERSED/, 'missing enum value reported');
  assert.match(r.stdout, /PartnerProvider\.productTypes/, 'missing additive column reported');
  assert.match(r.stdout, /CasinoTransaction\.amount type "text" != "int4"/, 'type mismatch reported');
  assert.match(r.stdout, /migrate resolve --rolled-back/, 'mentions the forbidden command explicitly');
  assert.strictEqual(r.exitCode, 1, 'exit code');
});

check('schema complete but no history row -> CASE B with resolve --applied, exit 0', async () => {
  const db = fullDb();
  db.migrations = [otherRow('20260916000000_add_crash_sequence_admin', '2026-09-16T09:00:00Z')];
  const r = await runScript(db);
  assert.strictEqual(r.thrown, null, `script threw: ${r.thrown}`);
  assert.match(r.stdout, /VERDICT: B_HISTORY_MISSING_SCHEMA_MATCHES/, 'verdict');
  assert.match(r.stdout, /resolve --applied 20260917000000_add_casino_provider_catalog/, 'applied advice');
  assert.strictEqual(r.exitCode, 0, 'exit code');
});

check('already rolled back + nothing committed -> retry deploy only, exit 0', async () => {
  const db = emptyDb();
  db.migrations = [migrationRow({ rolled_back_at: new Date('2026-09-17T11:00:00Z') })];
  const r = await runScript(db);
  assert.strictEqual(r.thrown, null, `script threw: ${r.thrown}`);
  assert.match(r.stdout, /VERDICT: ROLLED_BACK_READY_TO_RETRY/, 'verdict');
  assert.match(r.stdout, /pnpm --filter @tanvion-royale\/api prisma:migrate:deploy:strict/, 'deploy advice');
  assert.strictEqual(r.exitCode, 0, 'exit code');
});

check('nothing at all -> CASE A_UNAPPLIED, exit 0', async () => {
  const db = emptyDb();
  const r = await runScript(db);
  assert.strictEqual(r.thrown, null, `script threw: ${r.thrown}`);
  assert.match(r.stdout, /VERDICT: A_UNAPPLIED/, 'verdict');
  assert.strictEqual(r.exitCode, 0, 'exit code');
});

check('history says applied but schema is incomplete -> exit 1', async () => {
  const db = fullDb();
  delete db.tables.CasinoSession;
  db.migrations = [migrationRow({ finished_at: new Date('2026-09-17T10:05:00Z') })];
  const r = await runScript(db);
  assert.strictEqual(r.thrown, null, `script threw: ${r.thrown}`);
  assert.match(r.stdout, /VERDICT: HISTORY_APPLIED_SCHEMA_INCONSISTENT/, 'verdict');
  assert.match(r.stdout, /- CasinoSession/, 'missing table reported');
  assert.strictEqual(r.exitCode, 1, 'exit code');
});

check('read-only guarantee: every statement issued against the database is a SELECT', async () => {
  const db = fullDb();
  db.migrations = [migrationRow()];
  const r = await runScript(db);
  assert.ok(r.sql.length >= 5, `expected several queries, got ${r.sql.length}`);
  for (const sql of r.sql) {
    assert.match(sql.trim(), /^SELECT /i, `non-SELECT statement issued: ${sql.slice(0, 80)}`);
  }
});

check('--json emits the same verdict machine-readably', async () => {
  const db = emptyDb();
  db.migrations = [migrationRow()];
  const r = await runScript(db, ['--json']);
  const parsed = JSON.parse(r.stdout);
  assert.strictEqual(parsed.verdict.code, 'A_FAILED_FULLY_ROLLED_BACK', 'verdict');
  assert.strictEqual(parsed.file.lintProblems.length, 0, 'lint problems');
  assert.strictEqual(parsed.expected.counts.tables, 4, 'expected tables');
  assert.deepStrictEqual(parsed.expected.tables, [
    'CasinoCategory', 'CasinoGame', 'CasinoSession', 'CasinoTransaction',
  ]);
  assert.strictEqual(parsed.live.migrationRow.migration_name, MIGRATION, 'migration row');
});

(async () => {
  for (const task of tasks) {
    try {
      await task.fn();
      results.push(`PASS  ${task.label}`);
    } catch (error) {
      results.push(`FAIL  ${task.label}\n      ${error.message}`);
      runnerExit = 1;
    }
  }
  console.log(results.join('\n'));
  console.log(
    runnerExit === 0
      ? '\nALL CASINO MIGRATION-STATE SCENARIOS PASSED'
      : '\nSOME CASINO MIGRATION-STATE SCENARIOS FAILED',
  );
  process.exitCode = runnerExit;
})();







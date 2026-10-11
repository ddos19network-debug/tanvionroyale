'use strict';
/**
 * Compare the casino DDL in 20260917000000_add_casino_provider_catalog/migration.sql
 * against the SQL Prisma itself derives from database/prisma/schema.prisma
 * (`prisma migrate diff --from-empty --to-schema-datamodel ... --script`,
 * saved as .tmp-migration-harness/baseline-from-schema.sql).
 *
 * This proves the migration still represents the intended schema (Phase 3/6)
 * without needing a database: every Casino* table column (name, type,
 * nullability, default), index, unique constraint, foreign key and enum value
 * must match what the current schema generates.
 *
 * Run: node .tmp-migration-harness/compare-casino-ddl.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const harness = __dirname;
const root = path.join(harness, '..');
const migrationFile = path.join(
  harness, '..', 'database', 'prisma', 'migrations',
  '20260917000000_add_casino_provider_catalog', 'migration.sql',
);
const schemaFile = path.join(root, 'database', 'prisma', 'schema.prisma');
const baselineFile = path.join(harness, 'baseline-from-schema.sql');

/**
 * The baseline is the SQL Prisma itself derives from schema.prisma. It is
 * regenerated on demand so nothing generated needs to be committed and the
 * comparison can never be run against a stale baseline.
 * `--from-empty --to-schema-datamodel` never opens a connection, so the stub
 * DATABASE_URL/DIRECT_URL below can never reach any real database.
 */
function ensureBaseline() {
  const stub = 'postgresql://stub:stub@127.0.0.1:5432/stub?schema=public';
  // Run the CLI's JS entry with the current node binary: Node >= 20 refuses to
  // spawn .cmd/.bat shims through execFile without `shell: true` (EINVAL).
  const cli = path.join(root, 'node_modules', 'prisma', 'build', 'index.js');
  const sql = execFileSync(
    process.execPath,
    [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', schemaFile, '--script'],
    {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: stub, DIRECT_URL: stub },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  fs.writeFileSync(baselineFile, sql);
  return `regenerated (${sql.split(/\r?\n/).length} lines)`;
}

const baselineStatus = ensureBaseline();

const read = (p) => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');

const canon = (sql) =>
  sql
    .split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** key -> canonical statement text, for statements touching Casino* objects. */
function casinoObjects(sql, includePartnerProvider) {
  const map = new Map();
  for (const raw of sql.split(/;\s*(?:\r?\n|$)/)) {
    const t = canon(raw);
    if (!t) continue;
    if (!/Casino/.test(t) && !(includePartnerProvider && /PartnerProvider/.test(t))) continue;
    let key = null;
    let m;
    if ((m = /^CREATE TYPE "([^"]+)"/i.exec(t))) key = `enum:${m[1]}`;
    else if ((m = /^CREATE (?:UNIQUE )?TABLE "([^"]+)"/i.exec(t))) key = `table:${m[1]}`;
    else if ((m = /^CREATE (?:UNIQUE )?INDEX "([^"]+)"/i.exec(t))) key = `index:${m[1]}`;
    else if ((m = /^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)"/i.exec(t))) key = `constraint:${m[2]}`;
    else if ((m = /^ALTER TABLE "([^"]+)" ADD COLUMN "([^"]+)"/i.exec(t))) key = `column:${m[1]}.${m[2]}`;
    else key = `other:${t.slice(0, 60)}`;
    if (!map.has(key)) map.set(key, t);
  }
  return map;
}

const migration = casinoObjects(read(migrationFile), true);
// The baseline is the WHOLE schema, so restrict it to Casino* objects: the
// pre-existing PartnerProvider table (and its indexes) are NOT re-created by
// this migration — only two additive columns are.
const baseline = casinoObjects(read(baselineFile), false);

const onlyBaseline = [...baseline.keys()].filter((k) => !migration.has(k)).sort();
const onlyMigration = [...migration.keys()].filter((k) => !baseline.has(k)).sort();
/** The only things this migration has that the baseline has no CREATE for:
 *  the two additive PartnerProvider columns (the table already existed). */
const EXPECTED_EXTRAS = ['column:PartnerProvider.environment', 'column:PartnerProvider.productTypes'];
const extrasOk =
  onlyMigration.length === EXPECTED_EXTRAS.length &&
  EXPECTED_EXTRAS.every((k) => onlyMigration.includes(k));
const differing = [];
for (const [key, text] of baseline) {
  const mine = migration.get(key);
  if (mine !== undefined && mine !== text) differing.push({ key, baseline: text, migration: mine });
}

/** PartnerProvider additive columns: what does the schema demand? */
const baselineSql = read(baselineFile);
const providerBlock = /CREATE TABLE "PartnerProvider" \(([\s\S]*?)\n\);/m.exec(baselineSql);
const wantEnvironment = /"environment" TEXT,/.test(providerBlock ? providerBlock[1] : '');
const wantProductTypes = /"productTypes" TEXT\[\] DEFAULT ARRAY\[\]::TEXT\[\],/.test(
  providerBlock ? providerBlock[1] : '',
);
const migSql = read(migrationFile);
const hasEnv = /ALTER TABLE "PartnerProvider" ADD COLUMN "environment" TEXT;/.test(migSql);
const hasProductTypes =
  /ALTER TABLE "PartnerProvider" ADD COLUMN "productTypes" TEXT\[\] DEFAULT ARRAY\[\]::TEXT\[\];/.test(migSql);

console.log(`baseline: ${baselineStatus}`);
console.log(`baseline casino objects : ${baseline.size}`);
console.log(`migration casino objects: ${migration.size}`);
console.log(`only in baseline        : ${onlyBaseline.length ? onlyBaseline.join(', ') : '(none)'}`);
console.log(`only in migration       : ${onlyMigration.length ? onlyMigration.join(', ') : '(none)'}`);
console.log(`extras are exactly the 2 additive PartnerProvider columns: ${extrasOk ? 'YES' : 'NO'}`);
console.log(`differing statements    : ${differing.length}`);
for (const d of differing) {
  console.log(`  - ${d.key}`);
  console.log(`      baseline : ${d.baseline}`);
  console.log(`      migration: ${d.migration}`);
}

const columnsOfTables = (map) => {
  const cols = [];
  for (const [key, text] of map) {
    if (!key.startsWith('table:')) continue;
    const table = key.slice('table:'.length);
    const body = text.slice(text.indexOf('(') + 1).replace(/\)\s*;?\s*$/, '');
    const colsPart = body.split(/\bCONSTRAINT\b|\bPRIMARY KEY\b/)[0].replace(/,\s*$/, '');
    for (const part of colsPart.split(/,\s(?=")/)) {
      const cm = /^"([^"]+)" (.+)$/.exec(part.trim());
      if (cm) cols.push(`${table}.${cm[1]} = ${cm[2].replace(/,\s*$/, '')}`);
    }
  }
  return cols;
};
const baseCols = columnsOfTables(baseline);
const mineCols = columnsOfTables(migration);
const colDiff = baseCols.filter((c) => !mineCols.includes(c));

console.log(`\ncolumns from schema     : ${baseCols.length}`);
console.log(`columns in migration    : ${mineCols.length}`);
console.log(`missing/mismatched      : ${colDiff.length ? `\n  - ${colDiff.join('\n  - ')}` : '(none)'}`);
console.log(`CasinoTransaction.amount declared once: ${
  (migSql.match(/"amount"/g) || []).length === 1 ? 'YES' : 'NO'
}`);

console.log('\nPartnerProvider additive columns (schema -> migration):');
console.log(`  environment   nullable TEXT in schema: ${wantEnvironment} | ALTER ... ADD COLUMN in migration: ${hasEnv}`);
console.log(`  productTypes  TEXT[] default [] in schema: ${wantProductTypes} | ALTER ... ADD COLUMN in migration: ${hasProductTypes}`);

const ok =
  onlyBaseline.length === 0 &&
  extrasOk &&
  differing.length === 0 &&
  colDiff.length === 0 &&
  (migSql.match(/"amount"/g) || []).length === 1 &&
  wantEnvironment === hasEnv &&
  wantProductTypes === hasProductTypes;

console.log(`\n[compare-casino-ddl] ${ok ? 'MATCH — the migration matches schema.prisma' : 'MISMATCH — see above'}`);
process.exit(ok ? 0 : 1);

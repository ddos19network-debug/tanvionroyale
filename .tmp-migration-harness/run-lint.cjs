'use strict';
/**
 * Runs lint-migration-sql.cjs over every migration in database/prisma/migrations.
 * Run: node .tmp-migration-harness/run-lint.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const {
  splitStatements,
  stripComments,
  ALLOWED_STATEMENT_STARTS,
  migrationsDir,
} = require('./lint-migration-sql.cjs');

let failures = 0;
let checked = 0;
const dirs = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

for (const dir of dirs) {
  const file = path.join(migrationsDir, dir, 'migration.sql');
  if (!fs.existsSync(file)) {
    console.log(`FAIL  ${dir}: migration.sql is missing`);
    failures += 1;
    continue;
  }
  const sql = fs.readFileSync(file, 'utf8');
  const statements = splitStatements(sql);
  const problems = [];

  statements.forEach((stmt, idx) => {
    const bare = stripComments(stmt.text).trim();
    if (bare === '') return; // comment-only chunk
    checked += 1;
    const m = /^("\w+"|\w+)/.exec(bare);
    const token = m ? m[1] : '(empty)';
    if (token.startsWith('"')) {
      problems.push(
        `statement #${idx + 1} (line ${stmt.startLine}) begins with the QUOTED IDENTIFIER ${token} — ` +
          'an orphaned fragment outside a CREATE/ALTER statement (Postgres 42601).',
      );
    } else if (!ALLOWED_STATEMENT_STARTS.has(token.toUpperCase())) {
      problems.push(
        `statement #${idx + 1} (line ${stmt.startLine}) begins with the unexpected token "${token}".`,
      );
    }
    if (stmt.depth !== 0) {
      problems.push(`statement #${idx + 1} (line ${stmt.startLine}) unbalanced parentheses (depth ${stmt.depth}).`);
    }
    if (idx !== statements.length - 1 && !stmt.text.trimEnd().endsWith(';')) {
      problems.push(`statement #${idx + 1} (line ${stmt.startLine}) is missing its terminating semicolon.`);
    }
  });

  // NOTE: no naive file-wide parenthesis count here — it is not string/comment
  // aware (e.g. a `--` comment or a string literal containing a bracket would
  // produce a false positive). The per-statement depth above is quote aware.

  if (problems.length === 0) console.log(`ok    ${dir}  (${statements.length} statements)`);
  else {
    failures += problems.length;
    console.log(`FAIL  ${dir}`);
    for (const p of problems) console.log(`        - ${p}`);
  }
}

console.log(`\n[lint] ${dirs.length} migration file(s), ${checked} statement(s), ${failures} problem(s).`);

// The incident that started this: "amount" must be declared EXACTLY ONCE and
// INSIDE CREATE TABLE "CasinoTransaction".
const casinoFile = path.join(migrationsDir, '20260917000000_add_casino_provider_catalog', 'migration.sql');
const sql = fs.readFileSync(casinoFile, 'utf8');
const amountLines = sql
  .split(/\r?\n/)
  .map((l, i) => ({ l, n: i + 1 }))
  .filter((x) => /"amount"/.test(x.l));
const block = /CREATE TABLE "CasinoTransaction" \(([\s\S]*?)\n\);/m.exec(sql);
const insideBlock = Boolean(block) && /"amount"\s+INTEGER NOT NULL,/.test(block[1]);
console.log(
  `[lint] CasinoTransaction."amount": ${amountLines.length} declaration(s) at line(s) ` +
    `${amountLines.map((x) => x.n).join(', ') || '(none)'}; inside CREATE TABLE: ${insideBlock ? 'YES' : 'NO'}`,
);
if (amountLines.length !== 1 || !insideBlock) {
  failures += 1;
  console.log('[lint] FAIL — CasinoTransaction.amount must be declared exactly once inside its CREATE TABLE.');
}

process.exit(failures === 0 ? 0 : 1);

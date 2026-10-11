'use strict';
/**
 * Scratch diagnostic (NOT part of the app — mirrors .tmp-auth-retry/):
 * structural lint for Prisma migration SQL files.
 *
 * Run it directly:
 *   node .tmp-migration-harness/lint-migration-sql.cjs
 * or import the scanner from another harness:
 *   const { splitStatements } = require('./lint-migration-sql.cjs');
 */
const fs = require('node:fs');
const path = require('node:path');

const migrationsDir = path.join(__dirname, '..', 'database', 'prisma', 'migrations');

const ALLOWED_STATEMENT_STARTS = new Set([
  'CREATE', 'ALTER', 'DROP', 'COMMENT', 'INSERT', 'UPDATE', 'DELETE',
  'SELECT', 'TRUNCATE', 'GRANT', 'REVOKE', 'SET', 'DO', 'BEGIN', 'COMMIT',
  'ROLLBACK', 'WITH', 'VALUES', 'ANALYZE', 'REINDEX', 'CLUSTER', 'VACUUM',
]);

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
    if (text.trim().length > 0) out.push({ text, startLine, depth });
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

/** Remove comments so the first real token can be read. */
function stripComments(text) {
  // NOTE: split on /\r?\n/ — the migration files are CRLF, and in JavaScript
  // regexes `.` does NOT match \r and `$` (without /m) does not match before it,
  // so a naive split('\n') leaves the \r in place and `--.*$` silently fails.
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

module.exports = { splitStatements, stripComments, ALLOWED_STATEMENT_STARTS, migrationsDir };

// Executed directly (`node .tmp-migration-harness/lint-migration-sql.cjs`)?
// Then perform the lint — the implementation lives in run-lint.cjs so that both
// entry points behave identically.
if (require.main === module) {
  require('./run-lint.cjs');
}


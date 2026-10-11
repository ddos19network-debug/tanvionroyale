/**
 * Migration SQL STRUCTURE guard (regression test).
 *
 * Root cause of the 2026-09-27 production P3009 on
 * `20260927000000_add_affiliate_and_bigbang_webhook`:
 * a stray ORPHANED tail of the `CREATE TABLE "AffiliateMonthlyTarget"` body had
 * been appended to the END of migration.sql, AFTER the section 9 seed INSERTs.
 * That left a bare column list - `"targetValue" INTEGER NOT NULL,` ...
 * `CONSTRAINT "AffiliateMonthlyTarget_pkey" ... );` - sitting in TOP-LEVEL
 * STATEMENT POSITION. PostgreSQL rejected the whole batched script with
 * SQLSTATE 42601 `syntax error at or near ""targetValue""` (surfaced by Prisma
 * as P3018), so the migration never applied and every later Render deploy
 * aborted with P3009.
 *
 * The sibling failure (2026-09-26) was a UTF-8 BOM, guarded by
 * migration-encoding.spec.ts. That guard PASSED while this file was still
 * broken, because a BOM and a structural defect are different classes of bug.
 * This test closes the second class.
 *
 * It is deliberately STATIC: no database, no network, no secrets, no
 * credentials. It only reads the raw bytes of every migration.sql, so it runs
 * in CI before anything can reach a production database.
 */
import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_ROOT = path.join(__dirname, '..', '..', '..', 'database', 'prisma', 'migrations');

/**
 * Top-level statements must START with one of these keywords. A fragment that
 * begins with a quoted identifier (a column list) or with `CONSTRAINT` is
 * exactly the shape of an orphaned CREATE TABLE tail.
 */
const ALLOWED_LEADERS = [
  'BEGIN', 'COMMIT', 'ROLLBACK',
  'SET', 'SELECT', 'RESET',
  'CREATE', 'ALTER', 'DROP', 'TRUNCATE',
  'INSERT', 'UPDATE', 'DELETE',
  'GRANT', 'REVOKE', 'COMMENT', 'ANALYZE', 'VACUUM', 'DO', 'WITH', 'CALL',
];

/**
 * Strip comments and string literals, then split on top-level `;`.
 * Quoted identifiers are PRESERVED, because their content is what we assert on.
 */
function topLevelStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let i = 0;
  let dollar: string | null = null;
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
    if (ch === '-' && sql[i + 1] === '-') {           // line comment
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl + 1;
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {           // block comment
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (ch === "'") { inSingle = true; cur += ch; i += 1; continue; }
    const dm = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (dm) { dollar = dm[0]; cur += dm[0]; i += dm[0].length; continue; }
    if (ch === '"') {                                   // keep quoted identifier
      cur += ch; i += 1;
      while (i < sql.length && sql[i] !== '"') { cur += sql[i]; i += 1; }
      cur += '"'; i += 1;
      continue;
    }
    if (ch === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; i += 1; continue; }
    cur += ch;
    i += 1;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Drop leading `--` comment lines from a statement. */
function stripLeadingComments(text: string): string {
  let out = text.trimStart();
  while (out.startsWith('--')) {
    const nl = out.indexOf('\n');
    if (nl === -1) return '';
    out = out.slice(nl + 1).replace(/^\s*/, '');
  }
  return out.trim();
}

function migrationDirs(): string[] {
  return fs
    .readdirSync(MIGRATIONS_ROOT)
    .filter((d) => fs.existsSync(path.join(MIGRATIONS_ROOT, d, 'migration.sql')))
    .sort();
}

const AFFILIATE_MIGRATION = '20260927000000_add_affiliate_and_bigbang_webhook';

/**
 * The per-affiliate content-scope migration. It is additive and nullable, so
 * every pre-existing content block keeps reading back as GLOBAL.
 */
const INDIVIDUAL_CONTENT_MIGRATION = '20260929000000_add_affiliate_individual_content';

describe('migration SQL structure', () => {
  it('finds the migration history (guards against a silently empty glob)', () => {
    expect(migrationDirs().length).toBeGreaterThan(0);
  });

  it('every top-level statement starts with a known SQL command', () => {
    const offenders: string[] = [];
    for (const dir of migrationDirs()) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_ROOT, dir, 'migration.sql'), 'utf8');
      topLevelStatements(sql).forEach((raw, n) => {
        const stmt = stripLeadingComments(raw);
        if (!stmt) return;
        const first = /^[A-Za-z_]+/.exec(stmt)?.[0]?.toUpperCase() ?? '<none>';
        if (!ALLOWED_LEADERS.includes(first)) {
          offenders.push(
            `${dir} [statement ${n}]: starts with "${first}" -> ${stmt.split('\n')[0].slice(0, 90)}`,
          );
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('every top-level statement has balanced parentheses', () => {
    const offenders: string[] = [];
    for (const dir of migrationDirs()) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_ROOT, dir, 'migration.sql'), 'utf8');
      topLevelStatements(sql).forEach((raw, n) => {
        const stmt = stripLeadingComments(raw);
        if (!stmt) return;
        let depth = 0;
        let min = 0;
        for (const ch of stmt) {
          if (ch === '(') depth += 1;
          else if (ch === ')') { depth -= 1; if (depth < min) min = depth; }
        }
        if (depth !== 0 || min !== 0) {
          offenders.push(`${dir} [statement ${n}]: paren depth ${depth} (min ${min}) -> ${stmt.split('\n')[0].slice(0, 90)}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('no migration leaves unparsed text after its final semicolon', () => {
    // An orphan appended AFTER the last `;` is a statement Prisma still sends
    // but the splitter above would otherwise silently drop.
    const offenders: string[] = [];
    for (const dir of migrationDirs()) {
      const file = path.join(MIGRATIONS_ROOT, dir, 'migration.sql');
      const stripped = fs.readFileSync(file, 'utf8')
        .replace(/--[^\n]*/g, '')            // line comments
        .replace(/'(?:[^']|'')*'/g, "''")    // string literals
        .replace(/"[^"]*"/g, '""');          // quoted identifiers
      const last = stripped.lastIndexOf(';');
      if (stripped.slice(last + 1).trim().length > 0) {
        offenders.push(`${dir}: ${stripped.slice(last + 1).trim().slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  describe(AFFILIATE_MIGRATION, () => {
    const file = path.join(MIGRATIONS_ROOT, AFFILIATE_MIGRATION, 'migration.sql');

    it('defines "AffiliateMonthlyTarget" exactly once (no orphaned duplicate tail)', () => {
      const sql = fs.readFileSync(file, 'utf8');
      // Comments are stripped first: the file's repair-history header
      // legitimately NAMES `CREATE TABLE "AffiliateMonthlyTarget"` inside a
      // `--` comment, and a naive grep would report a false duplicate.
      const code = topLevelStatements(sql).map(stripLeadingComments).join(';\n');
      expect(code.match(/CREATE TABLE "AffiliateMonthlyTarget"/g) ?? []).toHaveLength(1);
    });

    it('contains no bare column list in top-level statement position', () => {
      const sql = fs.readFileSync(file, 'utf8');
      const stmts = topLevelStatements(sql).map(stripLeadingComments).filter(Boolean);
      // The orphan began with the column `"targetValue" INTEGER NOT NULL,`.
      const orphans = stmts.filter((s) => /^\s*"[A-Za-z_]\w*"\s+[A-Z]/.test(s));
      expect(orphans).toEqual([]);
    });

    it('declares the exact 23 statements the repaired migration is made of', () => {
      const sql = fs.readFileSync(file, 'utf8');
      const stmts = topLevelStatements(sql).map(stripLeadingComments).filter(Boolean);
      expect(stmts).toHaveLength(23);
      // 1 enum + 1 column + 4 tables + 3 unique + 8 indexes + 3 FKs + 3 seeds.
      const count = (re: RegExp) => stmts.filter((s) => re.test(s)).length;
      expect(count(/^CREATE TYPE/i)).toBe(1);
      expect(count(/^CREATE TABLE/i)).toBe(4);
      expect(count(/^CREATE UNIQUE INDEX/i)).toBe(3);
      expect(count(/^CREATE INDEX/i)).toBe(8);
      expect(count(/^ALTER TABLE/i)).toBe(4);
      expect(count(/^INSERT INTO/i)).toBe(3);
    });

    it('is pure ASCII with no BOM (the 2026-09-26 failure mode)', () => {
      const bytes = fs.readFileSync(file);
      expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
      expect(bytes[0]).toBe(0x2d); // '-'
      expect(bytes.toString('utf8')).not.toContain('\uFEFF');
    });
  });

  describe(INDIVIDUAL_CONTENT_MIGRATION, () => {
    const file = path.join(MIGRATIONS_ROOT, INDIVIDUAL_CONTENT_MIGRATION, 'migration.sql');

    it('is pure ASCII with no BOM (the 2026-09-26 failure mode)', () => {
      const bytes = fs.readFileSync(file);
      expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
      expect(bytes[0]).toBe(0x2d); // '-'
      expect(bytes.toString('utf8')).not.toContain('\uFEFF');
    });

    it('adds "affiliateUserId" as a NULLABLE column with no default', () => {
      const sql = fs.readFileSync(file, 'utf8');
      const code = topLevelStatements(sql).map(stripLeadingComments).join(';\n');
      // Nullable and defaultless is the whole existing-data guarantee: every
      // pre-existing row reads back as NULL, i.e. GLOBAL scope, untouched.
      expect(code).toMatch(/ADD COLUMN "affiliateUserId" TEXT;/);
      expect(code).not.toMatch(/ADD COLUMN "affiliateUserId"[^;]*DEFAULT/i);
    });

    it('creates both per-scope composite indexes', () => {
      const sql = fs.readFileSync(file, 'utf8');
      const code = topLevelStatements(sql).map(stripLeadingComments).join(';\n');
      // Both are prefixed by the scope key, which is what makes an individual
      // read/reorder a range scan that cannot interleave with another scope.
      expect(code).toContain('AffiliateContentBlock_affiliateUserId_isEnabled_sortOrder_idx');
      expect(code).toContain('AffiliateContentBlock_affiliateUserId_sortOrder_idx');
    });

    it('declares the scope foreign key to "User"', () => {
      const sql = fs.readFileSync(file, 'utf8');
      const code = topLevelStatements(sql).map(stripLeadingComments).join(';\n');
      expect(code).toMatch(
        /ADD CONSTRAINT "AffiliateContentBlock_affiliateUserId_fkey"[\s\S]*FOREIGN KEY \("affiliateUserId"\) REFERENCES "User"\("id"\)/,
      );
    });

    it('is ADDITIVE ONLY - it deletes, drops and backfills nothing', () => {
      const sql = fs.readFileSync(file, 'utf8');
      const code = topLevelStatements(sql).map(stripLeadingComments).join(';\n');
      const upper = code.toUpperCase();
      // No existing content may be deleted, dropped, truncated or reassigned to
      // an arbitrary affiliate.
      expect(upper).not.toMatch(/\bDELETE\b/);
      expect(upper).not.toMatch(/\bDROP\b/);
      expect(upper).not.toMatch(/\bTRUNCATE\b/);
      expect(upper).not.toMatch(/\bUPDATE\b/);
      // The tables the requirement says must stay untouched are never named
      // (compared in the original case, since these are quoted identifiers).
      for (const untouched of [
        '"Referral"',
        '"ReferralReward"',
        '"AffiliateClick"',
        '"AffiliateProfile"',
        '"AffiliateMonthlyTarget"',
      ]) {
        expect(code).not.toContain(untouched);
      }
    });
  });
});

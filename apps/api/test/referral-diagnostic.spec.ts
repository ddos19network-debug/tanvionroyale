/**
 * Regression tests for scripts/diagnose-referral-migration.cjs — the ONLY thing
 * standing between the 2026-09-26 P3009 outage and a `migrate reset`.
 *
 * The bug this locks down (historical)
 * ------------------------------------
 * probe() originally ran, unconditionally:
 *
 *     SELECT count("referralCode") ... FROM "User"
 *     SELECT id, "isEnabled" FROM "ReferralProgramSettings"
 *
 * Both objects are CREATED BY THE MIGRATION BEING DIAGNOSED. In the failed-before-
 * statement-0 state they do not exist, so PostgreSQL raised 42703/42P01, the
 * exception escaped before printReport() ran, and the tool printed a bare
 *
 *     [diagnose-referral] ERROR: column "User"."referralCode" does not exist
 *
 * i.e. it destroyed the very evidence (the `logs` column, the history, the
 * catalogue) that proves the migration applied nothing. The absence of the
 * objects IS the proof; treating it as a crash inverts the diagnosis.
 *
 * What this spec covers (the 10 required cases)
 * ---------------------------------------------
 *  1. The migration file bytes: no BOM, starts with '-', valid UTF-8.
 *  2. CASE A  FAILED + zero objects  -> recommends `--rolled-back`, never `--applied`.
 *  3. CASE B  FAILED + partial       -> FAIL CLOSED, no resolve command, additive
 *                                       repair plan printed for review.
 *  4. CASE C  FAILED + complete      -> `--applied` ONLY after the full
 *                                       object+data verification checklist.
 *  5. CASE D  drifted/inconsistent   -> FAIL CLOSED (two drift shapes tested).
 *  6. No destructive SQL: every executed statement is a SELECT; the printed plan
 *     never contains DROP/TRUNCATE/DELETE/UPDATE.
 *  7. Secrets: DATABASE_URL credentials never appear in stdout or stderr.
 *  8. Running the diagnostic modifies no migration file.
 *  9. BigBang/WinHouse untouched and never referenced by the diagnostic.
 * 10. (The full suite passing — enforced by running the whole `test` script;
 *     this file is one of its suites.)
 *
 * There is no Postgres (and no Docker) in CI, so the generated Prisma client is
 * replaced with a stub that answers catalogue queries and throws the exact Prisma
 * error a missing relation/column produces. Every verdict branch is exercised.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';

const HARNESS = path.join(__dirname, 'fixtures', 'referral-diagnostic-harness.cjs');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const MIGRATIONS_ROOT = path.join(REPO_ROOT, 'database', 'prisma', 'migrations');
const REFERRAL_MIGRATION = '20260926000000_add_user_referral_program';

type Scenario = 'nothing' | 'partial' | 'applied' | 'rolledback' | 'drift' | 'incomplete';
const ALL_SCENARIOS: Scenario[] = ['nothing', 'partial', 'applied', 'rolledback', 'drift', 'incomplete'];

interface RunResult {
  stdout: string;
  stderr: string;
  all: string;
  status: number | null;
}

/**
 * Run the diagnostic in a child process. Child-process isolation is what makes
 * this trustworthy: the script assigns process.exitCode and mutates process.env,
 * and a stubbed module registry in-process would leak between scenarios.
 */
function run(scenario: Scenario, extraArgs: string[] = []): RunResult {
  const r = spawnSync(process.execPath, [HARNESS, `--scenario=${scenario}`, ...extraArgs], {
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    all: `${r.stdout ?? ''}\n${r.stderr ?? ''}`,
    status: r.status,
  };
}

function sha256File(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Every migration.sql in the repo, mapped to its content hash. */
function migrationHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dir of fs.readdirSync(MIGRATIONS_ROOT)) {
    const file = path.join(MIGRATIONS_ROOT, dir, 'migration.sql');
    if (fs.existsSync(file)) out[dir] = sha256File(file);
  }
  return out;
}

describe('referral migration diagnostic', () => {
  const hasHarness = (() => {
    try {
      fs.accessSync(HARNESS);
      return true;
    } catch {
      return false;
    }
  })();

  // -------------------------------------------------------------------------
  // 1. Migration file bytes: no BOM, first char '-', valid UTF-8.
  // -------------------------------------------------------------------------
  describe('migration file encoding (byte-level)', () => {
    const file = path.join(MIGRATIONS_ROOT, REFERRAL_MIGRATION, 'migration.sql');
    const bytes = fs.readFileSync(file);

    it('does not start with a UTF-8 BOM (EF BB BF)', () => {
      expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    });

    it("first character is '-' (a comment, so PostgreSQL must reach statement 0)", () => {
      expect(bytes[0]).toBe(0x2d);
      expect(bytes.subarray(0, 2).toString('latin1')).toBe('--');
    });

    it('is valid UTF-8 text', () => {
      // TextDecoder with fatal:true throws on any invalid byte sequence.
      expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)).not.toThrow();
    });

    it('contains no NUL or unexpected control bytes', () => {
      for (let i = 0; i < bytes.length; i += 1) {
        const b = bytes[i];
        if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) {
          throw new Error(`control byte 0x${b.toString(16)} at offset ${i}`);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // 2-5. The four diagnostic cases (A, B, C, D) + derivation from migration.sql.
  // -------------------------------------------------------------------------
  (hasHarness ? describe : describe.skip)('verdict branches (emulated production states)', () => {
    it('CASE A: FAILED + nothing applied -> FAILED_NOTHING_APPLIED, recommends --rolled-back, never --applied', () => {
      // This is the production state that broke the tool AND the migration.
      const out = run('nothing').all;
      expect(out).toContain('FAILED_NOTHING_APPLIED');
      expect(out).toContain('objects present              NONE');
      // The original error must still be surfaced verbatim.
      expect(out).toContain('ORIGINAL ERROR (logs column');
      expect(out).toContain('syntax error');
      // It must never print a fatal ERROR line.
      expect(out).not.toContain('[diagnose-referral] ERROR');
      // Safe remedy present...
      expect(out).toContain('--rolled-back');
      expect(out).toContain('NEVER run `migrate reset`');
      // ...and the dangerous command explicitly forbidden, never runnable.
      expect(out).toContain('NEVER use `--applied`');
      expect(out).not.toContain('exec prisma migrate resolve --applied');
    });

    it('CASE B: FAILED + partial -> FAILED_PARTIAL, FAIL CLOSED, no resolve command at all', () => {
      const out = run('partial').all;
      expect(out).toContain('FAILED_PARTIAL');
      expect(out).toContain('objects present              SOME');
      expect(out).not.toContain('FAILED_BUT_COMPLETE');
      expect(out).not.toContain('[diagnose-referral] ERROR');
      expect(out).toContain('FAIL CLOSED');
      // No history mutation of any kind may be recommended in this state.
      expect(out).not.toContain('exec prisma migrate resolve --applied');
      expect(out).not.toContain('exec prisma migrate resolve --rolled-back');
      expect(out).not.toContain('prisma:migrate:deploy:strict');
      // The object-level report and the generated plan are present.
      expect(out).toContain('MINIMAL REPAIR PLAN');
      expect(out).toContain('MISSING');
    });

    it('CASE C: FAILED + complete -> FAILED_BUT_COMPLETE, --applied only after full verification', () => {
      const out = run('applied').all;
      expect(out).toContain('FAILED_BUT_COMPLETE');
      expect(out).toContain('objects present              ALL');
      expect(out).not.toContain('[diagnose-referral] ERROR');
      // The verification checklist that gates --applied must be visible.
      expect(out).toContain('Verification performed automatically');
      expect(out).toContain('every table, column, primary key, index/unique constraint, foreign key exists');
      expect(out).toContain('backfill complete, zero duplicate codes');
      expect(out).toContain('resolve --applied');
      // `--rolled-back` must not be offered once the schema is proven complete.
      expect(out).not.toContain('--rolled-back');
    });


    it('CASE D1: no history row but objects exist -> NO_ROW_BUT_OBJECTS_EXIST, FAIL CLOSED', () => {
      const out = run('drift').all;
      expect(out).toContain('NO_ROW_BUT_OBJECTS_EXIST');
      expect(out).toContain('objects present              ALL');
      expect(out).toContain('FAIL CLOSED');
      expect(out).not.toContain('[diagnose-referral] ERROR');
      // Drift must never be "resolved" automatically.
      expect(out).not.toContain('exec prisma migrate resolve --applied');
      expect(out).not.toContain('prisma:migrate:deploy:strict');
    });

    it('CASE D2: objects complete but backfill incomplete -> FAILED_BUT_DATA_INCOMPLETE, refuses --applied', () => {
      const out = run('incomplete').all;
      expect(out).toContain('FAILED_BUT_DATA_INCOMPLETE');
      expect(out).toContain('objects present              ALL');
      expect(out).toContain('backfill incomplete');
      expect(out).toContain('Do NOT run `--applied`');
      expect(out).not.toContain('[diagnose-referral] ERROR');
      // The --applied reconcile command itself must NOT be printed.
      expect(out).not.toContain('exec prisma migrate resolve --applied');
    });

    it('already rolled back + nothing applied -> ROLLED_BACK and says to deploy', () => {
      const out = run('rolledback').all;
      expect(out).toContain('ROLLED_BACK');
      expect(out).toContain('prisma:migrate:deploy:strict');
      expect(out).not.toContain('[diagnose-referral] ERROR');
    });

    it('reports the migration file as BOM-free with its exact first bytes', () => {
      const out = run('nothing').stdout;
      expect(out).toContain('starts with BOM              no');
      // 2D 2D 20 3D 3D 3D == "-- ====", i.e. plain ASCII SQL/comment content.
      expect(out).toContain('2D2D203D3D3D');
    });

    it('derives the expected object list from migration.sql (not hard-coded)', () => {
      const result = run('applied', ['--json']);
      expect(result.status).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.derivationWarnings).toEqual([]);
      // 4 tables + User.referralCode; 55 columns; 5 enums + 4 ADD VALUEs;
      // 11 indexes; 4 PKs; 5 FKs — parsed from the real file, not typed by hand.
      expect(json.expectedCounts).toEqual({
        tables: 4,
        columns: 55,
        enums: 5,
        enumValues: 22,
        indexes: 11,
        pks: 4,
        fks: 5,
      });
    });
  });


  // -------------------------------------------------------------------------
  // 6. No destructive SQL is ever executed or generated.
  // -------------------------------------------------------------------------
  (hasHarness ? describe : describe.skip)('read-only guarantee', () => {
    it('every SQL statement the diagnostic executes is a SELECT', () => {
      for (const scenario of ALL_SCENARIOS) {
        const out = run(scenario);
        const statements = [...out.stderr.matchAll(/\[sql\] (.+)/g)].map((m) => m[1]);
        // The stub throws on unstubbed queries, so at minimum the core probes ran.
        expect(statements.length).toBeGreaterThan(5);
        for (const sql of statements) {
          expect(sql).toMatch(/^\s*SELECT\b/i);
          expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/i);
        }
      }
    });

    it('the generated repair plan is additive only — no DROP/TRUNCATE/DELETE/UPDATE', () => {
      const out = run('partial').stdout;
      const planStart = out.indexOf('MINIMAL REPAIR PLAN');
      const verdictStart = out.indexOf('=== 8. VERDICT');
      expect(planStart).toBeGreaterThan(-1);
      expect(verdictStart).toBeGreaterThan(planStart);
      const plan = out.slice(planStart, verdictStart);
      // Destructive DDL. NB "ON DELETE CASCADE"/"ON UPDATE CASCADE" are foreign-key
      // referential-action clauses, not DML, so they must NOT trip these patterns.
      expect(plan).not.toMatch(/\bDROP\s+(TABLE|TYPE|INDEX|CONSTRAINT|COLUMN|FUNCTION)\b/i);
      expect(plan).not.toMatch(/\bTRUNCATE\b/i);
      // DML: anchored to the start of a statement line, not to a foreign-key clause.
      expect(plan).not.toMatch(/^\s*\|?\s*DELETE\s+FROM\b/im);
      expect(plan).not.toMatch(/^\s*\|?\s*UPDATE\s+["(]/im);
      // It really is a plan: DDL for the missing objects is in there.
      expect(plan).toMatch(/\bCREATE (TABLE|TYPE)\b/i);
      // Every plan line is either a blank marker or part of a CREATE/ALTER statement.
      expect(plan).not.toMatch(/^\s*\|\s*(GRANT|REVOKE|ALTER TABLE\s+\w+\s+DROP)\b/im);
    });

    it('has no code path that can write to the database or to files', () => {
      const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'diagnose-referral-migration.cjs'), 'utf8');
      // It may PRINT commands for the operator, but it must never EXECUTE one:
      // no child process is spawned anywhere in the script.
      expect(src).not.toMatch(/child_process/);
      expect(src).not.toMatch(/\b(execSync|execFileSync|spawnSync|spawn|execFile)\b/);
      // ...and it never writes or deletes a file.
      expect(src).not.toMatch(/writeFileSync|appendFileSync|unlinkSync|rmSync|mkdirSync/);
      // Every DB call goes through the single read-only helper.
      const queries = src.match(/\bq\(/g) ?? [];
      expect(queries.length).toBeGreaterThan(0);
      expect(src).toMatch(/const q = \(sql\) => prisma\.\$queryRawUnsafe\(sql\)/);
    });
  });


  // -------------------------------------------------------------------------
  // 7. Secrets: the connection URL/credentials are never printed.
  // -------------------------------------------------------------------------
  (hasHarness ? describe : describe.skip)('secret leakage', () => {
    it('never prints DATABASE_URL credentials — host only', () => {
      for (const scenario of ALL_SCENARIOS) {
        const out = run(scenario);
        expect(out.all).not.toContain('NEVER-PRINT-THIS-PASSWORD');
        expect(out.all).not.toContain('refdiag:');
        expect(out.all).not.toContain('postgresql://');
        expect(out.all).not.toContain('postgres://');
        // The host IS printed, for identification.
        expect(out.stdout).toContain('ep-super-cake-b3sxq4rp-pooler');
      }
    });

    it('redacts the connection URL from error messages too', () => {
      // The catch-path builds its message through hostOnly()/split(dbUrl).
      const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'diagnose-referral-migration.cjs'), 'utf8');
      expect(src).toContain('raw.split(dbUrl).join(hostOnly(dbUrl))');
      expect(src).toMatch(/Hostname ONLY/);
    });
  });


  // -------------------------------------------------------------------------
  // 8-9. Running the diagnostic mutates no files; BigBang/WinHouse untouched.
  // -------------------------------------------------------------------------
  (hasHarness ? describe : describe.skip)('no side effects', () => {
    it('does not modify any migration file (existing migrations untouched)', () => {
      const before = migrationHashes();
      expect(Object.keys(before).length).toBeGreaterThan(30);
      for (const scenario of ALL_SCENARIOS) run(scenario);
      expect(migrationHashes()).toEqual(before);
    });

    it('does not modify the referral migration when run with --json either', () => {
      const file = path.join(MIGRATIONS_ROOT, REFERRAL_MIGRATION, 'migration.sql');
      const before = sha256File(file);
      run('partial', ['--json']);
      expect(sha256File(file)).toBe(before);
    });

    it('never queries or references BigBang/WinHouse tables', () => {
      const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'diagnose-referral-migration.cjs'), 'utf8');
      expect(src).not.toMatch(/BigBang|WinHouse/i);
      // The executed SQL must not touch those tables. The printed migration HISTORY
      // legitimately lists every applied migration by name (including the BigBang
      // one) — that is read-only reporting, not a BigBang/WinHouse change.
      for (const scenario of ALL_SCENARIOS) {
        const out = run(scenario);
        const statements = [...out.stderr.matchAll(/\[sql\] (.+)/g)].map((m) => m[1]).join('\n');
        expect(statements).not.toMatch(/bigbang|winhouse/i);
        expect(statements).not.toMatch(/BigBangGame|WinHouse/i);
      }
    });
  });
});


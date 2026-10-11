/**
 * Migration FILE ENCODING guard (regression test).
 *
 * Root cause of the 2026-09-26 production P3009 outage:
 * the first commit of `20260926000000_add_user_referral_program` wrote its
 * migration.sql starting with a UTF-8 BOM (EF BB BF). The first statement in
 * every migration file is a `--` comment, and PostgreSQL does not treat U+FEFF
 * as whitespace, so `--` was not at the start of a token and the whole batched
 * script failed to parse BEFORE statement 0 executed. Prisma recorded the
 * failure in _prisma_migrations, and every subsequent Render deploy aborted
 * with P3009 even after the BOM was removed, because the failed row still had
 * to be resolved by hand.
 *
 * A BOM is invisible in most editors and survives copy/paste, so it is exactly
 * the kind of regression that must be caught automatically rather than by
 * review. This test reads the raw bytes of every migration.sql.
 *
 * Pure static analysis: no database, no network, no secrets.
 */
import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_ROOT = path.join(__dirname, '..', '..', '..', 'database', 'prisma', 'migrations');
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function migrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_ROOT)
    .filter((entry) => fs.existsSync(path.join(MIGRATIONS_ROOT, entry, 'migration.sql')))
    .sort();
}

describe('migration file encoding', () => {
  it('finds the migration history (guards against a silently empty glob)', () => {
    expect(migrationFiles().length).toBeGreaterThan(0);
  });

  it('no migration.sql starts with a UTF-8 BOM', () => {
    const offenders = migrationFiles().filter((dir) => {
      const file = path.join(MIGRATIONS_ROOT, dir, 'migration.sql');
      return fs.readFileSync(file).subarray(0, 3).equals(BOM);
    });
    expect(offenders).toEqual([]);
  });

  it('no migration.sql contains a BOM anywhere before its first statement', () => {
    // A BOM after a comment block is harmless; only a leading one breaks the
    // parse. Checked separately so the failure message stays actionable.
    const offenders = migrationFiles().filter((dir) => {
      const text = fs.readFileSync(path.join(MIGRATIONS_ROOT, dir, 'migration.sql'), 'utf8');
      const firstNonWhitespace = text.search(/\S/);
      return firstNonWhitespace !== -1 && text[0] === '\uFEFF';
    });
    expect(offenders).toEqual([]);
  });

  it('every migration.sql is valid UTF-8 text (no stray NUL / control bytes)', () => {
    const offenders: string[] = [];
    for (const dir of migrationFiles()) {
      const bytes = fs.readFileSync(path.join(MIGRATIONS_ROOT, dir, 'migration.sql'));
      // TextDecoder with fatal:true throws on any invalid byte sequence.
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        offenders.push(`${dir} (not valid UTF-8)`);
        continue;
      }
      for (let i = 0; i < bytes.length; i += 1) {
        // Allow TAB, LF, CR. Everything else below 0x20 is a control character
        // that has no business in a migration file.
        const b = bytes[i];
        if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) {
          offenders.push(`${dir} (0x${b.toString(16)} at offset ${i})`);
          break;
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the referral migration starts with "-", not with a BOM', () => {
    // The referral migration is the one that carried the BOM, so assert its
    // bytes explicitly as a named, greppable regression. Byte 0x2D is '-';
    // 0xEF 0xBB 0xBF is the BOM that broke production on 2026-09-26.
    const file = path.join(MIGRATIONS_ROOT, '20260926000000_add_user_referral_program', 'migration.sql');
    const bytes = fs.readFileSync(file);
    expect(bytes[0]).toBe(0x2d);
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('--');
    expect(bytes.subarray(0, 6).toString('hex').toUpperCase()).toBe('2D2D203D3D3D');
  });
});

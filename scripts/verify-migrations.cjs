#!/usr/bin/env node
/**
 * verify-migrations.cjs
 *
 * Guards against the exact failure mode this project hit repeatedly: code
 * deploys successfully while pending Prisma migrations are silently never
 * applied to the production database, surfacing later as random P2021
 * ("table does not exist") / P2022 ("column does not exist") errors on
 * unrelated endpoints.
 *
 * `prisma migrate status` always exits 0, even when migrations are pending —
 * so its exit code alone can't be trusted. This script runs it, PARSES the
 * output, and fails loudly when appropriate.
 *
 * Modes:
 *   node scripts/verify-migrations.cjs            (build mode, default)
 *     - Pending migrations found   -> print them, exit 1 (abort the build)
 *     - DB unreachable / no URL    -> exit 1 (never assume success)
 *     - Output unparseable        -> exit 1 (never assume success)
 *     - Schema up to date         -> exit 0
 *
 *   node scripts/verify-migrations.cjs --runtime   (startCommand mode)
 *     - Pending migrations found   -> print a loud ERROR banner to stderr,
 *                                     but exit 0 so the API still boots
 *                                     (better a running app with a visible
 *                                     warning than no app at all)
 *     - DB unreachable / no URL    -> exit 1 (can't verify -> don't boot)
 *     - Schema up to date         -> exit 0
 *
 * Never prints the full DATABASE_URL/DIRECT_URL (they contain credentials) —
 * only the host, for identification purposes.
 */

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const isRuntime = process.argv.includes('--runtime');
const schemaPath = path.join(__dirname, '..', 'database', 'prisma', 'schema.prisma');

function hostOnly(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.host;
  } catch {
    return '(unparseable URL)';
  }
}

function fail(message) {
  console.error(`\n[verify-migrations] ERROR: ${message}\n`);
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL || process.env.DIRECT_URL;
if (!dbUrl) {
  fail('Neither DATABASE_URL nor DIRECT_URL is set — cannot verify migration status.');
}
console.log(`[verify-migrations] Checking migration status against ${hostOnly(dbUrl)} ...`);

let output;
let statusFailed = false;
try {
  output = execFileSync(
    'npx',
    ['prisma', 'migrate', 'status', '--schema', schemaPath],
    { encoding: 'utf8', env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
} catch (err) {
  // `prisma migrate status` itself exits non-zero on connection errors
  // (P1001/P1002/etc). Capture whatever it printed either way.
  output = (err.stdout || '') + (err.stderr || '');
  statusFailed = true;
}

if (!output || output.trim().length === 0) {
  fail('`prisma migrate status` produced no output — treating as unverifiable.');
}

console.log(output);

const isUpToDate = /database schema is up to date/i.test(output);
// Prisma prints "Following migration have not yet been applied:" for exactly one
// pending migration and "Following migrations have not yet been applied:" for
// several (`Following migration${n > 1 ? 's' : ''} have ...` in the CLI), and
// newer releases word it "has". Match every wording so a single pending
// migration can never slip past this gate on a message-format change.
const hasPending = /following migrations?\s+(?:have|has)\s+not yet been applied/i.test(output)
  || /following migration.*have not yet been applied/i.test(output)
  || /migrations?\s+(?:have|has)\s+not yet been applied/i.test(output);
const hasFailed = /failed migrations? found/i.test(output) || /Error: P3009/i.test(output);

// `prisma migrate status` itself exits non-zero whenever there ARE pending
// migrations (that's expected, not a connection failure) — so only treat a
// non-zero exit as "couldn't verify" when the output doesn't actually match
// any of the known, successfully-parsed states above.
if (statusFailed && !isUpToDate && !hasPending && !hasFailed) {
  fail('Could not reach the database to verify migration status (see output above). Refusing to proceed.');
}

if (hasFailed) {
  fail('Database has a FAILED migration recorded. Resolve it (prisma migrate resolve) before deploying. See output above.');
}

if (hasPending) {
  const msg = 'Pending migration(s) detected — the database schema is behind the code being deployed. '
    + 'Every past incident of "table/column does not exist" in production traces back to this. '
    + 'Run `prisma migrate deploy` against the production database before this code goes live.';
  if (isRuntime) {
    console.error(`\n==================== [verify-migrations] ERROR ====================`);
    console.error(msg);
    console.error('The API will still start, but requests touching the missing schema WILL throw P2021/P2022.');
    console.error('=====================================================================\n');
    process.exit(0); // let the app boot; this is a loud warning, not a hard stop, at runtime
  }
  fail(msg);
}

if (!isUpToDate) {
  fail('Could not confirm "Database schema is up to date!" in `prisma migrate status` output — refusing to proceed.');
}

console.log('[verify-migrations] OK — database schema is up to date.');
process.exit(0);

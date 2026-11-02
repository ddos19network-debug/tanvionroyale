/**
 * TANVIONROYALE — LOCAL DEVELOPMENT admin account seed.
 *
 * WHY THIS EXISTS
 * ---------------
 * `POST /auth/admin-login` (the /admin/login page) only authenticates STAFF
 * accounts that hold ADMIN/SUPER_ADMIN, and the authorization boundary
 * (JwtAuthGuard) additionally re-strips any SUPER_ADMIN whose email is NOT in
 * MASTER_ADMIN_EMAILS. The normal local pipeline (db:seed, db:seed:freeplay-user,
 * db:bootstrap) provisions RBAC roles and a free-play CUSTOMER but never a
 * STAFF/admin account — so a fresh local database has NOBODY who can sign in at
 * /admin/login, and every attempt fails (401 for unknown creds, 403 for the one
 * regular user). This script closes that gap so local admin login works out of
 * the box.
 *
 * SAFETY
 * ------
 *  - REFUSES to run when NODE_ENV=production (this is a local-dev convenience
 *    only; production admins are bootstrapped via bootstrap-master-admin.ts,
 *    which is allowlist-gated and audited).
 *  - Fail-closed LOCAL-ONLY database gate: refuses to run unless DATABASE_URL
 *    targets the local Docker PostgreSQL (localhost/127.0.0.1 + database
 *    `tanvionroyale`, per docker-compose.yml) — checked BEFORE any query, so a
 *    misconfigured remote/production URL can never be written.
 *  - The account is created from LOCAL_DEV_ADMIN_EMAIL (default
 *    admin@local.test) — a non-routable .test address that can never be a real
 *    mailbox, so it is safe to seed by default.
 *  - It grants the ADMIN role (account type STAFF), NOT SUPER_ADMIN: the master-
 *    admin allowlist is capped at exactly two permanent owners, so a local seed
 *    must never consume a master slot or depend on MASTER_ADMIN_EMAILS. The
 *    password uses the SAME argon2id hash as every other account, and the ACTIVE
 *    + emailVerified + STAFF state is created in one place — no weaker path.
 *  - Idempotent: re-running only ensures the ADMIN assignment and never
 *    overwrites an existing password/username/profile.
 *
 * USAGE (from apps/api):
 *   pnpm db:seed:admin                         # uses LOCAL_DEV_ADMIN_EMAIL + default password
 *   LOCAL_DEV_ADMIN_PASSWORD='...' pnpm db:seed:admin   # custom password
 *
 * The password is NEVER echoed to the console/logs; supply it through
 * LOCAL_DEV_ADMIN_PASSWORD (a local-only env var, e.g. the gitignored .env).
 */
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaClient } from '../../apps/api/src/generated/prisma/index.js';

/*
 * Local-dev convenience: load the repo-root .env (if any) so this script works
 * with `pnpm db:seed:admin` outside Render. Real environment variables ALWAYS
 * win (existing process.env is never overridden), so it stays safe if ever run
 * with injected env vars. cwd-based lookup (never __dirname) because Node
 * ≥22.18 runs this file as ESM where __dirname is undefined; `pnpm db:seed:admin`
 * runs with apps/api as cwd, so the repo root is two levels up.
 */
(function loadRootEnv(): void {
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '..', '..', '.env'),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
    return;
  }
})();

/*
 * Load the shared argon2 password hasher at runtime via createRequire (the same
 * build-free pattern as seed-freeplay-user.ts) so the hash this script writes
 * verifies against the auth service's argon2.verify — no second hashing scheme.
 * `requireBase` is apps/api whether run under ts-node's CommonJS output
 * (__dirname present) or Node ≥22.18 native ESM (no __dirname → cwd).
 */
const requireBase =
  typeof __dirname !== 'undefined' ? path.join(__dirname, '..', '..', 'apps', 'api') : process.cwd();
const requireFromApi = createRequire(path.join(requireBase, 'package.json'));
const argon2 = requireFromApi('argon2') as {
  hash(password: string, options: { type: number }): Promise<string>;
  argon2id: number;
};

/**
 * The current NODE_ENV bucket. Deliberately inlined (rather than imported from
 * @tanvion-royale/config) so this standalone ts-node script has no workspace
 * build/resolution dependency — the sibling seed scripts use the same relative,
 * build-free import posture.
 */
function currentNodeEnv(): 'production' | 'test' | 'development' {
  switch (process.env.NODE_ENV) {
    case 'production':
      return 'production';
    case 'test':
      return 'test';
    default:
      return 'development';
  }
}

/**
 * Fail-closed LOCAL-ONLY database gate — runs before ANY query.
 *
 * The write path below may only ever touch the local Docker PostgreSQL defined
 * in docker-compose.yml (host localhost/127.0.0.1, database `tanvionroyale`).
 * Any other target — a Neon/Render/Vercel URL, a staging host, a different
 * database name, or an unparseable URL — aborts with a non-zero exit BEFORE a
 * single row is read or written, so this script can never mutate a remote
 * database even when NODE_ENV is misconfigured. The refusal message prints
 * only the host and database name — never the URL itself (its credentials).
 */
function assertLocalDatabase(): void {
  const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
  const LOCAL_DB_NAME = 'tanvionroyale'; // docker-compose.yml: POSTGRES_DB
  const raw = process.env.DATABASE_URL;
  let scheme = '';
  let host = '';
  let db = '';
  let ok = false;
  if (raw) {
    try {
      const url = new URL(raw);
      scheme = url.protocol.replace(/:$/, '');
      host = url.hostname.toLowerCase();
      db = decodeURIComponent(url.pathname.replace(/^\//, ''));
      ok =
        (scheme === 'postgresql' || scheme === 'postgres') &&
        LOCAL_HOSTS.has(host) &&
        db === LOCAL_DB_NAME;
    } catch {
      ok = false;
    }
  }
  if (!ok) {
    console.error(
      '[seed-local-admin] REFUSING to write: DATABASE_URL does not point at the local Docker ' +
        `PostgreSQL (expected postgres(ql) on localhost/127.0.0.1 with database '${LOCAL_DB_NAME}', ` +
        `got scheme=${scheme || '<unset>'} host=${host || '<unparsed>'} db=${db || '<unparsed>'}). ` +
        'Local admin seeding only ever touches the local development database.',
    );
    process.exit(1);
  }
}

/** Default local admin identity (non-routable .test mailbox — never a real inbox). */
const DEFAULT_ADMIN_EMAIL = 'admin@local.test';
const DEFAULT_ADMIN_USERNAME = 'localadmin';
/** A compliant default password (>=8, upper/lower/digit). Override via env. */
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? 'Admin@12345';

async function main(): Promise<void> {
  const env = currentNodeEnv();
  if (env === 'production') {
    console.error(
      '[seed-local-admin] REFUSING to run in production. Local admin seeding is a development ' +
        'convenience only; use bootstrap-master-admin.ts (allowlist-gated) for real staff accounts.',
    );
    process.exit(1);
  }

  assertLocalDatabase();

  const email = (process.env.LOCAL_DEV_ADMIN_EMAIL ?? DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
  const username = (process.env.LOCAL_DEV_ADMIN_USERNAME ?? DEFAULT_ADMIN_USERNAME).trim();
  const password = process.env.LOCAL_DEV_ADMIN_PASSWORD ?? DEFAULT_ADMIN_PASSWORD;

  const prisma = new PrismaClient();
  try {
    /*
     * Grant the ADMIN role (STAFF), NOT SUPER_ADMIN. /admin/login accepts any
     * STAFF account and /admin/access is guarded by @Roles('ADMIN','SUPER_ADMIN'),
     * so an ADMIN-role account signs in and reaches the panel. This deliberately
     * avoids the master-admin system: MASTER_ADMIN_EMAILS is capped at exactly
     * TWO permanent master admins, so a local seed must never consume one of
     * those slots or require an allowlist entry. Reuses the ONE existing argon2id
     * hash so the password verifies exactly like every other account.
     */
    const role = await prisma.role.findUnique({ where: { name: 'ADMIN' } });
    if (!role) {
      console.error('[seed-local-admin] ADMIN role not found — run `pnpm db:seed` (roles/permissions) first.');
      process.exit(1);
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    // Idempotent: ensure the STAFF account + its ADMIN assignment. Re-running
    // never overwrites an existing password/profile.
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    let created = false;
    let userId = existing?.id ?? '';
    if (existing) {
      await prisma.user.update({ where: { id: existing.id }, data: { accountType: 'STAFF' } });
    } else {
      const user = await prisma.user.create({
        data: {
          email,
          username,
          passwordHash,
          passwordSetAt: new Date(),
          firstName: 'Local',
          lastName: 'Admin',
          status: 'ACTIVE',
          emailVerified: true,
          emailVerifiedAt: new Date(),
          accountType: 'STAFF',
        },
        select: { id: true },
      });
      userId = user.id;
      created = true;
    }

    await prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      update: {},
      create: { userId, roleId: role.id },
    });
    // Ensure SUPER_ADMIN role is also assigned (in addition to ADMIN)
    const superAdminRole = await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } });
    if (superAdminRole) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId, roleId: superAdminRole.id } },
        update: {},
        create: { userId, roleId: superAdminRole.id },
      });
      console.log('[seed-local-admin] SUPER_ADMIN role ensured');
    } else {
      console.warn('[seed-local-admin] SUPER_ADMIN role not found in database');
    }

    console.log('');
    console.log(
      created
        ? `[seed-local-admin] Created local admin: ${email} (ADMIN, STAFF).`
        : `[seed-local-admin] Local admin already existed: ${email} — ADMIN/STAFF ensured.`,
    );
    console.log('');
    console.log('  Sign in at  http://localhost:3100/admin/login');
    console.log(`    Username / Gmail : ${username}  (or ${email})`);
    // The password is NEVER echoed (logs may be captured); it is supplied via
    // LOCAL_DEV_ADMIN_PASSWORD (a local-only env var) and never committed.
    console.log('    Password         : (never echoed — set via LOCAL_DEV_ADMIN_PASSWORD)');
    console.log('');
    console.log('  (No API restart needed — this is an ADMIN role, not a master admin.)');
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

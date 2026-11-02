#!/usr/bin/env node
/**
 * TANVIONROYALE — one-command local dev bootstrap (Windows / macOS / Linux).
 *
 *   pnpm dev:local            full pipeline, ends by starting `pnpm dev`
 *   pnpm dev:local --no-dev   pipeline only (infra + install + db), no dev servers
 *   pnpm dev:local --skip-install  reuse the existing node_modules
 *
 * Pipeline (see docs/local-dev.md for details):
 *   1. verify Node >= 20 and pnpm are available
 *   2. copy .env.example -> .env (never overwrite an existing .env)
 *   3. docker compose up -d   (Postgres + Redis) and wait for Postgres health
 *   4. pnpm install           (unless --skip-install)
 *   5. pnpm db:generate       (Prisma client)
 *   6. pnpm db:migrate        (apply migrations)
 *   7. pnpm db:seed           (RBAC + development catalog)
 *   8. pnpm db:seed:freeplay-user  (FREE-PLAY test user, no real funds)
 *   9. pnpm dev               (API + web), unless --no-dev
 *
 * Every step prints a banner, fails fast with a non-zero exit code and an
 * actionable message. `docker` is not required if Postgres/Redis are already
 * reachable on the default ports (e.g. local installs) — the script probes
 * first and skips compose in that case.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const NO_DEV = args.has('--no-dev');
const SKIP_INSTALL = args.has('--skip-install');

const isWindows = process.platform === 'win32';

function banner(text) {
  console.log(`\n=== ${text} ===`);
}

function fail(message) {
  console.error(`\n[dev:local] FAILED: ${message}`);
  process.exit(1);
}

/** Run a command with inherited stdio; throw on non-zero exit. */
function run(command, commandArgs, options = {}) {
  console.log(`> ${command} ${commandArgs.join(' ')}`);
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: isWindows, // .cmd shims (pnpm) need a shell on Windows
    ...options,
  });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${command} ${commandArgs.join(' ')} exited with code ${result.status}`);
  }
}

function tryRun(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    stdio: 'ignore',
    shell: isWindows,
  });
  return !result.error && result.status === 0;
}

/** Wait until something accepts TCP connections on host:port. */
function waitForPort(host, port, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host, port });
      const retryOrFail = () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`${label} did not accept connections on ${host}:${port} within ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 700);
        }
      };
      socket.once('connect', () => {
        socket.end();
        resolve();
      });
      socket.once('error', retryOrFail);
      socket.setTimeout(1500, retryOrFail);
    };
    attempt();
  });
}

// ---------------------------------------------------------------------------
// 1. Toolchain checks
// ---------------------------------------------------------------------------
banner('Checking toolchain');

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
if (!Number.isInteger(nodeMajor) || nodeMajor < 20) {
  fail(`Node >= 20 required (found ${process.versions.node}). Install from https://nodejs.org`);
}
console.log(`Node ${process.versions.node} OK`);

if (!tryRun('pnpm', ['--version'])) {
  fail('pnpm 9 not found. Enable corepack (`corepack enable`) or `npm i -g pnpm@9`.');
}
console.log('pnpm OK');

// ---------------------------------------------------------------------------
// 2. .env bootstrap (never overwrite developer edits)
// ---------------------------------------------------------------------------
banner('Environment file');

const envPath = path.join(ROOT, '.env');
const envExamplePath = path.join(ROOT, '.env.example');
if (fs.existsSync(envPath)) {
  console.log('.env already exists — leaving it untouched.');
} else if (fs.existsSync(envExamplePath)) {
  fs.copyFileSync(envExamplePath, envPath);
  console.log('Created .env from .env.example (defaults point at the docker-compose services).');
} else {
  fail('.env.example is missing — cannot bootstrap .env.');
}

// ---------------------------------------------------------------------------
// 3. Infrastructure (Postgres + Redis)
// ---------------------------------------------------------------------------
banner('Infrastructure (Postgres + Redis)');

const postgresUp = await waitForPort('127.0.0.1', 5432, 1000).then(
  () => true,
  () => false,
);
if (postgresUp) {
  console.log('Postgres already reachable on localhost:5432 — skipping docker compose.');
} else {
  if (!tryRun('docker', ['--version'])) {
    fail(
      'Docker is not available and nothing is listening on localhost:5432.\n' +
        '  Install Docker Desktop/Engine (https://docs.docker.com/get-docker/),\n' +
        '  or start a local Postgres on port 5432 and re-run.',
    );
  }
  if (!tryRun('docker', ['compose', 'version'])) {
    fail('Docker found but the `docker compose` plugin is missing. Install Docker Compose v2.');
  }
  run('docker', ['compose', 'up', '-d']);
  console.log('Waiting for Postgres to accept connections…');
  await waitForPort('127.0.0.1', 5432, 60_000, 'Postgres').catch((e) => fail(e.message));
  console.log('Postgres is up.');
  // Redis is optional for the Royale games; wait briefly but never block hard.
  await waitForPort('127.0.0.1', 6379, 10_000, 'Redis').then(
    () => console.log('Redis is up.'),
    () => console.log('Redis not reachable yet (queue features will retry later).'),
  );
}

// ---------------------------------------------------------------------------
// 4. Install dependencies
// ---------------------------------------------------------------------------
if (SKIP_INSTALL) {
  banner('Dependencies');
  console.log('--skip-install passed — reusing existing node_modules.');
} else {
  banner('Install dependencies');
  run('pnpm', ['install']);
}

// ---------------------------------------------------------------------------
// 5-8. Database: generate client, migrate, seed, FREE-PLAY test user
// ---------------------------------------------------------------------------
banner('Prisma generate');
run('pnpm', ['db:generate']);

banner('Database migrate');
// `prisma migrate deploy` (not `migrate dev`): the bootstrap must be
// non-interactive and needs no shadow database. `migrate dev` replays the
// whole historical chain in a fresh shadow DB every run, which fails with
// P3006/P1014 on migration 20260910000002 (it references PaymentMethod,
// created only by the later-numbered 20260912000001 — pre-existing chain
// ordering defect). `deploy` applies pending migrations only and is a no-op
// when the database is already up to date. Author migrations still use
// `pnpm db:migrate` (prisma migrate dev) manually.
run('pnpm', ['--filter', '@tanvion-royale/api', 'prisma:migrate:deploy']);

banner('Database seed (RBAC + dev catalog)');
run('pnpm', ['db:seed']);

banner('FREE-PLAY test user (points only — no real funds)');
run('pnpm', ['db:seed:freeplay-user']);


  banner('Local admin account (so /admin/login works locally)');
  run('pnpm', ['db:seed:admin']);

// ---------------------------------------------------------------------------
// 9. Dev servers
// ---------------------------------------------------------------------------
if (NO_DEV) {
  banner('Done');
  console.log('Infrastructure and database are ready. Start the apps with `pnpm dev`.');
} else {
  // Port availability first: a leftover API/web process on 3000/3100 would
  // make the dev servers fail with EADDRINUSE. Fails fast with instructions.
  banner('Port check (API 3000 / web 3100 — see docs/local-dev.md)');
  const portsResult = spawnSync('node', ['scripts/check-ports.mjs'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (portsResult.error) fail(`port check could not start: ${portsResult.error.message}`);
  if (portsResult.status !== 0) {
    fail(
      'Port already in use — see the message above.\n' +
        '  Stop the leftover process (`pnpm ports:free` stops only the port holder) and re-run.',
    );
  }

  banner('Starting dev servers (API + web — see docs/local-dev.md for ports)');
  run('pnpm', ['dev']);
}
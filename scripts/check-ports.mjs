#!/usr/bin/env node
/**
 * TANVIONROYALE — local dev port checker (Windows / macOS / Linux, ESM).
 *
 *   pnpm ports:check   (node scripts/check-ports.mjs)          report busy ports
 *   pnpm ports:free    (node scripts/check-ports.mjs --kill)   stop the holder
 *
 * Reads API_PORT (default 3000) and WEB_PORT (default 3100) from .env — no
 * other .env value is read or printed. Without --kill nothing is ever stopped;
 * with --kill only the process currently holding a busy port is stopped, and
 * only after printing its name and PID. Uses netstat/taskkill/tasklist on
 * Windows and lsof/kill on macOS/Linux — no bash-only commands.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const KILL = process.argv.includes('--kill');

/** Read a single numeric port key from .env (never echo the file contents). */
function readPortKey(file, key, fallback) {
  try {
    const match = fs
      .readFileSync(file, 'utf8')
      .match(new RegExp(`^\\s*${key}\\s*=\\s*(\\d+)\\s*`, 'm'));
    const value = match ? Number.parseInt(match[1], 10) : NaN;
    return Number.isInteger(value) && value > 0 && value <= 65535 ? value : fallback;
  } catch {
    return fallback; // no .env yet — use the documented defaults
  }
}

/** True when nothing is listening on <port> (bind probe on 0.0.0.0). */
function isFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '0.0.0.0');
  });
}

/** PIDs listening on `port`, via the platform's native tool. */
function findListeners(port) {
  if (isWindows) {
    const res = spawnSync('netstat', ['-ano'], { encoding: 'utf8' });
    if (res.error || res.status !== 0 || !res.stdout) return [];
    const pids = new Set();
    for (const line of res.stdout.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      // e.g. TCP  0.0.0.0:3000  0.0.0.0:0  LISTENING  6384
      if (cols.length < 5 || cols[0].toUpperCase() !== 'TCP') continue;
      if (cols[3].toUpperCase() !== 'LISTENING') continue;
      if (cols[1].split(':').pop() === String(port)) pids.add(cols[4]);
    }
    return [...pids];
  }
  const res = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
    encoding: 'utf8',
  });
  if (res.error || res.status !== 0 || !res.stdout) return []; // status 1 = nothing found
  return [...new Set(res.stdout.split(/\s+/).filter(Boolean))];
}

/** Best-effort process name for a PID (never fails the check). */
function processName(pid) {
  try {
    if (isWindows) {
      const res = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
      });
      const first = (res.stdout ?? '').split(/\r?\n/)[0] ?? '';
      const name = first.match(/^"([^"]+)"/)?.[1];
      return name && !/^INFO:/i.test(name) ? name : 'unknown';
    }
    const res = spawnSync('ps', ['-p', pid, '-o', 'comm='], { encoding: 'utf8' });
    const name = (res.stdout ?? '').trim().split('/').filter(Boolean).pop();
    return name || 'unknown';
  } catch {
    return 'unknown';
  }
}

function killCommandFor(pid) {
  return isWindows ? `taskkill /PID ${pid} /F` : `kill ${pid}`;
}

function findCommandFor(port) {
  return isWindows
    ? `netstat -ano | findstr :${port}`
    : `lsof -nP -iTCP:${port} -sTCP:LISTEN`;
}

function stopPid(pid) {
  if (isWindows) {
    const res = spawnSync('taskkill', ['/PID', pid, '/F'], { encoding: 'utf8' });
    return !res.error && res.status === 0;
  }
  const res = spawnSync('kill', ['-TERM', pid], { encoding: 'utf8' });
  return !res.error && res.status === 0;
}

// ---------------------------------------------------------------------------

const envPath = path.join(ROOT, '.env');
const targets = [
  { name: 'API', port: readPortKey(envPath, 'API_PORT', 3000) },
  { name: 'Web', port: readPortKey(envPath, 'WEB_PORT', 3100) },
];

console.log(
  KILL
    ? '[ports] Checking API_PORT/WEB_PORT — a busy port holder will be stopped (--kill).'
    : '[ports] Checking API_PORT/WEB_PORT — nothing will be stopped (use `pnpm ports:free` to stop a holder).',
);

let failed = false;
for (const { name, port } of targets) {
  if (await isFree(port)) {
    console.log(`[ports] ${port} ${name.padEnd(3)} FREE`);
    continue;
  }

  const pids = findListeners(port);
  console.log(`[ports] ${port} ${name.padEnd(3)} BUSY`);
  if (pids.length === 0) {
    console.log('[ports]   holder: unknown (could not resolve a PID)');
  }
  for (const pid of pids) {
    const procName = processName(pid);
    console.log(`[ports]   holder: PID ${pid} (${procName})`);
    console.log(`[ports]   find:   ${findCommandFor(port)}`);
    console.log(`[ports]   stop:   ${killCommandFor(pid)}`);
  }

  if (!KILL) {
    failed = true;
    continue;
  }

  for (const pid of pids) {
    const procName = processName(pid);
    console.log(`[ports]   stopping PID ${pid} (${procName})…`);
    if (!stopPid(pid)) {
      console.log(`[ports]   FAILED to stop PID ${pid} — try: ${killCommandFor(pid)}`);
      failed = true;
    }
  }
  // Verify — and on POSIX escalate once to SIGKILL for a stubborn holder.
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (!(await isFree(port)) && !isWindows) {
    for (const pid of findListeners(port)) {
      spawnSync('kill', ['-KILL', pid], { encoding: 'utf8' });
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (await isFree(port)) {
    console.log(`[ports] ${port} ${name.padEnd(3)} FREED`);
  } else {
    console.log(
      `[ports] ${port} ${name.padEnd(3)} STILL BUSY — stop it manually (commands above).`,
    );
    failed = true;
  }
}

if (failed) {
  console.error(
    '[ports] One or more ports are still in use. Stop the leftover process with the command above, then re-run.',
  );
  process.exit(1);
}
console.log('[ports] All checked ports are free.');

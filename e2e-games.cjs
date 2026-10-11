/**
 * End-to-end games verification (production-safe, local DB only).
 *
 * Boots the compiled API, registers a real user, and drives every free-play
 * game through the full flow: session -> actions -> engine result -> database.
 * No games are marked playable by this audit unless this script passes them.
 *
 * Usage: node e2e-games.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;

// ---------------------------------------------------------------------------
// Env loading (root .env) — names only are echoed, never values.
// ---------------------------------------------------------------------------
function loadRootEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue; // real env wins
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
loadRootEnv();

const PORT = Number(process.env.PORT || process.env.API_PORT || '3000');
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
function record(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`E2E| ${ok ? 'PASS' : 'FAIL'} | ${step} | ${detail}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// HTTP helpers (envelope: { success, data } on success; { statusCode, message } on error)
// ---------------------------------------------------------------------------
async function api(method, urlPath, opts = {}) {
  const { token, body } = opts;
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json };
}

function unwrap(res) {
  if (res.status >= 200 && res.status < 300 && res.json && res.json.success) {
    return { ok: true, data: res.json.data };
  }
  return {
    ok: false,
    status: res.status,
    message: (res.json && (res.json.message || res.json.error)) || `HTTP ${res.status}`,
  };
}

// ---------------------------------------------------------------------------
// API boot
// ---------------------------------------------------------------------------
function findApiEntry() {
  const candidates = [
    path.join(ROOT, 'apps', 'api', 'dist', 'main.js'),
    path.join(ROOT, 'apps', 'api', 'dist', 'src', 'main.js'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('Compiled API entry not found (dist/main.js or dist/src/main.js). Run the API build first.');
}

async function startApi() {
  const entry = findApiEntry();
  const child = spawn(process.execPath, [entry], {
    cwd: path.dirname(entry),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));
  child.on('exit', (code) => logs.push(`[exit code=${code}]`));

  const deadline = Date.now() + 60_000;
  let lastErr = 'no response';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/v1/health`);
      if (res.ok) return { child, logs };
      lastErr = `health ${res.status}`;
    } catch (e) {
      lastErr = String(e && e.cause ? e.cause.code || e.cause.message : e.message);
    }
    await sleep(700);
  }
  console.error('--- API LOG TAIL ---');
  console.error(logs.join('').slice(-4000));
  throw new Error(`API did not become healthy: ${lastErr}`);
}

// ---------------------------------------------------------------------------
// Game definitions (slug -> session payload + action driver)
// ---------------------------------------------------------------------------
const GAMES = [
  {
    slug: 'sky-rocket',
    sessionPayload: {},
    async drive(call) {
      // START -> TICK(s) -> CASH_OUT (or crash; either outcome is valid E2E)
      let r = await call('START');
      if (!r.ok) return r;
      let state = r.data.state || {};
      for (let i = 0; i < 4 && !r.data.finished && (state.phase || '').toUpperCase() === 'RUNNING'; i++) {
        await sleep(250);
        r = await call('TICK');
        if (!r.ok) return r;
        state = r.data.state || {};
        if (r.data.finished) return r;
      }
      if ((state.phase || '').toUpperCase() === 'RUNNING') {
        r = await call('CASH_OUT');
      }
      return r;
    },
  },
  { slug: 'lightning-dice', sessionPayload: { target: 'OVER_7' }, actions: ['ROLL'] },
  { slug: 'coin-flip', sessionPayload: {}, actions: ['FLIP'] },
  { slug: 'higher-or-lower', sessionPayload: {}, actions: [{ type: 'GUESS', payload: { guess: 'GUESS_HIGH' } }] },
  {
    slug: 'number-guess',
    sessionPayload: {},
    async drive(call) {
      // Bisect using the server-provided hint until finished (server holds secret).
      let lo = 1;
      let hi = 100;
      for (let i = 0; i < 8; i++) {
        const mid = Math.floor((lo + hi) / 2);
        const r = await call({ type: 'GUESS', payload: { n: mid } });
        if (!r.ok) return r;
        if (r.data.finished) return r;
        const hint = (r.data.state && r.data.state.hint) || '';
        if (hint === 'LOW') lo = mid + 1;
        else if (hint === 'HIGH') hi = mid - 1;
        else return r; // CORRECT or unknown
      }
      return { ok: false, status: 0, message: 'number-guess did not finish in 8 bisections' };
    },
  },
  { slug: 'rock-paper-scissors', sessionPayload: {}, actions: [{ type: 'PLAY', payload: { move: 'ROCK' } }] },
  { slug: 'dice-roll', sessionPayload: { pick: 3 }, actions: ['ROLL'] },
  { slug: 'wheel-spin', sessionPayload: {}, actions: ['SPIN'] },
  { slug: 'color-prediction', sessionPayload: { pick: 'RED' }, actions: ['DRAW'] },
  { slug: 'lucky-number', sessionPayload: { pick: 5 }, actions: ['DRAW'] },
  { slug: 'high-card', sessionPayload: {}, actions: ['DEAL'] },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  let api;
  try {
    api = await startApi();
    record('api-boot', true, `API healthy on :${PORT}`);

    // ---- Auth: register a unique user, then login -------------------------
    const stamp = Date.now();
    const email = `e2e_${stamp}@example.com`;
    const username = `e2e_${stamp}`;
    const password = 'Str0ngPassw0rd!';

    let reg = await api('POST', '/api/v1/auth/register', {
      body: { email, username, password, country: 'US' },
    });
    for (let i = 0; i < 3 && reg.status === 429; i++) {
      await sleep(5000); // register throttle: 5/min/IP
      reg = await api('POST', '/api/v1/auth/register', {
        body: { email, username, password, country: 'US' },
      });
    }
    const regU = unwrap(reg);
    if (!regU.ok) throw new Error(`register failed: HTTP ${reg.status} ${regU.message}`);
    const userId = regU.data && regU.data.id;

    const login = await api('POST', '/api/v1/auth/login', { body: { identifier: email, password } });
    const loginU = unwrap(login);
    if (!loginU.ok) throw new Error(`login failed: HTTP ${login.status} ${loginU.message}`);
    const token = loginU.data.accessToken;
    const authUid = loginU.data.user && loginU.data.user.id;
    record('auth-register-login', true, `user=${authUid || userId} (token received)`);

    // Negative: unauthenticated session creation must be rejected (401)
    const noAuthRes = await fetch(`${BASE}/api/v1/games/play/coin-flip/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    record(
      'games-session-unauth-401',
      noAuthRes.status === 401,
      `unauthenticated POST session -> HTTP ${noAuthRes.status}`,
    );

    // ---- Public catalog: /games must list exactly the internal games, ACTIVE
    const catalog = unwrap(await api('GET', '/api/v1/games'));
    if (!catalog.ok) throw new Error(`GET /games failed: ${catalog.status} ${catalog.message}`);
    const items = Array.isArray(catalog.data) ? catalog.data : catalog.data.items || [];
    const slugs = items.map((g) => g.slug).sort();
    const expected = GAMES.map((g) => g.slug).sort();
    const allActive = items.every((g) => (g.status || '').toUpperCase() === 'ACTIVE');
    record(
      'games-catalog',
      slugs.length === expected.length && expected.every((s) => slugs.includes(s)) && allActive,
      `catalog=${slugs.join(',')} allActive=${allActive}`,
    );

    // Unknown game meta -> 404
    const unknown = await api('GET', '/api/v1/games/play/not-a-real-game');
    record('games-unknown-404', unknown.status === 404, `GET meta unknown slug -> HTTP ${unknown.status}`);

    // ---- Per-game full flow ------------------------------------------------
    const dbCounts = { sessions: 0, results: 0 };
    for (const game of GAMES) {
      const step = `game:${game.slug}`;
      try {
        const meta = unwrap(await api('GET', `/api/v1/games/play/${game.slug}`));
        if (!meta.ok) throw new Error(`meta HTTP ${meta.status} ${meta.message}`);
        const metaStatus = (meta.data.status || '').toUpperCase();

        const start = unwrap(
          await api('POST', `/api/v1/games/play/${game.slug}/sessions`, {
            token,
            body: { payload: game.sessionPayload || {} },
          }),
        );
        if (!start.ok) throw new Error(`session HTTP ${start.status} ${start.message}`);
        const session = start.data;
        const sessionId = session.id;
        if (!sessionId) throw new Error('session response missing id');
        dbCounts.sessions++;

        const call = async (action) => {
          const a = typeof action === 'string' ? { type: action } : action;
          return unwrap(
            await api('POST', `/api/v1/games/play/${game.slug}/sessions/${sessionId}/actions`, {
              token,
              body: a,
            }),
          );
        };

        let result;
        if (game.drive) {
          result = await game.drive(call);
        } else {
          let last;
          for (const a of game.actions) {
            last = await call(a);
            if (!last.ok) break;
          }
          result = last;
        }
        if (!result.ok) throw new Error(`action HTTP ${result.status} ${result.message}`);
        const res = result.data.result;
        if (!res || !res.outcome) {
          throw new Error(`no engine result (state=${JSON.stringify(result.data.state).slice(0, 120)})`);
        }
        if (typeof res.score !== 'number') throw new Error('result.score missing');
        dbCounts.results++;
        record(step, true, 'session -> actions -> engine result OK');
      } catch (e) {
        record(step, false, e.message);
      }
    }

    // Invalid action type must be rejected (4xx, never 5xx)
    const cfStart = unwrap(
      await api('POST', '/api/v1/games/play/coin-flip/sessions', { token, body: {} }),
    );
    if (cfStart.ok) {
      const bad = await api(
        'POST',
        `/api/v1/games/play/coin-flip/sessions/${cfStart.data.id}/actions`,
        { token, body: { type: 'HACK_THE_PLANET' } },
      );
      record(
        'games-invalid-action-4xx',
        bad.status >= 400 && bad.status < 500,
        `invalid action -> HTTP ${bad.status}`,
      );
    } else {
      record('games-invalid-action-4xx', false, `could not open control session: ${cfStart.status}`);
    }

    // ---- Database persistence (direct DB read) ------------------------------
    try {
      const { Client } = require('pg');
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      const q = await client.query(
        'SELECT status, count(*)::int AS n FROM "GameSession" WHERE "userId" = $1 GROUP BY status',
        [authUid || userId],
      );
      const q2 = await client.query(
        'SELECT count(*)::int AS n FROM "GameResult" r JOIN "GameSession" s ON s.id = r."sessionId" WHERE s."userId" = $1',
        [authUid || userId],
      );
      await client.end();
      const byStatus = Object.fromEntries(q.rows.map((r) => [r.status, r.n]));
      const completed = byStatus.COMPLETED || 0;
      record(
        'db-persistence',
        completed === dbCounts.sessions && q2.rows[0].n >= dbCounts.results,
        `sessions=${JSON.stringify(byStatus)} results=${q2.rows[0].n} (expected sessions=${dbCounts.sessions}, results=${dbCounts.results})`,
      );
    } catch (e) {
      record('db-persistence', false, `DB check error: ${e.message}`);
    }

    // ---- Sports: public catalog must expose only football + cricket --------
    const sports = unwrap(await api('GET', '/api/v1/sports'));
    if (sports.ok) {
      const list = Array.isArray(sports.data) ? sports.data : sports.data.items || [];
      const sportSlugs = list.map((s) => s.slug).sort();
      record(
        'sports-catalog',
        sportSlugs.length === 2 && sportSlugs.includes('cricket') && sportSlugs.includes('football'),
        `sports=${sportSlugs.join(',')}`,
      );
    } else {
      record('sports-catalog', false, `GET /sports HTTP ${sports.status} ${sports.message}`);
    }
  } catch (e) {
    record('fatal', false, e.message);
  } finally {
    if (api) api.child.kill();
  }

  const failed = results.filter((r) => !r.ok);
  console.log('E2E| SUMMARY | ' + (failed.length === 0 ? 'ALL PASS' : `${failed.length} FAILED`));
  process.exit(failed.length === 0 ? 0 : 1);
})();

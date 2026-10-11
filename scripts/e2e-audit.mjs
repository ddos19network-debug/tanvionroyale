#!/usr/bin/env node
/**
 * TANVION ROYALE — production E2E audit (temporary tooling).
 *
 * Verifies, against a RUNNING API:
 *   1. Public sports catalog (Sports page data source).
 *   2. Free-play game metadata (public).
 *   3. Full authenticated game loop: register → login → create session →
 *      server-side action → result → DB persistence → play again → concede.
 *
 * Secrets are never printed. Usage:
 *   node scripts/e2e-audit.mjs [baseUrl]
 *   BASE_URL=https://tanvion-royale-api.onrender.com node scripts/e2e-audit.mjs
 */
const BASE_URL = (process.env.BASE_URL ?? process.argv[2] ?? 'http://localhost:3000').replace(/\/+$/, '');
const API = `${BASE_URL}/api/v1`;

let passed = 0;
let failed = 0;
function log(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (ok) passed += 1;
  else failed += 1;
}

async function api(method, path, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    return { ok: false, status: 0, json: null, error: String(err?.cause?.message ?? err?.message ?? err) };
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, json };
}

const unwrap = (r) => (r.json && typeof r.json === 'object' && 'data' in r.json ? r.json.data : r.json);

async function checkCatalog() {
  const health = await api('GET', '/health');
  log(health.ok, 'GET /health reachable', `HTTP ${health.status}`);

  const sports = await api('GET', '/sports');
  const data = unwrap(sports) ?? {};
  const sportsList = Array.isArray(data) ? data : (data.sports ?? []);
  log(
    sports.ok && sportsList.length > 0,
    'GET /sports returns catalog',
    sports.ok ? `${sportsList.length} sport(s): ${sportsList.map((s) => s?.slug).join(', ') || 'none'}` : `HTTP ${sports.status}`,
  );
  log(sportsList.some((s) => s?.slug === 'football'), 'Football present in catalog');
  log(sportsList.some((s) => s?.slug === 'cricket'), 'Cricket present in catalog');

  for (const slug of ['football', 'cricket']) {
    const events = await api('GET', `/sports/${slug}/events?limit=5`);
    const ed = unwrap(events) ?? {};
    const list = Array.isArray(ed) ? ed : (ed.events ?? []);
    log(events.ok, `GET /sports/${slug}/events`, events.ok ? `${list.length} event(s)` : `HTTP ${events.status}`);
    const ev = list[0];
    if (ev?.id) {
      const detail = await api('GET', `/events/${ev.id}`);
      const d = unwrap(detail) ?? {};
      const markets = Array.isArray(d.markets) ? d.markets : [];
      log(detail.ok, `GET /events/${ev.id} (match detail + markets)`, detail.ok ? `${markets.length} market(s)` : `HTTP ${detail.status}`);
    }
  }
}

async function checkGameMetadata() {
  const EXPECTED = ['sky-rocket', 'lightning-dice', 'coin-flip', 'higher-or-lower', 'number-guess', 'rock-paper-scissors', 'dice-roll', 'wheel-spin'];
  for (const slug of EXPECTED) {
    const meta = await api('GET', `/games/play/${slug}`);
    const m = unwrap(meta) ?? {};
    log(meta.ok && m?.slug === slug, `GET /games/play/${slug} metadata`, meta.ok ? (m?.title ?? '?') : `HTTP ${meta.status}`);
  }
  const anon = await api('POST', '/games/play/coin-flip/sessions', { body: {} });
  log(anon.status === 401, 'POST session without auth → 401', `HTTP ${anon.status}`);
}

async function registerAndLogin() {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const creds = { username: `e2e_${suffix}`, email: `e2e_${suffix}@example.test`, password: `E2e-Pass-${suffix}!aA1` };
  const reg = await api('POST', '/auth/register', { body: creds });
  log(reg.ok, 'POST /auth/register', reg.ok ? `user ${creds.username}` : `HTTP ${reg.status}`);
  const login = await api('POST', '/auth/login', { body: { identifier: creds.email, password: creds.password } });
  const token = unwrap(login)?.accessToken ?? (reg.ok ? unwrap(reg)?.accessToken : undefined);
  log(Boolean(token), 'POST /auth/login issues access token', token ? 'ok' : `HTTP ${login.status}`);
  return token;
}

function getSessionId(data) {
  return data?.session?.id ?? data?.id ?? null;
}

async function runGamePlan(token, [slug, startPayload, actions]) {
  const start = await api('POST', `/games/play/${slug}/sessions`, { token, body: { payload: startPayload } });
  const sessionId = getSessionId(unwrap(start));
  log(start.ok && Boolean(sessionId), `${slug}: POST session`, start.ok ? `session ${sessionId}` : `HTTP ${start.status}`);

  let roundFinished = false;
  let resultInfo = 'no result payload';
  let allOk = true;
  for (const [type, payload] of actions) {
    const r = await api('POST', `/games/play/${slug}/sessions/${sessionId}/actions`, { token, body: { type, payload } });
    const data = unwrap(r) ?? {};
    const finished = Boolean(data?.finished);
    if (payload?.invalid) {
      const rejected = r.status === 422 || r.status === 400;
      log(rejected, `${slug}: invalid action rejected by server`, `HTTP ${r.status}`);
      continue;
    }
    if (!r.ok) {
      allOk = false;
      log(false, `${slug}: action ${type}`, `HTTP ${r.status}`);
      continue;
    }
    if (finished) {
      roundFinished = true;
      const res = data?.result ?? data?.session?.result ?? null;
      resultInfo = res ? `outcome=${res?.outcome ?? '?'} score=${res?.score ?? '?'}` : 'finished w/o result payload';
    }
  }
  log(allOk, `${slug}: all actions accepted`, 'ok');
  log(roundFinished, `${slug}: server returned finished round + result`, resultInfo);

  const again = await api('POST', `/games/play/${slug}/sessions`, { token, body: { payload: startPayload } });
  const sid2 = getSessionId(unwrap(again));
  log(again.ok && Boolean(sid2), `${slug}: play again (second session)`, sid2 ? `session ${sid2}` : `HTTP ${again.status}`);
  if (sid2) {
    const concede = await api('POST', `/games/play/${slug}/sessions/${sid2}/actions`, { token, body: { type: 'CONCEDE' } });
    log(concede.ok, `${slug}: CONCEDE ends round`, `HTTP ${concede.status}`);
  }
}

async function checkResultsPersisted(token) {
  const results = await api('GET', '/games/play/coin-flip/results', { token });
  const rd = unwrap(results) ?? {};
  const rows = Array.isArray(rd) ? rd : (rd.results ?? rd.items ?? []);
  log(results.ok && rows.length > 0, 'GET /games/play/coin-flip/results (DB persistence)', `${rows.length} row(s)`);
}

async function main() {
  console.log(`E2E audit against ${BASE_URL}\n`);
  await checkCatalog();
  await checkGameMetadata();

  const token = await registerAndLogin();
  if (!token) return finish();

  // [slug, startPayload, actions] — { invalid: true } marks an action that must be rejected
  const plans = [
    ['sky-rocket', {}, [['START', {}], ['TICK', {}], ['TICK', {}], ['CASH_OUT', {}]]],
    ['lightning-dice', { target: 'OVER_7' }, [['ROLL', {}]]],
    ['coin-flip', { pick: 'HEADS' }, [['FLIP', {}]]],
    ['higher-or-lower', {}, [['GUESS', { guess: 'GUESS_HIGH' }]]],
    ['number-guess', {}, [['GUESS', { n: 50 }], ['GUESS', { n: 999, invalid: true }]]],
    ['rock-paper-scissors', {}, [['PLAY', { move: 'ROCK' }]]],
    ['dice-roll', { pick: 6 }, [['ROLL', {}]]],
    ['wheel-spin', {}, [['SPIN', {}]]],
  ];
  for (const plan of plans) await runGamePlan(token, plan);

  await checkResultsPersisted(token);
  finish();
}

function finish() {
  console.log(`\n===== E2E SUMMARY: ${passed} passed, ${failed} failed =====`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('E2E audit crashed:', err);
  process.exit(1);
});

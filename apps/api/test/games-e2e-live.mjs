/**
 * TANVIONROYALE — Free-play games END-TO-END verification (live HTTP).
 *
 * Runs against a REAL API + REAL Postgres:
 *   register → login → session → actions → engine → results → DB persistence
 * for all eight public free-play games, plus auth/ownership/validation
 * negative paths and a Sky Rocket crash-point leak check.
 *
 * Usage: node apps/api/test/games-e2e-live.mjs [baseUrl]
 */
const BASE = (process.argv[2] ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const API = `${BASE}/api/v1`;

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json };
}

function data(r) {
  if (!r.json || r.json.success !== true || r.json.data === undefined) {
    throw new Error(`unexpected envelope: HTTP ${r.status} ${JSON.stringify(r.json)?.slice(0, 300)}`);
  }
  return r.json.data;
}

const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
// ---------------------------------------------------------------------------
console.log(`E2E against ${API}\n`);

// 1. Health -----------------------------------------------------------------
{
  const r = await req('GET', '/health');
  ok('GET /health is 200', r.status === 200);
}

// 2. Register two users -------------------------------------------------------
const regA = await register(`e2e_a_${unique}`);
const regB = await register(`e2e_b_${unique}`);
ok('register returns accessToken', typeof regA.accessToken === 'string' && regA.accessToken.length > 20);
ok('register returns user', typeof regA.user?.id === 'string');
const A = regA.accessToken;
const B = regB.accessToken;

// 3. Login with the same credentials -----------------------------------------
{
  const r = await req('POST', '/auth/login', {
    body: { identifier: EMAIL_A, password: 'Str0ngPassw0rd!e2e' },
  });
  const d = r.status === 200 ? data(r) : null;
  ok('POST /auth/login works', r.status === 200 && typeof d?.accessToken === 'string');
}

// 4. Unauthenticated session creation is rejected -----------------------------
{
  const r = await startSession(undefined, 'coin-flip');
  ok('session without token → 401', r.status === 401, `HTTP ${r.status}`);
}

// 5. Public metadata -----------------------------------------------------------
{
  const r = await req('GET', '/games/play/coin-flip');
  const d = r.status === 200 ? data(r) : null;
  ok('GET /games/play/:slug (public meta)', r.status === 200 && d?.slug === 'coin-flip' && d?.kind === 'FREE_PLAY');
  const missing = await req('GET', '/games/play/does-not-exist');
  ok('unknown game meta → 404', missing.status === 404, `HTTP ${missing.status}`);
}

// 6. Ownership: user B cannot touch user A's session ---------------------------
{
  const s = await startSession(A, 'coin-flip');
  const sid = data(s).session.id;
  const r = await req('GET', `/games/play/coin-flip/sessions/${sid}`, { token: B });
  ok('foreign session read → 404', r.status === 404, `HTTP ${r.status}`);
  const x = await req('POST', `/games/play/coin-flip/sessions/${sid}/actions`, { token: B, body: { type: 'FLIP' } });
  ok('foreign session action → 404', x.status === 404, `HTTP ${x.status}`);
}

// 7. Invalid action type → 400 --------------------------------------------------
{
  const s = await startSession(A, 'coin-flip');
  const sid = data(s).session.id;
  const r = await req('POST', `/games/play/coin-flip/sessions/${sid}/actions`, { token: A, body: { type: 'HACK' } });
  ok('unsupported action → 400', r.status === 400, `HTTP ${r.status}`);
}

// 8. Action on a completed session → 409 ----------------------------------------
{
  const s = await startSession(A, 'coin-flip');
  const sid = data(s).session.id;
  await req('POST', `/games/play/coin-flip/sessions/${sid}/actions`, { token: A, body: { type: 'FLIP', payload: { choice: 'HEADS' } } });
  const r = await req('POST', `/games/play/coin-flip/sessions/${sid}/actions`, { token: A, body: { type: 'FLIP' } });
  ok('action on finished session → 409', r.status === 409, `HTTP ${r.status}`);
}

/** Drive a one-shot session: create, apply actions until finished, verify. */
async function drive(token, slug, { sessionPayload, actions }) {
  const start = await startSession(token, slug, sessionPayload);
  ok(`${slug}: session created`, start.status === 200 && data(start)?.session?.status === 'ACTIVE',
    start.status === 200 ? `id=${data(start).session.id}` : `HTTP ${start.status}`);
  if (start.status !== 200) throw new Error(`${slug}: cannot continue without a session`);
  const sid = data(start).session.id;
  let res = data(start);
  for (const step of actions) {

// ---------------------------------------------------------------------------
// 9. THE GAMES
// ---------------------------------------------------------------------------
console.log('\n— Coin Flip —');
{
  await drive(A, 'coin-flip', {
    actions: [
      {
        type: 'FLIP',
        payload: { choice: 'HEADS' },
        validate: (res) => {
          ok('coin-flip: server chose a fair side', res.session.state.flip === 'HEADS' || res.session.state.flip === 'TAILS', `flip=${res.session.state.flip}`);
          ok('coin-flip: outcome matches the flip', res.result ? res.result.outcome === (res.session.state.flip === 'HEADS' ? 'WIN' : 'LOSS') : true);
        },
      },
    ],
  });
}

console.log('\n— Sky Rocket (cash-out path) —');
{
  await drive(A, 'sky-rocket', {
    actions: [
      {
        type: 'START',
        validate: (res) => {
          ok('sky-rocket: phase RUNNING after START', res.session.state.phase === 'RUNNING', `phase=${res.session.state.phase}`);
          ok('sky-rocket: crashPoint NOT leaked while live', res.session.state.crashPoint === undefined, `crashPoint=${res.session.state.crashPoint}`);
        },
      },
      {
        type: 'CASH_OUT',
        validate: (res) => {
          ok('sky-rocket: finished round reveals crashPoint', typeof res.session.state.crashPoint === 'number', `crashPoint=${res.session.state.crashPoint}`);
          ok('sky-rocket: terminal phase', ['CASHED_OUT', 'CRASHED'].includes(res.session.state.phase), `phase=${res.session.state.phase}`);
        },
      },
    ],

console.log('\n— Sky Rocket (crash path via TICK) —');
{
  const start = await startSession(A, 'sky-rocket');
  const sid = data(start).session.id;
  await req('POST', `/games/play/sky-rocket/sessions/${sid}/actions`, { token: A, body: { type: 'START' } });
  let crashed = false;
  for (let i = 0; i < 60; i += 1) {
    const r = await req('POST', `/games/play/sky-rocket/sessions/${sid}/actions`, { token: A, body: { type: 'TICK' } });
    if (r.status !== 200) {
      ok('sky-rocket crash: TICK accepted', false, `HTTP ${r.status}`);
      break;
    }
    const res = data(r);
    if (res.finished) {
      crashed = res.session.state.phase === 'CRASHED' && typeof res.session.state.crashPoint === 'number';
      ok('sky-rocket: crash resolves server-side', crashed, `phase=${res.session.state.phase} cp=${res.session.state.crashPoint} ticks=${i + 1}`);
      ok('sky-rocket: crash outcome LOSS', res.result?.outcome === 'LOSS', `score=${res.result?.score}`);
      break;
    }
    await sleep(250);
  }
  ok('sky-rocket: round crashed within the tick window', crashed);
  await afterFinish(A, 'sky-rocket');
}

console.log('\n— Lightning Dice —');
{
  await drive(A, 'lightning-dice', {
    sessionPayload: { target: 'EXACT_7' },
    actions: [
      {
        type: 'ROLL',
        validate: (res) => {
          const dice = res.session.state.dice;
          const total = res.session.state.total ?? res.session.state.sum;
          ok('lightning-dice: three fair dice', Array.isArray(dice) && dice.length === 3 && dice.every((d) => Number.isInteger(d) && d >= 1 && d <= 6), `dice=${JSON.stringify(dice)}`);
          ok('lightning-dice: total consistent', Number.isInteger(total) && total === dice.reduce((a, b) => a + b, 0), `total=${total}`);
          ok('lightning-dice: outcome matches target EXACT_7', res.result ? (res.result.outcome === 'WIN') === (total === 7) : true, `outcome=${res.result?.outcome}`);
        },
      },
    ],
  });
}

console.log('\n— Higher or Lower —');
{
  await drive(A, 'higher-or-lower', {
    actions: [
      {
        type: 'GUESS',
        payload: { guess: 'GUESS_HIGH' },
        validate: (res) => {
          const { current, next } = res.session.state;
          ok('higher-lower: next drawn and different', Number.isInteger(next) && next !== current, `${current} → ${next}`);
          ok('higher-lower: outcome matches engine truth', res.result ? (res.result.outcome === 'WIN') === (next > current) : true, `outcome=${res.result?.outcome}`);
        },
      },
    ],
  });
}

  });
}

    const r = await req('POST', `/games/play/${slug}/sessions/${sid}/actions`, {
      token,
      body: { type: step.type, payload: step.payload },
    });
    const good = r.status === 200 && r.json?.data?.session;
    ok(`${slug}: action ${step.type}${step.payload ? ` ${JSON.stringify(step.payload)}` : ''}`, good,
      good ? `finished=${r.json.data.finished}${r.json.data.result ? ` → ${r.json.data.result.outcome}/${r.json.data.result.score} pts` : ''}` : `HTTP ${r.status} ${JSON.stringify(r.json)?.slice(0, 200)}`);
    if (!good) throw new Error(`${slug}: action ${step.type} failed`);
    res = r.json.data;
    if (step.validate) step.validate(res);
    if (res.finished) break;
  }
  ok(`${slug}: session completed`, res.finished === true && res.session.status === 'COMPLETED',
    `status=${res.session.status}`);
  await afterFinish(token, slug);
  return res;
}

console.log('\n— Number Guess (multi-action binary search) —');
{
  const start = await startSession(A, 'number-guess');
  const sid = data(start).session.id;
  let lo = 1;
  let hi = 100;
  let guesses = 0;
  let solved = false;
  let lastRes = null;
  for (let i = 0; i < 12; i += 1) {
    const mid = Math.floor((lo + hi) / 2);
    const r = await req('POST', `/games/play/number-guess/sessions/${sid}/actions`, {
      token: A,
      body: { type: 'GUESS', payload: { n: mid } },
    });
    if (r.status !== 200) {
      ok('number-guess: GUESS accepted', false, `HTTP ${r.status}`);
      break;
    }
    const res = data(r);
    guesses += 1;
    lastRes = res;
    if (res.finished) {
      solved = res.result?.outcome === 'WIN' && res.session.state.hint === 'CORRECT';
      ok('number-guess: solved server-side', solved, `secret=${res.session.state.secret ?? '?'} guesses=${guesses} score=${res.result?.score}`);
      break;
    }
    if (res.session.state.hint === 'LOW') lo = mid + 1;
    else if (res.session.state.hint === 'HIGH') hi = mid - 1;
    else {
      ok('number-guess: valid hint while unfinished', false, `hint=${res.session.state.hint}`);
      break;
    }
  }
  ok('number-guess: solved within log2 attempts', solved && guesses <= 8, `guesses=${guesses}`);
  ok('number-guess: session completed', lastRes?.session?.status === 'COMPLETED');
  await afterFinish(A, 'number-guess');
}

console.log('\n— Rock Paper Scissors —');
{
  await drive(A, 'rock-paper-scissors', {
    actions: [
      {
        type: 'PLAY',
        payload: { move: 'ROCK' },
        validate: (res) => {
          const cpu = res.session.state.cpuMove;
          ok('rps: server drew a valid move', ['ROCK', 'PAPER', 'SCISSORS'].includes(cpu), `cpu=${cpu}`);
          const win = cpu === 'SCISSORS';
          const draw = cpu === 'ROCK';
          ok('rps: outcome matches engine truth', res.result ? (res.result.outcome === 'WIN') === win && res.result.score === (win ? 100 : draw ? 20 : 0) : true, `outcome=${res.result?.outcome} score=${res.result?.score}`);
        },
      },
    ],
  });
}

console.log('\n— Dice Roll —');
{
  await drive(A, 'dice-roll', {
    sessionPayload: { pick: 3 },
    actions: [
      {
        type: 'ROLL',
        validate: (res) => {
          ok('dice-roll: fair die', Number.isInteger(res.session.state.dice) && res.session.state.dice >= 1 && res.session.state.dice <= 6, `dice=${res.session.state.dice}`);
          ok('dice-roll: outcome matches engine truth', res.result ? (res.result.outcome === 'WIN') === (res.session.state.dice === 3) : true, `outcome=${res.result?.outcome}`);
        },
      },
    ],
  });
}

console.log('\n— Wheel Spin —');
{
  const SEGMENTS = [0, 10, 25, 0, 50, 100, 0, 20, 5, 75];
  await drive(A, 'wheel-spin', {
    actions: [
      {
        type: 'SPIN',
        validate: (res) => {
          const idx = res.session.state.index;
          const prize = res.session.state.prize;
          ok('wheel-spin: valid segment index', Number.isInteger(idx) && idx >= 0 && idx < SEGMENTS.length, `index=${idx}`);
          ok('wheel-spin: prize matches the segment table', prize === SEGMENTS[idx], `prize=${prize} expected=${SEGMENTS[idx]}`);
          ok('wheel-spin: score equals prize', res.result ? res.result.score === prize : true);
        },
      },
    ],
  });
}

// 10. Results persisted ---------------------------------------------------------
console.log('\n— Database persistence (results) —');
for (const slug of ['coin-flip', 'sky-rocket', 'lightning-dice', 'higher-or-lower', 'number-guess', 'rock-paper-scissors', 'dice-roll', 'wheel-spin']) {
  const r = await req('GET', `/games/play/${slug}/results`, { token: A });
  const rows = r.status === 200 ? data(r) : null;
  ok(`results persisted for ${slug}`, Array.isArray(rows) && rows.length >= 1 && rows[0].gameSlug === slug && ['WIN', 'LOSS'].includes(rows[0].outcome), r.status === 200 ? `${rows.length} row(s), latest=${rows[0]?.outcome}/${rows[0]?.score}` : `HTTP ${r.status}`);
}

console.log(`\n==================== ${passed} passed, ${failed} failed ====================`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}


const EMAIL_A = `e2e_a_${unique}@e2e.example.com`;

async function register(username) {
  const r = await req('POST', '/auth/register', {
    body: {
      email: `${username}@e2e.example.com`,
      username,
      password: 'Str0ngPassw0rd!e2e',
    },
  });
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`register(${username}) failed: HTTP ${r.status} ${JSON.stringify(r.json)?.slice(0, 300)}`);
  }
  return data(r);
}

async function startSession(token, slug, payload) {
  return req('POST', `/games/play/${slug}/sessions`, { token, body: payload ? { payload } : {} });
}

async function afterFinish(token, slug) {
  const active = await req('GET', `/games/play/${slug}/sessions/active`, { token });
  const d = active.status === 200 ? data(active) : `HTTP ${active.status}`;
  ok(`${slug}: no active session after completion`, d === null, `active=${JSON.stringify(d)?.slice(0, 120)}`);
}

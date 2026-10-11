/**
 * TANVIONROYALE — end-to-end free-play games + sports smoke test.
 *
 * Runs against a RUNNING API (default http://127.0.0.1:3000/api/v1) and
 * exercises the complete production flow for every internally-owned game:
 *
 *   register → login → create session → server-validated action
 *   → engine result → GameResult persisted (verified via /results)
 *
 * plus the public sports catalog endpoints (football/cricket only).
 *
 * Usage: node apps/api/scripts/e2e-smoke.mjs
 * Env:   E2E_BASE (default http://127.0.0.1:3000/api/v1)
 */
const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3000/api/v1';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

let token = null;
async function api(method, path, body, withAuth = true) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(withAuth && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON (204 etc.) */
  }
  return { status: res.status, body: json };
}

const unwrap = (body) => body?.data ?? body;

// Per-game contract: session payload + action sequence. The loop below drives
// each game until `finished` (number-guess uses its hint loop).
const games = [
  { slug: 'sky-rocket', payload: {}, actions: [{ type: 'START' }, { type: 'TICK' }, { type: 'CASH_OUT' }] },
  { slug: 'lightning-dice', payload: { target: 'EXACT_7' }, actions: [{ type: 'ROLL' }] },
  { slug: 'coin-flip', payload: { pick: 'HEADS' }, actions: [{ type: 'FLIP' }] },
  { slug: 'higher-or-lower', payload: {}, actions: [{ type: 'GUESS', payload: { guess: 'GUESS_HIGH' } }] },
  { slug: 'rock-paper-scissors', payload: {}, actions: [{ type: 'PLAY', payload: { move: 'ROCK' } }] },
  { slug: 'dice-roll', payload: { pick: 3 }, actions: [{ type: 'ROLL' }] },
  { slug: 'wheel-spin', payload: {}, actions: [{ type: 'SPIN' }] },
  { slug: 'color-prediction', payload: { pick: 'RED' }, actions: [{ type: 'DRAW' }] },
  { slug: 'lucky-number', payload: { pick: 5 }, actions: [{ type: 'DRAW' }] },
  { slug: 'high-card', payload: {}, actions: [{ type: 'DEAL' }] },
  { slug: 'number-guess', payload: {}, actions: [] },
];

async function main() {
  // 0. Sports catalog (public) -------------------------------------------------
  const sportsRes = await api('GET', '/sports', undefined, false);
  const sports = unwrap(sportsRes.body);
  const football = Array.isArray(sports) ? sports.find((s) => s.slug === 'football') : null;
  const cricket = Array.isArray(sports) ? sports.find((s) => s.slug === 'cricket') : null;
  record('GET /sports returns 200', sportsRes.status === 200, `status=${sportsRes.status}`);
  record('football sport active', Boolean(football && (football.status ?? 'ACTIVE') === 'ACTIVE'));
  record('cricket sport active', Boolean(cricket && (cricket.status ?? 'ACTIVE') === 'ACTIVE'));

  for (const slug of ['football', 'cricket']) {
    const comps = await api('GET', `/sports/${slug}/competitions`, undefined, false);
    const list = unwrap(comps.body);
    record(
      `GET /sports/${slug}/competitions`,
      comps.status === 200 && Array.isArray(list),
      `status=${comps.status} count=${Array.isArray(list) ? list.length : 'n/a'}`,
    );
  }

  const eventsRes = await api('GET', '/events', undefined, false);
  record('GET /events returns 200', eventsRes.status === 200, `status=${eventsRes.status}`);

  // 1. Auth -------------------------------------------------------------------
  const stamp = Date.now();
  const email = `e2e-${stamp}@example.com`;
  const username = `e2e_${stamp}`;
  const password = 'Str0ngPassw0rd!';
  const reg = await api('POST', '/auth/register', { email, username, password }, false);
  record('register', [200, 201, 409].includes(reg.status), `status=${reg.status}`);

  const login = await api('POST', '/auth/login', { identifier: email, password }, false);
  const loginData = unwrap(login.body) ?? {};
  token = loginData.accessToken ?? loginData.access_token ?? null;
  record('login + access token', login.status === 200 && Boolean(token), `status=${login.status}`);

  // 2. Auth guards ------------------------------------------------------------
  const noAuth = await fetch(`${BASE}/games/play/coin-flip/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  record('session without token rejected (401)', noAuth.status === 401, `status=${noAuth.status}`);

  const bogus = await api('POST', '/games/play/no-such-game/sessions', {});
  record('unknown game slug rejected (404)', bogus.status === 404, `status=${bogus.status}`);

  await runGameLoops();
  reportSummary();
}
async function runGameLoops() {
  for (const game of games) {
    const start = await api('POST', `/games/play/${game.slug}/sessions`, { payload: game.payload });
    const session = unwrap(start.body);
    if (start.status !== 201 && start.status !== 200) {
      record(`${game.slug}: create session`, false, `status=${start.status} body=${JSON.stringify(start.body)}`);
      continue;
    }
    record(`${game.slug}: create session`, Boolean(session?.id), `id=${session?.id}`);

    const sid = session.id;
    const act = async (action) => {
      const r = await api('POST', `/games/play/${game.slug}/sessions/${sid}/actions`, action);
      return { r, data: unwrap(r.body) };
    };

    let finished = false;
    let lastResult = null;
    let attempts = 0;
    let low = 1;
    let high = 100;
    while (!finished && attempts < 40) {
      const action =
        game.slug === 'number-guess'
          ? { type: 'GUESS', payload: { n: Math.floor((low + high) / 2) } }
          : game.actions[attempts];
      if (!action) break;
      const { r, data } = await act(action);
      attempts += 1;
      if ([400, 409, 422].includes(r.status)) {
        // Engine rejected the action (e.g. crash burst before CASH_OUT) —
        // valid behavior. Confirm the session reached a terminal phase.
        const cur = await api('GET', `/games/play/${game.slug}/sessions/${sid}`);
        const phase = unwrap(cur.body)?.state?.phase;
        finished = ['CRASHED', 'CASHED_OUT', 'ROLLED', 'SPUN', 'DEALT', 'DRAWN', 'PLAYED', 'REVEALED', 'GUESSED'].includes(phase);
        record(`${game.slug}: illegal action rejected by engine`, finished, `status=${r.status} phase=${phase}`);
        break;
      }
      if (r.status !== 200 && r.status !== 201) {
        record(`${game.slug}: action ${attempts}`, false, `status=${r.status} body=${JSON.stringify(r.body)}`);
        break;
      }
      finished = Boolean(data?.finished);
      lastResult = data?.result ?? null;
      if (game.slug === 'number-guess' && !finished) {
        const hint = data?.state?.hint;
        const guess = action.payload.n;
        if (hint === 'LOW') low = guess + 1;
        else if (hint === 'HIGH') high = guess - 1;
      }
    }

    record(
      `${game.slug}: round finished with result`,
      finished && lastResult !== null && typeof lastResult.score === 'number',
      `outcome=${lastResult?.outcome} score=${lastResult?.score}`,
    );

    // Replaying a finished round must be rejected — proves server-side state.
    const replay =
      game.slug === 'number-guess' ? { type: 'GUESS', payload: { n: 1 } } : (game.actions[0] ?? { type: 'START' });
    const illegal = await act(replay);
    record(
      `${game.slug}: post-finish action rejected (400/409)`,
      [400, 409, 422].includes(illegal.r.status),
      `status=${illegal.r.status}`,
    );

    // GameResult persistence — verified through the authenticated /results API.
    const resList = await api('GET', `/games/play/${game.slug}/results`);
    const rows = unwrap(resList.body);
    record(
      `${game.slug}: result persisted in DB`,
      resList.status === 200 && Array.isArray(rows) && rows.some((x) => x.gameSlug === game.slug),
      `rows=${Array.isArray(rows) ? rows.length : 'n/a'}`,
    );
  }
}

function reportSummary() {
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log(`\nE2E_SUMMARY pass=${pass} fail=${fail} total=${results.length}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('E2E fatal:', err);
  process.exitCode = 1;
});

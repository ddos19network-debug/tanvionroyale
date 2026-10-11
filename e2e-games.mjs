/**
 * TANVIONROYALE — end-to-end free-play games + sports API verification.
 * Runs against a LIVE API instance (default http://localhost:3000).
 * Verifies: auth → session create → server-side actions → result persistence
 * → replay guard → negative paths → sports catalog endpoints.
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3000/api/v1';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  PASS ${name}`);
  } else {
    fail++;
    failures.push(`${name} ${extra}`);
    console.log(`  FAIL ${name} ${extra}`);
  }
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
async function main() {
  console.log(`E2E against ${BASE}`);

  // ---- health -------------------------------------------------------------
  const health = await api('GET', '/health');
  check('GET /health responds', health.status === 200, `status=${health.status}`);

  // ---- auth: register + login --------------------------------------------
  const uniq = `e2e${Date.now().toString(36).slice(-6)}`;
  const email = `${uniq}@example.com`;
  const password = 'Str0ngPassw0rd!';

  const reg = await api('POST', '/auth/register', {
    body: { email, username: uniq, password, firstName: 'E2E', lastName: 'Runner' },
  });
  check('POST /auth/register 201', reg.status === 201, `status=${reg.status} body=${JSON.stringify(reg.json)}`);

  const noAuth = await api('POST', '/games/play/coin-flip/sessions', { body: {} });
  check('session create without token → 401', noAuth.status === 401, `status=${noAuth.status}`);

  const login = await api('POST', '/auth/login', { body: { identifier: email, password } });
  check(
    'POST /auth/login + accessToken',
    (login.status === 200 || login.status === 201) && !!login.json?.data?.accessToken,
    `status=${login.status}`,
  );
  const token = login.json?.data?.accessToken;
  if (!token) throw new Error('No access token — cannot continue');

  // ---- games --------------------------------------------------------------
  const G = (p) => `/games/play/${p}`;
  const startSession = async (slug, payload) =>
    api('POST', `${G(slug)}/sessions`, { token, body: payload ? { payload } : {} });
  const act = async (slug, sessionId, type, payload) =>
    api('POST', `${G(slug)}/sessions/${sessionId}/actions`, {
      token,
      body: { type, ...(payload ? { payload } : {}) },
    });
  const results = async (slug) => api('GET', `${G(slug)}/results`, { token });

  async function runGame(slug, opts, run) {
    const s = await startSession(slug, opts?.payload);
    check(
      `[${slug}] session created (ACTIVE)`,
      (s.status === 201 || s.status === 200) && s.json?.data?.session?.id && s.json?.data?.session?.status === 'ACTIVE',
      `status=${s.status} body=${JSON.stringify(s.json)?.slice(0, 200)}`,
    );
    const sessionId = s.json?.data?.session?.id;
    if (!sessionId) return;
    try {
      await run(sessionId, s.json.data.session.state);
    } catch (e) {
      check(`[${slug}] flow completed`, false, `error=${e.message}`);
    }
    const r = await results(slug);
    check(
      `[${slug}] result persisted in DB (GET /results)`,
      r.status === 200 && Array.isArray(r.json?.data) && r.json.data.length >= 1,
      `status=${r.status} len=${r.json?.data?.length}`,
    );
  }

  // Sky Rocket — crash game with server-side clock
  await runGame('sky-rocket', null, async (sessionId) => {
    let a = await act('sky-rocket', sessionId, 'START');
    check('[sky-rocket] START accepted, round RUNNING', a.status === 200 && a.json?.data?.session?.state?.phase === 'RUNNING', `status=${a.status} phase=${a.json?.data?.session?.state?.phase}`);
    check('[sky-rocket] crash point hidden while live', a.json?.data?.session?.state?.crashPoint === undefined, 'crashPoint leaked!');
    let finished = false;
    for (let i = 0; i < 30 && !finished; i++) {
      await sleep(250);
      a = await act('sky-rocket', sessionId, 'TICK');
      const st = a.json?.data?.session?.state;
      if (a.status !== 200) break;
      if (st?.phase === 'CRASHED') finished = true;
      else if ((st?.multiplier ?? 0) >= 1.15) {
        a = await act('sky-rocket', sessionId, 'CASH_OUT');
        finished = true;
      }
    }
    const fin = a.json?.data;
    check(
      '[sky-rocket] round finished server-side (WIN or LOSS)',
      finished && fin?.finished === true && ['WIN', 'LOSS'].includes(fin?.result?.outcome) && (fin?.session?.status === 'COMPLETED'),
      `finished=${fin?.finished} outcome=${fin?.result?.outcome} status=${fin?.session?.status}`,
    );
    check('[sky-rocket] crash point revealed after finish', typeof a.json?.data?.session?.state?.crashPoint === 'number');
    const replay = await act('sky-rocket', sessionId, 'TICK');
    check('[sky-rocket] replay guarded → 409', replay.status === 409, `status=${replay.status}`);
  });

  // Lightning Dice — target bet at session creation
  await runGame('lightning-dice', { target: 'EXACT_7' }, async (sessionId) => {
    const a = await act('lightning-dice', sessionId, 'ROLL');
    check(
      '[lightning-dice] ROLL → finished with dice outcome',
      a.status === 200 && a.json?.data?.finished === true && ['WIN', 'LOSS'].includes(a.json?.data?.result?.outcome),
      `status=${a.status} outcome=${a.json?.data?.result?.outcome}`,
    );
  });

  // Coin Flip
  await runGame('coin-flip', { pick: 'HEADS' }, async (sessionId) => {
    const a = await act('coin-flip', sessionId, 'FLIP');
    check('[coin-flip] FLIP → finished', a.status === 200 && a.json?.data?.finished === true, `status=${a.status}`);
  });

  // Higher or Lower
  await runGame('higher-or-lower', null, async (sessionId) => {
    const a = await act('higher-or-lower', sessionId, 'GUESS', { guess: 'GUESS_HIGH' });
    check('[higher-or-lower] GUESS → finished', a.status === 200 && a.json?.data?.finished === true, `status=${a.status}`);
  });

  // __PART2B__
}

main().catch((e) => {
  console.error('E2E runner crashed:', e);
  process.exit(1);
});
